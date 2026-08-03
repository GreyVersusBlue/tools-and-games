// grade-math.test.mjs — hand-worked cases for the Carroll County final grade.
//
//   node Tools/final-grade-checker/grade-math.test.mjs
//
// Exits 1 on any failure (locked decision #13). Every case here was watched
// failing against a deliberately broken calculation before it was kept
// (locked decision #34) — see BREAKAGE LOG at the bottom.
//
// No real student appears in this file. Every name is invented.

import {
  getLetter, getQP, qpToFinalLetter, calcFinals, toScore,
  parseGradeToken, splitRow, parsePastedData, findQuarterWindow, isGradeCell,
} from './grade-math.mjs';

let passed = 0, failed = 0;
const fails = [];

function eq(actual, expected, what) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; return; }
  failed++; fails.push(`${what}\n       expected ${e}\n       got      ${a}`);
}
function group(name) { console.log(`\n${name}`); }

// ── Rule 3: the ten-point scale ──────────────────────────────
group('Rule 3 — ten-point scale');
eq(getLetter(100), 'A', '100 is an A');
eq(getLetter(90),  'A', '90 is an A');
eq(getLetter(89),  'B', '89 is a B');
eq(getLetter(80),  'B', '80 is a B');
eq(getLetter(79),  'C', '79 is a C');
eq(getLetter(70),  'C', '70 is a C');
eq(getLetter(69),  'D', '69 is a D');
eq(getLetter(60),  'D', '60 is a D');
eq(getLetter(59),  'F', '59 is an F');
eq(getLetter(0),   'F', '0 is an F');

// ── Rule 4: round up at exactly .5, and not before ───────────
group('Rule 4 — .5 rounds up, .49 does not');
eq(getLetter(89.5),  'A', '89.5 rounds up to an A');
eq(getLetter(79.5),  'B', '79.5 rounds up to a B');
eq(getLetter(69.5),  'C', '69.5 rounds up to a C');
eq(getLetter(59.5),  'D', '59.5 rounds up to a D — the pass/fail line');
eq(getLetter(89.51), 'A', '89.51 is an A');
eq(getLetter(89.49), 'B', '89.49 is a B');
eq(getLetter(89.45), 'B', '89.45 is a B, not an A (old code said A)');
eq(getLetter(79.45), 'C', '79.45 is a C, not a B (old code said B)');
eq(getLetter(69.45), 'D', '69.45 is a D, not a C (old code said C)');
eq(getLetter(59.45), 'F', '59.45 is an F, not a D (old code passed a failing student)');
eq(getLetter(59.499), 'F', '59.499 is still an F');

// The floating-point half of rule 4. Each of these has an exact mean of 89.5
// but evaluates to 89.49999999999999 in IEEE 754. A bare `>= 89.5` marks them
// all a B and costs a letter grade.
group('Rule 4 — a computed .5 that floating point puts just below');
const fpBoundary = [
  [58.80, 99.99, 99.25, 99.96],
  [59.43, 99.99, 99.25, 99.33],
  [60.18, 99.99, 99.25, 98.58],
];
for (const s of fpBoundary) {
  const raw = (s[0] + s[1] + s[2] + s[3]) / 4;
  eq(raw < 89.5, true, `${JSON.stringify(s)} really does land below 89.5 in floating point (${raw})`);
  eq(getLetter(raw), 'A', `${JSON.stringify(s)} mean is an A despite the float error`);
  eq(calcFinals(s).pctFinal, 'A', `${JSON.stringify(s)} percentage method is an A`);
}

// ── Rule 1 + 2: two figures, the higher one reported ─────────
group('Rule 1 — both figures get computed');
{
  const f = calcFinals([90, 90, 60, 60]);
  eq(f.avgQP, 2.5, 'quality points average is 2.5 (A,A,D,D = 4+4+1+1 / 4)');
  eq(f.pctAvg, 75, 'percentage average is 75');
  eq(f.qpFinal, 'C', 'quality points gives a C (2.50 does not round up to B)');
  eq(f.pctFinal, 'C', 'percentage gives a C');
}

group('Rule 2 — the HIGHER of the two is reported');
// Worked by hand:
//   Q1 90 A=4   Q2 90 A=4   Q3 90 A=4   Q4 10 F=0
//   quality points 12/4 = 3.00 -> B (a full 3, earned outright)
//   percentage    280/4 = 70.00 -> C
//   B beats C, so the student gets a B.
// This is the case that separates a correct tool from one that always reports
// the percentage average. (An earlier version of this example used A,A,C,D,
// which averages to exactly 2.75 QP — under the corrected whole-point rule
// that is short of a full 3 and lands on C, the same letter the percentage
// side gives, so it stopped demonstrating a QP win. See "Quality points must
// earn the full point" below for why 2.75 isn't a B.)
eq(calcFinals([90, 90, 90, 10]).qpFinal,  'B', 'quality points gives a B (a full 3.00 earned)');
eq(calcFinals([90, 90, 90, 10]).pctFinal, 'C', 'percentage gives a C');
eq(calcFinals([90, 90, 90, 10]).winner, 'QP', 'quality points wins when it is higher');
eq(calcFinals([90, 90, 90, 10]).finalLetter, 'B', 'and the B is what gets reported');

//   Q1 79 C=2   Q2 79 C=2   Q3 100 A=4   Q4 100 A=4
//   quality points 12/4 = 3.00 -> B
//   percentage    358/4 = 89.50 -> A   (and note the .5)
//   A beats B, so the student gets an A.
eq(calcFinals([79, 79, 100, 100]).qpFinal,  'B',   'quality points gives a B');
eq(calcFinals([79, 79, 100, 100]).pctAvg,   89.5,  'percentage average is exactly 89.5');
eq(calcFinals([79, 79, 100, 100]).pctFinal, 'A',   'percentage gives an A');
eq(calcFinals([79, 79, 100, 100]).winner,   'PCT', 'percentage wins when it is higher');
eq(calcFinals([79, 79, 100, 100]).finalLetter, 'A', 'and the A is what gets reported');

//   A tie: 85 four times. Both methods give a B. Either winner is the same letter.
eq(calcFinals([85, 85, 85, 85]).finalLetter, 'B', 'a tie reports the shared letter');

//   Quality points wins near the pass/fail line.
//   Q1 70 C=2  Q2 70 C=2  Q3 70 C=2  Q4 20 F=0
//   quality points 6/4 = 1.50 -> D
//   percentage   230/4 = 57.50 -> F
// (An earlier version of this example used three C's and a D, which
// averages to exactly 1.75 QP — under the corrected whole-point rule that is
// short of a full 2 and lands on D, the same letter the percentage side gives
// there, so it stopped demonstrating a QP win. See "Quality points must earn
// the full point" below for why 1.75 isn't a C.)
eq(calcFinals([70, 70, 70, 20]).qpFinal,     'D', 'quality points gives a D (1.50, at least a full 1)');
eq(calcFinals([70, 70, 70, 20]).pctFinal,    'F', 'percentage fails outright');
eq(calcFinals([70, 70, 70, 20]).finalLetter, 'D', 'the higher, D, is reported, the student passes');

//   A failing final either way.
eq(calcFinals([50, 55, 40, 58]).qpFinal,     'F', 'four Fs give an F by quality points');
eq(calcFinals([50, 55, 40, 58]).pctFinal,    'F', 'and an F by percentage');
eq(calcFinals([50, 55, 40, 58]).finalLetter, 'F', 'reported F');

//   One quarter carries a student over the line by quality points only —
//   and the margin is exact, not approximate, under the corrected rule.
//   Q1 70 C=2  Q2 60 D=1  Q3 60 D=1  Q4 30 F=0
//   quality points 3/4 = 0.75 -> old (wrong) code said D; the real rule needs
//   a FULL 1.00 to reach D, and 0.75 is short of it.
// This is the case round 1 and round 2 both had wrong: swap the C's raw score
// down to a plain D (making it four D/D/D/F instead of C/D/D/F) and see what
// actually clears the line.
eq(calcFinals([60, 60, 60, 30]).qpFinal,     'F', 'three Ds and an F average to exactly 0.75 QP, short of the full point');
eq(calcFinals([60, 60, 60, 30]).pctFinal,    'F', 'and the percentage average (52.50) also fails');
eq(calcFinals([60, 60, 60, 30]).finalLetter, 'F', 'so this student fails by both methods');
//   Now give one quarter a full extra point (a C instead of a fourth D):
//   quality points 4/4 = 1.00 -> D, a full point earned, exactly on the line.
eq(calcFinals([70, 60, 60, 30]).qpFinal,     'D', 'swap one D for a C and quality points reaches exactly 1.00 -> D');
eq(calcFinals([70, 60, 60, 30]).pctFinal,    'F', 'the percentage average (55.00) still fails');
eq(calcFinals([70, 60, 60, 30]).finalLetter, 'D', 'quality points passes this student, percentage alone would not');
//   How low the failing quarter is doesn't matter to quality points — F is F.
eq(calcFinals([70, 60, 60, 10]).qpFinal,     'D', 'an even worse F (10 instead of 30) does not change the QP outcome');
eq(calcFinals([70, 60, 60, 10]).finalLetter, 'D', 'quality points floors any F to 0 regardless of magnitude');

// ── Quality-point thresholds ─────────────────────────────────
group('Quality points — every reachable average');
eq(getQP('A'), 4, 'A is 4 points'); eq(getQP('B'), 3, 'B is 3 points');
eq(getQP('C'), 2, 'C is 2 points'); eq(getQP('D'), 1, 'D is 1 point');
eq(getQP('F'), 0, 'F is 0 points'); eq(getQP('Z'), null, 'nothing else is a letter');
// Averages of four integers 0-4 are multiples of 0.25 and exact in floating
// point, so this table is the complete set of inputs the method can produce.
// The rule is "earn the full point": a letter's cutoff is the whole number
// itself (4, 3, 2, 1), not a .5 below it, so anything short of a whole number
// falls to the next letter down. Confirmed directly by Devon: "4-a, 3-b,
// 2-c, 1-d, 0-f."
const qpTable = [
  [4.00,'A'],[3.75,'B'],[3.50,'B'],[3.25,'B'],[3.00,'B'],[2.75,'C'],[2.50,'C'],
  [2.25,'C'],[2.00,'C'],[1.75,'D'],[1.50,'D'],[1.25,'D'],[1.00,'D'],[0.75,'F'],
  [0.50,'F'],[0.25,'F'],[0.00,'F'],
];
for (const [avg, letter] of qpTable) eq(qpToFinalLetter(avg), letter, `quality-point average ${avg.toFixed(2)} is a ${letter}`);

// ── Rule 4, the quality-point half: .5 does NOT round up ─────
group('Quality points — .5 does not round up, unlike the percentage average');
eq(qpToFinalLetter(3.50), 'B', 'exactly 3.50 stays a B, not an A');
eq(qpToFinalLetter(2.50), 'C', 'exactly 2.50 stays a C, not a B');
eq(qpToFinalLetter(1.50), 'D', 'exactly 1.50 stays a D, not a C');
eq(qpToFinalLetter(0.50), 'F', 'exactly 0.50 stays an F, not a D — the pass/fail line');
// A real four-quarter set that lands exactly on the boundary: two A quarters
// and two D quarters average to exactly 2.50 quality points.
eq(calcFinals([90, 90, 60, 60]).avgQP,      2.5, 'A,A,D,D averages to exactly 2.50 QP');
eq(calcFinals([90, 90, 60, 60]).qpFinal,    'C', 'and that stays a C, not a B, under the real rule');
eq(calcFinals([90, 90, 60, 60]).pctFinal,   'C', 'the percentage average (75.00) also gives a C here');
eq(calcFinals([90, 90, 60, 60]).finalLetter,'C', 'so this particular set is a genuine tie, not a QP rescue');

// ── The deeper fix: quality points must earn the FULL point ──
group('Quality points must earn the full point, not just clear a midpoint');
// Confirmed directly by Devon, asked as a follow-up after the .5-rounding
// fix above: the QP cutoffs are not "3.5, 2.5, 1.5, 0.5" at all. They are the
// whole numbers 4, 3, 2, 1. A round-2 fix made the .5 boundary asymmetric
// with the percentage side (correct, and unaffected by this fix — see the
// group above) but kept the midpoints themselves as the thresholds, which
// meant almost every fractional average that wasn't sitting exactly on a .5
// was still landing one full letter too high.
eq(qpToFinalLetter(4.00), 'A', 'only an exact 4.00 is an A — nothing else clears the full point');
eq(qpToFinalLetter(3.99), 'B', '3.99 is a hundredth short of a full 4 and stays a B, not close to an A');
eq(qpToFinalLetter(3.75), 'B', '3.75 is a B now; earlier (wrong) code called this an A');
eq(qpToFinalLetter(2.75), 'C', '2.75 is a C now; earlier (wrong) code called this a B');
eq(qpToFinalLetter(1.75), 'D', '1.75 is a D now; earlier (wrong) code called this a C');
eq(qpToFinalLetter(0.75), 'F', '0.75 is an F now; earlier (wrong) code called this a D and passed the student');

// ── Missing and exempt quarters ──────────────────────────────
group('Missing or exempt quarters');
eq(calcFinals([90, 90, 90, null]), null, 'three quarters gives no final grade');
eq(calcFinals([90, 90, null, null]), null, 'two quarters gives no final grade');
eq(calcFinals([null, null, null, null]), null, 'no quarters gives no final grade');
eq(calcFinals([90, 90, 90, '']), null, 'an empty string is a missing quarter');
eq(calcFinals([90, 90, 90, 'exempt']), null, 'an unreadable quarter is a missing quarter');
eq(calcFinals([90, 90, 90, 90]).finalLetter, 'A', 'four quarters gives a final grade');
// Three high quarters must not average to a final grade on their own.
eq(calcFinals([100, 100, 100, null]), null, 'three 100s still gives no final grade');

// ── Out-of-range input never reaches the arithmetic ──────────
group('Out-of-range input');
eq(toScore(101), null, '101 is not a percentage');
eq(toScore(-1), null, 'a negative is not a percentage');
eq(toScore('abc'), null, 'text is not a percentage');
eq(toScore(100), 100, '100 is fine');
eq(toScore(0), 0, '0 is fine');
eq(getLetter(950), null, 'a stray 950 gets no letter');
eq(calcFinals([950, 96, 97, 98]), null, 'and it does not become a fourth quarter');
eq(parseGradeToken('A(950.00)'), null, 'a 950 in a paste is rejected');

// ── Paste import ─────────────────────────────────────────────
group('Paste import — token parsing');
eq(parseGradeToken('C(73.28)'), 73.28, 'C(73.28) reads as 73.28');
eq(parseGradeToken('A(100.00)'), 100, 'A(100.00) reads as 100');
eq(parseGradeToken('84'), 84, 'a bare number reads as itself');
eq(parseGradeToken(''), null, 'an empty cell is missing');
eq(parseGradeToken('   '), null, 'a whitespace cell is missing');
eq(parseGradeToken(undefined), null, 'an absent cell is missing');
eq(isGradeCell('B(84.00)'), true, 'B(84.00) is a grade cell');
eq(isGradeCell('88.25'), false, 'the system average column is not a grade cell');
eq(isGradeCell('7'), false, 'the grade-level column is not a grade cell');

group('Paste import — empty cells keep their column');
// THE HEADLINE CASE. Bartholomew has no Q1. Tab-separated, so the empty cell
// is really there. The old parser filtered empty columns out, which shifted
// Q2 into Q1, Q3 into Q2, Q4 into Q3, and the system-average column into Q4 —
// then reported a confident A for a student with three quarters on file.
{
  const paste =
    '123456\tAmelia Fakename\tSS7-3\t7\tB(85.00)\tB(84.00)\tA(91.00)\tA(93.00)\t88.25\n' +
    '123457\tBartholomew Notreal\tSS7-3\t7\t\tB(84.00)\tA(91.00)\tA(93.00)\t89.33';
  const { students, warnings } = parsePastedData(paste);
  eq(students.length, 2, 'both rows import');
  eq(students[0].scores, [85, 84, 91, 93], 'Amelia keeps her four quarters');
  eq(students[1].scores, [null, 84, 91, 93], 'Bartholomew keeps his empty Q1');
  eq(calcFinals(students[1].scores), null, 'and gets no final grade');
  eq(warnings.some(w => /Bartholomew/.test(w) && /1 quarter\(s\) missing/.test(w)), true,
     'and the missing quarter is warned about');
  eq(students[1].scores.includes(89.33), false,
     'the system-average column never becomes a quarter grade');
}

group('Paste import — column guards');
{
  // Six columns passed the old `< 6` guard and then read undefined for Q3/Q4.
  const { students, warnings } = parsePastedData('123458\tCordelia Madeup\tSS7-3\t7\tA(95.00)\tA(96.00)');
  eq(students.length, 0, 'a six-column row is skipped, not half-read');
  eq(/6 column\(s\), need at least 8/.test(warnings[0]), true, 'and says why');
}
{
  // An extra leading column shifts everything. The grade cells are still
  // findable, so the parser moves the window and says so.
  const { students, warnings } = parsePastedData('X\t123459\tDesmond Invented\tSS7-3\t7\tB(85.00)\tB(84.00)\tA(91.00)\tA(93.00)\t88.25');
  eq(students[0].scores, [85, 84, 91, 93], 'the quarters are still found');
  eq(warnings.some(w => /position 6, not 5/.test(w)), true, 'and the shift is reported');
}
{
  // A cell with something unreadable in it gets named, not silently dropped.
  const { warnings } = parsePastedData('1\tEudora Pretend\tSS7-3\t7\tB(85.00)\tEX\tA(91.00)\tA(93.00)\t88.25');
  eq(warnings.some(w => /Q2 reads "EX"/.test(w)), true, 'an "EX" quarter is named in a warning');
}
{
  const { students, warnings } = parsePastedData('1\tFitzwilliam Sham\tSS7-3\t7\t\t\t\t\t');
  eq(students.length, 0, 'a row with no grades at all is skipped');
  eq(warnings.some(w => /no grade data/.test(w)), true, 'and says so');
}
eq(parsePastedData('').students.length, 0, 'an empty paste imports nothing');
eq(parsePastedData('\n\n  \n').students.length, 0, 'a whitespace paste imports nothing');

group('Paste import — row splitting');
eq(splitRow('a\tb\t\td'), ['a','b','','d'], 'tabs keep empty cells');
eq(splitRow('a\tb\tc\td\r'), ['a','b','c','d'], 'a trailing carriage return is stripped');
eq(splitRow('a  b   c'), ['a','b','c'], 'fixed-width text splits on runs of spaces');
eq(findQuarterWindow(['1','n','s','7','B(85.00)','B(84.00)','A(91.00)','A(93.00)','88.25']).start, 4,
   'the documented layout is used as-is');

// ── End-to-end: a paste, through the arithmetic, to a letter ─
group('End to end — a pasted class');
{
  const paste = [
    '100001\tGwendolyn Placeholder\tSS7-1\t7\tA(95.00)\tA(92.00)\tB(88.00)\tA(94.00)\t92.25',
    '100002\tHoratio Notarealboy\tSS7-1\t7\tA(90.00)\tA(90.00)\tD(60.00)\tD(60.00)\t75.00',
    '100003\tIsolde Madeupname\tSS7-1\t7\tC(79.00)\tC(79.00)\tA(100.00)\tA(100.00)\t89.50',
    '100004\tJasper Fictional\tSS7-1\t7\tB(85.00)\t\tB(86.00)\tB(87.00)\t86.00',
  ].join('\n');
  const { students } = parsePastedData(paste);
  const result = students.map(s => {
    const f = calcFinals(s.scores);
    return [s.name, f ? f.finalLetter : 'no final', f ? f.winner : '-'];
  });
  eq(result, [
    ['Gwendolyn Placeholder', 'A', 'PCT'],  // 4+4+3+4 = 3.75 -> B (short of a full 4) ; 92.25 -> A ; PCT wins
    ['Horatio Notarealboy',   'C', 'QP'],   // 4+4+1+1 = 2.50 -> C (does not round up) ; 75.00 -> C ; tie, QP
    ['Isolde Madeupname',     'A', 'PCT'],  // 2+2+4+4 = 3.00 -> B ; 89.50 -> A ; PCT wins
    ['Jasper Fictional',      'no final', '-'], // missing Q2
  ], 'four students, four correct outcomes');
  // Gwendolyn is the case that changed: her quality-point average (3.75) used
  // to be miscalled an A by the old midpoint cutoff (>3.5), which happened to
  // match her percentage average (92.25 -> A) and look like a tie won by QP.
  // Under the corrected whole-point rule 3.75 is a B, so it is her percentage
  // average, not quality points, that actually earns the A — same final
  // letter on this student's report card, but the wrong method was getting
  // credit for it.
}

// ── Report ───────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
if (failed) {
  console.log(`${failed} FAILED, ${passed} passed\n`);
  for (const f of fails) console.log(`  FAIL ${f}\n`);
  process.exit(1);
}
console.log(`${passed} passed, 0 failed`);

// ── BREAKAGE LOG (locked decision #34) ───────────────────────
//
// Each of these was applied to grade-math.mjs, the suite run, the failures
// counted, then reverted. A case nobody has watched fail is a case that might
// not be able to fail.
//
//   1. winner = 'PCT' always                     -> 5 failed
//   2. `>= 89.5` on the raw value, no normalise  -> 6 failed  (the float cases)
//   3. Math.round(n*10) thresholds, i.e. the old -> 6 failed  (the x.45 band)
//      code restored
//   4. calcFinals divides by valid.length, so a  -> 8 failed
//      three-quarter student gets a final
//   5. splitRow filters empty cells, i.e. the    -> 7 failed  (the headline case)
//      old parser restored
//   6. MIN_COLUMNS back to 6                     -> 2 failed
//   7. range check removed from toScore          -> 5 failed
//   8. quarter window pinned to column 4         -> 2 failed
//
// All eight exited 1. The script that does this lives outside the repo; it
// patches, runs, records and restores byte-for-byte.
