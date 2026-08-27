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
//
// Phase 4 of the second arc adds the third thing the walker owes the rest of
// the build: the moments worth hearing. This file is where the distance walked
// and the surface under it are already known, so it is where a stride turns
// into a footstep — the geometry stays in collide.js, the material lookup in
// finish.js, the cadence arithmetic in sound.js, and what actually comes out of
// the speaker in audio.js. This file only says *when*, which is the one part
// none of them can see.
//
// Phase 2 adds the two things in a building that respond to you rather than
// just standing there. Doors swing open as you approach and shut behind you —
// the leaves live on the collider (see openings.js), this file only advances
// them once a frame and hands the result to the renderer to pose. And an
// elevator moves you: press E at the doors and the car comes.
//
// That last one was a teleport for fifteen phases, and the reason given was
// that "a lift that takes eight seconds to arrive is realism nobody
// inspecting a floor plan asked for". Phase 15 built the car anyway — for the
// crowd, because a timetable makes forty people want one at nine minutes past
// nine — and left the camera teleporting past it, which is the standing
// backlog's *"the walkthrough's own `E` key still teleports"*. It doesn't any
// more. Pressing E calls the car; when its doors open you step in; the floor
// under you is the car's own height until it puts you down. The state machine
// is lift.js's `stepRider` and none of it is here, for the reason nothing
// testable is ever here.

import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { CELL, EYE_H, activeFloor, floorBaseY, topOfBuilding } from './grid.js';
import { shapesOf, shapeArea, shapeBBox, interiorPoint } from './shapes.js';
import { catalogEntry } from './catalog.js';
import { finishAt } from './finish.js';
import { stairUnder, elevatorAt } from './stairs.js';
import {
  makeLifts, liftFor, liftAtHand, makeRider, pressRider, stepRider, cancelRider,
  stepLifts, liftText,
} from './lift.js';
import { stride, footstepFor } from './sound.js';
import { terrainField, emptyField, groundAt } from './terrain.js';
import { siteSurfaceAt, surfaceEntry } from './site.js';
import {
  GRAVITY, TERMINAL_V, JUMP_V, STEP_UP,
  buildCollider, emptyCollider, moveWalker, supportAt, storeyAt, updateDoorsFor,
  refreshProps,
} from './collide.js';
import { shoveProps } from './shove.js';
import { lookEulerDelta } from './touch.js';
import { stickVector, turnStep, XR_SPEED, XR_SPRINT, SNAP_ANGLE } from './xr.js';

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
// ...which is the other half of a bargain that only works if the frames keep
// coming. `MAX_STEP` caps *one* step; the page's loop caps `dt` at a tenth of
// a second; and together they mean that a browser drawing this building at
// eight frames a second simulates 0.8 of every second, and one drawing it at
// two frames a second simulates a fifth. What that looks like from a chair is
// **WASD not working**: you hold W, the building creeps, and you conclude the
// key is dead. Measured on a software rasterizer here: three seconds of held
// W moved the camera 2.4ft, when 12 ft/s says it owed you 36.
//
// So the walker no longer takes the frame's word for how much time passed. It
// keeps its own accumulator and spends it in fixed steps, however many of them
// this frame can afford — the physics run at a constant rate whatever the
// renderer manages, which is also what makes a step never skip a wall.
const FIXED_STEP = 1 / 60;   // s of simulated time per physics step
// ...bounded, because catching up is not the same as replaying. A tab that was
// hidden for a minute, a laptop that came out of sleep, a stall on a big
// rebuild: the walker owes you the movement you were asking for, not sixty
// seconds of it arriving at once through the wall of the room you are in.
const MAX_CATCHUP = 0.5;     // s of simulated time per frame
const MAX_STEPS = Math.ceil(MAX_CATCHUP / FIXED_STEP);
// Following somebody: their own eye height, and where the over-the-shoulder
// camera sits relative to them. Far enough back to see them walk, near enough
// that a corridor doesn't put a wall between you.
const EYE_FOLLOW = 5.4;  // ft
const OTS_BACK = 8;      // ft
const OTS_UP = 2.2;      // ft

export function initWalkthrough(camera, domElement, opts = {}) {
  const controls = new PointerLockControls(camera, domElement);
  const keys = new Set();
  let active = false;
  let ceiling = 80;   // fly-up limit, raised to clear the tallest building
  let world = null;   // the state being walked, for the stairs under our feet
  // The graded ground, swept once at walk-start and shared by every storey's
  // collider. It has the same lifetime as the colliders and for the same
  // reason: editing and walking are exclusive, so the site cannot change
  // under you mid-walk.
  let site = emptyField();
  let ghost = false;  // no-clip flight — the pre-Phase-5 behaviour
  let vy = 0;         // vertical velocity, ft/s
  let grounded = false;
  let colliders = new Map();
  let hudText = '';
  // Distance carried between frames, so footsteps come out of how far you have
  // walked rather than off a timer: walking slowly makes slower footsteps for
  // free, and stopping mid-stride keeps the fraction for when you start again.
  let strideAcc = 0;
  // Simulated time owed to the body but not yet spent — see FIXED_STEP.
  let stepAcc = 0;
  // Phase 6. The other people in the building, if there are any: a function
  // the caller hands over that answers "who else is on this storey", which is
  // all this file ever needs to know about a crowd. Nobody by default, which
  // is the whole of the pre-Phase-6 behaviour.
  let bodiesOn = opts.bodies || (() => null);
  // ...and whose eyes we are looking through, if anyone's. `follow` is null
  // for the ordinary camera, or { agent, mode } while riding along with
  // somebody — the wishlist's "day in the life", which turns out to be the
  // camera giving up its own body rather than growing a new feature.
  let follow = null;

  // The cars, and this camera's own side of a ride. `liftSource` is the same
  // arrangement `colliderSource` has and for the same reason: when a crowd is
  // running it owns the lifts, because two sets of cars for one shaft means a
  // queue waiting on a door that a different object is holding open. With no
  // crowd this file builds its own at walk-start and steps them itself.
  let liftSource = null;
  let lifts = null;
  const rider = makeRider();
  // What the lift is doing, for the HUD — it is the one thing in a walk that
  // takes seconds and gives no other sign that it heard you.
  let riding = '';

  const fwdV = new THREE.Vector3();

  // Where the eye is. Ordinarily this *is* `camera.position` — the same
  // object, aliased, so every line below reads and writes the camera directly
  // and nothing costs a copy. In a headset it can't be: three.js writes the
  // camera's own transform from the head pose every frame, so the walker
  // keeps its position here and render.js's rig is moved to put the head
  // where this says it is. One alias, and the whole of the physics below is
  // unchanged between the two.
  let body = camera.position;

  // Touch: Pointer Lock is desktop-only (PointerLockControls drives off a
  // locked pointer's mousemove, which a touchscreen never sends), so touch
  // gets its own input path — a virtual joystick for movement, a drag
  // anywhere else on the canvas to look, both landed in main.js/index.html —
  // driving the exact same updateWalk()/updateGhost() this file already had.
  let touchActive = false;
  const moveAxes = { x: 0, y: 0 }; // {right, forward}, set by the on-screen joystick
  let lookPointerId = null;
  let lookLast = null;
  const lookEuler = new THREE.Euler(0, 0, 0, 'YXZ');

  // ...and Phase 25's third input path, for the case nobody planned for:
  // **a desktop where Pointer Lock does not happen.** An iframe without
  // `allow="pointer-lock"`, a browser that refuses the request, a user who
  // dismissed the permission — in every one of them `controls.lock()` quietly
  // does nothing, `isLocked` stays false, and `update()`'s guard meant walk
  // mode was not merely mouse-less: WASD did nothing either, because the whole
  // step was skipped. A walkthrough you cannot walk is worse than no
  // walkthrough, so there is now a fallback: drag anywhere on the canvas to
  // look, and WASD moves whether or not anything is locked.
  //
  // It is a fallback rather than an option. Pointer Lock is the better gesture
  // by a distance — you can turn further than the window is wide — so it is
  // still asked for first, and this only takes over when the ask comes back
  // empty. `mouseLook` says it has.
  let mouseLook = false;

  const applyLook = (dx, dy) => {
    lookEuler.setFromQuaternion(camera.quaternion);
    const next = lookEulerDelta(
      { x: lookEuler.x, y: lookEuler.y }, dx, dy,
      controls.pointerSpeed, controls.minPolarAngle, controls.maxPolarAngle);
    lookEuler.x = next.x; lookEuler.y = next.y;
    camera.quaternion.setFromEuler(lookEuler);
  };

  // One drag-to-look path, shared by the touchscreen and the unlocked mouse.
  const dragLooks = (e) => (touchActive && e.pointerType === 'touch') ||
    (mouseLook && active && !controls.isLocked && e.pointerType !== 'touch');

  function onLookDown(e) {
    if (!dragLooks(e) || lookPointerId !== null) return;
    lookPointerId = e.pointerId;
    lookLast = { x: e.clientX, y: e.clientY };
    domElement.setPointerCapture(e.pointerId);
    if (e.pointerType !== 'touch') domElement.style.cursor = 'grabbing';
  }
  function onLookMove(e) {
    if (e.pointerId !== lookPointerId) return;
    const dx = e.clientX - lookLast.x, dy = e.clientY - lookLast.y;
    lookLast = { x: e.clientX, y: e.clientY };
    applyLook(dx, dy);
  }
  function onLookUp(e) {
    if (e.pointerId !== lookPointerId) return;
    lookPointerId = null;
    lookLast = null;
    domElement.style.cursor = mouseLook && active ? 'grab' : '';
  }
  domElement.addEventListener('pointerdown', onLookDown);
  domElement.addEventListener('pointermove', onLookMove);
  domElement.addEventListener('pointerup', onLookUp);
  domElement.addEventListener('pointercancel', onLookUp);

  // Where a storey's collider comes from. Normally this file builds its own
  // and caches it for the length of the walk — editing and walking are
  // exclusive, so nothing can change underneath it.
  //
  // Phase 6 breaks that exclusivity, and the fix is not a second cache: it is
  // **one** cache. A school with people in it has agents resolving against
  // the same walls, and — the part that actually bites — against the same
  // *door leaves*. Two colliders for one storey means two sets of leaves: the
  // crowd walks into doors the camera has already opened, because the door it
  // opened was a different object with the same key. So when there is a crowd,
  // whoever owns it owns the colliders and hands them over here.
  let colliderSource = null;
  const colliderFor = (i) => {
    if (colliderSource) return colliderSource(i) || emptyCollider();
    if (!world || !world.floors[i]) return emptyCollider();
    let c = colliders.get(i);
    if (!c) { c = buildCollider(world, i, catalogEntry, { site }); colliders.set(i, c); }
    return c;
  };

  function reportHud() {
    if (!opts.onHud) return;
    const feet = body.y - EYE_H;
    const level = world
      ? storeyAt(world, feet, groundAt(site, body.x, body.z)) + 1 : 1;
    // Phase 19: the lift's call panel says its own key. E is listed nowhere a
    // walker can see once the pointer is locked, and the lift is the one
    // thing in a walk you have to *ask* for — so standing at its doors, the
    // HUD is the panel and it names the button.
    const atLift = !riding && !ghost && lifts
      && liftAtHand(lifts, body.x, body.z, level - 1);
    const text = follow && follow.agent
      ? `Level ${level} · following ${follow.agent.name} (${follow.mode === 'fps' ? 'first person' : 'over the shoulder'})`
      : riding
        ? `Level ${level} · ${riding}`
        : `Level ${level} · ${ghost ? 'ghost (no-clip)' : 'walking'}` +
          (atLift ? ' · at the lift — E calls it' : '');
    if (text === hudText) return;
    hudText = text;
    opts.onHud(text);
  }

  // Look through somebody else's eyes, or over their shoulder. Neither is an
  // animation: an agent already has a position, a facing and a height, and
  // both views are that record read from a different distance.
  function rideAlong(agent, mode) {
    const eye = agent.y + EYE_FOLLOW * (agent.height || 1);
    const fx = Math.sin(agent.facing || 0), fz = Math.cos(agent.facing || 0);
    if (mode === 'fps') {
      camera.position.set(agent.x, eye, agent.z);
      camera.lookAt(agent.x + fx * 20, eye - 1.2, agent.z + fz * 20);
      return;
    }
    camera.position.set(agent.x - fx * OTS_BACK, eye + OTS_UP, agent.z - fz * OTS_BACK);
    camera.lookAt(agent.x + fx * 6, eye - 0.4, agent.z + fz * 6);
  }

  // Which storey the body is standing on, by the same rule everything else
  // in this file uses.
  const storeyHere = () => (world
    ? storeyAt(world, body.y - EYE_H, groundAt(site, body.x, body.z)) : 0);

  // Press the lift button. Works from inside the car *and* from the landing
  // outside it, which is the difference between a lift and a teleport you
  // have to be standing on: a person waiting for a lift is not in the shaft.
  //
  // Nothing happens if there is no lift within reach — which is why this is a
  // key rather than a prompt.
  function rideElevator() {
    if (!world) return false;
    const floorIndex = storeyHere();
    const at = liftAtHand(lifts, body.x, body.z, floorIndex);
    if (at) {
      pressRider(rider, at.car, floorIndex);
      riding = liftText(at.car);
      hudText = '';
      reportHud();
      return true;
    }
    // **The teleport, kept as a fallback and only as one.** A design whose
    // lifts were never built — a caller that handed in no source and a walk
    // that started before `enable()` made its own — still has a working `E`
    // rather than a dead key. Every path that has a car takes the car.
    const shaft = elevatorAt(world, body.x, body.z, floorIndex);
    if (!shaft) return false;
    body.y = shaft.y + EYE_H;
    vy = 0;
    grounded = true;
    hudText = '';
    reportHud();
    return true;
  }

  // The lift, once a frame. Returns true when the car is carrying the body,
  // in which case the walker's own physics stand down for this frame: a lift
  // is a small box and what is under your feet in one is the car.
  function updateLift(dt) {
    if (!lifts) return false;
    // Whoever owns the cars steps them. When a crowd is running, agents.js
    // has already done it this frame.
    if (!liftSource) stepLifts(lifts, dt);
    if (rider.state === 'away') { riding = ''; return false; }
    const car = lifts.get(rider.car);
    const floorIndex = storeyHere();
    const at = liftAtHand(lifts, body.x, body.z, floorIndex);
    // Walked off, or over to a different shaft. Not a failure and not a
    // message — you changed your mind, and the seat you were holding goes
    // back to the queue rather than being held from across the corridor.
    if (rider.state === 'waiting' && (!at || at.car !== car)) {
      cancelRider(rider, car);
      riding = '';
      return false;
    }
    const out = stepRider(rider, car, dt, {
      floorIndex,
      inside: !!(at && at.inside),
    });
    riding = out.state === 'away' ? '' : liftText(car);
    if (out.state !== 'riding') {
      if (out.arrived) {
        body.y = (out.y ?? body.y - EYE_H) + EYE_H;
        vy = 0;
        grounded = true;
      }
      return false;
    }
    // Being carried. The doors are shut around you and the walls of the shaft
    // are the collider's, so there is nothing to resolve against — the one
    // thing that moves is the floor.
    body.y = out.y + EYE_H;
    vy = 0;
    grounded = true;
    return true;
  }

  // The arrows are WASD. Not everybody who opens a floor-plan tool has played
  // a first-person game, and "walking mode does not respond to WASD" is a
  // report that reads the same whether the keys were dead or whether the four
  // being pressed were the arrows. They are free — nothing else in a walk
  // claims them — so they are the same four keys under a different name,
  // normalized here so that nothing downstream needs to know there are two.
  const MOVE_ALIAS = {
    ArrowUp: 'KeyW', ArrowDown: 'KeyS', ArrowLeft: 'KeyA', ArrowRight: 'KeyD',
  };
  const moveCode = (code) => MOVE_ALIAS[code] || code;

  document.addEventListener('keydown', (e) => {
    if (!active) return;
    if (e.code === 'KeyF') { ghost = !ghost; vy = 0; grounded = false; reportHud(); return; }
    if (e.code === 'KeyE') { rideElevator(); return; }
    keys.add(moveCode(e.code));
    // The arrows scroll the page and Space scrolls it further; neither is
    // wanted while you are inside the building.
    if (e.code === 'Space' || MOVE_ALIAS[e.code]) e.preventDefault();
  });
  document.addEventListener('keyup', (e) => keys.delete(moveCode(e.code)));

  // Where a walk starts.
  //
  // Two answers, in order. If the storey carries a `spawn` record — a point
  // somebody chose, either by naming a room in the walk overlay or by standing
  // somewhere and saying "here" — that is where the walk starts and which way
  // it faces, full stop. A tool that always drops you in the biggest room is a
  // tool that makes you walk the length of the building every time you want to
  // look at the front door again.
  //
  // Otherwise: the deepest point inside the storey's biggest room, looking
  // along the building's longer axis toward whichever side has more room to
  // walk into. `interiorPoint` rather than a centroid, because the centre of
  // area of an L-shaped corridor is in the wall beside it.
  function spawnPoint(f) {
    const chosen = f && f.spawn;
    if (chosen && Number.isFinite(chosen.x) && Number.isFinite(chosen.z)) {
      const yaw = Number.isFinite(chosen.yaw) ? chosen.yaw : 0;
      // `yaw` is the compass bearing the walk faces, in the same convention
      // agents.js uses: 0 looks down +Z, and it turns the short way round.
      return { x: chosen.x, z: chosen.z, lookX: Math.sin(yaw), lookZ: Math.cos(yaw) };
    }
    const rooms = shapesOf(f);
    const biggest = rooms.reduce(
      (best, s2) => (!best || shapeArea(s2) > shapeArea(best) ? s2 : best), null);
    if (!biggest) return { x: (f.w * CELL) / 2, z: (f.h * CELL) / 2, lookX: 0, lookZ: -1 };
    const p = interiorPoint(biggest);
    // The whole storey's extent decides which way to face, not the room's —
    // standing in a corridor you want to be looking down the building.
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const shape of rooms) {
      const b = shapeBBox(shape);
      minX = Math.min(minX, b.x0); maxX = Math.max(maxX, b.x1);
      minZ = Math.min(minZ, b.z0); maxZ = Math.max(maxZ, b.z1);
    }
    if (maxX - minX >= maxZ - minZ) {
      return { x: p.x, z: p.z, lookX: maxX - p.x >= p.x - minX ? 1 : -1, lookZ: 0 };
    }
    return { x: p.x, z: p.z, lookX: 0, lookZ: maxZ - p.z >= p.z - minZ ? 1 : -1 };
  }

  // Stand the walker on the storey's start point. One function so that
  // entering a walk and re-choosing the start point mid-walk cannot disagree
  // about what "the start point" means.
  function placeAtSpawn() {
    const state = world;
    if (!state) return;
    const p = spawnPoint(activeFloor(state));
    const eye = floorBaseY(state, state.currentFloor) + EYE_H;
    ceiling = topOfBuilding(state) + 40;
    camera.position.set(p.x, eye, p.z);
    camera.lookAt(p.x + p.lookX * 20, eye, p.z + p.lookZ * 20);
    if (body !== camera.position) body.copy(camera.position);
    vy = 0;
    grounded = false;
    stepAcc = 0;
    strideAcc = 0;
  }

  // Ghost flight: exactly what the camera did before this phase — no
  // collision, no gravity, and a courtesy ride up a stair you walk onto.
  function updateGhost(dt, fwd, right, speed) {
    const up = (keys.has('Space') ? 1 : 0) - (keys.has('KeyC') ? 1 : 0);
    if (fwd) controls.moveForward(fwd * speed * dt);
    if (right) controls.moveRight(right * speed * dt);
    if (up) {
      body.y = Math.min(ceiling, Math.max(1.5, body.y + up * speed * dt));
      return;
    }
    if (!world || !(fwd || right)) return;
    const ride = stairUnder(world, body.x, body.z, body.y - EYE_H);
    if (!ride) return;
    const target = ride.y + EYE_H;
    if (Math.abs(body.y - target) > RIDE_BAND) return;
    body.y = target;
  }

  // Walking: a circle on a surface. Horizontal movement is resolved against
  // the storey under your feet, then the surface it found decides your height.
  function updateWalk(dt, fwd, right, speed) {
    const feet = body.y - EYE_H;

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

    const floorIndex = storeyAt(world, feet, groundAt(site, body.x, body.z));
    const collider = colliderFor(floorIndex);
    // You walk around the crowd, and it walks around you: the same body list,
    // resolved by the same `moveWalker`, from both sides.
    const moved = moveWalker(world, collider, { x: body.x, y: feet, z: body.z },
      dx, dz, { grounded, bodies: bodiesOn(floorIndex) });
    const walked = Math.hypot(moved.x - body.x, moved.z - body.z);
    // Phase 11: what stopped you is what you push. The step this frame took
    // away from you — asked for minus got — is the whole input to the shove,
    // because `moveWalker` has already resolved you to exactly touching and
    // there is no penetration left to measure. Read *before* `body` is
    // updated, since that is what the difference is against.
    const blocked = { dx: dx - (moved.x - body.x), dz: dz - (moved.z - body.z) };
    body.x = moved.x;
    body.z = moved.z;

    // Only when your feet are near the floor: a chair on the level below
    // shouldn't scatter because somebody flew over it in ghost mode.
    if (grounded && opts.onShove) {
      const shoved = shoveProps(collider, body.x, body.z, blocked);
      if (shoved.length) opts.onShove(shoved, floorIndex);
    }

    // Vertical. `support` came back from the same query that vetted the step,
    // so standing and walking agree about what the floor is.
    const support = moved.support || supportAt(world, moved.x, moved.z, feet, { site });
    const surface = support ? support.y : 0;
    let y = feet;
    if (grounded) {
      if (surface <= feet + STEP_UP) y = surface;
      // Only a grounded walker takes steps. Airborne is silent, which is
      // what being airborne sounds like.
      if (walked > 0) {
        const s = stride(strideAcc, walked);
        strideAcc = s.acc;
        for (let i = 0; i < s.steps; i++) footfall(moved.x, surface, moved.z, support, 1);
      }
      if (keys.has('Space')) { vy = JUMP_V; grounded = false; strideAcc = 0; }
    } else {
      vy = Math.max(-TERMINAL_V, vy - GRAVITY * dt);
      const next = feet + vy * dt;
      // Land using the surface found at the *start* of the fall, so a long
      // frame drops through a slab's height without dropping through the slab.
      if (vy <= 0 && next <= surface) {
        // How hard you landed, as a multiple of a plain hop. A step off a curb
        // is a footstep; the bottom of a stairwell is not.
        footfall(moved.x, surface, moved.z, support, Math.abs(vy) / JUMP_V, true);
        y = surface; vy = 0; grounded = true;
      } else y = next;
    }
    body.y = y + EYE_H;
  }

  // Doors answer to where you *ended up*, and they answer on every storey you
  // might be standing on — including in ghost mode, where a corridor of doors
  // opening ahead of you is half the reason to fly down it. Its own function
  // since Phase 9, because a headset walks the same corridors and opens the
  // same doors.
  function updateDoors(dt) {
    if (!world) return;
    const floorIndex = storeyAt(world, body.y - EYE_H);
    const collider = colliderFor(floorIndex);
    // The camera is one body among however many; a leaf answers to whoever is
    // nearest it, which in a busy corridor is rarely you.
    const crowd = bodiesOn(floorIndex);
    const bodies = [{ x: body.x, z: body.z, open: true }];
    if (crowd) for (const b of crowd) bodies.push(b);
    if (updateDoorsFor(collider, bodies, dt) && opts.onDoors) {
      opts.onDoors(collider.doors);
    }
  }

  // --- Phase 9: walking in a headset ---
  //
  // The whole of VR locomotion, and it is four lines of new physics because
  // there is no new physics: the thumbstick produces the same `fwd`/`right`
  // pair the W and D keys do, `updateWalk` resolves it against the same
  // collider, and the doors open by the same test. What is genuinely
  // different is only this — the camera is not ours to move, so the walker's
  // position lives in `body` and gets handed out as a pose for render.js's
  // rig, and turning is a snap rather than a mouse, because a smoothly
  // rotating world makes people ill.
  let xr = null;

  function xrStep(dt) {
    const input = xr.input ? xr.input() : null;
    const stick = stickVector(input ? input.move.x : 0, input ? input.move.y : 0);
    const turn = turnStep(xr.turnMode, xr.latched, input ? input.turn : 0, dt, { angle: xr.snapAngle });
    xr.latched = turn.latched;
    // Turning about the head is turning on the spot, and the head is exactly
    // where `body` says it is — so a snap is one addition here and nothing at
    // all in the physics.
    if (turn.turn) xr.yaw += turn.turn;
    const speed = input && input.sprint ? XR_SPRINT : XR_SPEED;
    // `updateWalk` takes its heading from the camera's own world direction,
    // which in a session is the direction the head is actually facing — so
    // "forward" means what a person wearing it expects, with no extra term.
    // A headset rides the same car off the same state machine — there is no
    // E key in one, so the ride is started by the same `rideElevator` a touch
    // button calls, and this only has to let the car carry the rig.
    if (!updateLift(dt) && world) updateWalk(dt, -stick.y, stick.x, speed);
    updateDoors(dt);
    if (xr.onPose) xr.onPose({ x: body.x, y: body.y - EYE_H, z: body.z, yaw: xr.yaw });
    reportHud();
  }

  // One foot hitting one surface. The material is whatever the room under that
  // point is finished in — unless the surface isn't a slab at all, in which
  // case a stair tread or the ground outside has its own voice regardless of
  // what the plan says the finish is.
  function footfall(x, y, z, support, force, landing = false) {
    if (!opts.onStep || !world) return;
    const kind = support ? support.kind : 'ground';
    const floor = support && support.floor >= 0 ? world.floors[support.floor] : null;
    // Outside, what you are walking on is whichever site region you are
    // standing in — the same lookup the renderer paints the ground with.
    const surf = kind === 'ground' ? siteSurfaceAt(world, x, z) : null;
    const spec = footstepFor(kind, floor ? finishAt(floor, x, z) : null,
      surf ? surfaceEntry(surf).step : null);
    opts.onStep(spec, { x, y, z, floor: support ? Math.max(0, support.floor) : 0 }, force, landing);
  }

  return {
    controls,
    get ghost() { return ghost; },
    // Photo mode flies rather than walks — a camera that has to take the
    // stairs can't be put where a photograph wants it — so it needs to set
    // the ghost flag rather than ask the user to remember F.
    setGhost(on) {
      if (ghost === !!on) return;
      ghost = !!on;
      vy = 0;
      grounded = false;
      reportHud();
    },
    get touchActive() { return touchActive; },
    // Where the walker is standing, storey included — the one question a
    // caller cannot answer off `camera.position` alone, since which storey a
    // height belongs to is `storeyAt`'s and the graded ground's business.
    // Phase 11's hunt asks it once a frame.
    get at() {
      const feet = body.y - EYE_H;
      return {
        x: body.x, y: body.y, z: body.z,
        floor: world ? storeyAt(world, feet, groundAt(site, body.x, body.z)) : 0,
      };
    },
    // The cars, for the renderer to pose. Read-only, and the same objects the
    // rider above is queueing for — neither module describes a lift to the
    // other, exactly the arrangement `poseDoors` has with openings.js.
    get lifts() { return lifts; },
    // One storey's collider, read-only — Phase 21's label gate casts sight
    // against its live door leaves, which have to be *these* leaves: when a
    // crowd is running an agent may be holding one open, and a fresh
    // collection would be the plan's doors rather than the walk's.
    colliderAt: (i) => colliderFor(i),
    // Phase 22: the invalidation clause. Hands placed or removed a prop, so
    // every cached storey re-derives its prop obstacles from the design —
    // walls and door leaves stay the objects they were (see collide.js's
    // refreshProps). When a crowd owns the colliders this is a no-op here:
    // whoever handed them over refreshes the same shared objects, so the
    // camera and the agents keep agreeing about where the new desk is.
    // `opts.skipId` names the prop currently in the walker's hands, which
    // stops blocking the spot it was picked up from.
    propsChanged(opts = {}) {
      if (!world || colliderSource) return;
      for (const c of colliders.values()) refreshProps(world, c, catalogEntry, opts);
    },
    // Whose eyes. `null` gives the camera its own body back where it stands.
    get following() { return follow ? follow.agent : null; },
    get followMode() { return follow ? follow.mode : null; },
    setFollow(agent, mode = 'ots') {
      follow = agent ? { agent, mode } : null;
      if (follow) { vy = 0; grounded = true; }
      hudText = '';
      reportHud();
    },
    // The crowd, for collision and for the doors. Handing in a function rather
    // than an array keeps this file out of the business of knowing when the
    // population changed.
    setBodies(fn) { bodiesOn = fn || (() => null); },
    // ...and where the world they are resolved against comes from. Null gives
    // this file its own back.
    setColliders(fn) {
      colliderSource = fn || null;
      colliders = new Map();
    },
    // ...and where the cars come from. Same bargain as the colliders: when a
    // crowd is running it owns them, so the car the camera queues for is the
    // car forty people are queueing for. Null gives this file its own back,
    // built from the design the walk is standing in.
    setLifts(fn) {
      cancelRider(rider, lifts && lifts.get(rider.car));
      liftSource = fn || null;
      lifts = liftSource ? liftSource() : (world ? makeLifts(world) : null);
      riding = '';
    },
    enable(state) {
      active = true;
      world = state;
      site = terrainField(state);
      keys.clear();
      colliders = new Map();
      // A car halfway between two storeys of a building that has just been
      // re-drawn is a car in a shaft that may not exist — so the cars have
      // exactly the lifetime the colliders do, and for the same reason.
      lifts = liftSource ? liftSource() : makeLifts(state);
      cancelRider(rider, null);
      riding = '';
      ghost = false;
      vy = 0;
      grounded = false;
      strideAcc = 0;
      stepAcc = 0;
      hudText = '';
      touchActive = false;
      mouseLook = false;
      domElement.style.cursor = '';
      moveAxes.x = 0; moveAxes.y = 0;
      lookPointerId = null;
      lookLast = null;
      placeAtSpawn();
      reportHud();
    },
    // Put the walker back on the storey's start point, wherever that now is.
    // The overlay calls this when the start point changes under a walk that
    // has already begun — choosing "start in the gym" and then having to
    // leave and re-enter to be in the gym is the sort of thing that makes a
    // setting feel broken.
    respawn() {
      if (!active || !world) return;
      placeAtSpawn();
      reportHud();
    },
    // Where the walker is standing, which way it is facing, and which storey
    // it is on — a `spawn` record plus the one field that says where to put
    // it. What "start here next time" is made of.
    //
    // `floor` is the storey under the feet rather than the one being edited:
    // walk up the stairs and "here" is upstairs, which is the only reading of
    // the word that is ever true.
    get standing() {
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      return {
        x: body.x, z: body.z, yaw: Math.atan2(dir.x, dir.z), floor: storeyHere(),
      };
    },
    disable() {
      active = false;
      stepAcc = 0;
      follow = null;
      world = null;
      site = emptyField();
      keys.clear();
      colliders = new Map();
      cancelRider(rider, lifts && lifts.get(rider.car));
      lifts = liftSource ? liftSource() : null;
      riding = '';
      touchActive = false;
      mouseLook = false;
      domElement.style.cursor = '';
      moveAxes.x = 0; moveAxes.y = 0;
      lookPointerId = null;
      lookLast = null;
      if (controls.isLocked) controls.unlock();
    },
    // Touch has no pointer to lock — enter walking straight from the overlay
    // tap, and drive movement/looking from the joystick and canvas-drag
    // instead of PointerLockControls. `enable()` still does the spawn/reset.
    enableTouch() {
      touchActive = true;
      moveAxes.x = 0; moveAxes.y = 0;
      reportHud();
    },
    // Walk without a locked pointer: drag to look, WASD to move. What the
    // shell turns on when `controls.lock()` came back with nothing.
    enableMouseLook(on = true) {
      mouseLook = !!on;
      if (!mouseLook) { lookPointerId = null; lookLast = null; }
      domElement.style.cursor = mouseLook && active ? 'grab' : '';
      reportHud();
    },
    get mouseLook() { return mouseLook; },
    // The joystick's own axes, already signed to match WASD (+y forward,
    // +x right) — see touch.js's joystickAxes for the pixel-to-axis math.
    setMoveAxes(x, y) { moveAxes.x = x; moveAxes.y = y; },
    // Lets a touch UI button (jump, sprint) drive the same `keys` set a
    // keyboard would, so updateWalk()/updateGhost() need no touch-specific
    // branch for either.
    touchKey(code, down) { down ? keys.add(code) : keys.delete(code); },
    // Touch has no E key, so the same on-screen button that jumps can call
    // this — it's a no-op anywhere but inside a car.
    rideElevator,
    // --- Phase 9: the headset ---
    //
    // `input` is polled once a frame and answers { move: {x, y}, turn,
    // sprint }; `onPose` receives where the rig has to stand. Neither this
    // file nor render.js describes a controller to the other — main.js reads
    // the session's gamepads, because that is where every other input path in
    // this build is read too.
    get xr() { return !!xr; },
    get xrYaw() { return xr ? xr.yaw : 0; },
    enableXR(o = {}) {
      // A headset is a body, not a ghost: no-clip flight with a real head in
      // it is the fastest way to make somebody ill, and the stairs work.
      ghost = false;
      follow = null;
      vy = 0;
      grounded = true;
      body = new THREE.Vector3().copy(camera.position);
      xr = {
        input: o.input || null,
        onPose: o.onPose || null,
        turnMode: o.turnMode === 'smooth' ? 'smooth' : 'snap',
        snapAngle: Number.isFinite(o.snapAngle) ? o.snapAngle : SNAP_ANGLE,
        yaw: 0,
        latched: false,
      };
      if (xr.onPose) xr.onPose({ x: body.x, y: body.y - EYE_H, z: body.z, yaw: 0 });
      reportHud();
    },
    disableXR() {
      if (!xr) return;
      // Put the desktop camera back where the headset left the walker, so
      // taking it off doesn't teleport you home.
      camera.position.copy(body);
      body = camera.position;
      xr = null;
      reportHud();
    },
    setXRComfort(mode) { if (xr) xr.turnMode = mode === 'smooth' ? 'smooth' : 'snap'; },
    update(dt) {
      if (!active) return;
      // A session drives its own frames off the headset's clock; the page's
      // loop stands down while one is running (see render.js's enterXR).
      if (xr) { xrStep(dt); return; }
      if (!controls.isLocked && !touchActive && !mouseLook) return;
      // Riding along with somebody. The camera stops steering itself and
      // becomes a property of the agent — which is why this is four lines
      // rather than a mode: everything about *where* it goes is already being
      // worked out by agents.js, once per frame, for a body that walks the
      // same corridors under the same physics.
      if (follow && follow.agent) {
        rideAlong(follow.agent, follow.mode);
        reportHud();
        return;
      }
      // The lift first, because being carried by one is the one case where
      // the walker's own physics have nothing to say: a car between two
      // storeys is not a surface `supportAt` knows about, and a body resolved
      // against the storey it left would be dropped down the shaft it is
      // currently riding up. Ghost mode still flies — a no-clip camera is not
      // a passenger — so a rider is put down before it takes off.
      if (ghost && rider.state !== 'away') cancelRider(rider, lifts && lifts.get(rider.car));
      if (!ghost && updateLift(dt)) { updateDoors(dt); reportHud(); return; }
      const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? SPRINT_SPEED : WALK_SPEED;
      const fwd = touchActive ? moveAxes.y : (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
      const right = touchActive ? moveAxes.x : (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
      // The frame's whole elapsed time, spent in fixed steps — see FIXED_STEP.
      // The doors and the HUD are once-a-frame things and stay outside the
      // loop; only the body is stepped, because the body is the only part of
      // this that a long frame was quietly stealing from.
      stepAcc = Math.min(stepAcc + Math.max(0, dt), MAX_CATCHUP);
      let steps = 0;
      while (stepAcc >= FIXED_STEP && steps < MAX_STEPS) {
        stepAcc -= FIXED_STEP;
        steps++;
        if (ghost || !world) updateGhost(FIXED_STEP, fwd, right, speed);
        else updateWalk(FIXED_STEP, fwd, right, speed);
      }
      // A frame shorter than one step still has to *look* like it moved, or a
      // 200fps machine would stutter as the accumulator filled. Spend it.
      if (!steps && stepAcc > 0) {
        const rest = stepAcc;
        stepAcc = 0;
        if (ghost || !world) updateGhost(rest, fwd, right, speed);
        else updateWalk(rest, fwd, right, speed);
      }
      updateDoors(dt);
      reportHud();
    },
  };
}
