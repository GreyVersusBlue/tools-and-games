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
  phaseIsValid, standardPhases, Controller } = S;

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

group('determinism');

{
  const mk = () => new Controller({ mode: 'timed', plan: [{ phase: 0, green: 7 }, { phase: 1, green: 5 }], rules: [] });
  const a = mk(), b = mk();
  const trace = c => { const out = []; for (let i = 0; i < 600; i++) { c.step(1 / 60); out.push(c.stage[0] + c.phase); } return out.join(''); };
  ok(trace(a) === trace(b), 'two controllers stepped identically produce identical traces');
  ok(JSON.stringify(a.snapshot()) === JSON.stringify(b.snapshot()), 'and identical snapshots');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
