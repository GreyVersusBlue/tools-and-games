// agents.js — the people in the building.
//
// The walker stops being alone. Everything here is one idea repeated: **an
// agent is the walkthrough camera with a timetable instead of a keyboard.** It
// has the same body radius, it is resolved by the same `moveWalker`, it stands
// on whatever `supportAt` says is under it, and it climbs a stair by walking at
// it — because a stair is a surface, and always was. Phase 5 built that walker
// for one camera; this phase discovers that it takes an `n` without asking for
// one, which is why collide.js gained a `bodies` list and a spatial index and
// nothing else.
//
// Pure module, on the same terms as the rest: no three.js, no DOM, no clock of
// its own. `stepAgents` is handed a `dt` and a way to get a collider, and
// mutates the agent records in place — the one concession to a per-frame budget
// that allocating a new population every frame would blow.
//
// Three decisions worth knowing:
//
// * **Agents are steered, not scripted.** Each one holds a route out of
//   navgraph.js and walks at the next waypoint; nothing interpolates it along a
//   spline. So a corridor full of people is a corridor full of bodies pushing
//   each other out of the way, and a doorway two people arrive at together is a
//   doorway they queue at. That queue is the whole point of the fire drill.
// * **A seat is a prop.** Sitting down is walking to a chair the room already
//   contains and stopping there, which is why Phase 1 made seats separate
//   objects from the desks they belong to. A room with no chairs in it has a
//   class standing up, which is honest.
// * **Randomness is seeded, always.** A population is a pure function of
//   (design, seed, size). Two people with the same file and the same seed watch
//   the same school day.

import { CELL, FLOOR_H } from './grid.js';
import { propsOnFloor } from './props.js';
import {
  moveWalker, resolvePoint, supportAt, storeyAt, updateDoorsFor, STEP_UP, WALKER_R,
} from './collide.js';
import { groundAt } from './terrain.js';
import {
  blocks, blockAt, normalizeSchedule, isDefaultSchedule, makeTimetable, fixedTimetable,
} from './schedule.js';
import {
  route, egressField, teachingRooms, commonRooms, runLandings, DOOR_OFFSET,
} from './navgraph.js';
import { stairUnder, stairMetrics } from './stairs.js';

// A body a little narrower than the camera's. Two people have to pass each
// other in a 3ft doorway without either of them being pushed through a jamb,
// and the camera's 0.9 is sized for one.
export const AGENT_R = 0.72;         // ft
// Walking, hurrying between classes, and evacuating. A corridor at a passing
// period is genuinely faster than a corridor at any other time, and a drill is
// faster again without ever being a run — nobody runs in a fire drill, which
// is the first thing anybody is ever taught about one.
export const SPEED = { walk: 4.2, passing: 5.2, drill: 6.2 };
export const SPEED_VAR = 0.22;       // ±, per person, fixed at spawn
// How near a waypoint counts as reaching it. Wider than it sounds, because a
// waypoint is a hub in the middle of a room rather than a spot on the floor.
export const ARRIVE = 2.4;           // ft
// A chair is a spot on the floor — but it is also an obstacle, and a body
// resolved out of it can never stand on it. So arriving at a seat means
// getting within reach of one, and sitting snaps the rest of the way: which is
// what sitting down is.
export const ARRIVE_SEAT = 1.8;      // ft
// How far behind a seat its approach point stands. A pace and a half: far
// enough to be clear of the chair itself, near enough to be in the aisle
// rather than in the next row.
export const SEAT_APPROACH = 2.6;    // ft
// A doorway is aimed at rather than wandered near: the two points either side
// of one are what line a body up with the opening, and a loose radius on them
// is a body that clips the jamb and slides along the wall instead.
export const ARRIVE_DOOR = 1.15;     // ft
// Stop trying after this long without progress and ask the graph again. A
// crowd wedged in a doorway un-wedges itself; an agent walked into a corner by
// a design change does not.
export const STUCK_S = 2.2;
// How hard one person shoves another (see `pushOutOfCircle`). Well under 1, so
// a doorway is a queue rather than a deadlock.
export const BODY_PUSH = 0.5;
// Sidestepping. A body held up for this long starts angling round whatever is
// in front of it, one way or the other by its own `lane` — two people meeting
// head on pick opposite sides and get past each other, which is the entire
// social protocol of a corridor.
export const SHUFFLE_S = 0.5;
export const SHUFFLE_ANGLE = 0.62;   // rad — about 35°
// Getting round *furniture* is a different move from getting round a person.
// A desk doesn't step aside, so angling 35° off just walks into the next one
// along; what works is going almost sideways — following the edge of the thing
// until it ends. Held for long enough to actually clear a row of desks, too:
// a sidestep that changes its mind twice a second is a body oscillating in
// place, which is what the first version of this did.
export const SIDESTEP_ANGLE = 1.4;   // rad — about 80°
export const SIDESTEP_HOLD = 2.5;    // s before trying the other way
// Following. You do not walk into the back of the person in front of you: you
// slow down, and you stop a pace behind them. Without this a queue at a door
// is twelve people all pushing at once and nobody at the front of it, which
// jams permanently however soft the shoving is.
//
// **You only follow someone going your way.** Braking for a body coming the
// other way is the one thing that must not happen here: two people walking at
// each other both stop, both keep facing each other, and the corridor
// deadlocks permanently — which is exactly what the first version of this did.
// Somebody oncoming is somebody you go *around*, which is what the shuffle is
// for.
export const FOLLOW_NEAR = 1.5;      // ft — stop this far behind
export const FOLLOW_FAR = 2.9;       // ft — start slowing here
export const FOLLOW_CONE = 0.72;     // how far off your heading counts as "in front"
export const FOLLOW_ALIGN = 0.2;     // ...and how nearly their heading has to match yours
// Nobody is ever brought to a complete halt by another body. A crowd with a
// floor under its speed always drains; a crowd without one can find a standoff
// that no amount of patience clears.
export const CREEP = 0.18;
// How near its own doorway a body has to be before that doorway counts as one
// it is using — see `bodiesNear`. A little wider than openings.js's own
// proximity band, so a door is already moving by the time somebody arrives.
export const DOOR_REACH = 10;        // ft
// How far from a doorway two people start taking turns at it.
export const DOOR_YIELD = 4;         // ft
// ...and how near it counts as being *in* the doorway rather than beside it.
export const DOOR_MOUTH = 2.6;       // ft
export const YIELD_MAX = 2.5;        // s of politeness, then you go
// The escape valve. Every rule above is about *not* walking into people, and
// every one of them can, in a tight enough crowd, add up to a body that never
// moves again: it brakes for the queue, the queue brakes for the doorway, and
// the shove that would sort it out is exactly what politeness forbids. So a
// body that has got nowhere for this long stops being polite — it walks at
// full speed and ignores other people entirely, which for a couple of seconds
// looks like somebody squeezing past and, unlike every alternative, always
// terminates. Bodies are soft, so the overlap it makes is cleaned up by the
// next frame's resolution.
export const PATIENCE = 8;           // s
// ...and how long before a body that has run out of route may ask for another
// one. A search is cheap; a search whose answer flips every time you step
// across a threshold is a body pacing a corridor.
export const REPATH_COOLDOWN = 5;    // s
export const MAX_POP = 600;
// Seats an agent will consider in its room. Beyond this the nearest-free scan
// costs more than sitting somewhere sensible is worth.
export const SEAT_SCAN = 400;

// What a person is made of, for the renderer. Kept here rather than in
// render.js because the palette is per-agent state — an agent keeps its shirt
// between frames — and because a headless test can then assert that a
// population is reproducible right down to its colours.
export const SHIRTS = [
  '#3f6fae', '#7c2f3e', '#4f6f52', '#c98a3f', '#5b4a8a', '#2f7f8a',
  '#a8503f', '#3f8a5a', '#8a6a3f', '#4a5a7a', '#8a3f6a', '#5f7f3f',
];
export const TROUSERS = ['#2c3038', '#3a4250', '#4a3f36', '#26303a', '#514a42'];
export const SKINS = ['#e8c49a', '#d6a97a', '#b98253', '#8d5a34', '#6b4226', '#f0d5b8'];
export const TEACHER_SHIRTS = ['#2c3e50', '#4b3b52', '#3d5a4c', '#5a3f34'];

const FIRST_NAMES = [
  'Ada', 'Ben', 'Cruz', 'Dara', 'Eli', 'Faye', 'Gus', 'Hana', 'Ivo', 'Jae',
  'Kit', 'Lena', 'Milo', 'Nia', 'Omar', 'Pia', 'Quinn', 'Rosa', 'Sam', 'Tess',
  'Uma', 'Vik', 'Wren', 'Xiu', 'Yara', 'Zane',
];

// ---------- the settings a design carries ----------
//
// Agents themselves are never saved — a population is a pure function of the
// design, a seed and a size, so saving one would be saving something that can
// be recomputed, and (worse) a school full of people frozen mid-stride. What
// the file carries is the three numbers that reproduce them.

export const DEFAULT_LIFE = { students: 90, seed: 1 };

export function normalizeLife(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const num = (v, dflt, lo, hi) => {
    const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : dflt;
    return Math.min(hi, Math.max(lo, n));
  };
  const out = {
    students: num(src.students, DEFAULT_LIFE.students, 0, MAX_POP),
    seed: num(src.seed, DEFAULT_LIFE.seed, 1, 0x7fffffff),
  };
  // The schedule rides along only when it differs from the default one, the
  // same rule the environment, the roof and a plain doorway follow.
  const sched = normalizeSchedule(src.schedule);
  if (!isDefaultSchedule(sched)) out.schedule = sched;
  return out;
}

export const defaultLife = () => ({ ...DEFAULT_LIFE });

export const isDefaultLife = (life) => {
  if (!life) return true;
  const l = normalizeLife(life);
  return l.students === DEFAULT_LIFE.students && l.seed === DEFAULT_LIFE.seed && !l.schedule;
};

// ---------- randomness ----------

// mulberry32: thirty-two bits of state, four lines, and the same sequence
// everywhere. A seeded population is the difference between "watch this again"
// and "watch something like this again".
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rand, list) => list[Math.floor(rand() * list.length) % list.length];
const facingTo = (dx, dz) => Math.atan2(dx, dz);
const angleLerp = (from, to, t) => {
  let d = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return from + d * t;
};

// ---------- seats ----------

// Which props you can sit on, by geometry key. A row can override with an
// explicit `seat` block — the same escape hatch `emit` and `sound` give
// lights.js and sound.js — but every chair in the catalog is a chair because
// it is drawn like one, and a table of five keys beats five hundred rows.
export const SEAT_GEOS = {
  chair: { h: 1.5, back: true },
  stool: { h: 1.9, back: false },
  bench: { h: 1.35, back: false },
  softseat: { h: 1.2, back: true },
  audseat: { h: 1.5, back: true },
};

export function seatOf(entry) {
  if (!entry || entry.mount !== 'floor') return null;
  if (entry.seat && typeof entry.seat === 'object') return { h: 1.5, back: true, ...entry.seat };
  const byGeo = SEAT_GEOS[entry.geo];
  if (!byGeo) return null;
  // A floor cushion is a seat; it is also four inches tall, and sitting a
  // person's hips at ankle height reads as a bug rather than as a beanbag.
  return { ...byGeo, h: Math.min(byGeo.h, Math.max(0.4, (entry.h || 1) * 0.55)) };
}

export const isSeat = (entry) => seatOf(entry) !== null;

// Every seat inside one room, as somewhere to sit. `nav.roomIdAt` decides what
// "inside" means, so a chair belongs to the room the *model* says it is in
// rather than to the nearest bounding box.
export function seatsIn(state, nav, room, catalogGet, limit = SEAT_SCAN) {
  const out = [];
  if (!room || room.floor < 0) return out;
  for (const p of propsOnFloor(state, room.floor)) {
    const entry = catalogGet(p.type);
    const seat = seatOf(entry);
    if (!seat) continue;
    if (nav.roomIdAt(room.floor, p.x, p.z) !== room.id) continue;
    out.push({
      id: p.id,
      x: p.x, z: p.z,
      // A seat faces the way its prop faces, and a person sitting on it faces
      // the same way — which is what makes a classroom of chairs a classroom
      // of people looking at the board rather than at each other.
      facing: p.rotationY || 0,
      h: seat.h * (p.scale > 0 ? p.scale : 1),
      teacher: /teacher|task/.test(p.type),
    });
    if (out.length >= limit) break;
  }
  return out;
}

// ---------- the population ----------

function makeAgent(id, kind, rand, room, opts = {}) {
  const jitter = (r) => (rand() - 0.5) * r;
  const teacher = kind === 'teacher';
  return {
    id,
    kind,
    name: `${pick(rand, FIRST_NAMES)} ${String.fromCharCode(65 + Math.floor(rand() * 26))}.`,
    // Where the body is. `y` is the *feet*, the same datum every height in
    // collide.js uses, and the floor an agent is on is derived from it rather
    // than stored — exactly as `storeyAt` does it for the camera.
    x: room ? room.x + jitter(6) : 0,
    z: room ? room.z + jitter(6) : 0,
    y: room ? room.floor * (opts.floorHt || FLOOR_H) : 0,
    // Which storey the body is on. Derived from `y` on every step — but it has
    // to be right *before* the first one, because the first thing anybody does
    // with a new population is ask the graph for a route, and a route from the
    // wrong storey is a route to the wrong building.
    floorIndex: room ? room.floor : 0,
    facing: rand() * Math.PI * 2,
    speed: 1 + (rand() * 2 - 1) * SPEED_VAR,
    shirt: teacher ? pick(rand, TEACHER_SHIRTS) : pick(rand, SHIRTS),
    trousers: pick(rand, TROUSERS),
    skin: pick(rand, SKINS),
    height: teacher ? 0.98 + rand() * 0.08 : 0.82 + rand() * 0.16,
    home: room ? room.id : null,
    lunch: opts.lunch || null,
    timetable: opts.timetable || [],
    // Where it is trying to be, and how it is getting there. Both are derived
    // from the schedule every time the block changes; neither is saved.
    goal: null,
    path: null,
    wp: 0,
    state: 'idle',        // idle | walk | sit | out
    seat: null,
    gait: rand() * Math.PI * 2,
    lane: rand() * 2 - 1,
    stuck: 0,
    wait: 0,
    yielding: false,
    yielded: 0,
    lastX: 0, lastZ: 0,
    walked: 0,
    repathAt: -1e9,
    outAt: null,
  };
}

// A school's worth of people. Teachers first — one per teaching room, because
// that is what makes a room a class — then students spread over the same
// rooms' timetables.
export function makePopulation(state, nav, opts = {}) {
  const sched = normalizeSchedule(opts.schedule);
  const rand = rng(opts.seed ?? 1);
  const floorHt = state.floorHt || FLOOR_H;
  const teaching = teachingRooms(nav);
  const common = commonRooms(nav);
  const agents = [];
  if (!teaching.length) return agents;

  const lunchRoom = pickLunchroom(common, teaching);
  const wanted = Math.max(0, Math.min(MAX_POP, Math.round(opts.students ?? 90)));
  const teacherCount = Math.max(0, Math.min(teaching.length,
    Math.round(opts.teachers ?? teaching.length)));

  let id = 1;
  for (let i = 0; i < teacherCount; i++) {
    const room = teaching[i];
    agents.push(makeAgent(id++, 'teacher', rand, room, {
      floorHt,
      timetable: fixedTimetable(room.id, sched),
      lunch: room.id,
    }));
  }
  const roomIds = teaching.map((r) => r.id);
  for (let i = 0; i < wanted; i++) {
    // Spread the intake over the rooms rather than letting the seed cluster
    // it: a homeroom is where a student starts the day, and a school with
    // thirty in one room and none in the next reads as broken before the first
    // bell has even gone.
    const home = roomIds[i % roomIds.length];
    const room = nav.node(home);
    agents.push(makeAgent(id++, 'student', rand, room, {
      floorHt,
      timetable: makeTimetable(rand, roomIds, sched, { home }),
      lunch: lunchRoom,
    }));
  }
  return agents;
}

// Where lunch happens. A room that says so wins; otherwise the largest room
// that isn't a teaching space, which in a school is the cafeteria, the gym or
// the commons — all three of which are the right answer.
export function pickLunchroom(common, teaching) {
  const named = [...common, ...teaching]
    .find((r) => /cafeteria|caf|lunch|dining|commons/i.test(r.name || ''));
  if (named) return named.id;
  const biggest = common.slice().sort((a, b) => b.area - a.area)[0];
  return biggest ? biggest.id : (teaching[0] ? teaching[0].id : null);
}

// ---------- what an agent should be doing ----------

// The room this agent belongs in at this minute. During a passing period that
// is the room they are heading *to*, which is what makes a corridor full at
// nine o'clock and empty at ten past.
export function goalRoomFor(agent, sched, minutes, mode = 'day') {
  if (mode === 'drill') return null;
  const list = blocks(sched);
  const b = blockAt(sched, minutes);
  if (b.kind === 'before' || b.kind === 'after') return null;
  let block = b;
  if (b.kind === 'passing') {
    const i = list.indexOf(b);
    block = (i >= 0 && list[i + 1]) || b;
  }
  if (block.kind === 'lunch') return agent.lunch || agent.home;
  const idx = block.kind === 'homeroom' ? 0 : block.index;
  return agent.timetable[idx] || agent.home;
}

export function speedFor(sched, minutes, mode) {
  if (mode === 'drill') return SPEED.drill;
  return blockAt(sched, minutes).kind === 'passing' ? SPEED.passing : SPEED.walk;
}

// ---------- crowding ----------

// Where the crowd has been, in agent-seconds per bin. This is the fire drill's
// heatmap and, later, Phase 7's honest answer to "where does this building get
// tight" — measured rather than modelled, which is the only way a bottleneck
// nobody predicted ever shows up.
export function makeCrowdField(cell = CELL) {
  return { cell, floors: new Map(), max: 0, seconds: 0 };
}

export function crowdAdd(field, floorIndex, x, z, dt) {
  if (!field || !(dt > 0)) return;
  let f = field.floors.get(floorIndex);
  if (!f) { f = new Map(); field.floors.set(floorIndex, f); }
  const key = `${Math.floor(x / field.cell)}|${Math.floor(z / field.cell)}`;
  const v = (f.get(key) || 0) + dt;
  f.set(key, v);
  if (v > field.max) field.max = v;
}

export function crowdCells(field, floorIndex) {
  const f = field && field.floors.get(floorIndex);
  if (!f) return [];
  const out = [];
  for (const [key, v] of f) {
    const [cx, cz] = key.split('|').map(Number);
    out.push({
      x: (cx + 0.5) * field.cell,
      z: (cz + 0.5) * field.cell,
      v,
      // Normalised against the busiest bin anywhere in the design, so one
      // storey's heatmap is comparable with another's.
      t: field.max > 0 ? v / field.max : 0,
    });
  }
  return out.sort((a, b) => a.v - b.v);
}

export const clearCrowd = (field) => {
  field.floors.clear();
  field.max = 0;
  field.seconds = 0;
};

// ---------- stepping ----------

// Neighbours, bucketed. A body only ever pushes the bodies it can touch, so
// this is the same broad phase collide.js's index does for walls — a hash by
// floor and a cell twice the widest body.
const BODY_CELL = 4;   // ft

function bucketBodies(agents, extra) {
  const map = new Map();
  const add = (b) => {
    const key = `${b.floor}|${Math.floor(b.x / BODY_CELL)}|${Math.floor(b.z / BODY_CELL)}`;
    let list = map.get(key);
    if (!list) { list = []; map.set(key, list); }
    list.push(b);
  };
  for (const a of agents) {
    if (a.state === 'out') continue;
    add({
      id: a.id, x: a.x, z: a.z, r: AGENT_R, push: BODY_PUSH, floor: a.floorIndex ?? 0,
      // Which way they are going, so a queue can be told from a head-on meeting.
      // Somebody sitting or standing has no heading and is treated as a wall
      // you stop behind rather than as somebody to walk round.
      dx: a.state === 'walk' ? Math.sin(a.facing) : undefined,
      dz: a.state === 'walk' ? Math.cos(a.facing) : undefined,
      yielding: a.yielding,
    });
  }
  for (const b of extra || []) add({ ...b, r: b.r ?? WALKER_R });
  return map;
}

function neighbours(map, floorIndex, x, z) {
  const cx = Math.floor(x / BODY_CELL), cz = Math.floor(z / BODY_CELL);
  const out = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const list = map.get(`${floorIndex}|${cx + dx}|${cz + dz}`);
      if (list) out.push(...list);
    }
  }
  return out;
}

// Give an agent a route to its goal, or nothing if there isn't one. Failing to
// find a route is not an error: a room with its door deleted is a room you
// can't get to, and the agent in it stays put rather than walking through the
// wall to prove a point.
export function repath(ctx, agent, goalId) {
  agent.goal = goalId;
  agent.wp = 0;
  agent.stuck = 0;
  agent.wait = 0;
  agent.repathAt = ctx.elapsed;
  if (!goalId) { agent.path = null; return false; }
  const from = { floor: agent.floorIndex ?? 0, x: agent.x, z: agent.z };
  // **Somebody halfway up a stair is routed from the end of it.** The graph is
  // a graph of rooms, and asking it for a route from the middle of a run
  // answers with the room the run passes over — which is on the far side of a
  // five-foot drop the walker will quite correctly refuse to take. So the
  // route starts from the landing they are heading for, with the walk to that
  // landing in front of it.
  //
  // Which landing is decided by where they are *going*, never by which storey
  // they are currently over: deciding it by the latter sends anybody climbing
  // a run back down to the foot of it every time they re-plan, and they
  // oscillate on the stair forever. (They did.)
  const lead = runEndFor(ctx, agent, goalId);
  const wp = route(ctx.nav, lead ? { floor: lead.floor, x: lead.x, z: lead.z } : from, goalId);
  agent.path = wp && wp.length ? wp : null;
  if (lead) agent.path = [lead, ...(agent.path || [])];
  return !!agent.path;
}

// The end of the run an agent is standing on, or null if they are on a floor
// like everybody else.
function runEndFor(ctx, agent, goalId) {
  const ride = stairUnder(ctx.state, agent.x, agent.z, agent.y);
  // Standing *on* it, and high enough up that stepping off sideways is a drop
  // rather than a kerb. At the very bottom of a run you are on the floor like
  // everybody else, and sending you back to the foot you are standing on is a
  // ten-foot detour for nothing.
  if (!ride || ride.height <= STEP_UP || Math.abs(ride.y - agent.y) > 1) return null;
  const goal = ctx.nav.node(goalId);
  const goalFloor = goal ? (goal.floor ?? 0) : (agent.floorIndex ?? 0);
  const up = goalFloor > ride.link.from;
  const ends = runLandings(ride.link, stairMetrics(ctx.state));
  const at = up ? ends.head : ends.foot;
  return { x: at.x, z: at.z, floor: up ? ride.link.to : ride.link.from, kind: 'link', link: ride.link };
}

// Take a seat in the room an agent has arrived in, or stand somewhere in it.
// Seats are claimed rather than shared — `taken` is per-room and lives on the
// context for as long as the population does, which is what stops two people
// from ending the period in the same chair.
function takeSeat(ctx, agent, room) {
  if (!room) return;
  let seats = ctx.seats.get(room.id);
  if (!seats) {
    seats = seatsIn(ctx.state, ctx.nav, room, ctx.catalogGet);
    ctx.seats.set(room.id, seats);
  }
  // A teacher takes the teacher's chair if the room has one and a student
  // never does — so the preference is a first pass, and "any free seat" is the
  // fallback rather than a rule with an exception in it.
  const teacher = agent.kind === 'teacher';
  const nearestFree = (match) => {
    let found = null, bestD = Infinity;
    for (const s of seats) {
      if (ctx.taken.has(s.id)) continue;
      if (match !== null && !!s.teacher !== match) continue;
      const d = (s.x - agent.x) ** 2 + (s.z - agent.z) ** 2;
      if (d < bestD) { bestD = d; found = s; }
    }
    return found;
  };
  const best = nearestFree(teacher) || (teacher ? nearestFree(null) : nearestFree(false));
  if (best) {
    ctx.taken.add(best.id);
    agent.seat = best;
    agent.state = 'walk';        // walk to it first; sitting happens on arrival
    // **You sit down from behind the chair.** A classroom chair stands in
    // front of a desk and faces it, so the clear approach is the way the
    // person will be facing when they get there, reversed — walk at the seat
    // from any other side and the desk it belongs to is in the way. The
    // detour is dropped if it would put somebody in a wall or another room,
    // which is what the room check is: an approach point outside the room is
    // not an approach.
    const back = {
      x: best.x - Math.sin(best.facing) * SEAT_APPROACH,
      z: best.z - Math.cos(best.facing) * SEAT_APPROACH,
    };
    const seatWp = { x: best.x, z: best.z, floor: room.floor, kind: 'seat', seat: best };
    agent.path = ctx.nav.roomIdAt(room.floor, back.x, back.z) === room.id
      ? [{ x: back.x, z: back.z, floor: room.floor, kind: 'stand' }, seatWp]
      : [seatWp];
    agent.wp = 0;
  } else {
    // No chair — stand somewhere in the room instead. **Somewhere**, and never
    // just "here": a body that goes idle the instant it crosses the threshold
    // goes idle *in the doorway*, and an idle body is an immovable one. One
    // person standing in a doorway shuts a wing of the building, which is a
    // thing that happens in real schools and is not a thing anybody wants to
    // model.
    agent.state = 'walk';
    agent.path = [standAbout(agent, room)];
    agent.wp = 0;
  }
}

// Somewhere to stand in a room: near the middle, off to one side by a couple
// of paces, and the same place every time for the same person in the same
// room — a crowd that re-rolls its loitering spot every frame is a crowd with
// a nervous twitch.
function standAbout(agent, room) {
  const spread = Math.min(8, Math.sqrt(Math.max(room.area, 25)) * 0.28);
  return {
    x: room.x + Math.sin(agent.lane * Math.PI) * spread,
    z: room.z + Math.cos(agent.lane * Math.PI) * spread,
    floor: room.floor,
    kind: 'stand',
  };
}

function releaseSeat(ctx, agent) {
  if (agent.seat) ctx.taken.delete(agent.seat.id);
  agent.seat = null;
}

// The gap to whoever is in front. Infinity if the way is clear — which is
// what the person at the front of a queue always sees, and why a queue drains
// from the front rather than shuffling as a block.
function gapAhead(bodies, agent, dirX, dirZ) {
  let gap = Infinity;
  for (const b of bodies) {
    if (b.id !== undefined && b.id === agent.id) continue;
    const dx = b.x - agent.x, dz = b.z - agent.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-6 || d > FOLLOW_FAR + AGENT_R) continue;
    if ((dx / d) * dirX + (dz / d) * dirZ < FOLLOW_CONE) continue;   // beside or behind
    // Somebody standing still is not a queue to join — it is a thing to walk
    // round, like a desk. Braking for one means a room with people idling in
    // it can't be crossed, which is most rooms most of the time.
    if (b.dx === undefined) continue;
    if (b.dx * dirX + b.dz * dirZ < FOLLOW_ALIGN) continue;          // oncoming — go round
    gap = Math.min(gap, d);
  }
  return gap;
}

// Whoever is nearer the door goes first.
//
// A three-foot doorway does not pass two people at once, and two bodies that
// each creep into it from opposite sides wedge and stay wedged: soft shoving
// gets them past each other in a corridor, where there is somewhere to be
// pushed to, and never in a doorway, where there isn't. So a body about to use
// a door checks for somebody coming the other way who is closer to it than
// they are, and stands still until they are through. It is the same rule as a
// single-track bridge, and it is the only place in this file where an agent
// yields to someone it cannot see a route around.
function yieldAtDoor(bodies, agent, portal) {
  const mine = Math.hypot(agent.x - portal.x, agent.z - portal.z);
  for (const b of bodies) {
    if (b.dx === undefined || (b.id !== undefined && b.id === agent.id)) continue;
    const dx = agent.x - b.x, dz = agent.z - b.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-6 || d > DOOR_YIELD) continue;
    // Somebody who is themselves waiting is not somebody to wait for. Without
    // this the rule chains: A holds for B, who is holding for C, who is
    // holding for A, and the corridor is polite and completely stationary.
    if (b.yielding) continue;
    if (b.dx * (dx / d) + b.dz * (dz / d) < 0.3) continue;      // not coming at me
    // ...and actually in the doorway, not merely somewhere ahead of me in a
    // corridor. Yielding to everybody who happens to be nearer a door than I
    // am makes a building where nobody moves at all.
    const theirs = Math.hypot(b.x - portal.x, b.z - portal.z);
    if (theirs < mine && theirs < DOOR_MOUTH) return true;
  }
  return false;
}

// One agent, one frame.
function stepAgent(ctx, agent, dt, bodies) {
  const floorHt = ctx.state.floorHt || FLOOR_H;
  const ground = groundAt(ctx.site, agent.x, agent.z);
  const floorIndex = storeyAt(ctx.state, agent.y, ground);
  agent.floorIndex = floorIndex;
  if (agent.state === 'out') return;

  const collider = ctx.colliderFor(floorIndex);
  const target = agent.path && agent.path[agent.wp];

  if (agent.state === 'sit') {
    // Sitting is not standing still: the seat is where the body is, and the
    // only thing that moves is the clock. Keeping the agent snapped here means
    // a crowd walking past a seated class never nudges one out of a chair.
    if (agent.seat) {
      agent.x = agent.seat.x;
      agent.z = agent.seat.z;
      agent.facing = angleLerp(agent.facing, agent.seat.facing, Math.min(1, dt * 6));
    }
    agent.y = supportOf(ctx, agent, floorIndex);
    return;
  }

  if (!target) {
    agent.state = agent.state === 'sit' ? 'sit' : 'idle';
    // Standing still is not being a bollard. A body with nowhere to go is
    // still resolved against the crowd, so somebody walking into it moves it
    // — the difference between a person in your way and a wall in your way.
    const out = resolvePoint(collider, agent.x, agent.z, AGENT_R, 2, { bodies, skip: agent.id });
    agent.x = out.x;
    agent.z = out.z;
    agent.y = supportOf(ctx, agent, floorIndex);
    return;
  }

  // An elevator is a teleport with doors — the same deal the walkthrough's E
  // key makes, and for the same reason: a lift that takes eight seconds is
  // realism nobody watching a floor plan asked for.
  if (target.kind === 'ride' && target.link && target.link.type === 'elevator') {
    if (Math.hypot(target.x - agent.x, target.z - agent.z) < ARRIVE * 2) {
      agent.y = target.floor * floorHt;
      agent.wp++;
      return;
    }
  }

  // **Being in the room you were going to is arriving.** Not "reaching the
  // waypoint in the middle of it" — a hub is a point that may well have a desk
  // standing on it, and the last leg of a route is often a door on the far
  // side of the room you have just walked into. Checked against the goal
  // rather than against the current waypoint, so a route that overshoots is
  // ended by the arrival rather than by giving up on it.
  if (target.kind !== 'seat' && target.kind !== 'stand'
    && agent.goal && agent.goal === ctx.nav.roomIdAt(floorIndex, agent.x, agent.z)) {
    agent.wp = agent.path.length;
    arriveAtGoal(ctx, agent, { kind: 'room' });
    return;
  }

  const speed = ctx.speed * agent.speed;
  // Where in the doorway this person aims.
  //
  // Two corrections, both about the same thing: a door is a *gap with a
  // width*, not a point. `lane` is fixed per person, so a queue spreads itself
  // across a six-foot entrance instead of filing through the exact middle of
  // it. And once you are at the opening you aim at the opening — not at the
  // waypoint three feet past it, which from an off-centre approach is a line
  // that clips the jamb, and a body pressed on a jamb has its whole step
  // resolved straight back out again. It doesn't crash, it doesn't complain,
  // it just stands there for the rest of the school day.
  let aimX = target.x, aimZ = target.z;
  if (target.kind === 'door' && target.portal) {
    const P = target.portal;
    const spread = Math.max(0, P.w / 2 - AGENT_R - 0.35);
    const lane = spread > 0.05 ? agent.lane * spread : 0;
    const near = Math.hypot(agent.x - P.x, agent.z - P.z) < DOOR_OFFSET + 1;
    if (near) {
      // Just through the opening, on its own centre line: the shortest aim
      // that is guaranteed to be *between* the jambs rather than past one.
      const tx = target.x - P.x, tz = target.z - P.z;
      const tl = Math.hypot(tx, tz) || 1;
      aimX = P.x + (tx / tl) * 0.75 - P.nz * lane;
      aimZ = P.z + (tz / tl) * 0.75 + P.nx * lane;
    } else {
      aimX += -P.nz * lane;
      aimZ += P.nx * lane;
    }
  }
  // Steering is toward the aim; arriving is measured to the waypoint. They are
  // not the same point at a doorway, and conflating them makes a body decide
  // it has arrived somewhere it is only aiming past.
  let dx = aimX - agent.x, dz = aimZ - agent.z;
  let blocked = false;
  const flat = Math.hypot(target.x - agent.x, target.z - agent.z);
  const reach = Math.hypot(dx, dz);
  const arrive = target.kind === 'seat' ? ARRIVE_SEAT
    : (target.kind === 'door' ? ARRIVE_DOOR : ARRIVE);
  const sameFloor = target.floor === undefined || target.floor === floorIndex;
  // **Standing in the doorway counts as having reached the near side of it.**
  // A door's two waypoints sit three feet either side of the opening, and a
  // body shoved forward by the queue behind it can end up *in* the opening
  // with the near point now behind it — at which point, without this, it turns
  // round and walks back into the crowd, and the doorway has a plug in it that
  // nothing can shift. (This is what a fire drill that stalled at 40% turned
  // out to be, every time.)
  const next = agent.path[agent.wp + 1];
  const nearSideOfPair = target.kind === 'door' && next && next.node === target.node;
  const throughIt = nearSideOfPair
    && Math.hypot(target.portal.x - agent.x, target.portal.z - agent.z) < DOOR_OFFSET - 0.5;
  if ((flat < arrive || throughIt) && sameFloor) {
    // Reaching a waypoint is progress, and progress clears the patience
    // counters. Without this a route is burned through from the far end: the
    // counters keep whatever a busy corridor put into them, the next waypoint
    // is "given up on" seconds after being reached, and a body ends up
    // skipping to the end of its route and asking for another one — over and
    // over, without ever leaving the corridor it started in.
    agent.wp++;
    agent.stuck = 0;
    agent.wait = 0;
    if (agent.wp >= agent.path.length) arriveAtGoal(ctx, agent, target);
    return;
  }
  const shove = agent.wait > PATIENCE;
  if (reach > 1e-6) {
    let ux = dx / reach, uz = dz / reach;
    // Held up? Angle off. Which side is the agent's own business — two people
    // meeting head on pick opposite ones and get past each other — and it
    // flips on a timer, so a jam that survives one choice does not survive the
    // next. How far off depends on what is in the way: a person to squeeze
    // past, or a desk to walk round.
    if (agent.wait > SHUFFLE_S) {
      const wide = agent.stuck > SHUFFLE_S;
      const mag = wide ? SIDESTEP_ANGLE : SHUFFLE_ANGLE;
      // Which side is the agent's own `lane` — the same per-person random the
      // doorways use — rather than a parity of its id: two agents whose ids
      // happen to share a parity would otherwise mirror each other's sidestep
      // forever, which is a deadlock made out of the fix for deadlocks.
      const flip = Math.floor(agent.wait / (wide ? SIDESTEP_HOLD : 1.5));
      const a = mag * (((agent.lane >= 0 ? 1 : 0) + flip) % 2 ? 1 : -1);
      const c = Math.cos(a), sn = Math.sin(a);
      const nx = ux * c - uz * sn, nz = ux * sn + uz * c;
      ux = nx; uz = nz;
    }
    const gap = gapAhead(bodies, agent, ux, uz);
    blocked = gap < FOLLOW_FAR;
    let ease = gap >= FOLLOW_FAR ? 1
      : Math.max(CREEP, (gap - FOLLOW_NEAR) / (FOLLOW_FAR - FOLLOW_NEAR));
    // ...and nobody waits their turn forever: past `YIELD_MAX` the agent goes
    // anyway. A rule that can hold a body still indefinitely is a rule that
    // will, and being shoved through a doorway by an impatient stranger is
    // both the realistic outcome and the recoverable one.
    if (agent.wait > PATIENCE) ease = 1;
    const atDoor = !shove && target.kind === 'door' && target.portal
      && Math.hypot(agent.x - target.portal.x, agent.z - target.portal.z) < DOOR_YIELD;
    if (atDoor && agent.yielded < YIELD_MAX && yieldAtDoor(bodies, agent, target.portal)) {
      ease = 0;
      blocked = true;   // waiting your turn is queueing, not being stuck
      agent.yielding = true;
      agent.yielded += dt;
    } else {
      agent.yielding = false;
      agent.yielded = Math.max(0, agent.yielded - dt * 0.5);
    }
    const step = Math.min(speed * ease * dt, reach);
    dx = ux * step;
    dz = uz * step;
  } else { dx = 0; dz = 0; }

  const moved = moveWalker(ctx.state, collider,
    { x: agent.x, y: agent.y, z: agent.z }, dx, dz,
    {
      grounded: true, radius: AGENT_R, site: ctx.site,
      bodies: shove ? null : bodies, skip: agent.id,
    });
  const walked = Math.hypot(moved.x - agent.x, moved.z - agent.z);
  agent.x = moved.x;
  agent.z = moved.z;
  // Whatever `moveWalker` found under the step is what holds them up: it
  // already refused anything too far up or too far down to be a step, so this
  // is a stair climbing itself and a ramp sloping without a line of its own.
  if (moved.support) agent.y = moved.support.y;
  agent.walked += walked;
  agent.gait += walked * 1.35;
  agent.state = 'walk';
  if (walked > 1e-4) agent.facing = angleLerp(agent.facing, facingTo(dx, dz), Math.min(1, dt * 8));

  // Progress, or the lack of it — and *why* not, which is the distinction that
  // makes a crowd work. A body held up by another body is queueing: it waits,
  // it angles round, and it will move when the queue does. A body held up by
  // geometry is stuck: the graph has to be asked again, and failing that the
  // waypoint given up on. Only the second one is a problem, and telling them
  // apart is one boolean that `gapAhead` already worked out.
  const wanted = speed * dt * 0.35;
  if (walked < wanted) {
    agent.wait += dt;
    // Queueing still counts, at a quarter of the rate. Patience is right and
    // infinite patience is not: a body pressed against the wall beside a door
    // by a crowd reads as "somebody ahead of me" forever, and only a stuck
    // count that eventually rises gets it to step round.
    agent.stuck += blocked ? dt * 0.25 : dt;
  } else {
    agent.wait = 0;
    agent.stuck = Math.max(0, agent.stuck - dt);
  }
  if (agent.stuck > STUCK_S) {
    agent.stuck = 0;
    if (target.kind === 'seat') {
      // A chair somebody's bag is on, or one behind a desk with no way round.
      // Give it up and stand: a class with one person standing at the back is
      // a school, and a person walking into a chair for the rest of the period
      // is a bug.
      releaseSeat(ctx, agent);
      agent.path = null;
      agent.state = 'idle';
    } else if (agent.wp < agent.path.length - 1) {
      // **Skip the waypoint; don't re-plan.** Re-planning the moment anything
      // gets in the way is how a body ends up pacing a corridor forever: the
      // room it is standing in flips as it drifts across a threshold, each
      // room answers with a route the other way, and it walks between the two
      // until the bell goes. The route it already has was good when it was
      // made — what is in the way is usually local, and the next waypoint is
      // past it. Re-planning is the last resort, and rate-limited even then.
      agent.wp++;
    } else if (ctx.elapsed - agent.repathAt > REPATH_COOLDOWN) {
      repath(ctx, agent, agent.goal);
    } else {
      arriveAtGoal(ctx, agent, target);
    }
  }

  crowdAdd(ctx.crowd, floorIndex, agent.x, agent.z, dt);
}

function supportOf(ctx, agent, floorIndex) {
  const s = supportAt(ctx.state, agent.x, agent.z, agent.y, { site: ctx.site });
  return s ? s.y : floorIndex * (ctx.state.floorHt || FLOOR_H);
}

// The end of a route. What happens next depends on why they were walking: to a
// chair (sit down), out of the building (they're out), or into a room (find a
// chair, or stand about in it).
function arriveAtGoal(ctx, agent, target) {
  agent.path = null;
  agent.wp = 0;
  agent.stuck = 0;
  if (target && target.kind === 'seat') {
    agent.state = 'sit';
    return;
  }
  if (target && target.kind === 'stand') {
    agent.state = 'idle';
    return;
  }
  // A muster point is the end of the day, or the end of a drill: either way
  // the agent has left the building and stops being simulated.
  if (target && target.kind === 'muster') {
    agent.state = 'out';
    agent.outAt = ctx.elapsed;
    return;
  }
  const goalNode = ctx.nav.node(agent.goal);
  const leaving = ctx.mode === 'drill' || (goalNode && goalNode.kind === 'portal');
  if (leaving) {
    // Reaching the end of a route is not the same as being outside. If the
    // building is still around them, the route ran out early — ask for another
    // one rather than marking somebody evacuated who is standing in a
    // corridor. (Both halves of that sentence were bugs: people "outside" in
    // the main hall, and a school that never quite emptied at four o'clock.)
    if (ctx.nav.roomIdAt(agent.floorIndex ?? 0, agent.x, agent.z) === null) {
      agent.state = 'out';
      agent.outAt = ctx.elapsed;
    } else {
      headForTheDoor(ctx, agent);
    }
    return;
  }
  if (goalNode && goalNode.kind === 'room' && ctx.sitting) takeSeat(ctx, agent, goalNode);
  else agent.state = 'idle';
}

// ---------- the frame ----------

// Advance the whole population. `ctx` is built once per run by the caller
// (main.js) and carries the things an agent can't derive: the design, the
// graph, the schedule, a collider per storey, and where the camera is standing
// so that a crowd walks around the person watching it.
export function makeContext(state, nav, opts = {}) {
  return {
    state,
    nav,
    site: opts.site || null,
    schedule: normalizeSchedule(opts.schedule),
    colliderFor: opts.colliderFor || (() => ({ floor: 0, segs: [], props: [], doors: [], bodies: [] })),
    catalogGet: opts.catalogGet || (() => null),
    crowd: opts.crowd || makeCrowdField(),
    seats: new Map(),
    taken: new Set(),
    mode: 'day',
    minutes: opts.minutes ?? 0,
    speed: SPEED.walk,
    sitting: opts.sitting !== false,
    elapsed: 0,
    egress: null,
  };
}

// Everyone's goal, re-derived. Called when the block changes, when a drill
// starts or stops, and after an edit invalidates the graph — never per frame,
// because a route is a search and the answer only changes when the clock or
// the building does.
export function retargetAll(ctx, agents) {
  for (const agent of agents) {
    if (agent.state === 'out') continue;
    releaseSeat(ctx, agent);
    if (ctx.mode === 'drill') {
      headForTheDoor(ctx, agent);
      continue;
    }
    const goal = goalRoomFor(agent, ctx.schedule, ctx.minutes, ctx.mode);
    if (!goal) {
      // Before school and after it, everyone goes home — which from inside the
      // model means out of the nearest door and off the end of the graph. The
      // same walk a drill asks for, at a walk rather than a hurry.
      headForTheDoor(ctx, agent);
      continue;
    }
    const room = ctx.nav.node(goal);
    const here = ctx.nav.roomIdAt(agent.floorIndex ?? 0, agent.x, agent.z);
    if (here === goal && room) {
      agent.goal = goal;
      if (ctx.sitting) takeSeat(ctx, agent, room);
      else { agent.state = 'idle'; agent.path = null; }
    } else {
      repath(ctx, agent, goal);
      agent.state = agent.path ? 'walk' : 'idle';
    }
  }
}

// Out of the nearest door and off the end of the graph — a drill, and also
// what happens at the end of the day. The exit is the *nearest* one by the
// egress field rather than any old one: a school where half the building
// leaves by the far door is a school with a queue that isn't there.
function headForTheDoor(ctx, agent) {
  if (!ctx.egress) ctx.egress = egressField(ctx.nav);
  const room = ctx.nav.roomIdAt(agent.floorIndex ?? 0, agent.x, agent.z);
  if (!room) {
    // Already outside. Nothing to evacuate.
    agent.state = 'out';
    agent.outAt = agent.outAt ?? ctx.elapsed;
    return;
  }
  const exitId = ctx.egress.via.get(room);
  if (!exitId) {
    // No way out from here. The agent stays exactly where it is, and the
    // report says one person never got out — which is the finding, not a
    // failure of the simulation.
    agent.path = null;
    agent.goal = null;
    agent.state = 'idle';
    return;
  }
  repath(ctx, agent, exitId);
  const exit = ctx.nav.node(exitId);
  // Past the door and out to where people gather — the last leg of an
  // evacuation is the part that clears the doorway for the next person.
  if (agent.path && exit && exit.muster) {
    agent.path.push({ x: exit.muster.x, z: exit.muster.z, floor: 0, kind: 'muster' });
  }
  agent.state = agent.path ? 'walk' : 'idle';
}

export function stepAgents(ctx, agents, dt, opts = {}) {
  ctx.elapsed += dt;
  ctx.speed = speedFor(ctx.schedule, ctx.minutes, ctx.mode);
  // Sitting is for the part of the day people sit down for. A passing period
  // spent looking for a chair is a passing period nobody spends in a corridor.
  ctx.sitting = ctx.mode !== 'drill'
    && ['class', 'homeroom', 'lunch'].includes(blockAt(ctx.schedule, ctx.minutes).kind);
  const map = bucketBodies(agents, opts.bodies);
  for (const agent of agents) {
    const near = neighbours(map, agent.floorIndex ?? 0, agent.x, agent.z);
    stepAgent(ctx, agent, dt, near);
  }
  if (ctx.crowd) ctx.crowd.seconds += dt;
  ctx.doorsMoved = swingDoors(ctx, agents, dt, opts);
  return agents;
}

// The crowd opens the doors it walks through.
//
// Leaves are shared — one list per storey, held by that storey's collider —
// so they are advanced **once** per frame with everybody who could be pushing
// on them, rather than once per person with the last caller winning. That is
// the whole reason `updateLeavesFor` exists.
//
// `opts.skipFloors` is how the walkthrough keeps its own storey: when the
// camera is walking, walkthrough.js already drives that storey's doors with
// the crowd folded in, and driving them twice would double the swing rate.
function swingDoors(ctx, agents, dt, opts = {}) {
  const skip = opts.skipFloors || null;
  const floors = new Set();
  for (const a of agents) if (a.state !== 'out') floors.add(a.floorIndex ?? 0);
  const moved = [];
  for (const f of floors) {
    if (skip && skip.has(f)) continue;
    const collider = ctx.colliderFor(f);
    if (!collider || !collider.doors || !collider.doors.length) continue;
    const bodies = bodiesNear(agents, f, 0, 0, Infinity);
    if (updateDoorsFor(collider, bodies, dt)) moved.push(collider);
  }
  return moved;
}

// The bodies the *camera* has to walk around — the same records collide.js
// resolves the walker against, filtered to the storey it is on.
export function bodiesOn(agents, floorIndex, opts = {}) {
  const out = [];
  for (const a of agents) {
    if (a.state === 'out') continue;
    if ((a.floorIndex ?? 0) !== floorIndex) continue;
    out.push({ id: -a.id, x: a.x, z: a.z, r: opts.radius ?? AGENT_R });
  }
  return out;
}

// Everyone near a point, for the doors: a leaf has to answer to a crowd, and
// handing it the whole school is both slower and wrong (a door on the far side
// of the building is not being pushed open by anybody).
export function bodiesNear(agents, floorIndex, x, z, radius = 30, extra = null) {
  const out = extra ? [...extra] : [];
  const r2 = radius * radius;
  for (const a of agents) {
    if (a.state === 'out' || (a.floorIndex ?? 0) !== floorIndex) continue;
    if ((a.x - x) ** 2 + (a.z - z) ** 2 > r2) continue;
    // `open` is intent, and it is the whole difference between one walker and
    // forty: a body only opens a door it is actually walking through. Everyone
    // else is still handed to the leaf — a door that would swing into somebody
    // holds for them whether or not they are using it.
    const target = a.path && a.path[a.wp];
    const using = !!target && target.kind === 'door' && target.portal
      && Math.hypot(a.x - target.portal.x, a.z - target.portal.z) < DOOR_REACH;
    out.push({ x: a.x, z: a.z, open: using });
  }
  return out;
}

// ---------- reports ----------

export function census(agents) {
  const out = { total: agents.length, walking: 0, seated: 0, idle: 0, out: 0, teachers: 0 };
  for (const a of agents) {
    if (a.kind === 'teacher') out.teachers++;
    if (a.state === 'walk') out.walking++;
    else if (a.state === 'sit') out.seated++;
    else if (a.state === 'out') out.out++;
    else out.idle++;
  }
  return out;
}

// How the drill went. `stranded` is the number who never had a route to a
// door at all — the finding this whole exercise exists to surface, and the one
// Phase 7 will make a first-class check.
export function drillReport(agents, elapsed) {
  let out = 0, stranded = 0, longest = 0;
  for (const a of agents) {
    if (a.state === 'out') { out++; longest = Math.max(longest, a.outAt || 0); }
    else if (!a.path && !a.goal) stranded++;
  }
  return {
    total: agents.length,
    out,
    inside: agents.length - out,
    stranded,
    longest,
    elapsed,
    done: out + stranded >= agents.length,
  };
}
