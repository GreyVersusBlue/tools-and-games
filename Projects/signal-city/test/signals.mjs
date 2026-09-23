// node test/signals.mjs
//
// The signal model, stepped by hand. Exits non-zero on any FAIL (#13).
// Imports js/signals.js and nothing else: no DOM, no rng.

import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const S = await import(pathToFileURL(path.join(HERE, '..', 'js', 'signals.js')).href);
const { LEGS, exitLeg, parseMovement, conflicts, wideConflicts, movementsFor, conflictMatrix,
  phaseIsValid, standardPhases, extraPhases, Controller } = S;

let passed = 0, failed = 0;
const ok = (cond, what, detail = '') => {
  if (cond) { passed++; console.log(`  ok    ${what}${detail ? '  ' + detail : ''}`); }
  else { failed++; console.log(`  FAIL  ${what}${detail ? '  ' + detail : ''}`); }
};
const group = name => console.log(`\n${name}`);
const run = (c, seconds, dt = 0.1, sense = null) => { for (let i = 0, n = Math.round(seconds / dt); i < n; i++) c.step(dt, sense); };

/* --------------------------------------------------------------- geometry -- */

group('movements and exits');

ok(exitLeg('N', 'T') === 'S' && exitLeg('N', 'L') === 'E' && exitLeg('N', 'R') === 'W',
  'a southbound car goes straight to S, left to E, right to W');
ok(exitLeg('E', 'R') === 'N' && exitLeg('W', 'L') === 'N', 'E-right and W-left both land on N');
ok(movementsFor(LEGS).length === 12, 'a 4-way carries 12 vehicle movements', String(movementsFor(LEGS).length));
{
  const t = movementsFor(['N', 'E', 'S']);
  ok(t.length === 6 && !t.some(m => m.includes('W')) && !t.includes('N-R') && t.includes('N-L'),
    'a T with no west leg carries 6, and N cannot turn right into the missing leg', t.join(' '));
}
ok(parseMovement('P-N').ped && parseMovement('P-N').leg === 'N', 'P-N is a pedestrian crossing of the north leg');

group('the conflict matrix comes from geometry');

ok(!conflicts('N-T', 'S-T'), 'opposing throughs run together');
ok(conflicts('N-T', 'E-T'), 'crossing throughs conflict');
ok(conflicts('N-L', 'S-T'), 'a left conflicts with the opposing through');
ok(!conflicts('N-L', 'S-L'), 'opposing lefts run together');
ok(conflicts('N-L', 'E-T'), 'a left conflicts with the cross street');
ok(conflicts('N-L', 'W-L'), 'adjacent lefts cross');
ok(!conflicts('N-R', 'W-T') && !conflicts('N-R', 'S-T') && !conflicts('N-R', 'E-L'),
  'a right turn hugs its corner and crosses nothing');
ok(conflicts('N-R', 'S-L') && conflicts('N-R', 'E-T'), 'but it merges with the opposing left and the cross-street through, and a merge is a conflict');
ok(conflicts('N-L', 'S-R'), 'a left and the opposing right merge into the same lane, which conflicts');
ok(!conflicts('N-T', 'N-L') && !conflicts('N-T', 'N-R'), 'movements from one leg never conflict with each other');
ok(conflicts('N-T', 'P-N') && conflicts('S-T', 'P-N'), 'a crossing conflicts with cars entering or leaving its leg');
ok(!conflicts('E-R', 'P-N'), 'a right turn onto the crossed leg yields, it is not a conflict');
ok(!conflicts('N-T', 'P-E'), 'a through does not conflict with the parallel crossing');
{
  const m = conflictMatrix(LEGS);
  let symmetric = true;
  for (const [a, set] of m) for (const b of set) if (!m.get(b).has(a)) symmetric = false;
  ok(symmetric, 'the matrix is symmetric');
  ok(conflicts('N-L', 'E-L') === conflicts('E-L', 'N-L'), 'and so is the function');
}
ok(wideConflicts('N-L', 'N-T') && wideConflicts('N-L', 'W-T') && !wideConflicts('N-T', 'N-L'),
  'a wide left also blocks its own leg and its exit leg; a wide through does not');

group('phases');

{
  const v = phaseIsValid(['N-T', 'S-T', 'N-R', 'S-R']);
  ok(v.ok, 'the N-S through phase is valid');
  const bad = phaseIsValid(['N-T', 'E-T']);
  ok(!bad.ok && bad.pair.join() === 'N-T,E-T', 'N-T with E-T is refused and the pair is named', bad.pair && bad.pair.join(' vs '));
}
{
  const p = standardPhases(LEGS);
  ok(p.length === 2 && p[0].name === 'N-S' && p[1].name === 'E-W', 'the default 4-way is two phases', p.map(x => x.name).join(', '));
  ok(p[0].movements.includes('N-L') && p[0].permissive.includes('N-L'), 'and its lefts are permissive');
  ok(p.every(ph => phaseIsValid(ph.movements, ph.permissive).ok), 'every phase validates with its permissive list');
  ok(!phaseIsValid(p[0].movements).ok, 'and would not without it: the permissive left crosses the opposing through');
}
{
  const p = standardPhases(LEGS, { lefts: true });
  ok(p.length === 4 && p[1].movements.join() === 'N-L,S-L', 'with protected lefts it is four phases and the lefts pair up', p.map(x => x.name).join(', '));
  ok(p.every(ph => phaseIsValid(ph.movements).ok), 'every one of them validates');
}
{
  const p = standardPhases(LEGS, { main: 'EW' });
  ok(p[0].name === 'E-W' && p[1].name === 'N-S' && new Controller({ main: 'EW' }).majorLegs().join() === 'E,W', "main: 'EW' puts the east-west phase first, and the major legs follow it", p.map(x => x.name).join(', '));
  const q = standardPhases(LEGS, { lefts: true, main: 'EW' });
  ok(q.map(x => x.name).join() === 'E-W,E-W lefts,N-S,N-S lefts', 'and with protected lefts the four phases keep that order', q.map(x => x.name).join(', '));
}
{
  const p = standardPhases(['N', 'E', 'S']);
  ok(p.length === 2 && p[1].movements.every(m => m.startsWith('E-')), 'a T-junction gets a main phase and a stem phase', p.map(x => x.movements.join('+')).join(' | '));
}
{
  let threw = null;
  try { new Controller({ phases: [{ name: 'bad', movements: ['N-T', 'E-T'] }] }); } catch (e) { threw = e.message; }
  ok(threw && /N-T vs E-T/.test(threw), 'a controller refuses a conflicting phase at construction', threw);
}

/* ------------------------------------------------------------- transitions -- */

group('manual mode, one change');

{
  const c = new Controller({ phases: [
    { name: 'A', movements: ['N-T', 'S-T', 'N-R', 'S-R'] },
    { name: 'B', movements: ['E-T', 'W-T', 'E-R', 'W-R'] },
  ], timing: { yellow: 3, allRed: 1, minGreen: 4 } });
  ok(c.head('N-T') === 'green' && c.head('E-T') === 'red', 'starts green on phase A');
  ok(c.requestPhase(0) === false, 'requesting the phase in force is a no-op');
  run(c, 5);
  ok(c.requestPhase(1) === true, 'a request for B is accepted');
  ok(c.stage === 'yellow', 'and after minGreen it goes yellow at once', c.stage);
  ok(c.head('N-T') === 'yellow' && c.head('E-T') === 'red', 'A sees yellow, B still red');
  run(c, 2.9);
  ok(c.stage === 'yellow', 'yellow holds for its full 3 s');
  run(c, 0.2);
  ok(c.stage === 'allred', 'then all-red', c.stage);
  ok(c.head('N-T') === 'red' && c.head('E-T') === 'red', 'in which every head is red');
  run(c, 0.7);
  ok(c.stage === 'allred', 'all-red holds for its 1 s');
  run(c, 0.3);
  ok(c.stage === 'green' && c.phase === 1, 'then B is green', `${c.stage} ${c.phase}`);
  ok(c.head('E-T') === 'green' && c.head('N-T') === 'red', 'B green, A red');
  const kinds = c.log.map(l => l.kind).join(' ');
  ok(kinds === 'yellow allred green', 'the log reads yellow, allred, green', kinds);
}

group('never green to green');

{
  const c = new Controller({ timing: { yellow: 2, allRed: 2, minGreen: 1 } });
  run(c, 1);
  c.requestPhase(1);
  const seen = [];
  for (let i = 0; i < 100; i++) { c.step(0.1); seen.push(c.stage + c.phase); }
  const compact = seen.filter((s, i) => i === 0 || s !== seen[i - 1]).join(' > ');
  ok(compact === 'yellow0 > allred0 > green1', 'the stage sequence is yellow, allred, green', compact);
}

group('requests during clearance wait, and the last one wins');

{
  const c = new Controller({ phases: standardPhases(LEGS, { lefts: true }), timing: { yellow: 3, allRed: 1, minGreen: 2 } });
  run(c, 2.5);
  c.requestPhase(2);
  run(c, 1);
  ok(c.stage === 'yellow', 'mid-yellow');
  c.requestPhase(3);
  run(c, 3.5);
  ok(c.stage === 'green' && c.phase === 3, 'a second request during yellow replaces the first without shortening the clearance', `${c.stage} ${c.phase} at ${c.t.toFixed(1)}`);
  ok(c.head('E-L') === 'green-arrow' && c.head('W-L') === 'green-arrow', 'the lefts phase shows arrows');
  ok(c.head('E-T') === 'red', 'and the through it would cross is red');
}

group('minimum green');

{
  const c = new Controller({ timing: { yellow: 1, allRed: 1, minGreen: 5 } });
  run(c, 1);
  c.requestPhase(1);
  ok(c.stage === 'green', 'a request 1 s into a 5 s minimum green is held');
  run(c, 3.9);
  ok(c.stage === 'green', 'still held at 4.9 s');
  run(c, 0.2);
  ok(c.stage === 'yellow', 'and released at 5', `${c.stage} at ${c.t.toFixed(1)}`);
  ok(Math.abs(c.timeToYellow('N-T') - 0) < 1e-9 || c.timeToYellow('N-T') === Infinity, 'timeToYellow of a yellow head is not a number a driver acts on');
}

group('the green on its way');

{
  const c = new Controller({ timing: { yellow: 3, allRed: 2, minGreen: 1 } });
  ok(c.timeToGreen('N-T') === 0 && c.timeToGreen('E-T') === Infinity, 'green now is 0, and a red with nothing queued is Infinity');
  run(c, 1);
  c.requestPhase(1);
  ok(Math.abs(c.timeToGreen('E-T') - 5) < 1e-9, 'at the start of a 3 s yellow with 2 s of all-red, E-T is 5 s away', c.timeToGreen('E-T').toFixed(2));
  ok(c.timeToGreen('N-T') === Infinity, 'and N-T, whose green is ending, is not on its way');
  run(c, 2);
  ok(Math.abs(c.timeToGreen('E-T') - 3) < 1e-9, '2 s later it is 3 s away', c.timeToGreen('E-T').toFixed(2));
  run(c, 1.5);
  ok(c.stage === 'allred' && Math.abs(c.timeToGreen('E-T') - 1.5) < 1e-9, 'and in the all-red it counts that down', `${c.stage} ${c.timeToGreen('E-T').toFixed(2)}`);
  c.setTiming({ allRed: 4 });
  ok(Math.abs(c.timeToGreen('E-T') - 3.5) < 1e-9, 'setTiming mid-clearance stretches the wait the driver reads', c.timeToGreen('E-T').toFixed(2));
  run(c, 3.6);
  ok(c.stage === 'green' && c.phase === 1 && c.timeToGreen('E-T') === 0, 'then it is green', `${c.stage} ${c.phase}`);
}

group('the rule list is live');

{
  const c = new Controller({ timing: { yellow: 1, allRed: 1, minGreen: 1 } });
  run(c, 30);
  ok(c.stage === 'green' && c.phase === 0, 'with no rules nothing changes');
  c.setRules([{ when: 'elapsed', seconds: 5, then: 'next' }]);
  run(c, 0.2);
  ok(c.stage === 'yellow', 'a rule added mid-green fires against the green already elapsed', c.stage);
  run(c, 2.1);
  ok(c.phase === 1, 'and moves on');
  c.setRules([{ when: 'queue', movement: 'N-T', threshold: 2, then: 0 }, { when: 'elapsed', seconds: 3, then: 0 }]);
  run(c, 3.1, 0.1, () => 0);
  ok(c.stage === 'yellow' && c.next === 0, 'a queue rule with nobody on the loop lets the elapsed rule after it fire', `${c.stage} next ${c.next}`);
  ok(c.rules.length === 2 && c.rules[0].when === 'queue', 'and the list keeps the order it was given');
  let threw = null;
  try { c.setRules([{ when: 'elapsed', seconds: 5, then: 9 }]); } catch (e) { threw = e.message; }
  ok(threw && /no phase 9/.test(threw), 'a rule naming a phase that does not exist is refused', threw);
  ok(c.rules.length === 2, 'and the list is untouched');
}

group('flashing as a mode, and back');

{
  const c = new Controller({ rules: [{ when: 'elapsed', seconds: 5, then: 'next' }], timing: { yellow: 1, allRed: 1, minGreen: 1 } });
  run(c, 2);
  c.setFlash('red');
  run(c, 20);
  ok(c.stage === 'flash' && c.phase === 0, 'flashing red holds and the rules do not fire', `${c.stage} ${c.phase}`);
  ok(c.majorLegs().join() === 'N,S', 'the major legs are the entries of phase 0', c.majorLegs().join());
  c.setFlash({ major: c.majorLegs() });
  ok(c.head('N-T') === 'flash-yellow' && c.head('E-T') === 'flash-red' && c.head('N-L') === 'flash-yellow', 'flashing yellow on the majors, red on the minors');
  c.setFlash(null);
  ok(c.stage === 'allred' && c.next === 0, 'back to signals passes through an all-red into the phase that was running', `${c.stage} next ${c.next}`);
  run(c, 1.1);
  ok(c.stage === 'green' && c.phase === 0, 'and is green again');
  run(c, 5.1);
  ok(c.stage === 'yellow', 'and the rules fire again');
}

group('timed mode and offsets');

{
  const plan = [{ phase: 0, green: 10 }, { phase: 1, green: 6 }];
  const c = new Controller({ mode: 'timed', plan, timing: { yellow: 3, allRed: 1 } });
  ok(c.cycleLength() === 24, 'cycle = 10 + 6 + 2 x (3 + 1) = 24 s', String(c.cycleLength()));
  ok(Math.abs(c.timeToYellow('N-T') - 10) < 1e-9, 'timeToYellow reads the plan', c.timeToYellow('N-T').toFixed(2));
  run(c, 10.05);
  ok(c.stage === 'yellow', 'the first green ends on the plan');
  run(c, 4);
  ok(c.stage === 'green' && c.phase === 1, 'phase 1 follows');
  run(c, 6 + 4);
  ok(c.stage === 'green' && c.phase === 0, 'and the cycle wraps to phase 0', `${c.stage} ${c.phase} at ${c.t.toFixed(2)}`);
  const d = new Controller({ mode: 'timed', plan, timing: { yellow: 3, allRed: 1 }, offset: 12 });
  ok(d.stage === 'yellow' && d.phase === 0 && Math.abs(d.stageT - 2) < 1e-9, 'offset 12 starts 2 s into phase 0 yellow', `${d.stage} ${d.phase} ${d.stageT}`);
  const e = new Controller({ mode: 'timed', plan, timing: { yellow: 3, allRed: 1 }, offset: 15 });
  ok(e.stage === 'green' && e.phase === 1 && Math.abs(e.stageT - 1) < 1e-9, 'offset 15 starts 1 s into phase 1 green', `${e.stage} ${e.phase} ${e.stageT}`);
  // two controllers 24 s apart in offset are the same controller
  const f = new Controller({ mode: 'timed', plan, timing: { yellow: 3, allRed: 1 }, offset: 15 + 24 });
  run(e, 7.3); run(f, 7.3);
  ok(e.stage === f.stage && e.phase === f.phase && Math.abs(e.stageT - f.stageT) < 1e-9, 'an offset of one whole cycle changes nothing');
}

group('the offset moves through a transition (M7)');

{
  // Two Blocks' plan: 22 + 12 greens, 3 s yellow, 1.5 s all-red, a 43 s cycle.
  const plan = [{ phase: 0, green: 22 }, { phase: 1, green: 12 }];
  const timing = { yellow: 3, allRed: 1.5, minGreen: 4 };
  const mk = offset => new Controller({ mode: 'timed', plan, timing, offset });
  // the reference: a controller built at the new offset. The one under test
  // is built at 0, moved at t = 5, and has to end up stepping in lock step
  // with it without a single jump on the way.
  const same = (a, b) => a.stage === b.stage && a.phase === b.phase && Math.abs(a.stageT - b.stageT) < 1e-6;
  const legal = log => {
    // every stage change after the offset call is green -> yellow -> allred -> green
    const kinds = log.filter(e => ['yellow', 'allred', 'green'].includes(e.kind)).map(e => e.kind);
    const order = ['yellow', 'allred', 'green'];
    for (let i = 1; i < kinds.length; i++) if (kinds[i] !== order[(order.indexOf(kinds[i - 1]) + 1) % 3]) return false;
    return true;
  };

  const a = mk(0), ref = mk(16);
  run(a, 5); run(ref, 5);
  const before = { stage: a.stage, phase: a.phase, stageT: a.stageT };
  const q = a.setOffset(16);
  ok(a.offset === 16 && q === 16 && a.shift === 16, 'setOffset(16) on a 43 s cycle queues 16 s of greens to cut, the shorter way round', `offset ${a.offset} shift ${a.shift}`);
  ok(a.stage === before.stage && a.phase === before.phase && a.stageT === before.stageT, 'and the stage in force does not move at the call', `${a.stage} ${a.stageT.toFixed(1)}`);
  ok(Math.abs(a.timeToYellow('N-T') - (22 - 16 - 5)) < 1e-9, 'timeToYellow reads the cut green: 22 s less 16, from 5 s in', a.timeToYellow('N-T').toFixed(2));
  const mark = a.log.length;
  run(a, 1.05);
  ok(a.stage === 'yellow' && a.next === 1, 'the cut green ends at 6 s with the next phase queued', `${a.stage} next ${a.next} at ${a.t.toFixed(2)}`);
  ok(Math.abs(a.shift) < 1e-6, 'and one green paid the whole 16 s', String(a.shift));
  run(a, 200); run(ref, a.t - ref.t);
  ok(same(a, ref), 'four cycles on it steps in lock step with a controller built at offset 16', `${a.stage} ${a.phase} ${a.stageT.toFixed(2)} vs ${ref.stage} ${ref.phase} ${ref.stageT.toFixed(2)}`);
  ok(legal(a.log.slice(mark)), 'and every change on the way ran yellow then all-red', a.log.slice(mark).map(e => e.kind).join(' '));

  // the long way round is the stretch: 30 s further is 13 s back, so the greens stretch by 13
  const b = mk(0), refB = mk(30);
  run(b, 5); run(refB, 5);
  const qb = b.setOffset(30);
  ok(qb === -13 && b.shift === -13, 'setOffset(30) stretches by 13 s rather than cutting 30', `shift ${b.shift}`);
  ok(Math.abs(b.timeToYellow('N-T') - (22 + 13 - 5)) < 1e-9, 'timeToYellow reads the stretched green: 35 s', b.timeToYellow('N-T').toFixed(2));
  run(b, 200); run(refB, b.t - refB.t);
  ok(same(b, refB), 'and it too ends in lock step with a controller built at 30', `${b.stage} ${b.phase} ${b.stageT.toFixed(2)} vs ${refB.stage} ${refB.phase} ${refB.stageT.toFixed(2)}`);

  // a cut deeper than one green can pay: 21 s from 4 s in, with 22 - 4 = 18 spare on this green
  const c = mk(0), refC = mk(21);
  run(c, 4); run(refC, 4);
  c.setOffset(21);
  run(c, 0.05);
  ok(c.stage === 'yellow', 'a 21 s cut from 4 s in ends the green at the 4 s minimum', `${c.stage} at ${c.t.toFixed(2)}`);
  ok(Math.abs(c.shift - 3.1) < 1e-6, 'with 3.1 s still owed (the green ran 4.1 at a 0.1 s step)', c.shift.toFixed(2));
  run(c, 4.5 + 12 - 3.1 + 0.05);
  ok(c.stage === 'yellow' && c.phase === 1 && Math.abs(c.shift) < 1e-6, 'the 12 s side-street green pays the 3.1 and ends at 8.9', `${c.stage} phase ${c.phase} shift ${c.shift.toFixed(2)}`);
  run(c, 200); run(refC, c.t - refC.t);
  ok(same(c, refC), 'and the two are then in lock step', `${c.stage} ${c.phase} ${c.stageT.toFixed(2)} vs ${refC.stage} ${refC.phase} ${refC.stageT.toFixed(2)}`);

  // never below the minimum green, whatever is owed: 20 s asked 1 s into
  // a 22 s green would end it at 2 s, and it ends at 4. (The first green
  // is not in the log, the constructor starts in it, so this reads the
  // stage and not the log.)
  const d = mk(0);
  run(d, 1);
  d.setOffset(20);
  ok(Math.abs(d.timeToYellow('N-T') - 3) < 1e-9, 'a 20 s cut asked 1 s into a 22 s green leaves 3 s: the 4 s minimum, not 2 - 1', d.timeToYellow('N-T').toFixed(2));
  run(d, 2.05);
  ok(d.stage === 'green', 'at 3.05 s it is still green', `${d.stage} at ${d.t.toFixed(2)}`);
  run(d, 1);
  ok(d.stage === 'yellow' && Math.abs(d.shift - 2) < 0.11, 'at 4.05 s it is yellow, with 2 s of the 20 still owed', `${d.stage} at ${d.t.toFixed(2)}, shift ${d.shift.toFixed(2)}`);

  // the same offset again is a no-op; a whole cycle is a no-op
  const e = mk(16);
  run(e, 3);
  ok(e.setOffset(16) === 0 && e.shift === 0, 'setOffset to the offset it has queues nothing');
  ok(e.setOffset(16 + 43) === 0 && e.shift === 0 && e.offset === 59, 'and a whole cycle further queues nothing either', `offset ${e.offset}`);

  // a second call while the first is still owed: the two add up mod the cycle
  const f = mk(0);
  run(f, 2);
  f.setOffset(10); f.setOffset(0);
  ok(f.shift === 0, 'moving to 10 and straight back to 0 owes nothing', String(f.shift));
  f.setOffset(10); f.setOffset(20);
  ok(f.shift === 20, 'moving to 10 then 20 owes 20', String(f.shift));

  // a hand on the phases while a cut is owed counts toward it
  const g = mk(0);
  run(g, 10);
  g.setOffset(16);
  g.requestPhase(1);
  ok(g.stage === 'yellow' && Math.abs(g.shift - 4) < 1e-6, 'pressing the side street 10 s into a 22 s green pays 12 of the 16 owed', `shift ${g.shift.toFixed(2)}`);

  // cyclePosition and the forecast
  const h = mk(16);
  ok(Math.abs(h.cyclePosition() - 16) < 1e-9, 'cyclePosition reads 16 at t = 0 for offset 16', h.cyclePosition().toFixed(2));
  run(h, 10);
  ok(Math.abs(h.cyclePosition() - 26) < 1e-6 && h.stage === 'allred', 'and 26 ten seconds on: 1 s into phase 0\'s all-red', `${h.cyclePosition().toFixed(2)} ${h.stage} ${h.phase}`);
  const state = { stage: h.stage, phase: h.phase, stageT: h.stageT, t: h.t, logN: h.log.length };
  const fc = h.forecast('N-T', 43, 0.25);
  ok(h.stage === state.stage && h.t === state.t && h.stageT === state.stageT && h.log.length === state.logN, 'forecasting does not step the controller', `${h.stage} t ${h.t.toFixed(2)} vs ${state.stage} t ${state.t.toFixed(2)}`);
  ok(fc.length >= 4 && fc[0].head === 'red' && fc.every((r, i) => i === 0 || r.from === fc[i - 1].to), 'a cycle of N-T forecast from phase 1 is contiguous runs starting red', fc.map(r => `${r.head} ${r.from}-${r.to}`).join(', '));
  const greenRun = fc.find(r => r.head === 'green');
  ok(greenRun && Math.abs(greenRun.from - (0.5 + 12 + 4.5)) < 0.26 && Math.abs(greenRun.to - greenRun.from - 22) < 0.26, 'the next N-T green begins at 17 s (the half second of all-red, then the side street\'s 12 + 4.5) and runs 22', greenRun ? `${greenRun.from} to ${greenRun.to}` : 'none');
  // the forecast of a moved controller is the reference's, once the shift is paid
  const k = mk(0), refK = mk(16);
  run(k, 5); run(refK, 5);
  k.setOffset(16);
  run(k, 50); run(refK, 50);
  const fk = k.forecast('N-T', 43), fr = refK.forecast('N-T', 43);
  ok(JSON.stringify(fk) === JSON.stringify(fr), 'fifty seconds after the move its forecast is the reference\'s to the quarter second', `${fk.length} vs ${fr.length} runs`);
}

group('rules');

{
  const c = new Controller({ rules: [{ when: 'elapsed', seconds: 8, then: 'next' }], timing: { yellow: 1, allRed: 1, minGreen: 1 } });
  run(c, 8.05);
  ok(c.stage === 'yellow', 'an elapsed rule ends the green at its seconds');
  run(c, 2.1);
  ok(c.phase === 1 && c.stage === 'green', "and 'next' means the next phase");
}
{
  const c = new Controller({ rules: [{ when: 'queue', movement: 'E-T', threshold: 3, then: 1 }], timing: { yellow: 1, allRed: 1, minGreen: 2 } });
  let q = 0;
  run(c, 10, 0.1, () => q);
  ok(c.stage === 'green' && c.phase === 0, 'a queue rule with nobody waiting never fires');
  q = 3;
  run(c, 0.2, 0.1, () => q);
  ok(c.stage === 'yellow', 'three cars on the loop and it goes yellow');
  run(c, 2.1, 0.1, () => q);
  ok(c.phase === 1, 'to the phase the rule names');
  run(c, 10, 0.1, () => q);
  ok(c.phase === 1 && c.stage === 'green', 'and does not fire again while that movement is being served');
  const d = new Controller({ rules: [{ when: 'queue', movement: 'E-T', threshold: 1, then: 1 }] });
  run(d, 10);
  ok(d.phase === 0, 'without a sensor the queue rule sleeps');
  // a jump is an insertion: four phases, E-W lefts pulled in from N-S, and
  // 'next' after it goes to N-S lefts (the phase N-S would have led to), not
  // back around to N-S
  const j = new Controller({ lefts: true, rules: [{ when: 'queue', movement: 'E-L', threshold: 3, then: 3 }, { when: 'elapsed', seconds: 5, then: 'next' }], timing: { yellow: 1, allRed: 1, minGreen: 2 } });
  let bay = 0;
  run(j, 2.1, 0.1, () => bay);
  bay = 3;
  run(j, 2.2, 0.1, () => bay);
  ok(j.stage === 'green' && j.phase === 3, 'a full E bay during N-S pulls the E-W lefts in', `${j.stage} ${j.phase}`);
  bay = 0;
  run(j, 7.2, 0.1, () => bay);
  ok(j.stage === 'green' && j.phase === 1, "and the 'next' after it is N-S lefts, where the cycle was, not E-W", `${j.stage} ${j.phase}`);
  run(j, 7.2, 0.1, () => bay);
  ok(j.phase === 2, 'then the cycle runs on: E-W', `${j.phase}`);
  const e = new Controller({ rules: [{ when: 'queue', movement: 'E-T', threshold: 1, after: 16, then: 1 }], timing: { yellow: 1, allRed: 1, minGreen: 2 } });
  run(e, 15, 0.1, () => 5);
  ok(e.stage === 'green' && e.phase === 0, "a queue rule with `after: 16` does not cut a green short of 16 s, whatever the loop reads", `${e.stage} at ${e.t.toFixed(1)} s`);
  run(e, 1.2, 0.1, () => 5);
  ok(e.stage === 'yellow' && e.next === 1, 'and fires at 16', `${e.stage} next ${e.next}`);
}

group('holding a green against its rule (M7)');

{
  const c = new Controller({ rules: [{ when: 'elapsed', seconds: 8, then: 'next' }], timing: { yellow: 1, allRed: 1, minGreen: 1 } });
  run(c, 5);
  ok(c.holdGreen() === true && Math.abs(c.heldT - 5) < 1e-9 && c.stage === 'green' && Math.abs(c.stageT - 5) < 1e-9, 'holdGreen at 5 s takes and leaves the stage clock alone', `heldT ${c.heldT}, stageT ${c.stageT}`);
  ok(Math.abs(c.timeToYellow('N-T') - 8) < 1e-9, 'and the green now has 8 s left again, not 3', c.timeToYellow('N-T').toFixed(2));
  run(c, 5.05);
  ok(c.stage === 'green', 'so at 10 s it is still green, where the rule alone would have ended it at 8');
  run(c, 3.1);
  ok(c.stage === 'yellow', 'and goes yellow at 13', `${c.stage} at ${c.t.toFixed(1)} s`);
  run(c, 2.1);
  ok(c.phase === 1 && c.stage === 'green' && c.heldT === 0, 'the next green starts with nothing held', `heldT ${c.heldT}`);
  run(c, 8.05);
  ok(c.stage === 'yellow', 'and ends at its 8 s again');
  ok(c.log.some(l => l.kind === 'hold'), 'the log carries the hold');
  const t = new Controller({ mode: 'timed', plan: [{ phase: 0, green: 10 }, { phase: 1, green: 10 }] });
  run(t, 2);
  ok(t.holdGreen() === false, 'a timed plan cannot be held: its offsets are the point');
  const n = new Controller({ rules: [{ when: 'elapsed', seconds: 8, then: 'next' }], timing: { yellow: 1, allRed: 1, minGreen: 4 } });
  run(n, 2);
  n.requestPhase(1);
  ok(n.holdGreen() === false, 'nor a green with a request queued');
  const q = new Controller({ rules: [{ when: 'queue', movement: 'E-T', threshold: 3, then: 1 }] });
  run(q, 2);
  ok(q.holdGreen() === false, 'nor one with no elapsed rule to hold against');
}

group('flashing and dark');

{
  const c = new Controller();
  c.setFlash('red');
  ok(c.head('N-T') === 'flash-red' && c.head('E-L') === 'flash-red', 'four-way flash red');
  run(c, 30);
  ok(c.stage === 'flash', 'and it stays until told otherwise');
  c.setFlash({ major: ['N', 'S'] });
  ok(c.head('N-T') === 'flash-yellow' && c.head('E-T') === 'flash-red', 'major legs flash yellow, minor red');
  c.setDark();
  ok(c.head('N-T') === 'dark', 'a power outage is dark');
  c.requestPhase(1);
  ok(c.stage === 'allred', 'coming back from dark passes through all-red');
  run(c, 1.1);
  ok(c.stage === 'green' && c.phase === 1, 'and lands on the requested phase');
}

group('priority preemption');

{
  const c = new Controller({ timing: { yellow: 2, allRed: 1, minGreen: 1 } });
  run(c, 2);
  c.preempt(['E-T', 'E-R'], 6);
  ok(c.stage === 'yellow', 'a corridor request for the cross street ends the green');
  run(c, 3.1);
  ok(c.stage === 'green' && c.head('E-T') === 'green' && c.head('W-T') === 'red', 'then only the corridor is green', `${c.head('E-T')} ${c.head('W-T')}`);
  ok(Math.abs(c.timeToYellow('E-T') - (6 - c.stageT)) < 1e-9, 'timeToYellow reads the hold');
  run(c, 6);
  ok(c.stage === 'yellow' || c.stage === 'allred', 'the hold ends');
  run(c, 3.1);
  ok(c.stage === 'green' && c.phase === 0 && c.preemption === null, 'and the old phase resumes', `${c.stage} ${c.phase}`);
  let threw = null;
  try { c.preempt(['N-T', 'E-T']); } catch (e) { threw = e.message; }
  ok(threw && /conflicts/.test(threw), 'a conflicting corridor is refused', threw);
}
{
  const c = new Controller({ timing: { yellow: 2, allRed: 1, minGreen: 1 } });
  run(c, 2);
  c.preempt(['N-T'], 4);
  ok(c.stage === 'green' && c.head('N-T') === 'green', 'a corridor already green stays green with no clearance');
  ok(c.head('S-T') === 'red', 'and the rest of that phase drops to red');
}

group('the cause of a change (UI pass): read-only, for the page');

{
  const RULES = [{ when: 'elapsed', seconds: 30, then: 'next' }, { when: 'queue', movement: 'E-T', threshold: 3, after: 6, then: 1 }];
  const c = new Controller({ rules: RULES, timing: { yellow: 1, allRed: 1, minGreen: 4 } });
  ok(c.cause.by === 'start', 'a new controller names the level\'s start', JSON.stringify(c.cause));
  run(c, 7, 0.1, m => (m === 'E-T' ? 5 : 0));
  ok(c.cause.by === 'rule' && c.cause.rule === 1 && c.cause.text === 'rule 2: E-T had 5 queued', 'a queue rule firing names itself by its place in the list and what it read', JSON.stringify(c.cause));
  ok(c.log.filter(l => l.kind === 'yellow').slice(-1)[0].by === 'rule' && c.log.slice(-1)[0].by === 'rule', 'and the yellow it began and the all-red after are logged with that cause', c.log.slice(-2).map(l => `${l.kind}:${l.by}`).join(' '));
  run(c, 2.1);
  ok(c.log.slice(-1)[0].kind === 'green' && c.log.slice(-1)[0].by === 'rule', 'so is the green it brought');
  run(c, 30.1);
  ok(c.cause.by === 'rule' && c.cause.rule === 0 && c.cause.text === 'rule 1: 30 s of E-W', 'the elapsed rule names the green it ended', JSON.stringify(c.cause));
  run(c, 6);
  ok(c.requestPhase(1) === true && c.cause.by === 'player', 'a phase asked for is the player\'s', JSON.stringify(c.cause));
  run(c, 6);
  ok(c.holdGreen() === true && c.cause.by === 'player' && c.cause.hold === true, 'and so is a held green');
  c.preempt(['N-T', 'N-L', 'N-R'], 5);
  ok(c.cause.by === 'corridor' && !c.cause.back, 'the priority corridor names itself');
  run(c, 8);
  ok(c.cause.by === 'corridor' && c.cause.back === true, 'and names itself again for the change back', JSON.stringify(c.cause));
  c.setFlash('red');
  ok(c.cause.by === 'flash', 'flash mode names itself');
  c.setDark();
  ok(c.cause.by === 'outage', 'the dark names the outage');
  c.requestPhase(0, 'outage');
  ok(c.cause.by === 'outage' && c.cause.back === true, 'and the world\'s return from it passes the outage on');
  const t = new Controller({ mode: 'timed', plan: [{ phase: 0, green: 10 }, { phase: 1, green: 10 }], timing: { yellow: 1, allRed: 1, minGreen: 4 } });
  run(t, 10.05);
  ok(t.cause.by === 'plan', 'a timed plan\'s change is the plan\'s', JSON.stringify(t.cause));
  t.setOffset(6);
  run(t, 12);
  ok(t.cause.by === 'offset' && t.log.some(l => l.kind === 'yellow' && l.by === 'offset'), 'and while an offset is being paid its changes are the offset\'s', JSON.stringify(t.cause));
  // read-only: the same controller with the cause never written runs the
  // same 300 s, change for change, through everything that writes one: a
  // four-phase set, an elapsed rule, a queue rule that jumps the sequence
  // (so `resumeAt` matters), a hand every 37 s, a held green, a corridor
  const R4 = [{ when: 'elapsed', seconds: 14, then: 'next' }, { when: 'queue', movement: 'E-L', threshold: 2, after: 5, then: 3 }];
  const a = new Controller({ lefts: true, rules: R4, timing: { yellow: 3, allRed: 1.5, minGreen: 4 } });
  const b = new Controller({ lefts: true, rules: R4, timing: { yellow: 3, allRed: 1.5, minGreen: 4 } });
  b._setCause = () => {};
  for (const x of [a, b]) {
    const sense = m => (m === 'E-L' && Math.floor(x.t / 17) % 2 ? 3 : 0);
    for (let i = 0; i < 3000; i++) {
      if (i % 370 === 100) x.requestPhase((i / 370 | 0) % 4);
      if (i % 370 === 200) x.holdGreen();
      if (i === 1500) x.preempt(['W-T', 'W-L', 'W-R'], 8);
      x.step(0.1, sense);
    }
  }
  const trace = x => x.log.map(l => `${l.kind}${l.detail}@${l.t}`).join(' ');
  ok(trace(a) === trace(b) && a.log.length > 40 && a.log.some(l => l.by === 'rule') && a.log.some(l => l.kind === 'hold') && b.cause.by === 'start', 'writing the cause changes nothing the controller does', `${a.log.length} transitions each`);
}

group('determinism');

{
  const mk = () => new Controller({ mode: 'timed', plan: [{ phase: 0, green: 7 }, { phase: 1, green: 5 }], rules: [] });
  const a = mk(), b = mk();
  const trace = c => { const out = []; for (let i = 0; i < 600; i++) { c.step(1 / 60); out.push(c.stage[0] + c.phase); } return out.join(''); };
  ok(trace(a) === trace(b), 'two controllers stepped identically produce identical traces');
  ok(JSON.stringify(a.snapshot()) === JSON.stringify(b.snapshot()), 'and identical snapshots');
}


group('bought phases (M8): appended, and never reached by next');

{
  const four = standardPhases(LEGS);
  const arrows = extraPhases(LEGS, ['lefts'], four);
  ok(arrows.length === 2 && arrows[0].movements.join() === 'N-L,S-L' && arrows[1].movements.join() === 'E-L,W-L' && arrows.every(p => p.extra === 'lefts' && !p.permissive.length),
    'protected turns on a two-phase 4-way are two arrow phases, N-S and E-W, protected', arrows.map(p => `${p.name}: ${p.movements}`).join(' | '));
  ok(extraPhases(LEGS, ['lefts'], standardPhases(LEGS, { lefts: true })).length === 0, 'and none on a board whose lefts already run protected');
  const split = extraPhases(LEGS, ['split'], four);
  ok(split.length === 4 && split.every(p => p.movements.length === 3 && phaseIsValid(p.movements, p.permissive).ok && p.extra === 'split'),
    'extra phases are one phase per leg, all three movements, valid with the left protected', split.map(p => p.name).join(', '));
  const t = extraPhases(['N', 'E', 'S'], ['lefts', 'split'], standardPhases(['N', 'E', 'S']));
  ok(t.map(p => p.name).join() === 'N-S arrows,N alone,S alone' && t[0].movements.join() === 'N-L',
    'on the Stem the arrows are N-L alone (the stem\'s left is already protected) and E alone is left out, being the stem phase over again', t.map(p => `${p.name}: ${p.movements}`).join(' | '));

  const c = new Controller({ extra: ['lefts', 'split'], timing: { yellow: 3, allRed: 1, minGreen: 4 }, rules: [{ when: 'elapsed', seconds: 10, then: 'next' }] });
  ok(c.phases.length === 8 && c.cycle === 2 && c.phases.slice(0, 2).every(p => !p.extra) && c.phases.slice(2).every(p => p.extra),
    'a controller with both bought has its own two phases first and six bought after', `${c.phases.length} phases, cycle ${c.cycle}`);
  const seen = new Set();
  for (let i = 0; i < 1200; i++) { c.step(0.1); if (c.stage === 'green') seen.add(c.phase); }
  ok([...seen].sort().join() === '0,1', 'a 10 s next rule runs 120 s on phases 0 and 1 and never a bought one', [...seen].join());
  // from phase 1, press the N-S arrows; then a next rule goes on to phase 0.
  // Started on 1 so that the answer is not also (2 + 1) % 2 (#147)
  const a = new Controller({ extra: ['lefts'], startPhase: 1, timing: { yellow: 3, allRed: 1, minGreen: 4 } });
  a.requestPhase(2); run(a, 4 + 3 + 1 + 0.05);
  ok(a.phase === 2 && a.stage === 'green' && a.head('N-L') === 'green-arrow' && a.head('N-T') === 'red',
    'a press reaches the arrows: N-L on a green arrow, N-T red', `phase ${a.phase} ${a.stage} N-L ${a.head('N-L')}`);
  const base0 = a.lastBase;
  a.setRules([{ when: 'elapsed', seconds: 5, then: 'next' }]); run(a, 5 + 3 + 1 + 0.05);
  ok(base0 === 1 && a.phase === 0 && a.stage === 'green',
    'and a next rule goes on to phase 0, after phase 1, the last of the level\'s own to run, not to phase 3', `lastBase ${base0}, now ${a.phase}`);
  // lastBase follows the level's own greens: started on 0, sent to 1, then the arrows
  const b = new Controller({ extra: ['lefts'], timing: { yellow: 3, allRed: 1, minGreen: 4 } });
  b.requestPhase(1); run(b, 4 + 3 + 1 + 0.05);
  b.requestPhase(3); run(b, 4 + 3 + 1 + 0.05);
  const bBase = b.lastBase;
  b.requestNext(); run(b, 4 + 3 + 1 + 0.05);
  ok(bBase === 1 && b.phase === 0, 'a phase of the level\'s own that goes green becomes the one next goes on from: 1, so the arrows hand back to 0', `lastBase ${bBase}, then ${b.phase}`);
  // a rule may name a bought phase, and requestNext from one goes the same way
  const r = new Controller({ extra: ['split'], rules: [{ when: 'elapsed', seconds: 6, then: 5 }] });
  run(r, 6 + 3 + 1 + 0.05);
  ok(r.phase === 5 && r.current.name === 'W alone', 'a rule that names a bought phase by index runs it', r.current.name);
  r.setRules([]); r.requestNext(); run(r, 4 + 3 + 1 + 0.05);
  ok(r.phase === 1, 'and requestNext from it goes to phase 1, after phase 0, the last own phase to run (not (5 + 1) % 2)', String(r.phase));
  // a queue rule's jump to a bought phase remembers the own phase next was due
  const q = new Controller({ extra: ['lefts'], rules: [{ when: 'queue', movement: 'E-L', threshold: 2, then: 3 }, { when: 'elapsed', seconds: 8, then: 'next' }] });
  run(q, 5, 0.1, m => (m === 'E-L' ? 3 : 0));
  run(q, 3 + 1 + 0.05);
  const jumped = q.phase;
  run(q, 8 + 3 + 1 + 0.05);
  ok(jumped === 3 && q.phase === 1, 'a queue rule\'s jump to the E-W arrows comes back to phase 1, the one next was due', `jumped to ${jumped}, then ${q.phase}`);
  let threw = false;
  try { new Controller({ phases: [{ name: 'x', movements: ['N-T'], extra: 'lefts' }, { name: 'y', movements: ['E-T'] }] }); } catch { threw = true; }
  ok(threw, 'a bought phase ahead of a level\'s own is refused');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
