// walkthrough.js — first-person pointer-lock camera, now with a body.
//
// Phase 5: the camera collides. Walls, glass, railings and floor-standing
// furniture stop you; doorways let you through; a floor edge or the lip of a
// mezzanine stops you rather than dropping you; and gravity is what lands you
// after a jump or after leaving ghost mode in mid-air. All of the geometry
// behind that lives in collide.js — this file owns the camera, the keys and
// the timestep, the same way propedit.js owns pointers and propplace.js owns
// the math.
//
// Ghost mode (`F`) is the old no-clip flight, kept because inspecting a design
// from inside a wall is a legitimate thing to want from a floor-plan tool —
// and because a building with no stairs yet has no other way up.

import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { CELL, EYE_H, cellIdx, activeFloor, floorBaseY, topOfBuilding } from './grid.js';
import { shapesOf, shapeArea, shapeBBox, interiorPoint } from './shapes.js';
import { catalogEntry } from './catalog.js';
import { stairUnder } from './stairs.js';
import {
  GRAVITY, TERMINAL_V, JUMP_V, STEP_UP,
  buildCollider, emptyCollider, moveWalker, supportAt, storeyAt,
} from './collide.js';

const WALK_SPEED = 12;   // ft/s
const SPRINT_SPEED = 24; // ft/s
// How far the camera may be off a stair's surface and still ride it in ghost
// mode. Walking uses collide.js's support test instead — this is only the
// courtesy that keeps a ghost from drifting through a run they're following.
const RIDE_BAND = 7;     // ft
// Never let a stalled frame turn into a step wider than a room. collide.js
// refuses a step that crosses a wall outright, so a long one would read as
// "blocked" rather than as teleporting through it; capping it here means a
// dropped frame costs you distance instead of stopping you dead.
const MAX_STEP = 1.5;    // ft

export function initWalkthrough(camera, domElement, opts = {}) {
  const controls = new PointerLockControls(camera, domElement);
  const keys = new Set();
  let active = false;
  let ceiling = 80;   // fly-up limit, raised to clear the tallest building
  let world = null;   // the state being walked, for the stairs under our feet
  let ghost = false;  // no-clip flight — the pre-Phase-5 behaviour
  let vy = 0;         // vertical velocity, ft/s
  let grounded = false;
  let colliders = new Map();
  let hudText = '';

  const fwdV = new THREE.Vector3();

  const colliderFor = (i) => {
    if (!world || !world.floors[i]) return emptyCollider();
    let c = colliders.get(i);
    if (!c) { c = buildCollider(world, i, catalogEntry); colliders.set(i, c); }
    return c;
  };

  function reportHud() {
    if (!opts.onHud) return;
    const feet = camera.position.y - EYE_H;
    const level = world ? storeyAt(world, feet) + 1 : 1;
    const text = `Level ${level} · ${ghost ? 'ghost (no-clip)' : 'walking'}`;
    if (text === hudText) return;
    hudText = text;
    opts.onHud(text);
  }

  document.addEventListener('keydown', (e) => {
    if (!active) return;
    if (e.code === 'KeyF') { ghost = !ghost; vy = 0; grounded = false; reportHud(); return; }
    keys.add(e.code);
    if (e.code === 'Space') e.preventDefault();
  });
  document.addEventListener('keyup', (e) => keys.delete(e.code));

  function spawnPoint(f) {
    let sx = 0, sy = 0, n = 0;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let y = 0; y < f.h; y++)
      for (let x = 0; x < f.w; x++)
        if (f.cells[cellIdx(f, x, y)]) {
          sx += x + 0.5; sy += y + 0.5; n++;
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        }
    if (n === 0) {
      // A storey can be all polygon rooms and no grid cells — stand in the
      // biggest one rather than in the middle of an empty lattice.
      const biggest = shapesOf(f).reduce(
        (best, s) => (!best || shapeArea(s) > shapeArea(best) ? s : best), null);
      if (biggest) {
        const p = interiorPoint(biggest);
        const bb = shapeBBox(biggest);
        const wide = bb.x1 - bb.x0 >= bb.z1 - bb.z0;
        return {
          x: p.x, z: p.z,
          lookX: wide ? (bb.x1 - p.x >= p.x - bb.x0 ? 1 : -1) : 0,
          lookZ: wide ? 0 : (bb.z1 - p.z >= p.z - bb.z0 ? 1 : -1),
        };
      }
      return { x: (f.w * CELL) / 2, z: (f.h * CELL) / 2, lookX: 0, lookZ: -1 };
    }
    // nearest floored cell to the centroid, so we spawn inside the building
    const cx = sx / n, cy = sy / n;
    let best = null, bestD = Infinity;
    for (let y = 0; y < f.h; y++)
      for (let x = 0; x < f.w; x++)
        if (f.cells[cellIdx(f, x, y)]) {
          const d = (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2;
          if (d < bestD) { bestD = d; best = { x: x + 0.5, y: y + 0.5 }; }
        }
    // face along the building's longer axis, toward the side with more space
    let lookX, lookZ;
    if (maxX - minX >= maxY - minY) {
      lookX = (maxX + 1 - best.x) >= (best.x - minX) ? 1 : -1;
      lookZ = 0;
    } else {
      lookX = 0;
      lookZ = (maxY + 1 - best.y) >= (best.y - minY) ? 1 : -1;
    }
    return { x: best.x * CELL, z: best.y * CELL, lookX, lookZ };
  }

  // Ghost flight: exactly what the camera did before this phase — no
  // collision, no gravity, and a courtesy ride up a stair you walk onto.
  function updateGhost(dt, fwd, right, speed) {
    const up = (keys.has('Space') ? 1 : 0) - (keys.has('KeyC') ? 1 : 0);
    if (fwd) controls.moveForward(fwd * speed * dt);
    if (right) controls.moveRight(right * speed * dt);
    if (up) {
      camera.position.y = Math.min(ceiling, Math.max(1.5, camera.position.y + up * speed * dt));
      return;
    }
    if (!world || !(fwd || right)) return;
    const ride = stairUnder(world, camera.position.x, camera.position.z, camera.position.y - EYE_H);
    if (!ride) return;
    const target = ride.y + EYE_H;
    if (Math.abs(camera.position.y - target) > RIDE_BAND) return;
    camera.position.y = target;
  }

  // Walking: a circle on a surface. Horizontal movement is resolved against
  // the storey under your feet, then the surface it found decides your height.
  function updateWalk(dt, fwd, right, speed) {
    const feet = camera.position.y - EYE_H;

    // Heading, flattened: looking at the ceiling shouldn't slow you down or
    // walk you into the floor.
    camera.getWorldDirection(fwdV);
    fwdV.y = 0;
    if (fwdV.lengthSq() < 1e-9) fwdV.set(0, 0, -1);
    fwdV.normalize();
    const rx = -fwdV.z, rz = fwdV.x;

    let dx = fwdV.x * fwd + rx * right;
    let dz = fwdV.z * fwd + rz * right;
    const mag = Math.hypot(dx, dz);
    if (mag > 1e-9) {
      const step = Math.min(speed * dt, MAX_STEP);
      dx = (dx / mag) * step;
      dz = (dz / mag) * step;
    } else { dx = 0; dz = 0; }

    const collider = colliderFor(storeyAt(world, feet));
    const moved = moveWalker(world, collider, { x: camera.position.x, y: feet, z: camera.position.z },
      dx, dz, { grounded });
    camera.position.x = moved.x;
    camera.position.z = moved.z;

    // Vertical. `support` came back from the same query that vetted the step,
    // so standing and walking agree about what the floor is.
    const support = moved.support || supportAt(world, moved.x, moved.z, feet);
    const surface = support ? support.y : 0;
    let y = feet;
    if (grounded) {
      if (surface <= feet + STEP_UP) y = surface;
      if (keys.has('Space')) { vy = JUMP_V; grounded = false; }
    } else {
      vy = Math.max(-TERMINAL_V, vy - GRAVITY * dt);
      const next = feet + vy * dt;
      // Land using the surface found at the *start* of the fall, so a long
      // frame drops through a slab's height without dropping through the slab.
      if (vy <= 0 && next <= surface) { y = surface; vy = 0; grounded = true; }
      else y = next;
    }
    camera.position.y = y + EYE_H;
  }

  return {
    controls,
    get ghost() { return ghost; },
    enable(state) {
      active = true;
      world = state;
      keys.clear();
      colliders = new Map();
      ghost = false;
      vy = 0;
      grounded = false;
      hudText = '';
      // Start on the floor you were just editing, not always the ground.
      const p = spawnPoint(activeFloor(state));
      const eye = floorBaseY(state, state.currentFloor) + EYE_H;
      ceiling = topOfBuilding(state) + 40;
      camera.position.set(p.x, eye, p.z);
      camera.lookAt(p.x + p.lookX * 20, eye, p.z + p.lookZ * 20);
      reportHud();
    },
    disable() {
      active = false;
      world = null;
      keys.clear();
      colliders = new Map();
      if (controls.isLocked) controls.unlock();
    },
    update(dt) {
      if (!active || !controls.isLocked) return;
      const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? SPRINT_SPEED : WALK_SPEED;
      const fwd = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
      const right = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
      if (ghost || !world) updateGhost(dt, fwd, right, speed);
      else updateWalk(dt, fwd, right, speed);
      reportHud();
    },
  };
}
