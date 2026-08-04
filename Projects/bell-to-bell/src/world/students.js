import * as THREE from 'three';
import { tiled } from './materials.js';
import { fitFootprint, fitHeight, registerModel, findBone, poseIdle } from './models.js';

const AURA = { green: 0x6FCF6A, amber: 0xE8B23A, red: 0xE0553C };
// A thermal camera reads body heat, not clothing — every loaded character
// gets the same flat "person" thermal color regardless of outfit, matching
// mats.skin's thermal twin rather than inventing a separate constant.
const CHAR_THERMAL = 0xFF9C4A;

function box(scene, registry, mats, matKey, size, pos) {
  const dims = [...size].sort((a, b) => b - a);
  const mat = tiled(mats, matKey, dims[0], dims[1]);
  const m = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), mat);
  m.position.set(pos[0], pos[1], pos[2]);
  scene.add(m); registry.add(m);
  return m;
}

// Desk + chair are a visual-only upgrade — nothing reads their geometry
// (collision is a distance check against the student's own position, not
// this mesh), so a failed fetch just leaves the original box in place.
async function buildDeskFurniture(scene, registry, loader, modelPaths, mats, d, bodyOffsetZ) {
  let gotDesk = false, gotChair = false;

  if (loader && modelPaths.studentDesk) {
    try {
      const desk = await loader.loadStatic(modelPaths.studentDesk);
      fitFootprint(desk, 0.72, 0.52);
      desk.position.x += d.x; desk.position.z += d.z;
      registerModel(desk, registry, mats.desk.userData.thermal.color.getHex());
      scene.add(desk);
      gotDesk = true;
    } catch (err) {
      console.warn('studentDesk model failed to load, using placeholder box.', err);
    }
  }
  if (loader && modelPaths.studentChair) {
    try {
      const chair = await loader.loadStatic(modelPaths.studentChair);
      fitFootprint(chair, 0.44, 0.42);
      chair.position.x += d.x; chair.position.z += d.z + bodyOffsetZ;
      registerModel(chair, registry, mats.metal.userData.thermal.color.getHex());
      scene.add(chair);
      gotChair = true;
    } catch (err) {
      console.warn('studentChair model failed to load, using placeholder box.', err);
    }
  }

  if (!gotDesk) {
    box(scene, registry, mats, 'desk', [0.72, 0.05, 0.52], [d.x, 0.72, d.z]);
    for (const [dx, dz] of [[-0.3, -0.2], [0.3, -0.2], [-0.3, 0.2], [0.3, 0.2]]) {
      box(scene, registry, mats, 'metal', [0.06, 0.7, 0.06], [d.x + dx, 0.36, d.z + dz]);
    }
  }
  if (!gotChair) {
    box(scene, registry, mats, 'metal', [0.44, 0.05, 0.42], [d.x, 0.45, d.z + bodyOffsetZ]);
  }
}

// Load one rigged outfit and hand back the two bones reactions.js actually
// drives. If the rig doesn't have them (an outfit pack with a different
// skeleton, say), this bails to null rather than half-wiring a body no
// system can pose — buildStudents falls back to the original primitive body.
async function buildCharacterBody(loader, outfitPath, targetHeight, registry) {
  if (!loader || !outfitPath) return null;
  try {
    const { root, animations } = await loader.loadRigged(outfitPath);
    // Pose BEFORE measuring: fitHeight/the floor-settle below both bound the
    // model with Box3, and this rig's raw bind pose measures as a tiny,
    // curled-up ~0.5m box, not a standing one — measuring before poseIdle
    // scaled every character to several times its intended height.
    poseIdle(root, animations);
    fitHeight(root, targetHeight);
    const settle = new THREE.Box3().setFromObject(root);
    root.position.y -= settle.min.y;

    const head = findBone(root, ['Head']);
    // Chest first: rotating it swings the upper body the way the original
    // single torso cylinder did, without dragging the legs along the way
    // rotating Hips (parent of both spine and legs in most rigs) would.
    const torso = findBone(root, ['Chest', 'Spine1', 'Spine', 'Hips']);
    if (!head || !torso) return null;

    // A bone's rest rotation (baked in by poseIdle, above) is almost never
    // (0,0,0) — bind-pose joints carry a real local orientation relative to
    // their parent. reactions.js only ever wants to ADD a yaw/pitch/dip on
    // top of "standing naturally," so the rest pose has to be captured here
    // and re-added every frame, not overwritten. Skipping this folded every
    // character in half at the chest the instant idle torsoDip hit zero.
    const headRestX = head.rotation.x, headRestY = head.rotation.y;
    const torsoRestX = torso.rotation.x;

    registerModel(root, registry, CHAR_THERMAL);
    return { root, head, torso, headRestX, headRestY, torsoRestX };
  } catch (err) {
    console.warn(`Character model failed to load (${outfitPath}), using placeholder body.`, err);
    return null;
  }
}

// T4: the desks are the room and do not move (that is T5). The people do. So
// the furniture is built once per desk, and each body is then placed at
// whatever desk the seating chart put them at.
export async function buildStudents(scene, registry, mats, data, chart, opts = {}) {
  const { loader, assets } = opts;
  const modelPaths = assets?.models || {};
  const charCfg = assets?.characters;
  const targetHeight = charCfg?.targetHeight || 1.48;
  const { bodyOffsetZ } = data.seatGrid;

  await Promise.all(
    chart.desks.map(d => buildDeskFurniture(scene, registry, loader, modelPaths, mats, d, bodyOffsetZ))
  );

  const students = new Array(data.roster.length);

  await Promise.all(data.roster.map(async (spec, i) => {
    const seat = chart.deskOf(i);
    const x = seat.x, z = seat.z;

    const g = new THREE.Group();
    g.position.set(x, 0, z + bodyOffsetZ);
    scene.add(g);

    const outfitPath = charCfg?.outfits?.length ? charCfg.outfits[i % charCfg.outfits.length] : null;
    const built = await buildCharacterBody(loader, outfitPath, targetHeight, registry);

    let torso, head, auraY, headRestX = 0, headRestY = 0, torsoRestX = 0;

    if (built) {
      g.add(built.root);
      torso = built.torso;
      head = built.head;
      headRestX = built.headRestX; headRestY = built.headRestY;
      torsoRestX = built.torsoRestX;
      auraY = targetHeight + 0.08;
    } else {
      const shirt = mats[spec.shirt] || mats.shirtA;
      torso = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.22, 0.55, 10), shirt);
      torso.position.y = 0.78; g.add(torso); registry.add(torso);

      head = new THREE.Group();
      head.position.y = 1.18; g.add(head);

      const skull = new THREE.Mesh(new THREE.SphereGeometry(0.135, 14, 12), mats.skin);
      head.add(skull); registry.add(skull);

      const hair = new THREE.Mesh(new THREE.SphereGeometry(0.145, 14, 10, 0, Math.PI * 2, 0, 1.5), mats.hair);
      hair.position.y = 0.01; head.add(hair); registry.add(hair);

      const legs = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.42), shirt);
      legs.position.set(0, 0.5, -0.24); g.add(legs); registry.add(legs);

      auraY = 1.42;
    }

    // Comprehension aura (lesson T2). Deliberately NOT registered with the
    // material registry: it has its own palette and must not thermal-swap.
    const aura = new THREE.Mesh(
      new THREE.TorusGeometry(0.19, 0.018, 6, 20),
      new THREE.MeshBasicMaterial({ color: AURA.amber, transparent: true, opacity: 0.85 })
    );
    aura.rotation.x = Math.PI / 2;
    aura.position.y = auraY;
    aura.visible = false;
    g.add(aura);

    students[i] = {
      name: spec.name, note: spec.note || '', tension: spec.tension,
      aptitude: spec.aptitude ?? 1, steady: spec.steady ?? 0,
      // `seat` is who they are. `desk` is where they are. They used to be the
      // same number and T4 is the ticket where that stopped being true.
      seat: i, desk: seat.index, col: seat.col, row: seat.row,
      x, z, bodyZ: z + bodyOffsetZ,
      rowGain: seat.rowGain, sight: seat.sight.kind, steadyLoad: 0,
      group: g, torso, head, aura, headRestX, headRestY, torsoRestX,
      phase: Math.random() * 7,
      rx: [], holds: new Map(),
      comp: 0, compShown: 0
    };
  }));

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
      s.head.rotation.y = s.headRestY + Math.sin(s.phase * 0.45) * 0.35 * idle + Math.max(-1.2, Math.min(1.2, headYaw));
      s.head.rotation.x = s.headRestX + headPitch;
      s.torso.rotation.x = s.torsoRestX + torsoDip * 2.2;

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
