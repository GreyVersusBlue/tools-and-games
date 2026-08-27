// walk-main.js — the second entry point: a walk and nothing else.
//
// Phase 23. main.js boots a drawing board that can also walk; this boots a
// building that can only be walked. It exists for the person who was *handed*
// the school — tools/export-walk.mjs bundles this file's import graph, the
// vendored three.js and one design into a single .html that opens from
// file:// with no network and no tool. Everything here is the walk half of
// main.js, re-wired against a much smaller shell: pointer-lock (or touch)
// walking with collision, doors, the lift, footsteps and room acoustics, the
// sun, labels earned by sight, shove, the minimap, photo mode and the crowd.
//
// What is deliberately not here: every editor tool, generation, analysis,
// the session stack — and Phase 22's hands, which write a file that doesn't
// exist on this side. A guest can shove a chair (a session fact) but never
// edit the design (a file fact): the design a walk export carries is
// read-only by construction, so nothing in this file writes state and
// nothing autosaves.
//
// The one convention that matters most here is inherited rather than new:
// this file is a *shell*, thin over the same modules main.js is thin over.
// Anything smart enough to test belongs in one of them, not here.

import * as THREE from 'three';
import { CELL, EYE_H } from './grid.js';
import { catalogEntry } from './catalog.js';
import { initRender } from './render.js';
import { initWalkthrough } from './walkthrough.js';
import { initAudio } from './audio.js';
import { doorEvents } from './sound.js';
import { MAX_SHOVE } from './shove.js';
import { deserialize } from './save-load.js';
import { decodeShare } from './share.js';
import { makeLabelGate, LABEL_MODES, sightBlockers, doorPoints } from './sightline.js';
import { MOODS, applyMood } from './sky.js';
import { buildCollider, storeyAt, WALKER_R, updateDoorsFor } from './collide.js';
import { startHunt, checkFind, huntWarmth, huntSummary } from './hunt.js';
import {
  normalizeHaunt, stageFor, stageKnobs, flickerAt, writingPlaces,
  crashCurve, CRASH_S, slamCandidate, banishNode, escapeDoor,
  LOCKED_TEXT, HAUNT_COUNT, HAUNT_ITEM,
} from './haunt.js';
import {
  makeCreature, makeCreatureCtx, stepCreature, noteSlam, placeCreature,
  CREATURE_R,
} from './creature.js';
import { terrainField, groundAt } from './terrain.js';
import { buildNav } from './navgraph.js';
import {
  makePopulation, makeContext, retargetAll, stepAgents,
  bodiesOn, makeCrowdField, clearCrowd, normalizeLife,
} from './agents.js';
import { blockAt, bellsBetween, wrapMinutes, clockText } from './schedule.js';
import { normalizeTimetable, isEmptyTimetable, timetablePlan } from './timetable.js';
import { computeFloorPlan, drawPlanBody } from './blueprint.js';
import {
  MINI_SIZE, minimapView, worldToMini, viewCone, markerAngle, scaleBar,
  describeMinimap, nextMode, nextOrient, MIN_RANGE, MAX_RANGE,
} from './minimap.js';
import { INK } from './theme.js';
import { isTouchCapable, joystickAxes } from './touch.js';
import { floorBounds } from './shadow.js';

const $ = (id) => document.getElementById(id);
const canvas = $('view');
const walkHud = $('walk-hud');
const walkOverlay = $('walk-overlay');

// ---------- the design ----------
//
// The export carries its design the way a share link does: share.js's
// deflate-base64url payload, in a text script tag the bundler (or the export
// button) spliced in. The deserializer embedded in this bundle is the one
// this build shipped with, so an export made today opens forever — it never
// asks the tool that made it, or any newer one, what v-anything looks like.
function embeddedPayload() {
  const el = $('sg-design');
  const text = el ? el.textContent.trim() : '';
  // The committed template ships with a marker where a design would be, so
  // an unspliced template says what it is rather than throwing.
  if (!text || text.startsWith('<!--')) return null;
  return text;
}

function bootError(message) {
  const panel = $('boot-error');
  panel.textContent = message;
  panel.classList.remove('hidden');
  walkOverlay.classList.add('hidden');
}

// The editor's boot guard lives in index.html and is not part of this bundle,
// but render.js calls `window.__sgFail` when a WebGL context is lost and never
// comes back — so the exported walkthrough answers on the same name, through
// the panel it already has. Without this the message would be dropped and a
// dead canvas would go back to being unexplained.
if (typeof window !== 'undefined' && !window.__sgFail) {
  window.__sgFail = (title, body, remedy) => bootError([title, body, remedy]
    .filter(Boolean).join(' '));
}

let state = null;

// ---------- everything below runs only once the design decodes ----------

function boot() {
  const renderApi = initRender(canvas);
  const audio = initAudio(renderApi.walkCamera, { catalogEntry });

  // The leaves' open/shut fractions between frames, so a latch fires once.
  let doorState = new Map();

  const SCOOT_GAP = 130;   // ms
  const SCOOT_MIN = 0.02;  // ft in one frame
  let lastScoot = 0;

  const walk = initWalkthrough(renderApi.walkCamera, canvas, {
    onHud: (text) => { walkHud.textContent = text; },
    onDoors: (leaves) => {
      renderApi.poseDoors(leaves);
      const d = doorEvents(leaves, doorState);
      doorState = d.next;
      for (const ev of d.events) {
        audio.door(ev.kind, { x: ev.x, y: renderApi.walkCamera.position.y - 2, z: ev.z });
      }
    },
    onStep: (spec, at, force, landing) => {
      if (landing) audio.land(spec, at, force);
      else audio.step(spec, at);
    },
    onShove: (list) => {
      renderApi.moveProps(list);
      let far = list[0], best = -1;
      for (const m of list) {
        const d = Math.hypot(m.dx, m.dz);
        if (d > best) { best = d; far = m; }
      }
      const now = performance.now();
      if (best < SCOOT_MIN || now - lastScoot < SCOOT_GAP) return;
      lastScoot = now;
      audio.scoot({ x: far.x, y: renderApi.walkCamera.position.y - 4, z: far.z },
        best / MAX_SHOVE);
    },
  });

  // ---------- labels earned by sight ----------
  //
  // Same four modes as the tool, same gate. No localStorage here — a handed
  // file starts every guest at "earned", which is the mode that teaches.
  const LABEL_MODE_TEXT = {
    earned: 'Room labels: earned — a room joins the map when you first see its door',
    strict: 'Room labels: line of sight only',
    all: 'Room labels: all',
    none: 'Room labels: none',
  };
  let labelMode = 'earned';
  let labelGate = makeLabelGate(state);
  renderApi.setLabelMode(labelMode);
  renderApi.setLabelGate((floorIndex, roomId) =>
    (labelGate ? labelGate.visible(floorIndex, roomId, labelMode) : false));

  const cycleLabelMode = () => {
    labelMode = LABEL_MODES[(LABEL_MODES.indexOf(labelMode) + 1) % LABEL_MODES.length];
    renderApi.setLabelMode(labelMode);
    walkHud.textContent = LABEL_MODE_TEXT[labelMode];
  };

  function labelGateUpdate() {
    if (!labelGate || (labelMode !== 'earned' && labelMode !== 'strict')) return;
    const at = walk.at;
    labelGate.update({ x: at.x, z: at.z, floor: at.floor },
      walk.colliderAt(at.floor).doors, labelMode);
  }

  // ---------- the crowd ----------
  //
  // The walk export keeps the school day: L fills the building from the
  // design's own life record (seed, roll, schedule, timetable), K runs the
  // drill, V rides somebody's shoulder. It is main.js's wiring with the
  // panel taken off — the readouts here are the HUD line and nothing else.
  const life = {
    on: false, agents: [], nav: null, ctx: null,
    colliders: new Map(), site: null, crowd: makeCrowdField(),
    rate: 1, drill: false, clockAcc: 0, plan: null,
  };

  function lifeColliderFor(i) {
    let c = life.colliders.get(i);
    if (!c) {
      c = buildCollider(state, i, catalogEntry, { site: life.site });
      life.colliders.set(i, c);
    }
    return c;
  }

  function lifeStart() {
    const settings = normalizeLife(state.life);
    life.site = terrainField(state);
    life.nav = buildNav(state, { siteField: life.site });
    life.colliders = new Map();
    life.crowd = makeCrowdField();
    life.ctx = makeContext(state, life.nav, {
      site: life.site,
      schedule: settings.schedule,
      colliderFor: lifeColliderFor,
      catalogGet: catalogEntry,
      crowd: life.crowd,
      minutes: state.env.minutes,
    });
    const tt = normalizeTimetable(state.timetable);
    life.plan = isEmptyTimetable(tt) ? null : timetablePlan(tt, life.ctx.schedule);
    life.agents = makePopulation(state, life.nav, {
      seed: settings.seed, students: settings.students,
      schedule: life.ctx.schedule, plan: life.plan,
    });
    life.drill = false;
    life.on = life.agents.length > 0;
    retargetAll(life.ctx, life.agents);
    walk.setBodies((floorIndex) => (life.on ? bodiesOn(life.agents, floorIndex) : null));
    walk.setColliders(lifeColliderFor);
    walk.setLifts(() => (life.ctx ? life.ctx.lifts : null));
    walk.setFollow(null);
    walkHud.textContent = life.on
      ? `${life.agents.length} people in the building — K runs the fire drill, V follows somebody.`
      : 'Nobody to put in the building — it needs rooms with doors.';
    return life.on;
  }

  function lifeStop() {
    life.on = false;
    life.agents = [];
    life.drill = false;
    walk.setBodies(null);
    walk.setColliders(null);
    walk.setLifts(null);
    walk.setFollow(null);
    renderApi.clearCrowd();
    walkHud.textContent = 'The building is empty again.';
  }

  // The clock runs while the school does — whole minutes only, and the bells
  // it crosses ring on the way. See main.js's lifeAdvanceClock for why.
  function lifeAdvanceClock(dt) {
    if (!life.rate) return;
    life.clockAcc += dt * life.rate;
    if (life.clockAcc < 1) return;
    const step = Math.floor(life.clockAcc);
    life.clockAcc -= step;
    const before = state.env.minutes;
    const next = wrapMinutes(before + step);
    for (const bell of bellsBetween(life.ctx.schedule, before, next)) {
      if (audio.running) audio.ring();
      walkHud.textContent = `🔔 ${bell.label} — ${clockText(next)}`;
    }
    const blockBefore = blockAt(life.ctx.schedule, before);
    state.env.minutes = next;
    life.ctx.minutes = next;
    renderApi.setEnvironment(state.env);
    if (blockAt(life.ctx.schedule, next).label !== blockBefore.label && !life.drill) {
      retargetAll(life.ctx, life.agents);
    }
  }

  function lifeUpdate(dt) {
    if (!life.on || !life.ctx) return;
    lifeAdvanceClock(dt);
    const eye = renderApi.walkCamera.position;
    const floorIndex = storeyAt(state, eye.y - EYE_H, groundAt(life.site, eye.x, eye.z));
    stepAgents(life.ctx, life.agents, Math.min(dt, 0.05), {
      bodies: [{ id: 'camera', x: eye.x, z: eye.z, r: WALKER_R, push: 1 }],
      skipFloors: new Set([floorIndex]),
    });
    for (const collider of life.ctx.doorsMoved || []) renderApi.poseDoors(collider.doors);
    renderApi.setCrowd(life.agents, { recolor: true });
    lifeFollowTick();
  }

  function lifeSetDrill(on) {
    if (!life.on) return;
    life.drill = !!on;
    life.ctx.mode = on ? 'drill' : 'day';
    life.ctx.egress = null;
    life.ctx.elapsed = 0;
    if (on) {
      clearCrowd(life.crowd);
      for (const a of life.agents) { a.state = a.state === 'out' ? 'walk' : a.state; a.outAt = null; }
      if (audio.running) audio.announce();
    }
    retargetAll(life.ctx, life.agents);
    walkHud.textContent = on
      ? '🚨 Fire drill — everybody to the nearest way out. K again ends it.'
      : 'Drill over. Back to the timetable.';
  }

  // Nobody → over the shoulder → first person → nobody, on one key.
  function lifeFollow() {
    if (!life.on) return;
    const inside = life.agents.filter((a) => a.state !== 'out');
    if (!inside.length) return;
    const current = walk.following;
    if (!current) {
      const moving = inside.filter((a) => a.state === 'walk');
      const pool = moving.length ? moving : inside;
      walk.setFollow(pool[Math.floor(Math.random() * pool.length)], 'ots');
      walkHud.textContent = 'Over a shoulder — V again for their eyes, once more for your own.';
    } else if (walk.followMode === 'ots') {
      walk.setFollow(current, 'fps');
    } else {
      walk.setFollow(null);
    }
  }

  function lifeFollowTick() {
    const who = walk.following;
    if (who && who.state === 'out') walk.setFollow(null);
  }

  // ---------- Phase 24: lights out ----------
  //
  // The whole mode rides one optional save record. An export whose design
  // carries `haunt: { on: true }` shows one extra overlay button — a star
  // hunt — and the hunt is the trap: each find (and, more slowly, the clock)
  // ratchets haunt.js's stage machine, and everything below is just this
  // shell turning the knobs that machine hands back. An export without the
  // record shows nothing new at all: stealth holds in both directions.
  //
  // The pieces are the pure modules': hunt.js deals the stars, haunt.js
  // paces the night and places the writings, creature.js is the one body.
  // This file only wires — the same bargain the crowd struck, including the
  // collider handoff: when the building empties, the haunt owns them.
  const hauntRec = normalizeHaunt(state.haunt);
  const haunt = {
    armed: hauntRec.on, seed: hauntRec.seed, intensity: hauntRec.intensity,
    on: false, ended: false,
    stage: 0, knobs: null, elapsed: 0,
    hunt: null, nav: null, site: null, warmOpts: null,
    colliders: new Map(), segs: new Map(), doorPts: new Map(),
    creature: null, cctx: null,
    writings: [],
    escape: null, lockedDoors: [],
    slammed: new Map(),
    crash: -1, crashDone: false,
    prevAt: null, spawn: null, exodus: 0,
    envAcc: 0, buzzAcc: 0, warmAcc: 0, lastDetune: 0,
  };

  function hauntColliderFor(i) {
    let c = haunt.colliders.get(i);
    if (!c) {
      c = buildCollider(state, i, catalogEntry, { site: haunt.site });
      haunt.colliders.set(i, c);
    }
    return c;
  }
  const hauntSegsFor = (f) => {
    let s = haunt.segs.get(f);
    if (!s) { s = sightBlockers(state, f); haunt.segs.set(f, s); }
    return s;
  };
  const hauntDoorsFor = (f) => {
    let d = haunt.doorPts.get(f);
    if (!d) { d = doorPoints(state, f); haunt.doorPts.set(f, d); }
    return d;
  };

  const playerEye = () => {
    const at = walk.at;
    return { x: at.x, z: at.z, floor: at.floor };
  };
  const _lookV = new THREE.Vector3();
  function playerLook() {
    renderApi.walkCamera.getWorldDirection(_lookV);
    const d = Math.hypot(_lookV.x, _lookV.z) || 1;
    return { x: _lookV.x / d, z: _lookV.z / d };
  }
  const earY = () => renderApi.walkCamera.position.y;

  function hauntStart() {
    if (haunt.on) return;
    haunt.on = true;
    haunt.site = terrainField(state);
    haunt.nav = buildNav(state, { siteField: haunt.site });
    haunt.hunt = startHunt(haunt.nav, {
      seed: haunt.seed, count: HAUNT_COUNT, items: [HAUNT_ITEM], indoors: true,
    });
    haunt.warmOpts = { nav: haunt.nav };
    haunt.writings = writingPlaces(state, haunt.seed);
    haunt.spawn = playerEye();
    renderApi.setHunt(haunt.hunt.places);
    renderApi.setWritings(haunt.writings);
    // One closure for the whole night: it reads the live knobs, so the
    // renderer is handed a function once rather than a policy per frame.
    renderApi.setLampFlicker((i, t) => {
      const k = haunt.knobs;
      if (!k || (k.lampScale >= 1 && !(k.flickerDepth > 0))) return 1;
      return k.lampScale * flickerAt(k, t, i);
    });
    // Stage 0 wants the school day at its liveliest.
    if (!life.on) lifeStart();
    const n = haunt.hunt.places.length;
    walkHud.textContent =
      `⭐ ${n} gold stars are hidden in the building — the HUD reads warmer as you close in.`;
    const btn = $('walk-hunt');
    if (btn) btn.classList.add('hidden');
  }

  // The exodus is over — or never happened — and the haunt owns the
  // colliders now, the same bargain the crowd struck.
  function hauntTakeBuilding() {
    if (life.on) lifeStop();
    walk.setColliders(hauntColliderFor);
    walk.setLifts(null);
  }

  function hauntEnterStage(index, knobs) {
    haunt.stage = index;
    if (index >= 1 && life.on) life.rate = 0;   // the night owns the clock now
    if (index === 1) {
      // The final bell, and everyone files out. The drill machinery, re-aimed
      // — deliberately without the klaxon or the PA: a dismissal is a bell.
      audio.ring();
      if (life.on && life.ctx) {
        life.drill = true;
        life.ctx.mode = 'drill';
        life.ctx.egress = null;
        life.ctx.elapsed = 0;
        clearCrowd(life.crowd);
        retargetAll(life.ctx, life.agents);
      }
      haunt.exodus = 75;
      walkHud.textContent = '🔔 That’s the last bell.';
    } else if (index === 2) {
      hauntTakeBuilding();
      walkHud.textContent = 'The building is empty again.';
    } else if (index === 3 && !haunt.creature) {
      haunt.cctx = makeCreatureCtx(haunt.nav, {
        state,
        colliderFor: hauntColliderFor,
        sightSegsFor: hauntSegsFor,
        leavesFor: (f) => hauntColliderFor(f).doors,
        playerAt: playerEye,
        playerLook,
        intensity: haunt.intensity,
      });
      const far = banishNode(haunt.nav, playerEye());
      haunt.creature = makeCreature({ seed: haunt.seed, at: far || playerEye() });
      // One more body: it pushes on the camera and it opens doors, through
      // the same walkthrough calls the crowd used.
      walk.setBodies((f) => (haunt.creature && haunt.creature.floor === f
        ? [{ id: haunt.creature.id, x: haunt.creature.x, z: haunt.creature.z, r: CREATURE_R, open: true }]
        : null));
    } else if (index === 4) {
      haunt.escape = escapeDoor(haunt.nav, playerEye(), haunt.seed);
      haunt.lockedDoors = [];
      for (const e of haunt.nav.exits) {
        if (haunt.escape && e.id === haunt.escape.id) continue;
        const collider = hauntColliderFor(e.floor || 0);
        const leaves = (collider.doors || []).filter((l) =>
          Math.hypot(l.cx - e.x, l.cz - e.z) <= ((e.w || 3) / 2 + 2));
        haunt.lockedDoors.push({ exit: e, leaves, toast: 0 });
      }
      walkHud.textContent = knobs.hud || 'Get out.';
    }
  }

  function hauntSlam(door, floorIndex) {
    const collider = hauntColliderFor(floorIndex);
    const leaves = (collider.doors || []).filter((l) =>
      Math.hypot(l.cx - door.x, l.cz - door.z) <= ((door.w || 3) / 2 + 1.5));
    if (!leaves.length) return;
    for (const l of leaves) haunt.slammed.set(l, 3.2);
    if (haunt.cctx && haunt.creature) {
      noteSlam(haunt.cctx, haunt.creature, { x: door.x, z: door.z, floor: floorIndex });
    }
    audio.door('shut', { x: door.x, y: earY() - 1, z: door.z }, 1.9);
  }

  function hauntCreatureTick(dt, knobs) {
    const c = haunt.creature;
    if (!c) return;
    haunt.cctx.chaseArmed = knobs.chaseArmed;
    const at = walk.at;
    // The walkthrough drives the player's storey's doors with the creature
    // merged in; a creature elsewhere drives its own — the crowd's
    // skipFloors bargain, one body wide.
    if (c.floor !== at.floor) {
      const collider = hauntColliderFor(c.floor);
      if (updateDoorsFor(collider, [{ x: c.x, z: c.z, open: true }], dt)) {
        renderApi.poseDoors(collider.doors);
      }
    }
    for (const ev of stepCreature(haunt.cctx, c, dt)) {
      const pos = { x: ev.x, y: earY(), z: ev.z };
      if (ev.kind === 'thud') audio.thud(pos, 0.8);
      else if (ev.kind === 'chase-start') audio.thud(pos, 1.5);
      else if (ev.kind === 'caught') hauntCaught();
    }
    audio.creatureVoice({
      at: { x: c.x, y: c.y + 4, z: c.z },
      mode: c.state === 'chase' ? 'chase' : 'lurk',
    });
    if (c.state === 'chase' && haunt.prevAt && haunt.prevAt.floor === at.floor
        && Math.hypot(c.x - at.x, c.z - at.z) < 30) {
      const door = slamCandidate(hauntDoorsFor(at.floor), haunt.prevAt, at);
      if (door) hauntSlam(door, at.floor);
    }
    // The creature rides the crowd's meshes — they never share a frame, by
    // the stage machine's own invariant, and this guard says so.
    if (!life.on) {
      renderApi.setCrowd([{ ...c, state: c.state === 'freeze' ? 'idle' : 'walk' }],
        { recolor: true });
    }
  }

  function hauntFlightTick(dt) {
    const at = walk.at;
    for (const d of haunt.lockedDoors) {
      for (const l of d.leaves) l.open = 0;
      d.toast = Math.max(0, d.toast - dt);
      if ((d.exit.floor || 0) === at.floor && d.toast <= 0
          && Math.hypot(d.exit.x - at.x, d.exit.z - at.z) < 5) {
        d.toast = 6;
        walkHud.textContent = LOCKED_TEXT;
        audio.door('latch', { x: d.exit.x, y: earY() - 1, z: d.exit.z }, 1.6);
      }
    }
    if (at.floor === 0 && haunt.nav.roomIdAt(0, at.x, at.z) === null) hauntEscaped();
  }

  function hauntEscaped() {
    if (haunt.ended) return;
    haunt.ended = true;
    audio.creatureVoice(null);
    audio.setDetune(0);
    renderApi.setLampFlicker(null);
    renderApi.setCrowd([], {});
    const sum = huntSummary(haunt.hunt);
    $('haunt-end-line').textContent =
      `${sum.found} star${sum.found === 1 ? '' : 's'}, and the one door that still opens.`;
    $('haunt-end').classList.remove('hidden');
    if (walk.controls.isLocked) walk.controls.unlock();
  }

  // ---------- the fake crash ----------
  //
  // Caught. The screen tears into static, holds one honest second of error
  // card on black, and wakes at the entrance — finds kept, creature banished
  // to the far side of the building. haunt.js's `crashCurve` is the numbers;
  // this canvas is only the painter. `prefers-reduced-motion` runs the whole
  // thing at double speed, which halves the static.
  const glitch = $('glitch');
  const glitchCtx = glitch ? glitch.getContext('2d') : null;
  const reducedMotion = typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function drawGlitch(c) {
    if (!glitchCtx) return;
    const w = window.innerWidth, h = window.innerHeight;
    if (glitch.width !== w) glitch.width = w;
    if (glitch.height !== h) glitch.height = h;
    glitchCtx.clearRect(0, 0, w, h);
    if (c.phase === 'black') {
      glitchCtx.fillStyle = '#000';
      glitchCtx.fillRect(0, 0, w, h);
      if (c.text) {
        glitchCtx.fillStyle = '#c9ced6';
        glitchCtx.font = '15px system-ui, sans-serif';
        glitchCtx.textAlign = 'center';
        glitchCtx.fillText('school-walk.html is not responding', w / 2, h / 2 - 12);
        glitchCtx.fillStyle = '#7d838c';
        glitchCtx.font = '12px system-ui, sans-serif';
        glitchCtx.fillText('An error report has been saved.', w / 2, h / 2 + 12);
      }
      return;
    }
    if (c.noise > 0) {
      const cell = 6;
      for (let y = 0; y < h; y += cell) {
        for (let x = 0; x < w; x += cell) {
          if (Math.random() > c.noise) continue;
          const v = Math.floor(Math.random() * 255);
          glitchCtx.fillStyle = `rgb(${v},${v},${v})`;
          glitchCtx.fillRect(x, y, cell, cell);
        }
      }
    }
    for (let i = 0; i < c.bars; i++) {
      const y = Math.random() * h;
      const bh = 4 + Math.random() * 26;
      glitchCtx.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.85)' : 'rgba(210,214,220,0.6)';
      glitchCtx.fillRect(0, y, w, bh);
    }
  }

  function hauntCaught() {
    if (haunt.crash >= 0) return;
    haunt.crash = 0;
    haunt.crashDone = false;
    const at = walk.at;
    audio.thud({ x: at.x, y: earY(), z: at.z }, 1.5);
  }

  function hauntRespawn() {
    const p = haunt.spawn || { x: 0, z: 0, floor: 0 };
    renderApi.walkCamera.position.set(
      p.x, (p.floor || 0) * (state.floorHt || 12) + EYE_H, p.z);
    if (haunt.creature && haunt.nav) {
      const far = banishNode(haunt.nav, p);
      if (far) placeCreature(haunt.creature, far);
    }
    walkHud.textContent = '…the stars you found are still found.';
  }

  function hauntCrashTick(dt) {
    haunt.crash += dt * (reducedMotion ? 2 : 1);
    const c = crashCurve(haunt.crash);
    if (glitch) glitch.classList.remove('hidden');
    drawGlitch(c);
    if (!haunt.crashDone && (c.phase === 'black' || c.phase === 'wake')) {
      haunt.crashDone = true;
      hauntRespawn();
    }
    if (haunt.crash >= CRASH_S) {
      haunt.crash = -1;
      if (glitch) glitch.classList.add('hidden');
    }
  }

  // ---------- the night, once a frame ----------
  function hauntUpdate(dt) {
    if (haunt.crash >= 0) { hauntCrashTick(dt); return; }
    if (!haunt.on || haunt.ended) return;
    haunt.elapsed += dt;
    const sum = huntSummary(haunt.hunt);
    const st = stageFor(haunt, { finds: sum.found, total: sum.total, elapsed: haunt.elapsed });
    const knobs = stageKnobs(st.index, st.t, haunt);
    haunt.knobs = knobs;
    if (st.index !== haunt.stage) hauntEnterStage(st.index, knobs);

    const at = walk.at;
    const found = checkFind(haunt.hunt, at);
    if (found) {
      audio.chime({ x: found.x, y: earY(), z: found.z });
      const s2 = huntSummary(haunt.hunt);
      walkHud.textContent = s2.done
        ? '⭐ That’s all of them.'
        : `⭐ ${s2.found} of ${s2.total}.`;
      haunt.warmAcc = -4;
    }
    renderApi.updateHunt(at, haunt.hunt.found, dt);

    // The warmth line, every few seconds while stars are still out — routed
    // over the navgraph, so a star one wall away reads cool the long way round.
    haunt.warmAcc += dt;
    if (haunt.warmAcc >= 4 && !sum.done && haunt.stage < 4) {
      haunt.warmAcc = 0;
      const w = huntWarmth(haunt.hunt, at, haunt.warmOpts);
      if (w) walkHud.textContent = `⭐ ${sum.found}/${sum.total} · ${w.label} — ${w.place.hint}`;
    }

    // The sun, drifted — throttled, because each env write re-runs the light
    // budget, fine at a half hertz and ruinous at sixty.
    if (knobs.sunMinutes !== null) {
      haunt.envAcc += dt;
      if (haunt.envAcc >= 2 && state.env.minutes < knobs.sunMinutes) {
        // Four game-minutes a second: a whole afternoon dies in about three
        // real minutes, which is one dusk stage — fast enough to be *going*,
        // slow enough that nobody sees a sun move.
        state.env.minutes = Math.min(knobs.sunMinutes,
          state.env.minutes + Math.ceil(haunt.envAcc * 4));
        haunt.envAcc = 0;
        renderApi.setEnvironment(state.env);
      }
    }

    renderApi.updateWritings(Math.round(knobs.writings * haunt.writings.length));
    if (Math.abs(knobs.detuneCents - haunt.lastDetune) > 1.5) {
      haunt.lastDetune = knobs.detuneCents;
      audio.setDetune(knobs.detuneCents);
    }

    // The failing fixture's ballast, overhead, gated by the same curve that
    // dims it — light and sound fail together or the trick reads as two.
    haunt.buzzAcc += dt;
    if (haunt.buzzAcc >= 0.1) {
      haunt.buzzAcc = 0;
      const dip = knobs.flickerDepth > 0
        ? 1 - flickerAt(knobs, haunt.elapsed, knobs.failing) : 0;
      audio.buzz({ x: at.x, y: earY() + 4, z: at.z }, Math.min(1, dip * 2.2));
    }

    // Slammed leaves stay shut until their lockout decays.
    for (const [l, s] of [...haunt.slammed]) {
      l.open = 0;
      if (s - dt <= 0) haunt.slammed.delete(l);
      else haunt.slammed.set(l, s - dt);
    }

    // The dismissal's tail: when the last of the crowd is out — or 75s pass,
    // stragglers vanishing under the first long blackout — the building is
    // the haunt's.
    if (haunt.stage === 1 && life.on) {
      haunt.exodus -= dt;
      const inside = life.agents.some((a) => a.state !== 'out');
      if (haunt.exodus <= 0 || !inside) hauntTakeBuilding();
    }

    if (knobs.creature) hauntCreatureTick(dt, knobs);
    if (knobs.lockExits) hauntFlightTick(dt);
    haunt.prevAt = { x: at.x, z: at.z, floor: at.floor };
  }

  // ---------- the minimap ----------
  //
  // main.js's map with the findings layer left at home — findings come from
  // the report, and the report is analysis, which stayed with the tool. Plans
  // and rasters cache forever here: the design can never change under them.
  const miniCanvas = $('minimap');
  const miniCtx = miniCanvas.getContext('2d');
  let miniOn = true;
  let miniMode = 'follow';
  let miniOrient = 'heading';
  let miniRange = 90;
  const MINI_SCALES = [0.5, 1, 2, 4];
  const miniPlans = new Map();
  const miniRasters = new Map();

  const MINI_BOUND_PAD = 12; // ft
  function miniBounds(floor, plan) {
    const b = floorBounds(floor);
    if (!b) return plan.bounds;
    return {
      minX: Math.max(plan.bounds.minX, b.x0 * CELL - MINI_BOUND_PAD),
      minZ: Math.max(plan.bounds.minZ, b.y0 * CELL - MINI_BOUND_PAD),
      maxX: Math.min(plan.bounds.maxX, (b.x1 + 1) * CELL + MINI_BOUND_PAD),
      maxZ: Math.min(plan.bounds.maxZ, (b.y1 + 1) * CELL + MINI_BOUND_PAD),
    };
  }

  function miniPlanFor(floorIndex) {
    let cached = miniPlans.get(floorIndex);
    if (cached !== undefined) return cached;
    const plan = computeFloorPlan(state, floorIndex);
    cached = plan ? { plan, bounds: miniBounds(state.floors[floorIndex], plan) } : null;
    miniPlans.set(floorIndex, cached);
    return cached;
  }

  const miniScaleFor = (want) =>
    MINI_SCALES.find((s) => s >= want) || MINI_SCALES[MINI_SCALES.length - 1];

  function miniRasterFor(floorIndex, record, scale) {
    const key = `${floorIndex}:${scale}`;
    let c = miniRasters.get(key);
    if (c !== undefined) return c;
    const b = record.plan.bounds;
    const w = Math.max(1, Math.ceil((b.maxX - b.minX) * scale));
    const h = Math.max(1, Math.ceil((b.maxZ - b.minZ) * scale));
    if (w > 4000 || h > 4000) { miniRasters.set(key, null); return null; }
    c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = INK.miniPaper;
    ctx.fillRect(0, 0, w, h);
    drawPlanBody(ctx, record.plan, { scale, margin: 0, titleH: 0 }, {
      showFurniture: scale >= 1,
      showLabels: false,
      showDimensions: false,
    });
    miniRasters.set(key, c);
    return c;
  }

  function drawMinimap() {
    const cam = renderApi.walkCamera;
    const floorIndex = Math.max(0, Math.min(state.floors.length - 1,
      storeyAt(state, cam.position.y - EYE_H)));
    const record = miniPlanFor(floorIndex);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = MINI_SIZE;
    if (miniCanvas.width !== size * dpr) {
      miniCanvas.width = size * dpr;
      miniCanvas.height = size * dpr;
    }
    const e = new THREE.Euler().setFromQuaternion(cam.quaternion, 'YXZ');
    const eye = { x: cam.position.x, z: cam.position.z, yaw: e.y };
    const view = minimapView(record ? record.bounds : null, eye,
      { size, mode: miniMode, orient: miniOrient, range: miniRange });
    const raster = record ? miniRasterFor(floorIndex, record, miniScaleFor(view.scale)) : null;

    miniCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    miniCtx.clearRect(0, 0, size, size);
    miniCtx.fillStyle = INK.miniPaper;
    miniCtx.fillRect(0, 0, size, size);

    if (raster) {
      miniCtx.save();
      miniCtx.translate(size / 2, size / 2);
      miniCtx.rotate(view.rotation);
      miniCtx.scale(view.scale, view.scale);
      miniCtx.translate(-view.cx, -view.cz);
      const b = record.plan.bounds;
      miniCtx.drawImage(raster, b.minX, b.minZ, b.maxX - b.minX, b.maxZ - b.minZ);
      miniCtx.restore();
    }

    const cone = viewCone(view, eye);
    miniCtx.beginPath();
    miniCtx.moveTo(cone.at.x, cone.at.y);
    miniCtx.lineTo(cone.left.x, cone.left.y);
    miniCtx.lineTo(cone.right.x, cone.right.y);
    miniCtx.closePath();
    miniCtx.fillStyle = 'rgba(77, 163, 255, 0.28)';
    miniCtx.fill();

    const at = worldToMini(view, eye.x, eye.z);
    const a = markerAngle(view, eye.yaw);
    miniCtx.save();
    miniCtx.translate(at.x, at.y);
    miniCtx.rotate(a);
    miniCtx.beginPath();
    miniCtx.moveTo(0, -6);
    miniCtx.lineTo(4.2, 5);
    miniCtx.lineTo(0, 3);
    miniCtx.lineTo(-4.2, 5);
    miniCtx.closePath();
    miniCtx.fillStyle = '#2f6fd0';
    miniCtx.strokeStyle = '#ffffff';
    miniCtx.lineWidth = 1.2;
    miniCtx.fill();
    miniCtx.stroke();
    miniCtx.restore();

    const bar = scaleBar(view);
    miniCtx.strokeStyle = 'rgba(26, 32, 41, 0.75)';
    miniCtx.lineWidth = 2;
    miniCtx.beginPath();
    miniCtx.moveTo(8, size - 10);
    miniCtx.lineTo(8 + bar.px, size - 10);
    miniCtx.stroke();
    miniCtx.fillStyle = 'rgba(26, 32, 41, 0.8)';
    miniCtx.font = '9px system-ui, sans-serif';
    miniCtx.fillText(bar.label, 8, size - 14);

    const note = $('minimap-note');
    const text = `Level ${floorIndex + 1} · ${describeMinimap(view)}`;
    if (note.textContent !== text) note.textContent = text;
  }

  function updateMinimapButtons() {
    $('minimap-mode').textContent = miniMode === 'fit' ? 'Whole floor' : 'Follow';
    $('minimap-orient').textContent = miniOrient === 'heading' ? 'Heading' : 'North';
    $('minimap-in').disabled = miniMode === 'fit' || miniRange <= MIN_RANGE;
    $('minimap-out').disabled = miniMode === 'fit' || miniRange >= MAX_RANGE;
    document.body.classList.toggle('minimap', miniOn);
  }

  $('minimap-mode').addEventListener('click', () => { miniMode = nextMode(miniMode); updateMinimapButtons(); });
  $('minimap-orient').addEventListener('click', () => { miniOrient = nextOrient(miniOrient); updateMinimapButtons(); });
  $('minimap-in').addEventListener('click', () => {
    miniRange = Math.max(MIN_RANGE, Math.round(miniRange / 1.5));
    updateMinimapButtons();
  });
  $('minimap-out').addEventListener('click', () => {
    miniRange = Math.min(MAX_RANGE, Math.round(miniRange * 1.5));
    updateMinimapButtons();
  });

  // ---------- photo mode ----------
  let photoMode = false;

  function setPhotoMode(on) {
    if (on === photoMode) return;
    photoMode = on;
    document.body.classList.toggle('photo', on);
    walk.setGhost(on);
    renderApi.setPhoto({ on });
    if (on) {
      if (walk.controls.isLocked) walk.controls.unlock();
      walkOverlay.classList.add('hidden');
      renderPhotoPanel();
    } else if (!isTouch && !walk.controls.isLocked) {
      openWalkOverlay();
    }
  }

  function renderPhotoPanel() {
    const p = renderApi.photo;
    $('photo-fov').value = String(Math.round(p.fov));
    $('photo-fov-value').textContent = `${Math.round(p.fov)}°`;
    $('photo-focus').value = String(Math.round(p.focus));
    $('photo-focus-value').textContent = `${Math.round(p.focus)} ft`;
    $('photo-aperture').value = String(p.aperture);
    $('photo-aperture-value').textContent = `f/${p.aperture.toFixed(1)}`;
    $('photo-dof').checked = p.dof;
    $('photo-exposure').value = String(renderApi.exposureBias);
    $('photo-exposure-value').textContent = `${renderApi.exposureBias.toFixed(2)}×`;
  }

  // Phase 20's one-click times of day, on the photo panel — the walk export
  // has no sky panel, and golden hour is most of what a photograph wants.
  function renderMoods() {
    const host = $('photo-moods');
    for (const m of MOODS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = `${m.icon} ${m.label}`;
      b.addEventListener('click', () => {
        state.env = applyMood(state.env, m.key);
        renderApi.setEnvironment(state.env);
      });
      host.appendChild(b);
    }
  }

  $('photo-fov').addEventListener('input', (e) => {
    renderApi.setPhoto({ fov: Number(e.target.value) });
    renderPhotoPanel();
  });
  $('photo-focus').addEventListener('input', (e) => {
    renderApi.setPhoto({ focus: Number(e.target.value) });
    renderPhotoPanel();
  });
  $('photo-aperture').addEventListener('input', (e) => {
    renderApi.setPhoto({ aperture: Number(e.target.value) });
    renderPhotoPanel();
  });
  $('photo-dof').addEventListener('change', (e) => {
    renderApi.setPhoto({ dof: e.target.checked });
    renderPhotoPanel();
  });
  $('photo-exposure').addEventListener('input', (e) => {
    renderApi.exposureBias = Number(e.target.value);
    renderPhotoPanel();
  });
  for (const [id, scale] of [['photo-1x', 1], ['photo-2x', 2], ['photo-4x', 4]]) {
    $(id).addEventListener('click', () => {
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      renderApi.downloadCapture(scale, `school-photo-${stamp}.png`);
    });
  }
  $('photo-exit').addEventListener('click', () => setPhotoMode(false));

  // ---------- touch ----------
  //
  // Same joystick main.js wires: no pointer to lock on a phone, so movement
  // is a thumb and looking is a drag on the canvas (walkthrough.js owns the
  // drag; the joystick and buttons are wired here).
  const isTouch = isTouchCapable();
  const JOY_RADIUS = 44; // px — half the base minus the knob, matches the CSS

  const joystickEl = $('touch-joystick');
  const joystickKnob = $('touch-joystick-knob');
  let joyPointerId = null;
  let joyCenter = null;

  function joystickReset() {
    joystickKnob.style.transform = '';
    walk.setMoveAxes(0, 0);
  }
  function joystickUpdate(e) {
    const axes = joystickAxes(e.clientX - joyCenter.x, e.clientY - joyCenter.y, JOY_RADIUS);
    joystickKnob.style.transform = `translate(${axes.x * JOY_RADIUS}px, ${-axes.y * JOY_RADIUS}px)`;
    walk.setMoveAxes(axes.x, axes.y);
  }
  joystickEl.addEventListener('pointerdown', (e) => {
    if (joyPointerId !== null) return;
    joyPointerId = e.pointerId;
    const r = joystickEl.getBoundingClientRect();
    joyCenter = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    joystickEl.setPointerCapture(e.pointerId);
    joystickUpdate(e);
  });
  joystickEl.addEventListener('pointermove', (e) => { if (e.pointerId === joyPointerId) joystickUpdate(e); });
  function joystickEnd(e) {
    if (e.pointerId !== joyPointerId) return;
    joyPointerId = null;
    joystickReset();
  }
  joystickEl.addEventListener('pointerup', joystickEnd);
  joystickEl.addEventListener('pointercancel', joystickEnd);

  const touchJumpBtn = $('touch-jump');
  touchJumpBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); walk.touchKey('Space', true); });
  touchJumpBtn.addEventListener('pointerup', () => walk.touchKey('Space', false));
  touchJumpBtn.addEventListener('pointercancel', () => walk.touchKey('Space', false));

  $('touch-lift').addEventListener('click', () => walk.rideElevator());

  const touchSprintBtn = $('touch-sprint');
  let touchSprintOn = false;
  touchSprintBtn.addEventListener('click', () => {
    touchSprintOn = !touchSprintOn;
    walk.touchKey('ShiftLeft', touchSprintOn);
    touchSprintBtn.setAttribute('aria-pressed', String(touchSprintOn));
  });

  $('touch-menu').addEventListener('click', () => {
    walkOverlay.classList.remove('hidden');
  });

  if (isTouch) {
    document.body.classList.add('touch');
    $('walk-start').textContent = 'Tap to Walk';
    $('walk-controls-hint').innerHTML =
      'Left joystick to move &nbsp;·&nbsp; drag anywhere else to look<br />' +
      '🏃 toggles sprint &nbsp;·&nbsp; ⤒ jumps &nbsp;·&nbsp; 🛗 calls the lift<br />' +
      '≡ brings this sheet back';
  }

  // ---------- the overlay and the walk itself ----------
  function openWalkOverlay() {
    walkOverlay.classList.remove('hidden');
    $('walk-start').focus();
  }

  $('walk-start').addEventListener('click', () => {
    // An AudioContext may only start inside a user gesture, and this click is
    // the one that means "I want to be in the building".
    audio.setActive(true);
    if (isTouch) {
      walk.enableTouch();
      document.body.classList.add('touch-walk');
      walkOverlay.classList.add('hidden');
    } else {
      walk.controls.lock();
    }
  });

  $('walk-life').addEventListener('click', () => {
    if (life.on) lifeStop(); else lifeStart();
    $('walk-life').textContent = life.on ? '👥 Empty the building' : '👥 People';
  });

  // The star hunt's one button — in the overlay only when the design armed
  // it, and gone the moment it is pressed. An unarmed export never shows it.
  const walkHuntBtn = $('walk-hunt');
  if (walkHuntBtn) {
    if (haunt.armed) walkHuntBtn.classList.remove('hidden');
    walkHuntBtn.addEventListener('click', () => {
      audio.setActive(true);
      hauntStart();
      if (isTouch) {
        walk.enableTouch();
        document.body.classList.add('touch-walk');
        walkOverlay.classList.add('hidden');
      } else {
        walk.controls.lock();
      }
    });
  }
  const hauntEndBtn = $('haunt-end-close');
  if (hauntEndBtn) {
    hauntEndBtn.addEventListener('click', () => {
      $('haunt-end').classList.add('hidden');
      openWalkOverlay();
    });
  }

  walk.controls.addEventListener('lock', () => walkOverlay.classList.add('hidden'));
  walk.controls.addEventListener('unlock', () => {
    if (!photoMode && !haunt.ended) openWalkOverlay();
  });

  // ---------- keys ----------
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    switch (e.code) {
      case 'KeyI': cycleLabelMode(); break;
      case 'KeyJ': miniOn = !miniOn; updateMinimapButtons(); break;
      case 'KeyP': setPhotoMode(!photoMode); break;
      case 'KeyL': $('walk-life').click(); break;
      case 'KeyK': if (life.on) lifeSetDrill(!life.drill); break;
      case 'KeyV': lifeFollow(); break;
      case 'KeyB': audio.ring(); break;
      case 'KeyN': audio.announce(); break;
      default: break;
    }
  });

  // ---------- boot ----------
  renderApi.setMode('walk');
  document.body.dataset.mode = 'walk';
  renderApi.buildFromState(state);
  walk.enable(state);
  audio.setWorld(state);
  renderMoods();
  updateMinimapButtons();
  renderApi.resize();
  window.addEventListener('resize', () => renderApi.resize());
  openWalkOverlay();

  const clock = new THREE.Clock();
  function loop() {
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.1);
    walk.update(dt);
    audio.update(dt);
    labelGateUpdate();
    lifeUpdate(dt);
    hauntUpdate(dt);
    renderApi.poseLifts(walk.lifts || (life.ctx && life.ctx.lifts));
    renderApi.render(dt);
    if (miniOn && !photoMode) drawMinimap();
  }
  loop();

  // debug/test hook — the visual harness and the export smoke test read this.
  window.walkApp = {
    get state() { return state; }, renderApi, walk, audio, life, setPhotoMode,
    haunt, hauntStart, hauntUpdate,
  };
}

// The async edge of the whole file: the codec inflates through
// DecompressionStream, so the design arrives on a promise and everything
// else waits for it.
(async () => {
  const payload = embeddedPayload();
  if (!payload) {
    bootError('This file has no design embedded — it is the empty template. '
      + 'Export a walk from the School Generator to get one with a school in it.');
    return;
  }
  try {
    state = deserialize(await decodeShare(payload));
  } catch (err) {
    bootError(`Could not open the design this file carries: ${err.message}`);
    return;
  }
  boot();
})();
