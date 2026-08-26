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
// elevator moves you: step into a car, press E, and you are on the other
// storey. That is the whole of "teleport with doors", and it is deliberately
// not an animation — a lift that takes eight seconds to arrive is realism
// nobody inspecting a floor plan asked for.

import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { CELL, EYE_H, activeFloor, floorBaseY, topOfBuilding } from './grid.js';
import { shapesOf, shapeArea, shapeBBox, interiorPoint } from './shapes.js';
import { catalogEntry } from './catalog.js';
import { finishAt } from './finish.js';
import { stairUnder, elevatorAt } from './stairs.js';
import { stride, footstepFor } from './sound.js';
import { terrainField, emptyField, groundAt } from './terrain.js';
import { siteSurfaceAt, surfaceEntry } from './site.js';
import {
  GRAVITY, TERMINAL_V, JUMP_V, STEP_UP,
  buildCollider, emptyCollider, moveWalker, supportAt, storeyAt, updateDoorsFor,
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

  function onTouchLookDown(e) {
    if (!touchActive || e.pointerType !== 'touch' || lookPointerId !== null) return;
    lookPointerId = e.pointerId;
    lookLast = { x: e.clientX, y: e.clientY };
    domElement.setPointerCapture(e.pointerId);
  }
  function onTouchLookMove(e) {
    if (e.pointerId !== lookPointerId) return;
    const dx = e.clientX - lookLast.x, dy = e.clientY - lookLast.y;
    lookLast = { x: e.clientX, y: e.clientY };
    lookEuler.setFromQuaternion(camera.quaternion);
    const next = lookEulerDelta(
      { x: lookEuler.x, y: lookEuler.y }, dx, dy,
      controls.pointerSpeed, controls.minPolarAngle, controls.maxPolarAngle);
    lookEuler.x = next.x; lookEuler.y = next.y;
    camera.quaternion.setFromEuler(lookEuler);
  }
  function onTouchLookUp(e) {
    if (e.pointerId !== lookPointerId) return;
    lookPointerId = null;
    lookLast = null;
  }
  domElement.addEventListener('pointerdown', onTouchLookDown);
  domElement.addEventListener('pointermove', onTouchLookMove);
  domElement.addEventListener('pointerup', onTouchLookUp);
  domElement.addEventListener('pointercancel', onTouchLookUp);

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
    const text = follow && follow.agent
      ? `Level ${level} · following ${follow.agent.name} (${follow.mode === 'fps' ? 'first person' : 'over the shoulder'})`
      : `Level ${level} · ${ghost ? 'ghost (no-clip)' : 'walking'}`;
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

  // Ride the elevator you are standing in. Nothing happens if you aren't in
  // one, which is why this is a key rather than a prompt: the answer to "am I
  // in a lift" is a point-in-box test, not a state machine.
  function rideElevator() {
    if (!world) return false;
    const feet = body.y - EYE_H;
    const car = elevatorAt(world, body.x, body.z, storeyAt(world, feet));
    if (!car) return false;
    body.y = car.y + EYE_H;
    vy = 0;
    grounded = true;
    hudText = '';
    reportHud();
    return true;
  }

  document.addEventListener('keydown', (e) => {
    if (!active) return;
    if (e.code === 'KeyF') { ghost = !ghost; vy = 0; grounded = false; reportHud(); return; }
    if (e.code === 'KeyE') { rideElevator(); return; }
    keys.add(e.code);
    if (e.code === 'Space') e.preventDefault();
  });
  document.addEventListener('keyup', (e) => keys.delete(e.code));

  // Where a walk starts: the deepest point inside the storey's biggest room,
  // looking along the building's longer axis toward whichever side has more
  // room to walk into. `interiorPoint` rather than a centroid, because the
  // centre of area of an L-shaped corridor is in the wall beside it.
  function spawnPoint(f) {
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
    if (world) updateWalk(dt, -stick.y, stick.x, speed);
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
    enable(state) {
      active = true;
      world = state;
      site = terrainField(state);
      keys.clear();
      colliders = new Map();
      ghost = false;
      vy = 0;
      grounded = false;
      strideAcc = 0;
      hudText = '';
      touchActive = false;
      moveAxes.x = 0; moveAxes.y = 0;
      lookPointerId = null;
      lookLast = null;
      // Start on the floor you were just editing, not always the ground.
      const p = spawnPoint(activeFloor(state));
      const eye = floorBaseY(state, state.currentFloor) + EYE_H;
      ceiling = topOfBuilding(state) + 40;
      camera.position.set(p.x, eye, p.z);
      camera.lookAt(p.x + p.lookX * 20, eye, p.z + p.lookZ * 20);
      if (body !== camera.position) body.copy(camera.position);
      reportHud();
    },
    disable() {
      active = false;
      follow = null;
      world = null;
      site = emptyField();
      keys.clear();
      colliders = new Map();
      touchActive = false;
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
      if (!controls.isLocked && !touchActive) return;
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
      const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? SPRINT_SPEED : WALK_SPEED;
      const fwd = touchActive ? moveAxes.y : (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
      const right = touchActive ? moveAxes.x : (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
      if (ghost || !world) updateGhost(dt, fwd, right, speed);
      else updateWalk(dt, fwd, right, speed);
      updateDoors(dt);
      reportHud();
    },
  };
}
