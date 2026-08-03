import * as THREE from 'three';

const AURA = { green: 0x6FCF6A, amber: 0xE8B23A, red: 0xE0553C };

function box(scene, registry, size, mat, pos) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), mat);
  m.position.set(pos[0], pos[1], pos[2]);
  scene.add(m); registry.add(m);
  return m;
}

// T4: the desks are the room and do not move (that is T5). The people do. So
// the furniture is built once per desk, and each body is then placed at whatever
// desk the seating chart put them at.
export function buildStudents(scene, registry, mats, data, chart) {
  const { bodyOffsetZ } = data.seatGrid;
  const students = [];

  for (const d of chart.desks) {
    box(scene, registry, [0.72, 0.05, 0.52], mats.desk, [d.x, 0.72, d.z]);
    for (const [dx, dz] of [[-0.3, -0.2], [0.3, -0.2], [-0.3, 0.2], [0.3, 0.2]]) {
      box(scene, registry, [0.06, 0.7, 0.06], mats.metal, [d.x + dx, 0.36, d.z + dz]);
    }
    box(scene, registry, [0.44, 0.05, 0.42], mats.metal, [d.x, 0.45, d.z + bodyOffsetZ]);
  }

  {
    let i = 0;
    for (const spec of data.roster) {
      const seat = chart.deskOf(i);
      const x = seat.x, z = seat.z;

      const g = new THREE.Group();
      g.position.set(x, 0, z + bodyOffsetZ);
      scene.add(g);

      const shirt = mats[spec.shirt] || mats.shirtA;
      const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.22, 0.55, 10), shirt);
      torso.position.y = 0.78; g.add(torso); registry.add(torso);

      const head = new THREE.Group();
      head.position.y = 1.18; g.add(head);

      const skull = new THREE.Mesh(new THREE.SphereGeometry(0.135, 14, 12), mats.skin);
      head.add(skull); registry.add(skull);

      const hair = new THREE.Mesh(new THREE.SphereGeometry(0.145, 14, 10, 0, Math.PI * 2, 0, 1.5), mats.hair);
      hair.position.y = 0.01; head.add(hair); registry.add(hair);

      const legs = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.42), shirt);
      legs.position.set(0, 0.5, -0.24); g.add(legs); registry.add(legs);

      // Comprehension aura (lesson T2). Deliberately NOT registered with the
      // material registry: it has its own palette and must not thermal-swap.
      const aura = new THREE.Mesh(
        new THREE.TorusGeometry(0.19, 0.018, 6, 20),
        new THREE.MeshBasicMaterial({ color: AURA.amber, transparent: true, opacity: 0.85 })
      );
      aura.rotation.x = Math.PI / 2;
      aura.position.y = 1.42;
      aura.visible = false;
      g.add(aura);

      students.push({
        name: spec.name, note: spec.note || '', tension: spec.tension,
        aptitude: spec.aptitude ?? 1, steady: spec.steady ?? 0,
        // `seat` is who they are. `desk` is where they are. They used to be the
        // same number and T4 is the ticket where that stopped being true.
        seat: i, desk: seat.index, col: seat.col, row: seat.row,
        x, z, bodyZ: z + bodyOffsetZ,
        rowGain: seat.rowGain, sight: seat.sight.kind, steadyLoad: 0,
        group: g, torso, head, aura,
        phase: Math.random() * 7,
        rx: [], holds: new Map(),
        comp: 0, compShown: 0
      });
      i++;
    }
  }
  return students;
}

// Move the bodies to wherever the chart says, once the player has stopped
// dragging names around. The desks stay where they are.
export function placeStudents(students, chart, bodyOffsetZ) {
  for (const s of students) {
    const d = chart.deskOf(s.seat);
    s.group.position.set(d.x, s.group.position.y, d.z + bodyOffsetZ);
  }
  return students;
}

// ---------------------------------------------------------------------------
// T1 — reactions. Poses are data (data/reactions.json); this is the tween.
// A pose is a small bag of offsets and an envelope: attack in, hold, release out.
// ---------------------------------------------------------------------------

// A student's body faces -Z. Yaw that turns them to face a world point:
function aimYawTo(student, x, z) {
  const dx = x - student.x, dz = z - student.bodyZ;
  const len = Math.hypot(dx, dz) || 1;
  return Math.atan2(-dx / len, -dz / len);
}

function envelope(r, pose) {
  const attack = pose.attack ?? 0.1;
  const release = pose.release ?? 0.8;
  const hold = pose.hold ? Infinity : Math.max(0, (pose.dur || 0) - attack - release);
  const t = r.t;
  if (t < 0) return 0;
  if (t < attack) return t / attack;
  if (t < attack + hold) return 1;
  if (hold === Infinity) return 1;
  const out = 1 - (t - attack - hold) / release;
  return Math.max(0, out);
}

export function createReactions({ students, data, camera }) {
  const poses = data.poses;

  function push(student, poseName, { scale = 1, delay = 0, key = null, partner = null } = {}) {
    const pose = poses[poseName];
    if (!pose) return null;
    const r = {
      pose, name: poseName, scale, key,
      t: -delay,
      aim: pose.aimHead ? aimYawTo(student, camera.position.x, camera.position.z) : 0,
      aimPartner: pose.aimPartner && partner ? aimYawTo(student, partner.x, partner.bodyZ) : 0,
      done: false
    };
    // A held pose replaces any earlier hold under the same key.
    if (pose.hold && key != null) {
      release(student, key);
      student.holds.set(key, r);
    }
    student.rx.push(r);
    return r;
  }

  function release(student, key) {
    if (!student) return;
    for (const r of student.rx) {
      if (r.key === key && r.pose.hold) {
        // convert the hold into a release: freeze the envelope and let it decay
        r.pose = { ...r.pose, hold: false, dur: r.t + (r.pose.release ?? 0.8), attack: Math.min(r.pose.attack ?? 0.1, r.t || 0.01) };
      }
    }
    student.holds.delete(key);
  }

  // One student, one pose.
  function play(student, poseName, opts) {
    if (!student || !poseName) return;
    push(student, poseName, opts);
  }

  // Everyone, staggered outward from a point. Used for escalation ripples and
  // for whole-room beats like a check for understanding.
  function wave(poseName, { from = camera.position, scale = 1, delayPerMetre = 0.05, skip = null } = {}) {
    for (const s of students) {
      if (skip && skip.has(s.seat)) continue;
      const d = Math.hypot(s.x - from.x, s.bodyZ - from.z);
      push(s, poseName, { scale, delay: d * delayPerMetre });
    }
  }

  // The escalation ripple: the row turns around, one after another.
  function ripple(subject, cfg) {
    const from = { x: subject.x, z: subject.bodyZ };
    for (const s of students) {
      if (cfg.skipSubject && s.seat === subject.seat) continue;
      const d = Math.hypot(s.x - from.x, s.bodyZ - from.z);
      if (d > cfg.radius) continue;
      push(s, cfg.pose, { scale: cfg.scale * (1 - d / cfg.radius * 0.5), delay: d * cfg.delayPerMetre });
    }
  }

  function tick(dt, { auraFor } = {}) {
    for (const s of students) {
      let headYaw = 0, headPitch = 0, torsoDip = 0, idleScale = 1, freeze = 0;

      for (let i = s.rx.length - 1; i >= 0; i--) {
        const r = s.rx[i];
        r.t += dt;
        const e = envelope(r, r.pose) * r.scale;
        if (r.t > 0 && e <= 0 && !r.pose.hold) { s.rx.splice(i, 1); continue; }
        if (e <= 0) continue;
        const p = r.pose;
        if (p.aimHead) headYaw += r.aim * p.aimHead * e;
        if (p.aimPartner) headYaw += r.aimPartner * p.aimPartner * e;
        if (p.headPitch) headPitch += p.headPitch * e;
        if (p.torsoDip) torsoDip += p.torsoDip * e;
        if (p.idleScale != null) idleScale = Math.min(idleScale, 1 - (1 - p.idleScale) * e);
        if (p.freeze) freeze = Math.max(freeze, e);
      }

      const idle = idleScale * (1 - freeze);
      s.phase += dt * (0.6 + s.tension * 0.5) * (0.35 + idle * 0.65);
      s.group.position.y = Math.sin(s.phase) * 0.012 * idle - torsoDip;
      s.head.rotation.y = Math.sin(s.phase * 0.45) * 0.35 * idle + Math.max(-1.2, Math.min(1.2, headYaw));
      s.head.rotation.x = headPitch;
      s.torso.rotation.x = torsoDip * 2.2;

      if (auraFor) {
        const band = auraFor(s);
        if (band) {
          s.aura.visible = true;
          s.aura.material.color.setHex(AURA[band]);
        } else {
          s.aura.visible = false;
        }
      } else {
        s.aura.visible = false;
      }
    }
  }

  return { play, wave, ripple, release, tick };
}
