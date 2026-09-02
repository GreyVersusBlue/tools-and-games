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
  dayStart, dayEnd,
} from './schedule.js';
import { siteCurbs } from './site.js';
import { makeThresholds, stepThresholds, thresholdFor, admit } from './threshold.js';
import {
  route, egressField, teachingRooms, commonRooms, runLandings, DOOR_OFFSET,
} from './navgraph.js';
import { stairUnder, stairMetrics } from './stairs.js';
import {
  makeLifts, liftFor, callLift, canBoard, boardLift, canAlight, leaveLift,
  liftStop, stepLifts, BOARD_REACH,
} from './lift.js';
import { registerRecord } from './records.js';

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

// ---------- arriving and leaving (Phase 39) ----------
//
// The crowd used to be born seated and die at the last bell. Now the day has
// edges: everybody is assigned a curb point (a bus bay, a drop-off pull-in, a
// parking aisle — whatever the site's region kinds imply) and a minute to
// arrive at it, walks in across the site, and after the last bell walks back
// out to the same curb and is gone. A design whose site implies no curb keeps
// the old lifecycle verbatim — you cannot arrive at a building from a site
// that has nowhere to arrive from.
export const ARRIVE_WINDOW = 25;     // min — the stagger the students arrive over
export const ARRIVE_LAST = 2;        // min before first bell the last one aims for
export const TEACHER_EARLY = 12;     // min — teachers come in ahead of the crowd
export const DEPART_LINGER = 6;      // min — how long the slowest linger after dismissal

// ---------- talking (Phase 28) ----------
//
// Two people who meet in a corridor sometimes stop and talk. The pairing is
// deterministic — no dice: everyone carries a seeded `social` appetite and a
// `chatIn` countdown, and a conversation starts when two willing people are
// simply close enough. The same seed makes the same friends stop at the same
// lockers, which is what keeps a replayed school the same school.
export const CHAT_RANGE = 3.2;       // ft — close enough to talk
export const CHAT_MIN_S = 2.5;       // the shortest conversation worth stopping for
export const CHAT_MAX_S = 5.5;       // ...and the longest before the bell wins
export const CHAT_COOLDOWN = 18;     // s, scaled by how social each person is
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
// Phase 31: the rest of the wardrobe. Hair is the one part of a person that
// was the same on all hundred and fifty of them — a school of identical heads
// reads as a school of clones from the far end of a corridor, which is the
// distance a school is mostly looked at from.
export const HAIRS = [
  '#1b1614', '#2e211a', '#4a3220', '#6b4a2a', '#8c6b3f', '#b08d55',
  '#5a5350', '#8d8783', '#c9542f', '#3b2f46',
];
// A backpack is the one thing every student in the world is carrying and
// nobody in this building was. Teachers mostly are not.
export const BAGS = [
  '#2f4858', '#7a3b3b', '#3f5f3a', '#5a4a7a', '#8a5a2a', '#33404d', '#6b2f4f',
];
export const BAG_ODDS = { student: 0.72, teacher: 0.18 };
// How much narrower or wider than the standard body a person is built. Applied
// across the body only — a tall person is `height`, a broad one is `build`,
// and conflating the two gives you a school of people scaled like photographs.
export const BUILD_MIN = 0.86;
export const BUILD_MAX = 1.16;

// The wardrobe: hair, how broadly somebody is built, and whether there is a
// bag on their back.
//
// **Drawn off its own generator, seeded from the population's seed and this
// person's id** — not from the sequence everything else comes out of. That is
// a rule about *phases* rather than about people. Adding a field to the agent
// record shifts every draw after it, so a purely cosmetic addition moves where
// everybody spawns and how fast they walk; the first cut of this phase did
// exactly that, and the suite's one *simulating* test caught it as two fewer
// people reaching their classroom. A side generator means the wardrobe can
// grow forever and the crowd still walks the walk it walked before — while
// two different seeds still dress two different schools, because the seed is
// half of what mixes into it.
export function wardrobeOf(id, seed = 1, teacher = false) {
  const rand = rng((Math.imul(seed >>> 0, 0x9e3779b1) ^ Math.imul(id | 0, 0x85ebca6b)) >>> 0);
  const hair = pick(rand, HAIRS);
  const build = BUILD_MIN + rand() * (BUILD_MAX - BUILD_MIN);
  // A colour is drawn whether or not it is worn, so the two kinds of person
  // leave this little sequence in the same place.
  const colour = pick(rand, BAGS);
  return {
    hair,
    build,
    bag: rand() < (teacher ? BAG_ODDS.teacher : BAG_ODDS.student) ? colour : null,
  };
}

// When this person reaches the curb, and which curb it is — drawn off a side
// generator exactly the way the wardrobe is, and for the same reason: a
// minute of the morning is as cosmetic to the *simulation's sequence* as a
// hair colour, and folding it into `makeAgent`'s draws would move where
// everybody spawns. `when` spreads the arrivals, `curb` picks the bay, and
// `linger` is how long after the last bell this person takes to pack up.
export function arrivalOf(id, seed = 1) {
  const rand = rng((Math.imul(seed >>> 0, 0x27d4eb2f) ^ Math.imul(id | 0, 0x165667b1)) >>> 0);
  return { when: rand(), curb: rand(), linger: rand() };
}

// How far the pelvis rises and falls over one stride, in feet at full height.
// Real walking is about two inches; this is a shade more, because a rigid-part
// puppet has no spine to absorb the rest of it.
export const BOB_AMPLITUDE = 0.19;

// **Twice per stride, not once.** The single thing that separates a walk from
// a glide: the body is at its highest in the middle of each step, when the
// stance leg is vertical, and at its lowest at both heel strikes — so the rise
// and fall happens at twice the frequency the legs swing at. Bob a body once
// per stride and it limps; don't bob it at all and it hovers, which is what
// every version of the crowd before Phase 31 did.
//
// Lives here rather than in render.js for the same reason the palette does:
// the gait is the agent's, and a headless test can hold the phase to the leg
// it belongs to.
export function walkBob(agent) {
  if (!agent || agent.state !== 'walk') return 0;
  const g = Number.isFinite(agent.gait) ? agent.gait : 0;
  const h = Number.isFinite(agent.height) && agent.height > 0 ? agent.height : 1;
  return BOB_AMPLITUDE * h * (1 - Math.cos(2 * g)) * 0.5;
}

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
  // Phase 39: how this person's day reaches the building, off the arrival
  // side generator — none of it touches `rand`, so the crowd walks the walk
  // it walked before the site had a curb.
  const arr = arrivalOf(id, opts.seed);
  const curbs = opts.curbs && opts.curbs.length ? opts.curbs : null;
  const curb = curbs ? curbs[Math.floor(arr.curb * curbs.length) % curbs.length] : null;
  return {
    id,
    kind,
    // A timetable names its teachers, so a teacher who came out of one keeps
    // the name the timetable gave them — which is what makes "Ms. Ashdown is
    // in 104" a sentence about this school rather than about a simulation.
    // `rand` is drawn either way, so a named teacher and an anonymous one
    // leave the seeded sequence in the same place.
    name: (() => {
      const made = `${pick(rand, FIRST_NAMES)} ${String.fromCharCode(65 + Math.floor(rand() * 26))}.`;
      return opts.person || made;
    })(),
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
    // Hair, build and the bag — see `wardrobeOf`, and note that not one of
    // them is drawn from `rand`.
    ...wardrobeOf(id, opts.seed, teacher),
    home: room ? room.id : null,
    lunch: opts.lunch || null,
    timetable: opts.timetable || [],
    // Which group this person moves with, when a timetable said so. Null for
    // the random intake, and the reason a follow-a-student readout can say
    // "9-2" rather than "a student".
    cohort: opts.cohort || null,
    group: opts.group || null,
    // Where it is trying to be, and how it is getting there. Both are derived
    // from the schedule every time the block changes; neither is saved.
    goal: null,
    path: null,
    wp: 0,
    state: 'idle',        // idle | walk | sit | out
    seat: null,
    gait: rand() * Math.PI * 2,
    // How far off their own feet this body is riding — see `walkBob`. Zero
    // until somebody takes a step.
    bob: 0,
    lane: rand() * 2 - 1,
    stuck: 0,
    wait: 0,
    // Which car this person is queueing for or riding in, and how long they
    // have been doing it. Null for everybody who has never met a lift, which
    // in a single-storey school is everybody.
    lift: null,
    liftWait: 0,
    // Whether this person stops to talk (Phase 28). `social` is fixed at
    // spawn — some people always have a minute, some never do; `chatIn`
    // counts down to the next time they are willing; `chat` is the
    // conversation they are in ({ with, t, x, z }), or null.
    social: rand(),
    chatIn: 4 + rand() * 24,
    chat: null,
    yielding: false,
    yielded: 0,
    lastX: 0, lastZ: 0,
    walked: 0,
    repathAt: -1e9,
    outAt: null,
    // Phase 39: the day's edges. `curb` is where a vehicle lets this person
    // out in the morning and picks them up again; `arriveMin` and `departMin`
    // are the minutes of the day they reach it and head back for it, spread
    // by the seeded stagger; `doorWait` is how long the front door's rate has
    // held them on the steps. All null/zero for a design whose site implies
    // no curb, whose crowd keeps the born-in-homeroom lifecycle it always had.
    curb,
    arriveMin: opts.dayStart !== undefined && curb
      ? Math.max(0, opts.dayStart - ARRIVE_LAST - (teacher ? TEACHER_EARLY : 0)
        - Math.round(arr.when * ARRIVE_WINDOW))
      : null,
    departMin: opts.dayEnd !== undefined && curb
      ? opts.dayEnd + Math.round(arr.linger * DEPART_LINGER)
      : null,
    doorWait: 0,
  };
}

// A school's worth of people. Teachers first — one per teaching room, because
// that is what makes a room a class — then students spread over the same
// rooms' timetables.
//
// **`opts.plan` is Phase 15, and it is the whole difference between a
// plausible school and this one.** Without it every student gets a random
// room per period that isn't the one they were just in, which is what Phase 6
// shipped and said out loud was random. With it a student belongs to a cohort,
// walks its rooms in its order, and stays with the same twenty-five people all
// day — and a teacher follows the sections the timetable actually gave them
// rather than standing in one room from bell to bell.
//
// The plan is plain data (`timetablePlan` in timetable.js), not a timetable
// object, for the same reason the schedule is five numbers rather than a list
// of periods: the crowd should not have to import the thing that decides where
// everybody goes, and this file has never known that a generator exists.
export function makePopulation(state, nav, opts = {}) {
  const sched = normalizeSchedule(opts.schedule);
  const seed = opts.seed ?? 1;
  const rand = rng(seed);
  const floorHt = state.floorHt || FLOOR_H;
  const teaching = teachingRooms(nav);
  const common = commonRooms(nav);
  const agents = [];
  if (!teaching.length) return agents;

  const lunchRoom = pickLunchroom(common, teaching);
  const wanted = Math.max(0, Math.min(MAX_POP, Math.round(opts.students ?? 90)));
  // Phase 39: where the day begins and ends. The curb list and the two bell
  // minutes ride into every `makeAgent`, and a site that implies no curb
  // hands over nothing — see `curbsFor`.
  const curbs = curbsFor(state, nav);
  const edges = { curbs, dayStart: dayStart(sched), dayEnd: dayEnd(sched) };
  const plan = planFor(opts.plan, nav, sched);
  if (plan) return fromPlan(state, nav, plan, { rand, seed, floorHt, sched, lunchRoom, wanted, edges });

  const teacherCount = Math.max(0, Math.min(teaching.length,
    Math.round(opts.teachers ?? teaching.length)));

  let id = 1;
  for (let i = 0; i < teacherCount; i++) {
    const room = teaching[i];
    agents.push(makeAgent(id++, 'teacher', rand, room, {
      seed,
      floorHt,
      timetable: fixedTimetable(room.id, sched),
      lunch: room.id,
      ...edges,
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
      seed,
      floorHt,
      timetable: makeTimetable(rand, roomIds, sched, { home }),
      lunch: lunchRoom,
      ...edges,
    }));
  }
  return agents;
}

// Where the crowd reaches the property. The site's own curb points when any
// region kind implies some; failing that the public way — you can still walk
// in from the street a design has, even if nobody drew the bus its loop.
// Nothing at all for a sealed or site-less building, whose population is born
// in homeroom exactly as it was before this phase.
export function curbsFor(state, nav) {
  const drawn = siteCurbs(state);
  if (drawn.length) return drawn;
  return (nav && nav.ways ? nav.ways : [])
    .map((w) => ({ id: w.id, x: w.x, z: w.z, kind: 'way', region: null, name: w.name }));
}

// A plan worth using: one with at least one cohort that has somewhere to be.
// A timetable whose rooms all belong to a building that has since been redrawn
// is not a plan, and falling back to the random intake is better than a school
// standing still in the car park.
function planFor(plan, nav, sched) {
  if (!plan || !Array.isArray(plan.cohorts) || !plan.cohorts.length) return null;
  const usable = plan.cohorts.some((c) => (c.rooms || []).some((id) => id && nav.node(id)));
  return usable ? plan : null;
}

// The population a timetable implies. A cohort's size is how many students it
// is worth, capped by what the caller asked for — which is what keeps the
// students slider meaningful with a timetable loaded: at half the roll you get
// every cohort at half strength rather than half the cohorts at full.
function fromPlan(state, nav, plan, ctx) {
  const { rand, seed, floorHt, sched, lunchRoom, wanted, edges } = ctx;
  const agents = [];
  const periods = normalizeSchedule(sched).periods;
  // A plan's rooms are indexed by *its* period count; a design whose bell
  // schedule has since grown a period would read past the end of one. Padded
  // with the last room rather than with null, which is the same thing
  // `timetablePlan` does to a free period and for the same reason.
  const laid = (rooms) => {
    const out = new Array(periods + 1).fill(null);
    let last = null;
    for (let p = 0; p <= periods; p++) {
      const id = rooms && rooms[p] && nav.node(rooms[p]) ? rooms[p] : last;
      out[p] = id;
      last = id || last;
    }
    return out;
  };

  let id = 1;
  for (const teacher of plan.teachers || []) {
    const timetable = laid(teacher.rooms);
    const home = timetable[0];
    const room = home ? nav.node(home) : null;
    if (!room) continue;
    agents.push(makeAgent(id++, 'teacher', rand, room, {
      seed, floorHt, timetable, lunch: home, cohort: null, person: teacher.name,
      ...edges,
    }));
  }

  const roll = plan.cohorts.reduce((n, c) => n + Math.max(1, c.size || 0), 0);
  // Every cohort scaled by the same fraction, so a slider at 40% is a school
  // at 40% rather than the first nine cohorts and nobody else.
  const scale = roll > 0 ? Math.min(1, wanted / roll) : 0;
  let budget = Math.min(wanted, MAX_POP - agents.length);
  for (const cohort of plan.cohorts) {
    if (budget <= 0) break;
    const timetable = laid(cohort.rooms);
    const home = timetable[0];
    const room = home ? nav.node(home) : null;
    if (!room) continue;
    const size = Math.min(budget, Math.max(1, Math.round(Math.max(1, cohort.size || 0) * scale)));
    for (let i = 0; i < size; i++) {
      agents.push(makeAgent(id++, 'student', rand, room, {
        seed, floorHt, timetable, lunch: lunchRoom, cohort: cohort.id, group: cohort.name,
        ...edges,
      }));
      budget--;
      if (budget <= 0) break;
    }
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
    if (a.state === 'out' || a.state === 'away') continue;
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
  // A rider whose destination has changed steps out at the next opportunity
  // rather than riding to a floor nobody wants any more — and a person in the
  // queue stops holding the button.
  releaseLift(ctx, agent);
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

// Get out of the car, wherever the car happens to be. Called on every
// re-plan for the same reason `releaseSeat` is: a person whose period has
// changed under them is a person who has stopped wanting to go where they
// were going, and a rider nobody ever took out of the car holds one of eight
// places in it for the rest of the school day.
function releaseLift(ctx, agent) {
  if (!agent.lift) return;
  const car = ctx.lifts ? ctx.lifts.get(agent.lift) : null;
  if (car) leaveLift(car, agent.id);
  agent.lift = null;
  agent.liftWait = 0;
}

// Is this door waypoint the *outdoor* side of its exterior portal? The near
// side of the pair, approached from outside, is the outdoor point — which is
// what makes a crossing inbound, and it is a fact about the waypoint rather
// than about where the body happens to be standing this frame (a body nudged
// half a step past the wall plane is still coming in).
function isOutdoorSide(wp) {
  const P = wp.portal;
  const out = P.a ? P.pb : P.pa;
  return Math.hypot(wp.x - out.x, wp.z - out.z) < 0.5;
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
  // Gone home, or not here yet: either way there is no body to move. `away`
  // is Phase 39's "the bus hasn't come" — the person exists, their day is
  // assigned, and the site simply doesn't hold them yet.
  if (agent.state === 'out' || agent.state === 'away') return;
  const floorHt = ctx.state.floorHt || FLOOR_H;
  const ground = groundAt(ctx.site, agent.x, agent.z);
  const floorIndex = storeyAt(ctx.state, agent.y, ground);
  agent.floorIndex = floorIndex;
  if (agent.chatIn > 0) agent.chatIn -= dt;

  const collider = ctx.colliderFor(floorIndex);
  const target = agent.path && agent.path[agent.wp];

  if (agent.state === 'chat') {
    // Stopped to talk. Face the other person, hold your ground the way any
    // standing body does (a crowd pushing past still moves you), and when
    // the conversation runs out pick the day back up where it was — the
    // route is untouched, only the clock on it slipped a few seconds.
    const c = agent.chat;
    if (c && c.t > 0) {
      c.t -= dt;
      agent.facing = angleLerp(agent.facing,
        Math.atan2(c.x - agent.x, c.z - agent.z), Math.min(1, dt * 5));
      const out = resolvePoint(collider, agent.x, agent.z, AGENT_R, 2, { bodies, skip: agent.id });
      agent.x = out.x;
      agent.z = out.z;
      agent.y = supportOf(ctx, agent, floorIndex);
      return;
    }
    endChat(agent);
  }

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

  // **The lift.** Until Phase 15 this was a teleport with doors — walk into
  // the shaft, arrive upstairs — and the reason given was that a lift taking
  // eight seconds is realism nobody watching a floor plan asked for. A
  // timetable is what made somebody ask: once a section is upstairs at ten
  // past nine, the crush at the doors between second and third period is a
  // real event, and a car everybody walks into at once is not it.
  //
  // So a rider does the four things a person at a lift does — press the
  // button, wait, get in when there is room, get out at their floor — and a
  // school with one car and forty people wanting it queues, which is the
  // whole point of having built the car a state machine. `ctx.lifts` absent
  // is the old behaviour verbatim, which is what keeps every suite that
  // predates this reading the same answer.
  if (target.kind === 'ride' && target.link && target.link.type === 'elevator') {
    const car = liftFor(ctx.lifts, target.link);
    if (!car) {
      if (Math.hypot(target.x - agent.x, target.z - agent.z) < ARRIVE * 2) {
        agent.y = target.floor * floorHt;
        agent.wp++;
      }
      return;
    }
    return rideLift(ctx, agent, car, target, dt, bodies, floorIndex);
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
      const tx = target.x - P.x, tz = target.z - P.z;
      const tl = Math.hypot(tx, tz) || 1;
      // Already through the opening, on the waypoint's own side of it? Then
      // the pulled-in aim below is *behind* the body, and steering at it
      // parks you in the leaf's swing — three feet short of "arrived", with
      // the door shutting on you and the resolution free to squeeze you back
      // through the gap you came from. Aim at the waypoint proper instead:
      // straight out of the swing, on the centre line you are already on.
      // Room-bound routes never met this (being in the room you were going
      // to is arriving); Phase 39's curb-bound walks cross enough doorways
      // mid-route to find it in an afternoon.
      const crossed = (agent.x - P.x) * tx + (agent.z - P.z) * tz > 0.2 * tl;
      if (crossed) {
        aimX = target.x;
        aimZ = target.z;
      } else {
        // Just through the opening, on its own centre line: the shortest aim
        // that is guaranteed to be *between* the jambs rather than past one.
        aimX = P.x + (tx / tl) * 0.75 - P.nz * lane;
        aimZ = P.z + (tz / tl) * 0.75 + P.nx * lane;
      }
    } else {
      aimX += -P.nz * lane;
      aimZ += P.nx * lane;
    }
  }
  // Just crossed a doorway? Walk clear of its swing before turning. A body
  // that turns the moment it is through hugs the wall through the leaf's own
  // arc — and a parked or closing leaf stands exactly there, so the turn ends
  // pressed against a door with the route on the far side of it. Real people
  // do this without being told: you step out of a doorway, then you turn.
  // (Phase 39's curb walks found it — the first routes whose next waypoint
  // is a long way down the same wall the door hangs in.)
  const prevWp = agent.wp > 0 ? agent.path[agent.wp - 1] : null;
  const prev2 = agent.wp > 1 ? agent.path[agent.wp - 2] : null;
  if (prevWp && prevWp.kind === 'door' && prevWp.portal
    && prev2 && prev2.node === prevWp.node) {
    const P = prevWp.portal;
    const away = Math.hypot(agent.x - P.x, agent.z - P.z);
    const clear = (P.w || 3) + AGENT_R + 0.4;
    if (away < clear) {
      const ox = prevWp.x - P.x, oz = prevWp.z - P.z;
      const ol = Math.hypot(ox, oz) || 1;
      aimX = P.x + (ox / ol) * (clear + 0.5);
      aimZ = P.z + (oz / ol) * (clear + 0.5);
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
    // Phase 39: an exterior doorway admits at a rate — inbound only. The
    // morning crush spends the door's credit one person at a time and stacks
    // outside it when the credit runs dry; the crash bar on the way out
    // spends nothing, which is what keeps a fire drill exactly the drill it
    // was. A person the rate holds is a queue, not a jam: resolved against
    // the crowd, counted by the heatmap, cleared of the stuck counters that
    // would otherwise shove them through the arithmetic, and never held past
    // the bound `admit` keeps.
    if (nearSideOfPair && target.portal.exterior && ctx.thresholds
      && isOutdoorSide(target)) {
      const th = thresholdFor(ctx.thresholds, target.portal);
      if (!admit(th, agent.doorWait)) {
        agent.doorWait += dt;
        agent.state = 'queue';
        agent.stuck = 0;
        agent.wait = 0;
        const held = resolvePoint(collider, agent.x, agent.z, AGENT_R, 2,
          { bodies, skip: agent.id });
        agent.x = held.x;
        agent.z = held.z;
        agent.y = supportOf(ctx, agent, floorIndex);
        crowdAdd(ctx.crowd, floorIndex, agent.x, agent.z, dt);
        return;
      }
      agent.doorWait = 0;
    }
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
  // Which way the body *wants* to go, before the shuffle angles it off. The
  // patience counters measure progress against this rather than against raw
  // displacement: a body pressed on a parked door leaf slides along it at
  // walking speed while getting nowhere, and counting the slide as progress
  // keeps resetting the very timer whose flip would carry it round the leaf's
  // free end. (Found by Phase 39's dismissal — the first routes that walk a
  // long leg *along* a wall a leaf stands open against.)
  let wantX = 0, wantZ = 0;
  if (reach > 1e-6) {
    let ux = dx / reach, uz = dz / reach;
    wantX = ux; wantZ = uz;
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
  // ...and how much of it was in the direction the body wanted — see `wantX`.
  const toward = (moved.x - agent.x) * wantX + (moved.z - agent.z) * wantZ;
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
  if (toward < wanted) {
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
    } else if (nearSideOfPair && target.portal && target.portal.exterior
      && ctx.thresholds && isOutdoorSide(target)) {
      // The one waypoint the skip may not jump: an admitting doorway. A body
      // wedged in the morning crush that skipped the near side would walk in
      // through the far one with nobody counting — so it stays in the crush,
      // which is where the crush wants it anyway.
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

// One person, one car, one frame. Three states and nothing between them:
// walking to the doors, standing at them, and standing in the car.
//
// A rider is snapped to the car rather than resolved against the world while
// they are in it. The alternative — letting a body in a moving shaft be pushed
// around by the collider — is a body that gets shoved through a shaft wall on
// the frame the floor changes underneath it, which is exactly the bug the
// walkthrough's own lift avoids by teleporting.
function rideLift(ctx, agent, car, target, dt, bodies, floorIndex) {
  const stop = liftStop(car.link, car.at, car.floorHt);
  const want = target.floor;

  // In the car: go where it goes, and get out when it opens at your floor.
  if (agent.lift === car.id && car.riders.has(agent.id)) {
    agent.state = 'ride';
    // Riders share the car rather than standing on one point in it. `lane` is
    // fixed per person, so eight of them make a car-load rather than a totem.
    const { w, d } = { w: 2.2, d: 1.6 };
    agent.x = stop.x + agent.lane * w * 0.5;
    agent.z = stop.z + (agent.gait % 1 - 0.5) * d;
    agent.y = car.y;
    agent.facing = angleLerp(agent.facing, Math.atan2(0, -1), Math.min(1, dt * 4));
    if (canAlight(car, agent.id)) {
      leaveLift(car, agent.id);
      agent.lift = null;
      agent.liftWait = 0;
      agent.y = car.at * car.floorHt;
      agent.floorIndex = car.at;
      agent.state = 'walk';
      agent.wp++;
    }
    return;
  }

  // At the landing: press the button, hold your place, get in when you can.
  const landing = { x: target.x, z: target.z };
  const reach = Math.hypot(stop.x - agent.x, stop.z - agent.z);
  if (reach > BOARD_REACH * 3) {
    // Still walking to the doors — steer at the landing rather than at the
    // waypoint on the far storey, which is directly above it and therefore no
    // direction at all.
    stepToward(ctx, agent, landing, dt, bodies, floorIndex);
    agent.lift = car.id;
    callLift(car, floorIndex);
    return;
  }

  agent.lift = car.id;
  agent.state = 'queue';
  agent.liftWait += dt;
  car.waited = Math.max(car.waited, agent.liftWait);
  callLift(car, floorIndex);
  if (canBoard(car, floorIndex) && boardLift(car, agent.id, want)) {
    agent.state = 'ride';
    return;
  }
  // Waiting is not being a bollard, the same way standing idle isn't: the
  // queue at a lift is a crowd that shuffles, and somebody walking into it
  // moves it.
  const out = resolvePoint(ctx.colliderFor(floorIndex), agent.x, agent.z, AGENT_R, 2,
    { bodies, skip: agent.id });
  agent.x = out.x;
  agent.z = out.z;
  agent.y = supportOf(ctx, agent, floorIndex);
  agent.facing = angleLerp(agent.facing, facingTo(stop.x - agent.x, stop.z - agent.z),
    Math.min(1, dt * 3));
}

// The plainest possible "walk at that point": no doorway lanes, no queueing,
// no arrival test. Used only by the walk up to a lift's doors, where the
// waypoint the path offers is on the wrong storey and every one of the
// refinements in `stepAgent` is about a target on this one.
function stepToward(ctx, agent, at, dt, bodies, floorIndex) {
  const dx = at.x - agent.x, dz = at.z - agent.z;
  const len = Math.hypot(dx, dz) || 1;
  const speed = ctx.speed * agent.speed;
  const out = resolvePoint(ctx.colliderFor(floorIndex),
    agent.x + (dx / len) * speed * dt, agent.z + (dz / len) * speed * dt,
    AGENT_R, 3, { bodies, skip: agent.id });
  agent.x = out.x;
  agent.z = out.z;
  agent.y = supportOf(ctx, agent, floorIndex);
  agent.facing = angleLerp(agent.facing, facingTo(dx, dz), Math.min(1, dt * 6));
  agent.state = 'walk';
  agent.gait += speed * dt * 0.5;
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
  // the agent has left the building and stops being simulated. The curb is
  // the same thing said the Phase 39 way — the bus door shuts behind them.
  if (target && (target.kind === 'muster' || target.kind === 'curb')) {
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
    // Phase 15's cars. One per elevator link, built here rather than passed in
    // because a car is a thing about *this run* of the school day and not a
    // thing about the design — the same reason the seats map lives here.
    // `opts.lifts: false` turns them off, and turning them off is the Phase 2
    // teleport back, verbatim.
    lifts: opts.lifts === false ? null : makeLifts(state),
    // Phase 39's doors. A threshold is a fact about this run of the school
    // day, the same as a lift car or a claimed chair — never about the
    // design. `opts.thresholds: false` turns the rate off, and off is the
    // door that passes a crowd instantaneously, verbatim.
    thresholds: opts.thresholds === false ? null : makeThresholds(),
  };
}

// Everyone's goal, re-derived. Called when the block changes, when a drill
// starts or stops, and after an edit invalidates the graph — never per frame,
// because a route is a search and the answer only changes when the clock or
// the building does.
export function retargetAll(ctx, agents) {
  const block = blockAt(ctx.schedule, ctx.minutes);
  for (const agent of agents) {
    // A new block, a drill, a rebuilt world — whatever brought us here ends
    // every conversation: the states below are assigned fresh, and a `chat`
    // left set would be a pair whose other half no longer exists.
    if (agent.chat) { agent.chat = null; agent.state = 'idle'; }
    if (ctx.mode === 'drill') {
      if (agent.state === 'out' || agent.state === 'away') continue;
      releaseSeat(ctx, agent);
      headForTheDoor(ctx, agent);
      continue;
    }
    // Phase 39: the day has edges. Before school the building fills — from
    // the curb, in the seeded stagger — instead of switching on; after the
    // last bell it streams back out to the curb instead of switching off.
    if (block.kind === 'before') {
      beforeSchool(ctx, agent);
      continue;
    }
    if (block.kind === 'after') {
      afterSchool(ctx, agent);
      continue;
    }
    // In session. Somebody not on site — the clock was scrubbed past their
    // arrival, or a new day started under yesterday's `out` — arrives now,
    // through the same curb their morning would have used. No curb, no way
    // in: they stay wherever their old lifecycle left them.
    if (agent.state === 'out' || agent.state === 'away') {
      if (!agent.curb) continue;
      placeAtCurb(ctx, agent);
    }
    releaseSeat(ctx, agent);
    const goal = goalRoomFor(agent, ctx.schedule, ctx.minutes, ctx.mode);
    if (!goal) {
      headForTheDoor(ctx, agent);
      continue;
    }
    sendTo(ctx, agent, goal);
  }
}

// The one way anybody is ever sent to a room: already there means settle
// (a chair if the block sits, a spot to stand if it doesn't), anywhere else
// means a route — the same three lines the old retarget ended in, named so
// the day's edges can use them too.
function sendTo(ctx, agent, goal) {
  const room = goal ? ctx.nav.node(goal) : null;
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

// ---------- the day's edges (Phase 39) ----------

// Before the first bell. Not here yet means parked at the curb as `away`;
// arrived means walking in to homeroom, which is where an early school
// morning actually gathers. A person with no curb keeps the old lifecycle:
// born in the building, and before school they go home the way they always
// did.
function beforeSchool(ctx, agent) {
  if (!agent.curb || agent.arriveMin === null) {
    if (agent.state === 'out' || agent.state === 'away') return;
    releaseSeat(ctx, agent);
    headForTheDoor(ctx, agent);
    return;
  }
  if (ctx.minutes < agent.arriveMin) {
    parkAway(ctx, agent);
    return;
  }
  if (agent.state === 'out' || agent.state === 'away') placeAtCurb(ctx, agent);
  releaseSeat(ctx, agent);
  sendTo(ctx, agent, agent.timetable[0] || agent.home);
}

// After the last bell. Whoever's linger has run out heads for their curb;
// the rest keep their seat or their spot in the corridor — a school does not
// empty on one bell, and the stagger out is the same seeded kind of stagger
// the morning came in on.
function afterSchool(ctx, agent) {
  if (agent.state === 'out' || agent.state === 'away') return;
  if (agent.departMin !== null && ctx.minutes < agent.departMin) {
    agent.goal = null;
    if (agent.state !== 'sit') { agent.state = 'idle'; agent.path = null; }
    return;
  }
  releaseSeat(ctx, agent);
  headForTheCurb(ctx, agent);
}

// Not on site yet: the body stands at its curb, unsimulated, until its
// minute comes. Position is written now so the moment it appears it appears
// *there*, and so a panel that asks where somebody is has an answer.
function parkAway(ctx, agent) {
  releaseSeat(ctx, agent);
  releaseLift(ctx, agent);
  agent.state = 'away';
  agent.path = null;
  agent.goal = null;
  agent.chat = null;
  agent.x = agent.curb.x;
  agent.z = agent.curb.z;
  agent.y = groundAt(ctx.site, agent.x, agent.z);
  agent.floorIndex = 0;
  agent.outAt = null;
  agent.doorWait = 0;
}

// The vehicle door opens: the body is set down a pace along the curb by its
// own `lane` — three people off one bus are a knot, not a totem, and the
// crowd resolution spreads them the rest of the way.
function placeAtCurb(ctx, agent) {
  agent.x = agent.curb.x + Math.sin(agent.lane * Math.PI) * 1.5;
  agent.z = agent.curb.z + Math.cos(agent.lane * Math.PI) * 1.5;
  agent.y = groundAt(ctx.site, agent.x, agent.z);
  agent.floorIndex = 0;
  agent.state = 'idle';
  agent.outAt = null;
  agent.doorWait = 0;
}

// Out of the building and along the site to the curb the day started at.
// The curb is a node on the same graph the morning walked in over, so the
// route out is a real route — around the building, not through it — and
// arriving at it is going home (see `arriveAtGoal`). A curb the graph lost
// (the region was deleted mid-day) falls back to the plain walk out.
function headForTheCurb(ctx, agent) {
  const curbNode = agent.curb ? ctx.nav.node(agent.curb.id) : null;
  if (curbNode) {
    repath(ctx, agent, agent.curb.id);
    if (agent.path) {
      agent.state = 'walk';
      return;
    }
    // No route, but already outdoors: close enough to be gone.
    if (ctx.nav.roomIdAt(agent.floorIndex ?? 0, agent.x, agent.z) === null) {
      agent.state = 'out';
      agent.outAt = ctx.elapsed;
      return;
    }
  }
  headForTheDoor(ctx, agent);
}

// The edges, ticked every frame: an `away` person whose minute has come is
// set down at the curb and walks in; after the last bell, whoever's linger
// has run out heads back for it. Both are no-ops outside their block, and
// neither costs a search unless somebody actually moves.
function dayEdges(ctx, agents) {
  if (ctx.mode === 'drill') return;
  const block = blockAt(ctx.schedule, ctx.minutes);
  if (block.kind === 'before') {
    for (const agent of agents) {
      if (agent.state !== 'away' || !agent.curb) continue;
      if (ctx.minutes < agent.arriveMin) continue;
      placeAtCurb(ctx, agent);
      sendTo(ctx, agent, agent.timetable[0] || agent.home);
    }
  } else if (block.kind === 'after') {
    for (const agent of agents) {
      if (agent.state === 'out' || agent.state === 'away') continue;
      if (agent.departMin !== null && ctx.minutes < agent.departMin) continue;
      if (agent.goal || (agent.path && agent.wp < agent.path.length)) continue;
      if (ctx.elapsed - agent.repathAt < REPATH_COOLDOWN) continue;
      releaseSeat(ctx, agent);
      headForTheCurb(ctx, agent);
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

// The conversation is over. The route was never dropped, so resuming is
// just being a walker again; the cooldown is what keeps one sociable pair
// from spending the whole passing period three feet apart, stopping.
function endChat(agent) {
  agent.chat = null;
  agent.chatIn = CHAT_COOLDOWN * (0.6 + agent.social);
  agent.state = agent.path && agent.wp < agent.path.length ? 'walk' : 'idle';
}

// Two willing people close enough to talk, paired. Runs off the same
// neighbour buckets the collision pass built, so finding a partner costs a
// look at the nine cells around you rather than at the school. Never during
// a drill — nobody stops to chat under the alarm.
function pairChats(ctx, agents, map) {
  const byId = new Map();
  for (const a of agents) byId.set(a.id, a);
  const willing = (a) => a && !a.chat && a.chatIn <= 0
    && (a.state === 'walk' || a.state === 'idle');
  for (const a of agents) {
    if (!willing(a)) continue;
    const f = a.floorIndex ?? 0;
    let best = null, bestD = CHAT_RANGE;
    for (const b of neighbours(map, f, a.x, a.z)) {
      // Bodies here include the camera and anything else the caller handed
      // in; a partner is a real agent with a real id, and not yourself.
      if (typeof b.id !== 'number' || b.id <= 0 || b.id === a.id) continue;
      const other = byId.get(b.id);
      if (!willing(other) || (other.floorIndex ?? 0) !== f) continue;
      const d = Math.hypot(other.x - a.x, other.z - a.z);
      if (d >= bestD) continue;
      // Three feet apart can still be two sides of a partition. Same room —
      // and outdoors counts as one big room — or no conversation.
      if (ctx.nav.roomIdAt(f, a.x, a.z) !== ctx.nav.roomIdAt(f, other.x, other.z)) continue;
      bestD = d; best = other;
    }
    if (!best) continue;
    // How long they talk is who they are, not a die roll.
    const t = CHAT_MIN_S + ((a.social + best.social) / 2) * (CHAT_MAX_S - CHAT_MIN_S);
    a.chat = { with: best.id, t, x: best.x, z: best.z };
    best.chat = { with: a.id, t, x: a.x, z: a.z };
    a.state = 'chat';
    best.state = 'chat';
  }
}

export function stepAgents(ctx, agents, dt, opts = {}) {
  ctx.elapsed += dt;
  ctx.speed = speedFor(ctx.schedule, ctx.minutes, ctx.mode);
  // Sitting is for the part of the day people sit down for. A passing period
  // spent looking for a chair is a passing period nobody spends in a corridor.
  ctx.sitting = ctx.mode !== 'drill'
    && ['class', 'homeroom', 'lunch'].includes(blockAt(ctx.schedule, ctx.minutes).kind);
  // Phase 39: the doors accrue their flow, and the day's edges tick — who
  // has just reached the curb, who has finished lingering after the bell.
  if (ctx.thresholds) stepThresholds(ctx.thresholds, dt);
  dayEdges(ctx, agents);
  const map = bucketBodies(agents, opts.bodies);
  for (const agent of agents) {
    const near = neighbours(map, agent.floorIndex ?? 0, agent.x, agent.z);
    stepAgent(ctx, agent, dt, near);
  }
  if (ctx.mode !== 'drill') pairChats(ctx, agents, map);
  // How high off their own feet each body is riding this instant. Written onto
  // the record here rather than worked out by the renderer, so the crowd stays
  // a thing the scene *reads* and never a formula the scene has to know — the
  // same deal `shirt` and `facing` have had since Phase 6. After `pairChats`,
  // because somebody who has just stopped to talk has stopped bobbing.
  for (const agent of agents) agent.bob = walkBob(agent);
  if (ctx.crowd) ctx.crowd.seconds += dt;
  // The cars run whether or not anybody is in them: a lift somebody called and
  // then walked away from still has to come, open, wait and shut, which is
  // what makes the one at the far end of the corridor be somewhere else when
  // you want it.
  if (ctx.lifts) stepLifts(ctx.lifts, dt);
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
  for (const a of agents) {
    if (a.state !== 'out' && a.state !== 'away') floors.add(a.floorIndex ?? 0);
  }
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
    if (a.state === 'out' || a.state === 'away') continue;
    // Somebody in the car is inside a shaft, behind three walls and a door.
    // Resolving the walker against them is resolving it against a body it
    // cannot reach, and on the frame the car passes a storey it is a body
    // that appears in the middle of a corridor and shoves.
    if (a.state === 'ride') continue;
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
    if (a.state === 'out' || a.state === 'away' || a.state === 'ride'
      || (a.floorIndex ?? 0) !== floorIndex) continue;
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
  const out = {
    total: agents.length, walking: 0, seated: 0, idle: 0, out: 0, teachers: 0,
    queueing: 0, riding: 0, chatting: 0, away: 0,
  };
  for (const a of agents) {
    if (a.kind === 'teacher') out.teachers++;
    if (a.state === 'walk') out.walking++;
    else if (a.state === 'sit') out.seated++;
    else if (a.state === 'out') out.out++;
    else if (a.state === 'away') out.away++;
    else if (a.state === 'queue') out.queueing++;
    else if (a.state === 'ride') out.riding++;
    else if (a.state === 'chat') out.chatting++;
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
    // Somebody the bus never brought is not in the building, which for a
    // drill is the same thing as being safely out of it.
    if (a.state === 'out' || a.state === 'away') {
      out++;
      longest = Math.max(longest, a.outAt || 0);
    } else if (!a.path && !a.goal) stranded++;
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

// Phase 42: the population settings are this module's record on the design.
// Registered here rather than imported by the loader, so that opening a file
// does not fetch the crowd — see records.js.
registerRecord('life', { normalize: normalizeLife, isEmpty: isDefaultLife });
