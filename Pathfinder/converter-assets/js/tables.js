// tables.js: the benchmark tables the PF1e -> PF2e monster converter measures
// against, and the helpers that turn a stat into a tier and a tier back into
// a stat.
//
// The approach is relative benchmarking. A PF1e stat is placed on a
// continuous tier ladder (terrible 0, low 1, moderate 2, high 3, extreme 4)
// by comparing it with PF1e's expected value for its CR; the PF2e stat is the
// value at that same tier for the converted creature's level. See pf1TierOf
// for how each PF1e stat is pinned to the ladder and why.
//
// Plain ES module, no dependencies, same file in the browser and in Node.

// ---------------------------------------------------------------------------
// PF1e: Monster Statistics by CR
// ---------------------------------------------------------------------------
// Source: https://aonprd.com/Rules.aspx?Name=Step%202:%20Target%20Statistics&Category=Monster%20Creation
//   (Pathfinder RPG Bestiary pg. 291, Table 1-1: Monster Statistics by CR),
//   fetched 2026-09-29. Rows 1/2 and 1 to 20 are the printed table.
//
// avgDamageHigh/avgDamageLow are the table's "average damage": the total of a
// full attack if every attack hits, not the damage of one attack.
//
// The table stops at CR 1/2. The rows for 1/3, 1/4, 1/6 and 1/8 are
// EXTRAPOLATED, steered by the medians of 332 PF1e monsters of CR 2 and lower
// scraped from aonprd.com the same day (n = 10, 13, 27, 32 at 1/8, 1/6, 1/4,
// 1/3). Those medians: hp 2, 3, 4, 5 (table-scaled by 10/9, the 1/2 row's
// table/median ratio); high attack -1, 0, 3, 2; damage 1, 1, 1, 2.5;
// good save 4 and poor save 0 to 1 at every fraction. AC is held at the 1/2
// row's 11 because the real monsters do not fall below it (median 14 at every
// fraction; see the AC note in pf1TierOf). Saves are held flat for the same
// reason.
const PF1_ROWS = [
  //  cr        hp   ac  hiAtk loAtk dmgHi dmgLo  pDC  sDC good poor
  [1 / 8,       2,  11,   -1,   -2,    1,    1,    9,   7,   3,   0], // extrapolated
  [1 / 6,       3,  11,   -1,   -2,    2,    1,    9,   7,   3,   0], // extrapolated
  [1 / 4,       5,  11,    0,   -1,    2,    2,   10,   7,   3,   0], // extrapolated
  [1 / 3,       6,  11,    0,   -1,    3,    2,   10,   8,   3,   0], // extrapolated
  [1 / 2,      10,  11,    1,    0,    4,    3,   11,   8,   3,   0],
  [1,          15,  12,    2,    1,    7,    5,   12,   9,   4,   1],
  [2,          20,  14,    4,    3,   10,    7,   13,   9,   5,   1],
  [3,          30,  15,    6,    4,   13,    9,   14,  10,   6,   2],
  [4,          40,  17,    8,    6,   16,   12,   15,  10,   7,   3],
  [5,          55,  18,   10,    7,   20,   15,   15,  11,   8,   4],
  [6,          70,  19,   12,    8,   25,   18,   16,  11,   9,   5],
  [7,          85,  20,   13,   10,   30,   22,   17,  12,  10,   6],
  [8,         100,  21,   15,   11,   35,   26,   18,  12,  11,   7],
  [9,         115,  23,   17,   12,   40,   30,   18,  13,  12,   8],
  [10,        130,  24,   18,   13,   45,   33,   19,  13,  13,   9],
  [11,        145,  25,   19,   14,   50,   37,   20,  14,  14,  10],
  [12,        160,  27,   21,   15,   55,   41,   21,  15,  15,  11],
  [13,        180,  28,   22,   16,   60,   45,   21,  15,  16,  12],
  [14,        200,  29,   23,   17,   65,   48,   22,  15,  17,  12],
  [15,        220,  30,   24,   18,   70,   52,   23,  16,  18,  13],
  [16,        240,  31,   26,   19,   80,   60,   24,  17,  19,  14],
  [17,        270,  32,   27,   20,   90,   67,   24,  18,  20,  15],
  [18,        300,  33,   28,   21,  100,   75,   25,  18,  20,  16],
  [19,        330,  34,   29,   22,  110,   82,   26,  19,  21,  16],
  [20,        370,  36,   30,   23,  120,   90,   27,  20,  22,  17],
];
const PF1_KEYS = ['hp', 'ac', 'highAttack', 'lowAttack', 'avgDamageHigh', 'avgDamageLow',
  'primaryDC', 'secondaryDC', 'goodSave', 'poorSave'];

// Keyed by CR as a number: 0.125, 0.16666666666666666, 0.25, 0.3333333333333333,
// 0.5, 1 .. 20. Use pf1Row() rather than indexing with a fraction you typed.
export const PF1_BY_CR = Object.freeze(Object.fromEntries(PF1_ROWS.map(([cr, ...v]) =>
  [cr, Object.freeze(Object.fromEntries(PF1_KEYS.map((k, i) => [k, v[i]])))])));

// "1/3", "CR 1/3", 0.333, "12" -> a number. NaN if it is not a CR.
export function parseCr(cr) {
  if (typeof cr === 'number') return cr;
  const m = String(cr ?? '').trim().match(/^(?:CR\s*)?(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+))?$/i);
  if (!m) return NaN;
  return m[2] ? Number(m[1]) / Number(m[2]) : Number(m[1]);
}

// The CR 1/8 row below 1/8, a straight line between printed rows, and past
// CR 20 the average per-CR slope of CR 16 to 20 (hp +32.5, AC +1.25, attacks
// +1, damage +10/+7.5, DCs and saves +0.75 per CR). Values past 20 are
// extrapolated, not printed anywhere; fine for tiering, which only needs the
// shape. Returns unrounded numbers plus the cr it was asked for.
export function pf1Row(cr) {
  const c = parseCr(cr);
  if (!Number.isFinite(c)) throw new Error(`pf1Row: not a CR: ${cr}`);
  const rows = PF1_ROWS;
  const pick = (r) => r.slice(1);
  let vals;
  if (c <= rows[0][0]) vals = pick(rows[0]);
  else if (c >= 20) {
    const a = pick(rows[rows.length - 5]), b = pick(rows[rows.length - 1]);
    vals = b.map((v, i) => v + (b[i] - a[i]) / 4 * (c - 20));
  } else {
    let i = 1;
    while (rows[i][0] < c) i++;
    const [lo, hi] = [rows[i - 1], rows[i]];
    const t = (c - lo[0]) / (hi[0] - lo[0]);
    vals = pick(lo).map((v, k) => v + (hi[k + 1] - v) * t);
  }
  return Object.freeze({ cr: c, ...Object.fromEntries(PF1_KEYS.map((k, i) => [k, vals[i]])) });
}

// ---------------------------------------------------------------------------
// PF2e Remaster: GM Core, Building Creatures (Tables 2-1 to 2-12)
// ---------------------------------------------------------------------------
// Source: https://2e.aonprd.com/Rules.aspx?ID=2874 (GM Core pg. 112 onward),
//   fetched 2026-09-29 and parsed from the page's tables, not retyped.
// Every table is keyed by level, -1 to 24. Notes on what the page prints:
//   PF2_ABILITY: extreme is printed as a dash at levels -1 and 0, stored as null.
//   PF2_SKILL: low is printed as a range ("+2 to +1"); `low` is the top of
//     it and `lowMin` the bottom.
//   PF2_HP and PF2_RESIST: [min, max]. PF2_RESIST is weaknesses too.
//   PF2_STRIKE_DAMAGE and PF2_AREA_DAMAGE: { avg, dice } as printed. The avg
//     is the page's rounded figure, so at level -1 high (1d4+1) and moderate
//     (1d4) both read 3.
//   PF2_STRIKE_ATTACK, PF2_SPELL_DC and PF2_SPELL_ATTACK repeat level 0 at -1.
// Nothing here is guessed: the page was reached and every number came off it.
//
// Empirical cross-check, Pathfinder/data/npcs/npc-level-*.json (Foundry pf2e,
// every creature at that level; median, then the table's moderate/high):
//   level  n    AC        Fort      best save  HP (mid)    Perception  top Strike  its damage   spell DC
//   1      503  16 15/16  7  7/10   9  7/10    20  20/25   7  7/10     8  7/9      5.5 5/6      17 14/17
//   5      452  21 21/22  12 12/15  14.5 12/15 75  75/94   12 12/15    15 13/15    14  13/16    22 19/22
//   10     267  29 29/30  20 19/22  21 19/22   175 175/219 19 19/22    23 21/23    23  22/26    29 26/29
//   15     176  37 36/37  27 26/29  29 26/29   275 275/344 27 26/29    30 28/30    32.5 30/36   36 33/36
//   20     114  45 44/45  34 33/36  36 33/36   380 375/469 36 33/36    38 36/38    44  37/44    42 39/42
// So the typical creature sits at moderate for HP, Fort and Perception,
// between moderate and high for AC and Strike damage, at high for its best
// save, its best Strike and its spell DC. That is what pf1TierOf anchors to.

export const PF2_ABILITY = Object.freeze({
  [-1]: { extreme: null, high: 3, moderate: 2, low: 0 },
  0: { extreme: null, high: 3, moderate: 2, low: 0 },
  1: { extreme: 5, high: 4, moderate: 3, low: 1 },
  2: { extreme: 5, high: 4, moderate: 3, low: 1 },
  3: { extreme: 5, high: 4, moderate: 3, low: 1 },
  4: { extreme: 6, high: 5, moderate: 3, low: 2 },
  5: { extreme: 6, high: 5, moderate: 4, low: 2 },
  6: { extreme: 7, high: 5, moderate: 4, low: 2 },
  7: { extreme: 7, high: 6, moderate: 4, low: 2 },
  8: { extreme: 7, high: 6, moderate: 4, low: 3 },
  9: { extreme: 7, high: 6, moderate: 4, low: 3 },
  10: { extreme: 8, high: 7, moderate: 5, low: 3 },
  11: { extreme: 8, high: 7, moderate: 5, low: 3 },
  12: { extreme: 8, high: 7, moderate: 5, low: 4 },
  13: { extreme: 9, high: 8, moderate: 5, low: 4 },
  14: { extreme: 9, high: 8, moderate: 5, low: 4 },
  15: { extreme: 9, high: 8, moderate: 6, low: 4 },
  16: { extreme: 10, high: 9, moderate: 6, low: 5 },
  17: { extreme: 10, high: 9, moderate: 6, low: 5 },
  18: { extreme: 10, high: 9, moderate: 6, low: 5 },
  19: { extreme: 11, high: 10, moderate: 6, low: 5 },
  20: { extreme: 11, high: 10, moderate: 7, low: 6 },
  21: { extreme: 11, high: 10, moderate: 7, low: 6 },
  22: { extreme: 11, high: 10, moderate: 8, low: 6 },
  23: { extreme: 11, high: 10, moderate: 8, low: 6 },
  24: { extreme: 13, high: 12, moderate: 9, low: 7 },
});

export const PF2_PERCEPTION = Object.freeze({
  [-1]: { extreme: 9, high: 8, moderate: 5, low: 2, terrible: 0 },
  0: { extreme: 10, high: 9, moderate: 6, low: 3, terrible: 1 },
  1: { extreme: 11, high: 10, moderate: 7, low: 4, terrible: 2 },
  2: { extreme: 12, high: 11, moderate: 8, low: 5, terrible: 3 },
  3: { extreme: 14, high: 12, moderate: 9, low: 6, terrible: 4 },
  4: { extreme: 15, high: 14, moderate: 11, low: 8, terrible: 6 },
  5: { extreme: 17, high: 15, moderate: 12, low: 9, terrible: 7 },
  6: { extreme: 18, high: 17, moderate: 14, low: 11, terrible: 8 },
  7: { extreme: 20, high: 18, moderate: 15, low: 12, terrible: 10 },
  8: { extreme: 21, high: 19, moderate: 16, low: 13, terrible: 11 },
  9: { extreme: 23, high: 21, moderate: 18, low: 15, terrible: 12 },
  10: { extreme: 24, high: 22, moderate: 19, low: 16, terrible: 14 },
  11: { extreme: 26, high: 24, moderate: 21, low: 18, terrible: 15 },
  12: { extreme: 27, high: 25, moderate: 22, low: 19, terrible: 16 },
  13: { extreme: 29, high: 26, moderate: 23, low: 20, terrible: 18 },
  14: { extreme: 30, high: 28, moderate: 25, low: 22, terrible: 19 },
  15: { extreme: 32, high: 29, moderate: 26, low: 23, terrible: 20 },
  16: { extreme: 33, high: 30, moderate: 28, low: 25, terrible: 22 },
  17: { extreme: 35, high: 32, moderate: 29, low: 26, terrible: 23 },
  18: { extreme: 36, high: 33, moderate: 30, low: 27, terrible: 24 },
  19: { extreme: 38, high: 35, moderate: 32, low: 29, terrible: 26 },
  20: { extreme: 39, high: 36, moderate: 33, low: 30, terrible: 27 },
  21: { extreme: 41, high: 38, moderate: 35, low: 32, terrible: 28 },
  22: { extreme: 43, high: 39, moderate: 36, low: 33, terrible: 30 },
  23: { extreme: 44, high: 40, moderate: 37, low: 34, terrible: 31 },
  24: { extreme: 46, high: 42, moderate: 38, low: 36, terrible: 32 },
});

export const PF2_SKILL = Object.freeze({
  [-1]: { extreme: 8, high: 5, moderate: 4, low: 2, lowMin: 1 },
  0: { extreme: 9, high: 6, moderate: 5, low: 3, lowMin: 2 },
  1: { extreme: 10, high: 7, moderate: 6, low: 4, lowMin: 3 },
  2: { extreme: 11, high: 8, moderate: 7, low: 5, lowMin: 4 },
  3: { extreme: 13, high: 10, moderate: 9, low: 7, lowMin: 5 },
  4: { extreme: 15, high: 12, moderate: 10, low: 8, lowMin: 7 },
  5: { extreme: 16, high: 13, moderate: 12, low: 10, lowMin: 8 },
  6: { extreme: 18, high: 15, moderate: 13, low: 11, lowMin: 9 },
  7: { extreme: 20, high: 17, moderate: 15, low: 13, lowMin: 11 },
  8: { extreme: 21, high: 18, moderate: 16, low: 14, lowMin: 12 },
  9: { extreme: 23, high: 20, moderate: 18, low: 16, lowMin: 13 },
  10: { extreme: 25, high: 22, moderate: 19, low: 17, lowMin: 15 },
  11: { extreme: 26, high: 23, moderate: 21, low: 19, lowMin: 16 },
  12: { extreme: 28, high: 25, moderate: 22, low: 20, lowMin: 17 },
  13: { extreme: 30, high: 27, moderate: 24, low: 22, lowMin: 19 },
  14: { extreme: 31, high: 28, moderate: 25, low: 23, lowMin: 20 },
  15: { extreme: 33, high: 30, moderate: 27, low: 25, lowMin: 21 },
  16: { extreme: 35, high: 32, moderate: 28, low: 26, lowMin: 23 },
  17: { extreme: 36, high: 33, moderate: 30, low: 28, lowMin: 24 },
  18: { extreme: 38, high: 35, moderate: 31, low: 29, lowMin: 25 },
  19: { extreme: 40, high: 37, moderate: 33, low: 31, lowMin: 27 },
  20: { extreme: 41, high: 38, moderate: 34, low: 32, lowMin: 28 },
  21: { extreme: 43, high: 40, moderate: 36, low: 34, lowMin: 29 },
  22: { extreme: 45, high: 42, moderate: 37, low: 35, lowMin: 31 },
  23: { extreme: 46, high: 43, moderate: 38, low: 36, lowMin: 32 },
  24: { extreme: 48, high: 45, moderate: 40, low: 38, lowMin: 33 },
});

export const PF2_AC = Object.freeze({
  [-1]: { extreme: 18, high: 15, moderate: 14, low: 12 },
  0: { extreme: 19, high: 16, moderate: 15, low: 13 },
  1: { extreme: 19, high: 16, moderate: 15, low: 13 },
  2: { extreme: 21, high: 18, moderate: 17, low: 15 },
  3: { extreme: 22, high: 19, moderate: 18, low: 16 },
  4: { extreme: 24, high: 21, moderate: 20, low: 18 },
  5: { extreme: 25, high: 22, moderate: 21, low: 19 },
  6: { extreme: 27, high: 24, moderate: 23, low: 21 },
  7: { extreme: 28, high: 25, moderate: 24, low: 22 },
  8: { extreme: 30, high: 27, moderate: 26, low: 24 },
  9: { extreme: 31, high: 28, moderate: 27, low: 25 },
  10: { extreme: 33, high: 30, moderate: 29, low: 27 },
  11: { extreme: 34, high: 31, moderate: 30, low: 28 },
  12: { extreme: 36, high: 33, moderate: 32, low: 30 },
  13: { extreme: 37, high: 34, moderate: 33, low: 31 },
  14: { extreme: 39, high: 36, moderate: 35, low: 33 },
  15: { extreme: 40, high: 37, moderate: 36, low: 34 },
  16: { extreme: 42, high: 39, moderate: 38, low: 36 },
  17: { extreme: 43, high: 40, moderate: 39, low: 37 },
  18: { extreme: 45, high: 42, moderate: 41, low: 39 },
  19: { extreme: 46, high: 43, moderate: 42, low: 40 },
  20: { extreme: 48, high: 45, moderate: 44, low: 42 },
  21: { extreme: 49, high: 46, moderate: 45, low: 43 },
  22: { extreme: 51, high: 48, moderate: 47, low: 45 },
  23: { extreme: 52, high: 49, moderate: 48, low: 46 },
  24: { extreme: 54, high: 51, moderate: 50, low: 48 },
});

export const PF2_SAVES = Object.freeze({
  [-1]: { extreme: 9, high: 8, moderate: 5, low: 2, terrible: 0 },
  0: { extreme: 10, high: 9, moderate: 6, low: 3, terrible: 1 },
  1: { extreme: 11, high: 10, moderate: 7, low: 4, terrible: 2 },
  2: { extreme: 12, high: 11, moderate: 8, low: 5, terrible: 3 },
  3: { extreme: 14, high: 12, moderate: 9, low: 6, terrible: 4 },
  4: { extreme: 15, high: 14, moderate: 11, low: 8, terrible: 6 },
  5: { extreme: 17, high: 15, moderate: 12, low: 9, terrible: 7 },
  6: { extreme: 18, high: 17, moderate: 14, low: 11, terrible: 8 },
  7: { extreme: 20, high: 18, moderate: 15, low: 12, terrible: 10 },
  8: { extreme: 21, high: 19, moderate: 16, low: 13, terrible: 11 },
  9: { extreme: 23, high: 21, moderate: 18, low: 15, terrible: 12 },
  10: { extreme: 24, high: 22, moderate: 19, low: 16, terrible: 14 },
  11: { extreme: 26, high: 24, moderate: 21, low: 18, terrible: 15 },
  12: { extreme: 27, high: 25, moderate: 22, low: 19, terrible: 16 },
  13: { extreme: 29, high: 26, moderate: 23, low: 20, terrible: 18 },
  14: { extreme: 30, high: 28, moderate: 25, low: 22, terrible: 19 },
  15: { extreme: 32, high: 29, moderate: 26, low: 23, terrible: 20 },
  16: { extreme: 33, high: 30, moderate: 28, low: 25, terrible: 22 },
  17: { extreme: 35, high: 32, moderate: 29, low: 26, terrible: 23 },
  18: { extreme: 36, high: 33, moderate: 30, low: 27, terrible: 24 },
  19: { extreme: 38, high: 35, moderate: 32, low: 29, terrible: 26 },
  20: { extreme: 39, high: 36, moderate: 33, low: 30, terrible: 27 },
  21: { extreme: 41, high: 38, moderate: 35, low: 32, terrible: 28 },
  22: { extreme: 43, high: 39, moderate: 36, low: 33, terrible: 30 },
  23: { extreme: 44, high: 40, moderate: 37, low: 34, terrible: 31 },
  24: { extreme: 46, high: 42, moderate: 38, low: 36, terrible: 32 },
});

export const PF2_HP = Object.freeze({
  [-1]: { high: [9, 9], moderate: [7, 8], low: [5, 6] },
  0: { high: [17, 20], moderate: [14, 16], low: [11, 13] },
  1: { high: [24, 26], moderate: [19, 21], low: [14, 16] },
  2: { high: [36, 40], moderate: [28, 32], low: [21, 25] },
  3: { high: [53, 59], moderate: [42, 48], low: [31, 37] },
  4: { high: [72, 78], moderate: [57, 63], low: [42, 48] },
  5: { high: [91, 97], moderate: [72, 78], low: [53, 59] },
  6: { high: [115, 123], moderate: [91, 99], low: [67, 75] },
  7: { high: [140, 148], moderate: [111, 119], low: [82, 90] },
  8: { high: [165, 173], moderate: [131, 139], low: [97, 105] },
  9: { high: [190, 198], moderate: [151, 159], low: [112, 120] },
  10: { high: [215, 223], moderate: [171, 179], low: [127, 135] },
  11: { high: [240, 248], moderate: [191, 199], low: [142, 150] },
  12: { high: [265, 273], moderate: [211, 219], low: [157, 165] },
  13: { high: [290, 298], moderate: [231, 239], low: [172, 180] },
  14: { high: [315, 323], moderate: [251, 259], low: [187, 195] },
  15: { high: [340, 348], moderate: [271, 279], low: [202, 210] },
  16: { high: [365, 373], moderate: [291, 299], low: [217, 225] },
  17: { high: [390, 398], moderate: [311, 319], low: [232, 240] },
  18: { high: [415, 423], moderate: [331, 339], low: [247, 255] },
  19: { high: [440, 448], moderate: [351, 359], low: [262, 270] },
  20: { high: [465, 473], moderate: [371, 379], low: [277, 285] },
  21: { high: [495, 505], moderate: [395, 405], low: [295, 305] },
  22: { high: [532, 544], moderate: [424, 436], low: [317, 329] },
  23: { high: [569, 581], moderate: [454, 466], low: [339, 351] },
  24: { high: [617, 633], moderate: [492, 508], low: [367, 383] },
});

export const PF2_RESIST = Object.freeze({
  [-1]: [1, 1],
  0: [1, 3],
  1: [2, 3],
  2: [2, 5],
  3: [3, 6],
  4: [4, 7],
  5: [4, 8],
  6: [5, 9],
  7: [5, 10],
  8: [6, 11],
  9: [6, 12],
  10: [7, 13],
  11: [7, 14],
  12: [8, 15],
  13: [8, 16],
  14: [9, 17],
  15: [9, 18],
  16: [9, 19],
  17: [10, 19],
  18: [10, 20],
  19: [11, 21],
  20: [11, 22],
  21: [12, 23],
  22: [12, 24],
  23: [13, 25],
  24: [13, 26],
});

export const PF2_STRIKE_ATTACK = Object.freeze({
  [-1]: { extreme: 10, high: 8, moderate: 6, low: 4 },
  0: { extreme: 10, high: 8, moderate: 6, low: 4 },
  1: { extreme: 11, high: 9, moderate: 7, low: 5 },
  2: { extreme: 13, high: 11, moderate: 9, low: 7 },
  3: { extreme: 14, high: 12, moderate: 10, low: 8 },
  4: { extreme: 16, high: 14, moderate: 12, low: 9 },
  5: { extreme: 17, high: 15, moderate: 13, low: 11 },
  6: { extreme: 19, high: 17, moderate: 15, low: 12 },
  7: { extreme: 20, high: 18, moderate: 16, low: 13 },
  8: { extreme: 22, high: 20, moderate: 18, low: 15 },
  9: { extreme: 23, high: 21, moderate: 19, low: 16 },
  10: { extreme: 25, high: 23, moderate: 21, low: 17 },
  11: { extreme: 27, high: 24, moderate: 22, low: 19 },
  12: { extreme: 28, high: 26, moderate: 24, low: 20 },
  13: { extreme: 29, high: 27, moderate: 25, low: 21 },
  14: { extreme: 31, high: 29, moderate: 27, low: 23 },
  15: { extreme: 32, high: 30, moderate: 28, low: 24 },
  16: { extreme: 34, high: 32, moderate: 30, low: 25 },
  17: { extreme: 35, high: 33, moderate: 31, low: 27 },
  18: { extreme: 37, high: 35, moderate: 33, low: 28 },
  19: { extreme: 38, high: 36, moderate: 34, low: 29 },
  20: { extreme: 40, high: 38, moderate: 36, low: 31 },
  21: { extreme: 41, high: 39, moderate: 37, low: 32 },
  22: { extreme: 43, high: 41, moderate: 39, low: 33 },
  23: { extreme: 44, high: 42, moderate: 40, low: 35 },
  24: { extreme: 46, high: 44, moderate: 42, low: 36 },
});

export const PF2_STRIKE_DAMAGE = Object.freeze({
  [-1]: { extreme: { avg: 4, dice: '1d6+1' }, high: { avg: 3, dice: '1d4+1' }, moderate: { avg: 3, dice: '1d4' }, low: { avg: 2, dice: '1d4' } },
  0: { extreme: { avg: 6, dice: '1d6+3' }, high: { avg: 5, dice: '1d6+2' }, moderate: { avg: 4, dice: '1d4+2' }, low: { avg: 3, dice: '1d4+1' } },
  1: { extreme: { avg: 8, dice: '1d8+4' }, high: { avg: 6, dice: '1d6+3' }, moderate: { avg: 5, dice: '1d6+2' }, low: { avg: 4, dice: '1d4+2' } },
  2: { extreme: { avg: 11, dice: '1d12+4' }, high: { avg: 9, dice: '1d10+4' }, moderate: { avg: 8, dice: '1d8+4' }, low: { avg: 6, dice: '1d6+3' } },
  3: { extreme: { avg: 15, dice: '1d12+8' }, high: { avg: 12, dice: '1d10+6' }, moderate: { avg: 10, dice: '1d8+6' }, low: { avg: 8, dice: '1d6+5' } },
  4: { extreme: { avg: 18, dice: '2d10+7' }, high: { avg: 14, dice: '2d8+5' }, moderate: { avg: 12, dice: '2d6+5' }, low: { avg: 9, dice: '2d4+4' } },
  5: { extreme: { avg: 20, dice: '2d12+7' }, high: { avg: 16, dice: '2d8+7' }, moderate: { avg: 13, dice: '2d6+6' }, low: { avg: 11, dice: '2d4+6' } },
  6: { extreme: { avg: 23, dice: '2d12+10' }, high: { avg: 18, dice: '2d8+9' }, moderate: { avg: 15, dice: '2d6+8' }, low: { avg: 12, dice: '2d4+7' } },
  7: { extreme: { avg: 25, dice: '2d12+12' }, high: { avg: 20, dice: '2d10+9' }, moderate: { avg: 17, dice: '2d8+8' }, low: { avg: 13, dice: '2d6+6' } },
  8: { extreme: { avg: 28, dice: '2d12+15' }, high: { avg: 22, dice: '2d10+11' }, moderate: { avg: 18, dice: '2d8+9' }, low: { avg: 15, dice: '2d6+8' } },
  9: { extreme: { avg: 30, dice: '2d12+17' }, high: { avg: 24, dice: '2d10+13' }, moderate: { avg: 20, dice: '2d8+11' }, low: { avg: 16, dice: '2d6+9' } },
  10: { extreme: { avg: 33, dice: '2d12+20' }, high: { avg: 26, dice: '2d12+13' }, moderate: { avg: 22, dice: '2d10+11' }, low: { avg: 17, dice: '2d6+10' } },
  11: { extreme: { avg: 35, dice: '2d12+22' }, high: { avg: 28, dice: '2d12+15' }, moderate: { avg: 23, dice: '2d10+12' }, low: { avg: 19, dice: '2d8+10' } },
  12: { extreme: { avg: 38, dice: '3d12+19' }, high: { avg: 30, dice: '3d10+14' }, moderate: { avg: 25, dice: '3d8+12' }, low: { avg: 20, dice: '3d6+10' } },
  13: { extreme: { avg: 40, dice: '3d12+21' }, high: { avg: 32, dice: '3d10+16' }, moderate: { avg: 27, dice: '3d8+14' }, low: { avg: 21, dice: '3d6+11' } },
  14: { extreme: { avg: 43, dice: '3d12+24' }, high: { avg: 34, dice: '3d10+18' }, moderate: { avg: 28, dice: '3d8+15' }, low: { avg: 23, dice: '3d6+13' } },
  15: { extreme: { avg: 45, dice: '3d12+26' }, high: { avg: 36, dice: '3d12+17' }, moderate: { avg: 30, dice: '3d10+14' }, low: { avg: 24, dice: '3d6+14' } },
  16: { extreme: { avg: 48, dice: '3d12+29' }, high: { avg: 37, dice: '3d12+18' }, moderate: { avg: 31, dice: '3d10+15' }, low: { avg: 25, dice: '3d6+15' } },
  17: { extreme: { avg: 50, dice: '3d12+31' }, high: { avg: 38, dice: '3d12+19' }, moderate: { avg: 32, dice: '3d10+16' }, low: { avg: 26, dice: '3d6+16' } },
  18: { extreme: { avg: 53, dice: '3d12+34' }, high: { avg: 40, dice: '3d12+20' }, moderate: { avg: 33, dice: '3d10+17' }, low: { avg: 27, dice: '3d6+17' } },
  19: { extreme: { avg: 55, dice: '4d12+29' }, high: { avg: 42, dice: '4d10+20' }, moderate: { avg: 35, dice: '4d8+17' }, low: { avg: 28, dice: '4d6+14' } },
  20: { extreme: { avg: 58, dice: '4d12+32' }, high: { avg: 44, dice: '4d10+22' }, moderate: { avg: 37, dice: '4d8+19' }, low: { avg: 29, dice: '4d6+15' } },
  21: { extreme: { avg: 60, dice: '4d12+34' }, high: { avg: 46, dice: '4d10+24' }, moderate: { avg: 38, dice: '4d8+20' }, low: { avg: 31, dice: '4d6+17' } },
  22: { extreme: { avg: 63, dice: '4d12+37' }, high: { avg: 48, dice: '4d10+26' }, moderate: { avg: 40, dice: '4d8+22' }, low: { avg: 32, dice: '4d6+18' } },
  23: { extreme: { avg: 65, dice: '4d12+39' }, high: { avg: 50, dice: '4d12+24' }, moderate: { avg: 42, dice: '4d10+20' }, low: { avg: 33, dice: '4d6+19' } },
  24: { extreme: { avg: 68, dice: '4d12+42' }, high: { avg: 52, dice: '4d12+26' }, moderate: { avg: 44, dice: '4d10+22' }, low: { avg: 35, dice: '4d6+21' } },
});

export const PF2_SPELL_DC = Object.freeze({
  [-1]: { extreme: 19, high: 16, moderate: 13 },
  0: { extreme: 19, high: 16, moderate: 13 },
  1: { extreme: 20, high: 17, moderate: 14 },
  2: { extreme: 22, high: 18, moderate: 15 },
  3: { extreme: 23, high: 20, moderate: 17 },
  4: { extreme: 25, high: 21, moderate: 18 },
  5: { extreme: 26, high: 22, moderate: 19 },
  6: { extreme: 27, high: 24, moderate: 21 },
  7: { extreme: 29, high: 25, moderate: 22 },
  8: { extreme: 30, high: 26, moderate: 23 },
  9: { extreme: 32, high: 28, moderate: 25 },
  10: { extreme: 33, high: 29, moderate: 26 },
  11: { extreme: 34, high: 30, moderate: 27 },
  12: { extreme: 36, high: 32, moderate: 29 },
  13: { extreme: 37, high: 33, moderate: 30 },
  14: { extreme: 39, high: 34, moderate: 31 },
  15: { extreme: 40, high: 36, moderate: 33 },
  16: { extreme: 41, high: 37, moderate: 34 },
  17: { extreme: 43, high: 38, moderate: 35 },
  18: { extreme: 44, high: 40, moderate: 37 },
  19: { extreme: 46, high: 41, moderate: 38 },
  20: { extreme: 47, high: 42, moderate: 39 },
  21: { extreme: 48, high: 44, moderate: 41 },
  22: { extreme: 50, high: 45, moderate: 42 },
  23: { extreme: 51, high: 46, moderate: 43 },
  24: { extreme: 52, high: 48, moderate: 45 },
});

export const PF2_SPELL_ATTACK = Object.freeze({
  [-1]: { extreme: 11, high: 8, moderate: 5 },
  0: { extreme: 11, high: 8, moderate: 5 },
  1: { extreme: 12, high: 9, moderate: 6 },
  2: { extreme: 14, high: 10, moderate: 7 },
  3: { extreme: 15, high: 12, moderate: 9 },
  4: { extreme: 17, high: 13, moderate: 10 },
  5: { extreme: 18, high: 14, moderate: 11 },
  6: { extreme: 19, high: 16, moderate: 13 },
  7: { extreme: 21, high: 17, moderate: 14 },
  8: { extreme: 22, high: 18, moderate: 15 },
  9: { extreme: 24, high: 20, moderate: 17 },
  10: { extreme: 25, high: 21, moderate: 18 },
  11: { extreme: 26, high: 22, moderate: 19 },
  12: { extreme: 28, high: 24, moderate: 21 },
  13: { extreme: 29, high: 25, moderate: 22 },
  14: { extreme: 31, high: 26, moderate: 23 },
  15: { extreme: 32, high: 28, moderate: 25 },
  16: { extreme: 33, high: 29, moderate: 26 },
  17: { extreme: 35, high: 30, moderate: 27 },
  18: { extreme: 36, high: 32, moderate: 29 },
  19: { extreme: 38, high: 33, moderate: 30 },
  20: { extreme: 39, high: 34, moderate: 31 },
  21: { extreme: 40, high: 36, moderate: 33 },
  22: { extreme: 42, high: 37, moderate: 34 },
  23: { extreme: 43, high: 38, moderate: 35 },
  24: { extreme: 44, high: 40, moderate: 37 },
});

export const PF2_AREA_DAMAGE = Object.freeze({
  [-1]: { unlimited: { avg: 2, dice: '1d4' }, limited: { avg: 4, dice: '1d6' } },
  0: { unlimited: { avg: 4, dice: '1d6' }, limited: { avg: 6, dice: '1d10' } },
  1: { unlimited: { avg: 5, dice: '2d4' }, limited: { avg: 7, dice: '2d6' } },
  2: { unlimited: { avg: 7, dice: '2d6' }, limited: { avg: 11, dice: '3d6' } },
  3: { unlimited: { avg: 9, dice: '2d8' }, limited: { avg: 14, dice: '4d6' } },
  4: { unlimited: { avg: 11, dice: '3d6' }, limited: { avg: 18, dice: '5d6' } },
  5: { unlimited: { avg: 12, dice: '2d10' }, limited: { avg: 21, dice: '6d6' } },
  6: { unlimited: { avg: 14, dice: '4d6' }, limited: { avg: 25, dice: '7d6' } },
  7: { unlimited: { avg: 15, dice: '4d6' }, limited: { avg: 28, dice: '8d6' } },
  8: { unlimited: { avg: 17, dice: '5d6' }, limited: { avg: 32, dice: '9d6' } },
  9: { unlimited: { avg: 18, dice: '5d6' }, limited: { avg: 35, dice: '10d6' } },
  10: { unlimited: { avg: 20, dice: '6d6' }, limited: { avg: 39, dice: '11d6' } },
  11: { unlimited: { avg: 21, dice: '6d6' }, limited: { avg: 42, dice: '12d6' } },
  12: { unlimited: { avg: 23, dice: '5d8' }, limited: { avg: 46, dice: '13d6' } },
  13: { unlimited: { avg: 24, dice: '7d6' }, limited: { avg: 49, dice: '14d6' } },
  14: { unlimited: { avg: 26, dice: '4d12' }, limited: { avg: 53, dice: '15d6' } },
  15: { unlimited: { avg: 27, dice: '6d8' }, limited: { avg: 56, dice: '16d6' } },
  16: { unlimited: { avg: 28, dice: '8d6' }, limited: { avg: 60, dice: '17d6' } },
  17: { unlimited: { avg: 29, dice: '8d6' }, limited: { avg: 63, dice: '18d6' } },
  18: { unlimited: { avg: 30, dice: '9d6' }, limited: { avg: 67, dice: '19d6' } },
  19: { unlimited: { avg: 32, dice: '7d8' }, limited: { avg: 70, dice: '20d6' } },
  20: { unlimited: { avg: 33, dice: '6d10' }, limited: { avg: 74, dice: '21d6' } },
  21: { unlimited: { avg: 35, dice: '10d6' }, limited: { avg: 77, dice: '22d6' } },
  22: { unlimited: { avg: 36, dice: '8d8' }, limited: { avg: 81, dice: '23d6' } },
  23: { unlimited: { avg: 38, dice: '11d6' }, limited: { avg: 84, dice: '24d6' } },
  24: { unlimited: { avg: 39, dice: '11d6' }, limited: { avg: 88, dice: '25d6' } },
});

// ---------------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------------
export const TIERS = Object.freeze({ terrible: 0, low: 1, moderate: 2, high: 3, extreme: 4 });
const TIER_NAMES = Object.keys(TIERS);

export const LEVEL_MIN = -1;
export const LEVEL_MAX = 24;
const clampLevel = (l) => Math.max(LEVEL_MIN, Math.min(LEVEL_MAX, Math.round(l)));

// The row of a PF2 table for a level, clamped to -1..24.
export function pf2Row(table, level) {
  return table[clampLevel(level)];
}

// A cell as one number: a [min, max] range reads as its midpoint, a
// { avg, dice } entry as its avg. null and undefined mean "no such tier".
function cellValue(c) {
  if (c == null) return null;
  if (Array.isArray(c)) return (c[0] + c[1]) / 2;
  if (typeof c === 'object') return c.avg;
  return c;
}

// [[tier, value], ...] in tier order, for the tiers the row has.
function ladder(row) {
  const pts = [];
  for (const name of TIER_NAMES) {
    const v = cellValue(row?.[name]);
    if (v != null) pts.push([TIERS[name], v]);
  }
  if (pts.length < 2) throw new Error('tier row needs at least two tiers');
  return pts;
}

// Slope of the first or last segment that is not flat, for extrapolating.
function endSlope(pts, atEnd) {
  const order = atEnd ? [...pts.keys()].reverse().slice(0, -1) : [...pts.keys()].slice(0, -1);
  for (const i of order) {
    const [a, b] = atEnd ? [pts[i - 1], pts[i]] : [pts[i], pts[i + 1]];
    const s = (b[1] - a[1]) / (b[0] - a[0]);
    if (s !== 0) return s;
  }
  return 1;
}

// Continuous tier of `value` against a row such as PF2_AC[5]: extreme 4,
// high 3, moderate 2, low 1, terrible 0, linear between the tiers the row
// has and extrapolated past its ends along the end segment. A value equal to
// several tiers (a printed tie) reads as the middle of them.
export function tierOf(value, row) {
  const pts = ladder(row);
  const eq = pts.filter(([, v]) => v === value);
  if (eq.length) return eq.reduce((s, [t]) => s + t, 0) / eq.length;
  const first = pts[0], last = pts[pts.length - 1];
  if (value < first[1]) return first[0] + (value - first[1]) / endSlope(pts, false);
  if (value > last[1]) return last[0] + (value - last[1]) / endSlope(pts, true);
  for (let i = 1; i < pts.length; i++) {
    const [ta, va] = pts[i - 1], [tb, vb] = pts[i];
    if (value > va && value < vb) return ta + (tb - ta) * (value - va) / (vb - va);
  }
  return NaN; // unreachable for a monotonic row
}

// The inverse of tierOf, unrounded.
function valueAtExact(tier, row) {
  const pts = ladder(row);
  const first = pts[0], last = pts[pts.length - 1];
  if (tier <= first[0]) return first[1] + (tier - first[0]) * endSlope(pts, false);
  if (tier >= last[0]) return last[1] + (tier - last[0]) * endSlope(pts, true);
  for (let i = 1; i < pts.length; i++) {
    const [ta, va] = pts[i - 1], [tb, vb] = pts[i];
    if (tier <= tb) return va + (vb - va) * (tier - ta) / (tb - ta);
  }
  return NaN;
}

// The value at a (possibly fractional) tier on a row, rounded to an integer.
// valueAt(3, PF2_AC[5]) is 22; valueAt(2.5, PF2_AC[5]) is 22 (21.5 rounds up).
export function valueAt(tier, row) {
  return Math.round(valueAtExact(tier, row));
}

// ---------------------------------------------------------------------------
// CR <-> level
// ---------------------------------------------------------------------------
// Rule: level = CR for CR 1 and up; CR 1/2 (and anything from 1/2 up to 1) is
// level 0; below 1/2 is level -1. Clamped to -1..24, the span of GM Core's
// tables, so the CR 25 tarrasque converts at 24.
//
// Evidence: 184 monsters matched by name between aonprd.com PF1e stat blocks
// and Pathfinder/data/npcs (Monster Core or the earliest bestiary printing).
//   CR >= 1 (n = 165): level - CR is 0 for 117, -1 for 26, +1 for 16, and
//     2 to 4 away for 6; mean +0.01, median 0.
//   CR 1/2 (n = 13): level 0 x6, -1 x5, +1 x1 (naiad), 9 x1 (ifrit, a
//     different creature in 2e). CR 1/3 and 1/4 (n = 6): all level -1.
//   Named: goblin warrior 1/3 -> -1, wolf 1 -> 1, ogre 3 -> ogre warrior 3,
//     owlbear 4 -> 4, troll 5 -> 5, young red dragon 10 -> 10, adult red
//     dragon 14 -> 14, ancient red dragon 19 -> 19, lich 12 -> 12, balor
//     20 -> 20, tarrasque 25 -> 25 (Age of Ashes). Vampire is the outlier:
//     PF1 CR 9 (a 8th-level fighter template) vs vampire count level 6.
// Paizo's own Second Edition Conversion Guide
// (https://paizo.com/community/blog/v5748dyo6sgue) treats the two as the same
// scale: it converts the CR 8 nabasu from the level 9 vrock, "off by one
// level", with the weak adjustment.
// One line for a converter to show the user.
export const CR_TO_LEVEL_RULE = 'level = CR from CR 1 up, CR 1/2 is level 0, lower is level -1 '
  + '(of 165 monsters in both editions at CR 1+, 117 kept their number exactly)';

export function crToLevel(cr) {
  const c = parseCr(cr);
  if (!Number.isFinite(c)) throw new Error(`crToLevel: not a CR: ${cr}`);
  if (c >= 1) return clampLevel(c);
  return c >= 0.5 ? 0 : -1;
}

// Level 0 -> CR 1/2, level -1 -> CR 1/4 (the commonest CR among the level -1
// matches above), otherwise CR = level. crToLevel(levelToCr(l)) === l for
// every l in -1..24.
export function levelToCr(level) {
  const l = Math.round(level);
  if (l <= -1) return 0.25;
  if (l === 0) return 0.5;
  return l;
}

// ---------------------------------------------------------------------------
// Placing a PF1e stat on the tier ladder
// ---------------------------------------------------------------------------
// pf1TierOf(stat, value, cr) -> continuous tier, for stat in
//   hp       hit points
//   ac       Armor Class
//   attack   best attack bonus
//   damage   full-attack damage, all hits (Table 1-1's meaning)
//   dc       best special ability or spell DC
//   save     a saving throw bonus
//
// The scheme, and why. Two things have to be decided per stat: which PF2 tier
// a PF1e benchmark sits at (the anchor), and how far one tier is (the step).
//
// Anchor: median to median. Each PF1e anchor below is the column the actual
// PF1e monsters sit on at their CR, and each PF2 tier is where the actual
// PF2 creatures sit at their level, so a typical 1e monster lands on a
// typical 2e value. PF1e medians from 181 Bestiary 1 monsters plus the 332
// low-CR ones above, against Table 1-1 (median / table):
//   CR     n    hp       AC      best atk  high/low  full dmg  high/low  best DC  primary
//   1      95   13/15    14/12   3   2/1             5   7/5             13  12
//   3      19   30/30    15/15   5   6/4             13.5 13/9           14.5 14
//   5      11   52/55    19/18   10  10/7            15  20/15           17.5 15
//   7      16   84/85    20/20   12  13/10           25  30/22           19  17
//   9      8    117/115  22/23   17  17/12           38  40/30           21  18
//   13     5    184/180  28/28   26  22/16           79  60/45           22.5 21
//   (good and poor saves: medians equal Table 1-1's to within 1 at every CR
//   with n >= 8.)
// From CR 3 up, the table's hp, AC, high attack, primary DC and good save
// each sit on the PF1e median (within a point or two), and the median full
// attack sits between high and low damage. The PF2 medians (the cross-check
// above) give the tier each one maps to:
//   hp      table hp              = PF2 HP_ANCHOR_TIER, 2.2 (low below
//                                   CR 1): moderate (2) read the printed
//                                   monsters low; see HP_ANCHOR_TIER below
//   ac      table AC              = PF2 AC_ANCHOR_TIER, 2.5: the PF2 median
//                                   AC is moderate at 10 of levels 1-20 and
//                                   high at the other 10
//   attack  highAttack            = PF2 high (3)
//   damage  mean(high, low) dmg   = PF2 DAMAGE_ANCHOR_TIER, 2.25: the tier of
//                                   the PF2 median best-Strike damage, levels
//                                   1-20, is 2.27 median, 2.32 mean
//   dc      primaryDC             = PF2 high spell DC (3)
//   save    goodSave              = PF2 high (3)
// lowAttack, poorSave and secondaryDC are not anchors: they fall out of the
// step, and land at about 1.3, 1.7 and 1 respectively at CR 10 (tabulated in
// the test), which is where the column names say they should.
//
// Step: PF2's, not PF1e's. The d20 stats (ac, attack, dc, save) move one
// PF2 point per PF1e point off the anchor, and hp and damage move by ratio
// (a 1e monster with 1.2x its CR's hp gets 1.2x the anchor-tier PF2 hp at the
// level, then that is tiered). Taking the step from PF1e's own two columns
// was tried and dropped: at CR 1/2 high and low attack are 1 and 0, so a
// perfectly ordinary +3 would read as five tiers above high.
//
// Below CR 3 the anchors are measured, not read off Table 1-1. The table
// runs low there: at CR 1/2 and 1 it prints AC 11/12, attack +1/+2 and
// primary DC 11/12 against real medians of 14, +3 and 13 (the 332 low-CR
// monsters above). Anchoring on the table read every goblin as extreme AC and
// every CR 1/2 brute as extreme attack. So pf1Anchors() uses these medians
// for CR 1/8 to 2, and blends into the table in a straight line to CR 3,
// where the two agree to within a point. Two medians were smoothed so the
// column never falls as CR rises (attack 1/4 was +3 over n = 24, DC 1/6 was
// n = 2). Damage and the poor-save/secondary columns keep the table.
//
// Checked against the answer key: the PF1e monsters Paizo also printed in
// PF2 (matched by name, level within 1 of crToLevel; about 190 comparisons
// per stat, 61 for DC). The PF1e stat is run through pf1TierOf and valueAt
// at crToLevel(cr), and compared with the PF2 creature's own stat moved to
// that level at the same tier:
//                      mean |error|   mean bias (predicted - actual)
//   table anchors      AC 1.40  attack 2.34  best save 2.11  DC 2.36  hp 19.5%
//                      bias AC +0.63  attack +1.15  save +1.57  DC +1.34  hp -11.8%
//   CR < 3 only        bias attack +2.45  save +2.00  hp -18.2%
//   CR >= 3 only       bias AC +0.26  attack -0.48  save +1.01  DC +1.39  hp -3.5%
//   measured anchors   AC 1.25  attack 1.88  best save 1.86  DC 2.33  hp 17.9%
//                      bias AC +0.35  attack +0.48  save +1.29  DC +1.02  hp -7.7%
// So the table works from CR 3 up and the low end needed the medians.
export const AC_ANCHOR_TIER = 2.5;
// HP anchors at 2.2 from CR 1 up (HISTORY #714, which folded #713's 2.5 from
// CR 3 into #713's 2.2 at CR 1 and 2) and at low below CR 1 (HISTORY #712,
// which replaced #711's 2.25). Paizo builds its level -1 and 0
// mooks on low Hit Points: Skeleton Guard 4, Goblin Warrior 6, Kobold Warrior
// 7, where level -1 low is 5 to 6. converter-convert.test.mjs checked 16
// monsters against their printed PF2e versions, six of them CR 1/4 to 1/2:
//   CR < 1 anchor   2.25   2      1.75   1.5    1.25   1
//   mean |error|    26.8%  23.7%  23.7%  17.8%  18.2%  12.5%
//   mean bias       +26.8% +23.7% +18.0% +10.5% +4.8%  -2.5%
// #711 had measured 2.25 best with the goblin among the eleven then checked;
// its +50% at the old anchor was hiding a -4.5% bias in the other ten. The
// wider answer key above (-7.7% hp bias at moderate) points the same way.
// #713 added ten CR 1 and 2 pairs. At 2.5 the eleven CR 1 and 2 pairs ran
// +7.4% while the nine from CR 3 up held at +1.6%, so CR 1 and 2 took 2.2
// (bias +0.2%) and CR 3 up kept 2.5. #714 added twelve CR 3 to 6 pairs (dire
// wolf, doppelganger, rust monster, hell hound, gargoyle, griffon, mimic,
// basilisk, gibbering mouther, djinni, ettin, wyvern), and at 2.5 the
// twenty-one from CR 3 up ran +7.9%:
//   CR >= 3 anchor  2      2.1    2.15   2.2    2.25   2.3    2.4    2.5
//   mean |error|    16.5%  17.0%  17.2%  17.3%  17.9%  18.4%  19.0%  20.1%
//   mean bias       -3.6%  -1.4%  -0.3%  +0.8%  +2.0%  +3.1%  +5.4%  +7.9%
// The gargoyle is +65% at 2.2 on its own (Paizo prints it at 40, under
// level 4's low row, and gives it physical resistance 5 instead); without it
// the bias crosses zero near 2.3. Twenty-one pairs spread 23% have a standard
// error of about 5%, so 2.1 to 2.3 are equally supported and nothing
// separates CR 3 up from CR 1 and 2 any more. One anchor for CR 1 up at 2.15
// measured 16.4% error over all 38 pairs, at 2.2 16.5%, at 2.3 17.3%; 2.2 is
// kept because it leaves every CR 1 and 2 conversion where #713 put it.
// PF1e has no CR between 1/2 and 1, so the switch falls between two levels.
export const HP_ANCHOR_TIER = 2.2;
export const HP_LOW_CR_ANCHOR_TIER = 1;
export const hpAnchorTier = (cr) => (cr < 1 ? HP_LOW_CR_ANCHOR_TIER : HP_ANCHOR_TIER);
export const DAMAGE_ANCHOR_TIER = 2.25;

// Medians of PF1e monsters by CR (aonprd.com, fetched 2026-09-29), CR 1/8 to 2.
//              cr     hp   ac  atk   dc  goodSave
const PF1_LOW_MEDIANS = [
  [1 / 8,       2,  14,  -1,  10,  4],
  [1 / 6,       3,  14,   0,  10,  4],
  [1 / 4,       4,  14,   2,  11,  4],
  [1 / 3,       5,  14,   2,  12,  4],
  [1 / 2,       9,  14,   3,  13,  4],
  [1,          13,  14,   3,  13,  5],
  [2,          19,  15,   5,  13,  5.5],
];

// The PF1e value each stat is pinned to at a CR: { hp, ac, attack, damage, dc,
// save }. Table 1-1 from CR 3 up; the measured medians below it (see above).
export function pf1Anchors(cr) {
  const row = pf1Row(cr);
  const c = row.cr;
  const out = {
    hp: row.hp, ac: row.ac, attack: row.highAttack,
    damage: (row.avgDamageHigh + row.avgDamageLow) / 2,
    dc: row.primaryDC, save: row.goodSave,
  };
  if (c < 3) {
    const t3 = pf1Row(3);
    const pts = [...PF1_LOW_MEDIANS, [3, t3.hp, t3.ac, t3.highAttack, t3.primaryDC, t3.goodSave]];
    let i = 1;
    while (i < pts.length - 1 && pts[i][0] < c) i++;
    const [lo, hi] = [pts[i - 1], pts[i]];
    const t = Math.max(0, (c - lo[0]) / (hi[0] - lo[0]));
    const v = (k) => lo[k] + (hi[k] - lo[k]) * t;
    Object.assign(out, { hp: v(1), ac: v(2), attack: v(3), dc: v(4), save: v(5) });
  }
  return Object.freeze(out);
}

export const PF1_STATS = Object.freeze(['hp', 'ac', 'attack', 'damage', 'dc', 'save']);

export function pf1TierOf(stat, value, cr) {
  const a = pf1Anchors(cr);
  const level = crToLevel(cr);
  const at = (table, tier) => valueAtExact(tier, pf2Row(table, level));
  const d20 = (table, anchor, tier) => tierOf(value - anchor + at(table, tier), pf2Row(table, level));
  const ratio = (table, anchor, tier) => tierOf(value / anchor * at(table, tier), pf2Row(table, level));
  switch (stat) {
    case 'hp': return ratio(PF2_HP, a.hp, hpAnchorTier(cr));
    case 'ac': return d20(PF2_AC, a.ac, AC_ANCHOR_TIER);
    case 'attack': return d20(PF2_STRIKE_ATTACK, a.attack, TIERS.high);
    case 'damage': return ratio(PF2_STRIKE_DAMAGE, a.damage, DAMAGE_ANCHOR_TIER);
    case 'dc': return d20(PF2_SPELL_DC, a.dc, TIERS.high);
    case 'save': return d20(PF2_SAVES, a.save, TIERS.high);
    default: throw new Error(`pf1TierOf: unknown stat "${stat}" (want ${PF1_STATS.join('|')})`);
  }
}

// Freeze the PF2 rows too, so a caller cannot edit a benchmark by accident.
for (const t of [PF2_ABILITY, PF2_PERCEPTION, PF2_SKILL, PF2_AC, PF2_SAVES, PF2_HP, PF2_RESIST,
  PF2_STRIKE_ATTACK, PF2_STRIKE_DAMAGE, PF2_SPELL_DC, PF2_SPELL_ATTACK, PF2_AREA_DAMAGE]) {
  for (const row of Object.values(t)) {
    Object.freeze(row);
    for (const c of Object.values(row)) if (c && typeof c === 'object') Object.freeze(c);
  }
}
