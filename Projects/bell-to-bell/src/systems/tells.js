import * as THREE from 'three';
import { CFG } from '../config.js';

// A tell is something true about the room that a normal glance would miss.
// It has a birth, a lifespan, a world position, and a line of sight that the
// furniture is allowed to break.
export function createTellSystem({ scene, camera, students, data, occluders, schedule, onBorn, onGone }) {
  const defs = data.types;
  const tells = [];
  const ray = new THREE.Raycaster();
  let nextId = 0;

  function positionFor(type, seat, seat2) {
    const def = defs[type];
    const a = students[seat];
    if (def.anchor === 'pair' && seat2 != null) {
      const b = students[seat2];
      return new THREE.Vector3((a.x + b.x) / 2, def.height ?? 0.8, (a.bodyZ + b.bodyZ) / 2);
    }
    return new THREE.Vector3(a.x + 0.18, 0.52, a.bodyZ - 0.1);
  }

  function create(type, seat, seat2, atGameTime, life, extra = {}) {
    const t = {
      id: ++nextId, type, seat, seat2,
      at: atGameTime, life,
      born: null, dead: false, resolved: false,
      // T4: the position is resolved at birth, not now. Between now and then the
      // player is on the seating chart screen moving these people around.
      pos: null,
      obj: null, el: null,
      substituted: extra.substituted ?? null
    };
    tells.push(t);
    return t;
  }

  // Load a schedule. atMinute counts elapsed minutes into the period. The rows
  // handed in here are the ones the seating chart says this room will actually
  // produce (systems/chart.js resolveSchedule) — not necessarily the authored ones.
  function load(rows) {
    tells.length = 0;
    for (const row of rows) {
      create(row.type, row.seat, row.seat2 ?? row.with, CFG.periodSeconds - row.atMinute * 60,
             row.life, { substituted: row.substituted });
    }
    return tells;
  }

  load(schedule || data.schedule);

  function buildMesh(t) {
    const grp = new THREE.Group();
    grp.position.copy(t.pos);
    const a = students[t.seat];
    const b = t.seat2 != null ? students[t.seat2] : null;

    if (t.type === 'NOTE' && b) {
      const note = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 0.09),
        new THREE.MeshBasicMaterial({ color: 0xFF7A18 }));
      grp.add(note);
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(a.x, 0.8, a.bodyZ),
        new THREE.Vector3((a.x + b.x) / 2, 1.0, (a.bodyZ + b.bodyZ) / 2),
        new THREE.Vector3(b.x, 0.8, b.bodyZ)
      ]);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xFF7A18, transparent: true, opacity: 0.75 }));
      line.position.sub(t.pos);
      grp.add(line);
    } else if (t.type === 'COPYING' && b) {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(a.x, 0.76, a.z), new THREE.Vector3(b.x, 0.76, b.z)
      ]);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xFF7A18 }));
      line.position.sub(t.pos);
      grp.add(line);
    } else if (t.type === 'WHISPER') {
      grp.add(new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0xFF9C4A, transparent: true, opacity: 0.85 })));
    } else {
      grp.add(new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.005, 0.16),
        new THREE.MeshBasicMaterial({ color: 0xFFD166 })));
    }

    grp.visible = false;
    scene.add(grp);
    t.obj = grp;
  }

  // The blind-spot rule. This is the reason the furniture exists.
  function hasLineOfSight(target) {
    const from = camera.position.clone();
    const dir = target.clone().sub(from);
    const dist = dir.length();
    dir.normalize();
    ray.set(from, dir);
    ray.far = dist - 0.12;
    return ray.intersectObjects(occluders, false).length === 0;
  }

  function isVisible(t) {
    if (t.born === null || t.dead || !t.pos) return false;
    if (camera.position.distanceTo(t.pos) > CFG.withitnessRange) return false;
    return hasLineOfSight(t.pos);
  }

  function kill(t) {
    if (t.dead) return;
    t.dead = true;
    if (t.obj) t.obj.visible = false;
    if (t.el) { t.el.remove(); t.el = null; }
    onGone?.(t);
  }

  function update(state, onExpire) {
    for (const t of tells) {
      if (t.born === null && state.t <= t.at) {
        t.born = state.t;
        t.pos = positionFor(t.type, t.seat, t.seat2);
        buildMesh(t);
        t.obj.visible = state.withitness;
        onBorn?.(t);
      }
      if (t.born !== null && !t.dead && (t.born - state.t) > t.life) {
        const wasResolved = t.resolved;
        kill(t);
        if (!wasResolved) onExpire(t);
      }
    }
  }

  function spawnFalsePositive(state) {
    const seat = 2 + Math.floor(Math.random() * (students.length - 3));
    const t = create('FALSE', seat, undefined, state.t, 150);
    t.born = state.t;
    t.pos = positionFor(t.type, t.seat, t.seat2);
    buildMesh(t);
    t.obj.visible = state.withitness;
    onBorn?.(t);
    return t;
  }

  // Drop the DOM annotations without killing the tells themselves.
  function clearLabels() {
    for (const t of tells) if (t.el) { t.el.remove(); t.el = null; }
  }

  function setThermalVisible(on) {
    for (const t of tells) if (t.obj) t.obj.visible = on && t.born !== null && !t.dead;
  }

  function describe(t) {
    const def = defs[t.type];
    return (def.copy || '')
      .replace('{a}', students[t.seat].name)
      .replace('{b}', t.seat2 != null ? students[t.seat2].name : '');
  }

  return { tells, defs, load, update, isVisible, kill, spawnFalsePositive, setThermalVisible, clearLabels, describe };
}
