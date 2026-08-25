// The generator. Two suites' worth of question in one file: does the layout
// produce a coherent set of rectangles, and does the design it writes read
// back as an ordinary school through every reader the tool already has.
//
// The second half is the one that matters. A generator that produces something
// only it understands is a generator nobody can edit, so most of what follows
// runs Phase 6's nav graph and Phase 7's report over the output and asks the
// same things of it that they ask of a design somebody drew.

import test from 'node:test';
import assert from 'node:assert/strict';

import { CELL, MAX_FLOORS, getCell, isDoorEdge, edgeHIdx, edgeVIdx, EDGE_WINDOW } from '../js/grid.js';
import { buildProgram, SCHEMES, normalizeBrief } from '../js/program.js';
import { parseBrief } from '../js/brief.js';
import { serialize, deserialize } from '../js/save-load.js';
import { buildNav, navSummary, floorRooms, egressField, unreachableRooms, findPath } from '../js/navgraph.js';
import { buildReport } from '../js/report.js';
import { buildingOccupancy } from '../js/occupancy.js';
import { buildingOverhang } from '../js/shadow.js';
import { catalogEntry } from '../js/catalog.js';
import { computeFloorPlan } from '../js/blueprint.js';
import {
  SPINE_W, WING_CORR_W, WING_BAY_D, HEAD_STAIR_W,
  layoutSchool, buildSchool, expandProgram, generationSummary, exteriorDoors,
  applyAdjacency, nearestPair, ADJACENT_FT, APART_FT,
} from '../js/generate.js';

const BRIEF = { students: 600, band: 'middle', storeys: 2, seed: 1 };
const PLAN = layoutSchool(BRIEF);
const SCHOOL = buildSchool(PLAN);

// ---------- the program, expanded ----------

test('expandProgram produces one entry per room, sized in whole cells', () => {
  const program = buildProgram(BRIEF);
  const rooms = expandProgram(program);
  assert.equal(rooms.length, program.roomCount);
  for (const r of rooms) {
    assert.ok(Number.isInteger(r.w) && r.w >= 1, `${r.name}: bad width`);
    assert.ok(Number.isInteger(r.d) && r.d >= 1, `${r.name}: bad depth`);
    assert.ok(r.w * CELL >= 0);
  }
});

// ---------- the layout ----------

test('every rectangle is well formed and inside the footprint', () => {
  for (const storey of PLAN.rects) {
    for (const r of storey) {
      assert.ok(r.x1 >= r.x0 && r.y1 >= r.y0, `${r.name}: inside out`);
      assert.equal(r.w, r.x1 - r.x0 + 1);
      assert.equal(r.h, r.y1 - r.y0 + 1);
      assert.ok(r.x0 >= 0 && r.y0 >= 0, `${r.name}: off the lattice`);
      assert.ok(r.x1 < PLAN.footprint.w && r.y1 < PLAN.footprint.h, `${r.name}: past the footprint`);
      assert.ok(r.name, 'a rectangle with no name');
    }
  }
});

test('no two rectangles on a storey overlap', () => {
  for (const storey of PLAN.rects) {
    for (let i = 0; i < storey.length; i++) {
      for (let j = i + 1; j < storey.length; j++) {
        const a = storey[i], b = storey[j];
        const hit = a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;
        assert.ok(!hit, `${a.name} overlaps ${b.name}`);
      }
    }
  }
});

test('the scheme is the scheme: a spine, wings off it, a stair at each end', () => {
  assert.ok(PLAN.wings >= 1);
  assert.equal(PLAN.spine.w, SPINE_W);
  const ground = PLAN.rects[0];
  const corridors = ground.filter((r) => r.kind === 'corridor');
  assert.ok(corridors.length >= 1 + PLAN.wings, 'a spine and a corridor per wing');
  for (let i = 0; i < PLAN.wings; i++) {
    const halls = ground.filter((r) => r.stairHall && r.wing === i);
    assert.equal(halls.length, 2, `wing ${i} should have a stair at each end`);
    assert.ok(halls.some((h) => h.head), 'one of them at the head');
  }
  // The head stair takes the first bay on the west side, so no room starts
  // above it.
  for (let i = 0; i < PLAN.wings; i++) {
    const west = ground.filter((r) => r.kind === 'room' && r.side === -1 && r.wing === i);
    for (const r of west) assert.ok(r.y0 >= PLAN.wingY0 + HEAD_STAIR_W, `${r.name} is on top of the head stair`);
  }
});

test('every room the program asked for is somewhere in the plan', () => {
  assert.deepEqual(PLAN.unplaced, [], 'the layout dropped a room');
  const placed = PLAN.rects.flat().filter((r) => r.kind === 'room').length;
  assert.ok(placed >= PLAN.program.roomCount, 'fewer rooms on the plan than in the program');
});

test('classroom numbers run in the hundreds, one hundred per storey', () => {
  PLAN.rects.forEach((storey, s) => {
    for (const r of storey) {
      const m = /^Room (\d+)$/.exec(r.name || '');
      if (!m) continue;
      assert.equal(Math.floor(Number(m[1]) / 100), s + 1, `${r.name} is on the wrong storey`);
    }
  });
});

test('the same brief always lays out the same school, and a different seed does not', () => {
  assert.deepEqual(layoutSchool(BRIEF), layoutSchool({ ...BRIEF }));
  const other = layoutSchool({ ...BRIEF, seed: 9 });
  assert.notDeepEqual(other.rects, PLAN.rects, 'the seed changed nothing');
  // ...but the program it was built from is identical, which is the point:
  // the seed rearranges the school, it does not resize it.
  assert.deepEqual(other.program.rooms, PLAN.program.rooms);
});

test('the layout survives the whole plausible range of briefs', () => {
  for (const students of [30, 120, 400, 900, 2400, 4000]) {
    for (const band of ['elementary', 'middle', 'high']) {
      for (const storeys of [1, 2, 4]) {
        const p = layoutSchool({ students, band, storeys, seed: 3 });
        assert.ok(p.footprint.w <= 200 && p.footprint.h <= 200,
          `${students}/${band}/${storeys}: footprint ${p.footprint.w}x${p.footprint.h} off the lattice`);
        // Rooms may be left over only when the brief asked for more building
        // than the lattice can hold, and then it says so.
        if (p.unplaced.length) {
          assert.ok(p.oversize, `${students}/${band}/${storeys}: rooms dropped without saying so`);
        }
        assert.ok(p.storeys <= MAX_FLOORS);
      }
    }
  }
});

// ---------- the design it writes ----------

test('the state is an ordinary state, with no generator marker on it', () => {
  assert.equal(SCHOOL.generated, undefined, 'generate-then-edit is sacred');
  assert.equal(SCHOOL.currentFloor, 0);
  assert.equal(SCHOOL.floors.length, BRIEF.storeys);
  const raw = JSON.parse(serialize(SCHOOL));
  for (const key of Object.keys(raw)) {
    assert.ok(['version', 'cellFt', 'floorHt', 'w', 'h', 'floors', 'currentFloor', 'props',
      'links', 'env', 'roof', 'terrain', 'site', 'life', 'nextId'].includes(key),
    `an unexpected field made it into the save: ${key}`);
  }
});

test('it round-trips through save and load unchanged in every way that matters', () => {
  const back = deserialize(serialize(SCHOOL));
  assert.equal(back.floors.length, SCHOOL.floors.length);
  assert.equal(back.props.length, SCHOOL.props.length);
  assert.equal(back.links.length, SCHOOL.links.length);
  assert.equal(buildingOccupancy(back).total, buildingOccupancy(SCHOOL).total);
});

test('every prop it places is a real catalog row on a real floor', () => {
  assert.ok(SCHOOL.props.length > 100, 'a generated school should be furnished');
  for (const p of SCHOOL.props) {
    assert.ok(catalogEntry(p.type), `${p.type} is not in the catalog`);
    assert.ok(p.floor >= 0 && p.floor < SCHOOL.floors.length);
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z));
  }
});

test('every room the plan drew is a room the nav graph finds, with a name', () => {
  for (let i = 0; i < SCHOOL.floors.length; i++) {
    const rooms = floorRooms(SCHOOL, i).rooms;
    assert.ok(rooms.length > 0, `no rooms on storey ${i}`);
    for (const r of rooms) assert.ok(r.name, `an unnamed room on storey ${i}`);
  }
});

test('the building is connected: every room can reach a way out', () => {
  const report = buildReport(SCHOOL);
  const stranded = report.egress.rooms.filter((r) => !r.reached);
  assert.deepEqual(stranded.map((r) => r.name), [], 'rooms with no route to an exit');
  assert.ok(report.egress.summary.exits >= 4, 'a school this size needs more than a couple of doors');
});

test('every storey above the ground stands entirely on the one below it', () => {
  // The scheme guarantees this rather than checking it — see the note on
  // building the storeys out solid in generate.js — so this is the assertion
  // that the guarantee is real.
  for (const students of [120, 600, 1400, 2400]) {
    for (const storeys of [2, 3, 4]) {
      const s = buildSchool({ students, band: 'high', storeys, seed: 2 });
      const o = buildingOverhang(s);
      assert.equal(o.cells, 0, `${students}/${storeys}: ${o.area} ft² hanging in the air`);
    }
  }
});

test('the upper storeys are reachable, and reachable without stairs', () => {
  const report = buildReport(SCHOOL);
  assert.ok(report.nav.links >= 2, 'no vertical circulation');
  assert.equal(report.accessible.summary.unreachable, 0,
    'a generated school should have a lift that reaches every storey');
});

test('the occupant load it produces is in the right country for the enrollment', () => {
  // An IBC occupant load is a maximum, not a roll call — it comes out around
  // twice the enrollment for a school, and a generator that produced a
  // building holding a tenth of its students has laid out the wrong thing.
  const occ = buildingOccupancy(SCHOOL);
  assert.ok(occ.total > BRIEF.students, `${occ.total} for ${BRIEF.students} students is too small`);
  assert.ok(occ.total < BRIEF.students * 5, `${occ.total} for ${BRIEF.students} students is absurd`);
  assert.equal(occ.unnamed, 0, 'the generator should not leave a room unnamed');
});

test('the exterior wall has windows in it and doors through it', () => {
  const doors = exteriorDoors(SCHOOL);
  assert.ok(doors >= 4, `only ${doors} doors to the outside`);
  const f = SCHOOL.floors[0];
  let windows = 0;
  for (let y = 0; y <= f.h; y++) {
    for (let x = 0; x < f.w; x++) if (f.edgesH[edgeHIdx(f, x, y)] === EDGE_WINDOW) windows++;
  }
  for (let y = 0; y < f.h; y++) {
    for (let x = 0; x <= f.w; x++) if (f.edgesV[edgeVIdx(f, x, y)] === EDGE_WINDOW) windows++;
  }
  assert.ok(windows > 20, `only ${windows} window bays on the ground floor`);
});

test('every room has a way into it', () => {
  // Not through the graph — off the plan, edge by edge, so a room whose only
  // door opened into the next classroom would be caught here rather than as a
  // routing oddity three readers downstream.
  for (let i = 0; i < SCHOOL.floors.length; i++) {
    const f = SCHOOL.floors[i];
    for (const room of floorRooms(SCHOOL, i).rooms) {
      if (room.rep !== 'grid') continue;
      let doors = 0;
      for (let y = 0; y < f.h; y++) {
        for (let x = 0; x < f.w; x++) {
          if (!getCell(f, x, y)) continue;
          const cell = f.cells[y * f.w + x];
          if (cell.room !== room.name) continue;
          for (const v of [
            f.edgesH[edgeHIdx(f, x, y)], f.edgesH[edgeHIdx(f, x, y + 1)],
            f.edgesV[edgeVIdx(f, x, y)], f.edgesV[edgeVIdx(f, x + 1, y)],
          ]) if (isDoorEdge(v)) doors++;
        }
      }
      assert.ok(doors > 0, `${room.name} on storey ${i} has no door`);
    }
  }
});

test('the blueprint can draw it', () => {
  const plan = computeFloorPlan(SCHOOL, 0);
  assert.ok(plan, 'no plan came back');
  // A generated school is all lattice rooms, so the plan's polygon list is
  // empty by construction and the walls and the labels are what it drew.
  assert.ok(plan.walls.length > 50, 'a plan with no walls in it');
  assert.ok(plan.gridLabels.length > 10, 'a plan with no room labels on it');
  assert.ok(plan.doors.length > 20, 'a plan with no openings in it');
});

test('a brief written as a sentence generates the school it describes', () => {
  const { brief } = parseBrief('a single-storey elementary school for 400 students with no gym');
  const s = buildSchool(brief);
  assert.equal(s.floors.length, 1);
  const names = floorRooms(s, 0).rooms.map((r) => r.name);
  assert.ok(!names.some((n) => /gym/i.test(n)), 'it built a gym nobody asked for');
  assert.ok(names.some((n) => /kindergarten|room 1/i.test(n)), 'no classrooms');
});

test('turning the site off leaves the building and nothing round it', () => {
  const withSite = buildSchool({ ...BRIEF, site: true });
  const without = buildSchool({ ...BRIEF, site: false });
  assert.ok(withSite.site && withSite.site.regions.length > 4);
  assert.ok(!without.site || !without.site.regions.length);
  assert.equal(without.floors.length, withSite.floors.length);
});

test('the population it sets matches the enrollment it was asked for', () => {
  assert.ok(SCHOOL.life, 'no population settings');
  assert.equal(SCHOOL.life.seed, BRIEF.seed);
  assert.ok(SCHOOL.life.students > 0 && SCHOOL.life.students <= BRIEF.students);
});

test('generationSummary reports what was actually built', () => {
  const sum = generationSummary(PLAN, SCHOOL);
  assert.equal(sum.students, BRIEF.students);
  assert.equal(sum.storeys, BRIEF.storeys);
  assert.equal(sum.props, SCHOOL.props.length);
  assert.equal(sum.links, SCHOOL.links.length);
  assert.ok(sum.exits >= 4);
  assert.deepEqual(sum.unplaced, []);
  assert.ok(sum.footprintFt.w > 100 && sum.footprintFt.d > 100);
});

test('a whole sweep of briefs builds something the report can read', () => {
  for (const students of [120, 600, 1600]) {
    for (const storeys of [1, 3]) {
      const s = buildSchool({ students, band: 'high', storeys, seed: 5, site: false });
      const r = buildReport(s);
      assert.ok(r.summary.rooms > 0);
      assert.equal(r.egress.rooms.filter((x) => !x.reached).length, 0,
        `${students}/${storeys}: stranded rooms`);
      assert.ok(navSummary(buildNav(s)).exits > 0);
    }
  }
});


// ---------- the three schemes ----------
//
// Phase 10's second-largest item, and the one with the least to prove: the
// contract is the plan `buildSchool` reads, and a scheme is right when what it
// produces reads back as an ordinary school through every reader the tool
// already has. So these ask the same things of the two new schemes that the
// suite above asks of the spine — and one thing extra, which is that they are
// actually different buildings.

const SCHEME_KEYS = SCHEMES.map((s) => s.key);

test('the brief carries a scheme, and only one of the three', () => {
  assert.deepEqual(SCHEME_KEYS, ['spine', 'courtyard', 'compact']);
  assert.equal(normalizeBrief({}).scheme, 'spine');
  assert.equal(normalizeBrief({ scheme: 'courtyard' }).scheme, 'courtyard');
  assert.equal(normalizeBrief({ scheme: 'pyramid' }).scheme, 'spine');
  for (const s of SCHEMES) {
    assert.ok(s.label && s.note, `${s.key} says what it is`);
  }
});

test('every scheme answers the same contract', () => {
  for (const scheme of SCHEME_KEYS) {
    const plan = layoutSchool({ ...BRIEF, scheme });
    assert.equal(plan.scheme, scheme);
    for (const key of ['rects', 'links', 'exits', 'footprint', 'entry', 'envelope', 'style', 'storeyOcc']) {
      assert.ok(plan[key] !== undefined, `${scheme} has ${key}`);
    }
    assert.equal(plan.rects.length, plan.storeys);
    assert.ok(plan.footprint.w > 0 && plan.footprint.h > 0);
    // The envelope is the box the grounds are drawn round, and it has to be
    // inside the lattice the building is written on.
    assert.ok(plan.envelope.x1 <= plan.footprint.w && plan.envelope.y1 <= plan.footprint.h);
    assert.equal(plan.unplaced.length, 0, `${scheme} places every room it was given`);
  }
});

test('every scheme builds a school you can walk round', () => {
  for (const scheme of SCHEME_KEYS) {
    for (const storeys of [1, 3]) {
      const state = buildSchool(layoutSchool({ ...BRIEF, storeys, scheme }), { furnish: false });
      const nav = buildNav(state);
      const field = egressField(nav, { metric: true });
      assert.ok(nav.exits.length > 0, `${scheme} has a way out`);
      assert.equal(unreachableRooms(nav, field).length, 0,
        `${scheme} on ${storeys} storeys strands nobody`);
      // ...and the whole of it is one building rather than two that met: every
      // room can be walked to from every other, without going outside.
      const from = nav.rooms[0];
      for (const room of nav.rooms) {
        assert.ok(findPath(nav, from.id, room.id), `${scheme}: ${room.name} is reachable inside`);
      }
    }
  }
});

test('a corridor cut into compartments keeps the junction at its far end', () => {
  // The bug this is here for: `splitCorridor` used to give every segment after
  // the first a door back to the one before it and *drop* whatever the caller
  // had asked for at the far end. A spine never noticed — it is a tree. A ring
  // came back as a horseshoe, and the south half of a courtyard was reachable
  // only by going outside.
  const state = buildSchool(layoutSchool({ ...BRIEF, storeys: 1, scheme: 'courtyard' }), { furnish: false });
  const nav = buildNav(state);
  const north = nav.rooms.find((r) => (r.name || '').startsWith('North Hall'));
  const south = nav.rooms.find((r) => (r.name || '').startsWith('South Hall'));
  assert.ok(north && south);
  const path = findPath(nav, north.id, south.id);
  assert.ok(path, 'the ring is a ring');
  assert.ok(!path.includes(nav.outside), 'and you do not have to go outside to walk it');
});

test('every storey of every scheme stands on the one below it', () => {
  for (const scheme of SCHEME_KEYS) {
    const state = buildSchool(layoutSchool({ ...BRIEF, storeys: 3, scheme }), { furnish: false });
    assert.equal(buildingOverhang(state).area, 0,
      `${scheme} has no upper storey over open air`);
  }
});

test('the three schemes are three different buildings', () => {
  const plans = SCHEME_KEYS.map((scheme) => layoutSchool({ ...BRIEF, scheme }));
  const shapes = plans.map((p) => `${p.footprint.w}x${p.footprint.h}`);
  assert.equal(new Set(shapes).size, 3, `three footprints, got ${shapes.join(' ')}`);
  // The courtyard is the one with a hole in it, and the hole is not built on.
  const court = plans[1].court;
  assert.ok(court && court.w > 0 && court.h > 0);
  const state = buildSchool(plans[1], { furnish: false });
  const f = state.floors[0];
  for (let y = court.y0; y < court.y0 + court.h; y++) {
    for (let x = court.x0; x < court.x0 + court.w; x++) {
      assert.ok(!getCell(f, x, y), 'nothing is built in the court');
    }
  }
});

test('nothing opens onto the court, because a court is not a way out', () => {
  const plan = layoutSchool({ ...BRIEF, scheme: 'courtyard' });
  const state = buildSchool(plan, { furnish: false });
  const nav = buildNav(state);
  const court = plan.court;
  for (const exit of nav.exits) {
    const gx = exit.x / CELL;
    const gz = exit.z / CELL;
    const inCourt = gx > court.x0 && gx < court.x0 + court.w
      && gz > court.y0 && gz < court.y0 + court.h;
    assert.ok(!inCourt, 'an exit discharges to the site, never into the court');
  }
});

test('the generation summary names the scheme it drew', () => {
  for (const scheme of SCHEME_KEYS) {
    const plan = layoutSchool({ ...BRIEF, scheme });
    const sum = generationSummary(plan, buildSchool(plan, { furnish: false }));
    assert.equal(sum.scheme, scheme);
    assert.ok(sum.schemeLabel.length > 0);
    assert.ok(sum.rooms > 0 && sum.exits > 0);
  }
});


// ---------- adjacency ----------

const ruleFor = (plan, a, b) => plan.adjacency.find((r) => r.a === a && r.b === b);

test('the layout keeps two blocks together when the brief asks it to', () => {
  for (const scheme of SCHEME_KEYS) {
    const plan = layoutSchool({
      ...BRIEF, scheme,
      adjacency: [{ a: 'gym', b: 'cafeteria', want: 'near' }],
    });
    const rule = ruleFor(plan, 'gym', 'cafeteria');
    assert.ok(rule, `${scheme} reports what it did with the rule`);
    assert.ok(rule.after <= rule.before + 1e-9,
      `${scheme} did not push them further apart than they started`);
  }
  // The spine lays its blocks in a row, so this one is exact: they end up
  // sharing a wall.
  const spine = layoutSchool({ ...BRIEF, adjacency: [{ a: 'gym', b: 'cafeteria', want: 'near' }] });
  assert.equal(ruleFor(spine, 'gym', 'cafeteria').after, 0);
  assert.equal(ruleFor(spine, 'gym', 'cafeteria').done, true);
});

test('...and pushes two rooms apart when it asks for that instead', () => {
  const near = layoutSchool({ ...BRIEF, scheme: 'courtyard' });
  const apart = layoutSchool({
    ...BRIEF, scheme: 'courtyard',
    adjacency: [{ a: 'music', b: 'library', want: 'apart' }],
  });
  const rule = ruleFor(apart, 'music', 'library');
  assert.ok(rule.after > rule.before, 'it moved them');
  assert.ok(rule.after >= APART_FT, `${rule.after} ft is away from`);
  assert.equal(rule.done, true);
  // ...and the room count is untouched: a swap moves what a room is, never
  // whether it exists.
  const count = (plan, key) => plan.rects.flat().filter((r) => r.key === key).length;
  for (const key of ['music', 'library', 'classroom', 'science']) {
    assert.equal(count(apart, key), count(near, key), `${key} count is unchanged`);
  }
});

test('a rule the program cannot honour is reported, not silently dropped', () => {
  const plan = layoutSchool({
    ...BRIEF, gym: false,
    adjacency: [{ a: 'gym', b: 'cafeteria', want: 'near' }],
  });
  const rule = ruleFor(plan, 'gym', 'cafeteria');
  assert.equal(rule.done, false);
  assert.equal(rule.why, 'not in this program');
  assert.equal(generationSummary(plan, null).adjacency[0].done, false);
});

test('distance between two rooms is measured edge to edge', () => {
  const a = { x0: 0, y0: 0, x1: 9, y1: 9, storey: 0 };
  const b = { x0: 10, y0: 0, x1: 19, y1: 9, storey: 0 };
  assert.equal(nearestPair([a], [b]), 0, 'sharing a wall is no distance at all');
  const far = { x0: 30, y0: 0, x1: 39, y1: 9, storey: 0 };
  assert.equal(nearestPair([a], [far]), 20 * CELL);
  // A storey between two rooms counts for more than the stair is long.
  const above = { ...a, storey: 1 };
  assert.ok(nearestPair([a], [above]) > ADJACENT_FT);
});

test('applyAdjacency swaps what a room is, never where it is', () => {
  const rects = [[
    { kind: 'room', key: 'music', name: 'Band Room', tpl: null, x0: 0, y0: 0, x1: 3, y1: 3, w: 4, h: 4, storey: 0 },
    { kind: 'room', key: 'library', name: 'Library', tpl: null, x0: 5, y0: 0, x1: 8, y1: 3, w: 4, h: 4, storey: 0 },
    { kind: 'room', key: 'classroom', name: 'Room 101', tpl: null, x0: 60, y0: 0, x1: 63, y1: 3, w: 4, h: 4, storey: 0 },
  ]];
  const before = rects[0].map((r) => `${r.x0},${r.y0}`);
  const report = applyAdjacency(rects, [{ a: 'music', b: 'library', want: 'apart' }]);
  assert.equal(report.length, 1);
  assert.deepEqual(rects[0].map((r) => `${r.x0},${r.y0}`), before, 'nothing moved');
  const music = rects[0].find((r) => r.key === 'music');
  assert.equal(music.x0, 60, 'the band room is now the far slot');
  assert.equal(music.name, 'Band Room', 'and it took its name with it');
  assert.equal(report[0].done, true);
});
