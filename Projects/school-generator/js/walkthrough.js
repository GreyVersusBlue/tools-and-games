// walkthrough.js — first-person pointer-lock camera. Still no-clip: collision
// and stair navigation are Phase 5, once there are props to bump into. What
// multi-floor adds here is a spawn on the storey you were editing, and a
// vertical range that reaches the whole building rather than one 10ft slice.

import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { CELL, EYE_H, cellIdx, activeFloor, floorBaseY, topOfBuilding } from './grid.js';
import { shapesOf, shapeArea, shapeBBox, interiorPoint } from './shapes.js';

const WALK_SPEED = 12;   // ft/s
const SPRINT_SPEED = 24; // ft/s

export function initWalkthrough(camera, domElement) {
  const controls = new PointerLockControls(camera, domElement);
  const keys = new Set();
  let active = false;
  let ceiling = 80;   // fly-up limit, raised to clear the tallest building

  document.addEventListener('keydown', (e) => {
    if (!active) return;
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

  return {
    controls,
    enable(state) {
      active = true;
      keys.clear();
      // Start on the floor you were just editing, not always the ground.
      const p = spawnPoint(activeFloor(state));
      const eye = floorBaseY(state, state.currentFloor) + EYE_H;
      ceiling = topOfBuilding(state) + 40;
      camera.position.set(p.x, eye, p.z);
      camera.lookAt(p.x + p.lookX * 20, eye, p.z + p.lookZ * 20);
    },
    disable() {
      active = false;
      keys.clear();
      if (controls.isLocked) controls.unlock();
    },
    update(dt) {
      if (!active || !controls.isLocked) return;
      const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? SPRINT_SPEED : WALK_SPEED;
      const fwd = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
      const right = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
      const up = (keys.has('Space') ? 1 : 0) - (keys.has('KeyC') ? 1 : 0);
      if (fwd) controls.moveForward(fwd * speed * dt);
      if (right) controls.moveRight(right * speed * dt);
      if (up) camera.position.y = Math.min(ceiling, Math.max(1.5, camera.position.y + up * speed * dt));
    },
  };
}
