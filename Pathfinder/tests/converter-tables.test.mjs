// converter-tables.test.mjs: the benchmark tables and tier helpers the PF1e
// -> PF2e monster converter measures against.
//
//   node Pathfinder/tests/converter-tables.test.mjs      (from the repo root)
//
// Exits non-zero on any failure.
//
// WHY. Every converted number goes through these tables twice (PF1e stat to
// tier, tier to PF2e stat), so one mistyped cell moves every monster that
// passes through that level. The shape checks (every level present, rising
// with level, tiers in order) catch a slipped digit anywhere; the spot values
// pin cells read off the source pages on 2026-09-29, so a table that is
// consistent but shifted a row still fails.

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const T = await import(pathToFileURL(path.join(HERE, '..', 'converter-assets', 'js', 'tables.js')).href);

let checks = 0, failures = 0;
const ok = (cond, label, detail = '') => {
  checks++;
  if (cond) console.log(`  ok    ${label}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const TIER_ORDER = ['extreme', 'high', 'moderate', 'low', 'terrible'];
const LEVELS = Array.from({ length: 26 }, (_, i) => i - 1);

// A cell as a list of numbers to compare: ranges give both ends.
const nums = (c) => c == null ? null : Array.isArray(c) ? c : typeof c === 'object' ? [c.avg] : [c];

const PF2 = {
  PF2_ABILITY: T.PF2_ABILITY, PF2_PERCEPTION: T.PF2_PERCEPTION, PF2_SKILL: T.PF2_SKILL,
  PF2_AC: T.PF2_AC, PF2_SAVES: T.PF2_SAVES, PF2_HP: T.PF2_HP, PF2_STRIKE_ATTACK: T.PF2_STRIKE_ATTACK,
  PF2_STRIKE_DAMAGE: T.PF2_STRIKE_DAMAGE, PF2_SPELL_DC: T.PF2_SPELL_DC,
  PF2_SPELL_ATTACK: T.PF2_SPELL_ATTACK, PF2_AREA_DAMAGE: T.PF2_AREA_DAMAGE,
};
const TIERED = Object.keys(PF2).filter(k => k !== 'PF2_AREA_DAMAGE');

console.log('\nPF2 tables: every level -1..24, and nothing else');
for (const [name, t] of Object.entries({ ...PF2, PF2_RESIST: T.PF2_RESIST })) {
  const keys = Object.keys(t).map(Number).sort((a, b) => a - b);
  ok(eq(keys, LEVELS), `${name} has exactly levels -1..24`, `has ${keys.join(',')}`);
}

console.log('\nPF2 tables: no column falls as level rises');
for (const [name, t] of Object.entries(PF2)) {
  const cols = Object.keys(t[0]);
  const bad = [];
  for (const col of cols) for (const L of LEVELS.slice(1)) {
    const a = nums(t[L - 1][col]), b = nums(t[L][col]);
    if (a == null || b == null) continue;
    if (a.some((v, i) => b[i] < v)) bad.push(`${col} ${L - 1}->${L}: ${a} then ${b}`);
  }
  ok(bad.length === 0, `${name} (${cols.join('/')})`, bad.join('; '));
}
{
  const bad = LEVELS.slice(1).filter(L => T.PF2_RESIST[L][0] < T.PF2_RESIST[L - 1][0] || T.PF2_RESIST[L][1] < T.PF2_RESIST[L - 1][1]);
  ok(bad.length === 0, 'PF2_RESIST min and max', `falls at ${bad}`);
}

console.log('\nPF2 tables: extreme >= high >= moderate >= low >= terrible in every row');
for (const name of TIERED) {
  const bad = [];
  for (const L of LEVELS) {
    const row = PF2[name][L];
    const present = TIER_ORDER.filter(k => row[k] != null);
    for (let i = 1; i < present.length; i++) {
      const hi = nums(row[present[i - 1]]), lo = nums(row[present[i]]);
      if (Math.min(...hi) < Math.max(...lo)) bad.push(`L${L} ${present[i - 1]} ${hi} < ${present[i]} ${lo}`);
    }
  }
  ok(bad.length === 0, name, bad.join('; '));
}
// The one tie the page prints: level -1 high (1d4+1) and moderate (1d4)
// strike damage both show "(3)". Any other tie is a typo.
{
  const ties = [];
  for (const name of TIERED) for (const L of LEVELS) {
    const row = PF2[name][L];
    const present = TIER_ORDER.filter(k => row[k] != null);
    for (let i = 1; i < present.length; i++)
      if (eq(nums(row[present[i - 1]]), nums(row[present[i]]))) ties.push(`${name}[${L}] ${present[i - 1]}=${present[i]}`);
  }
  ok(eq(ties, ['PF2_STRIKE_DAMAGE[-1] high=moderate']), 'the only equal adjacent tiers are level -1 strike damage high/moderate', ties.join(', '));
}
ok(LEVELS.every(L => T.PF2_SKILL[L].lowMin <= T.PF2_SKILL[L].low), 'PF2_SKILL lowMin <= low at every level');
ok(LEVELS.every(L => T.PF2_HP[L].high[0] <= T.PF2_HP[L].high[1] && T.PF2_HP[L].low[0] <= T.PF2_HP[L].low[1]), 'PF2_HP ranges are [min, max]');
ok(LEVELS.every(L => T.PF2_RESIST[L][0] <= T.PF2_RESIST[L][1]), 'PF2_RESIST ranges are [min, max]');
ok(LEVELS.every(L => T.PF2_AREA_DAMAGE[L].limited.avg > T.PF2_AREA_DAMAGE[L].unlimited.avg), 'limited-use area damage beats unlimited at every level');
ok(LEVELS.every(L => T.PF2_SPELL_ATTACK[L].high === T.PF2_SPELL_DC[L].high - 8), 'spell attack is spell DC - 8 at high (a relation the page holds throughout)');

console.log('\nPF2 spot values (2e.aonprd.com Rules.aspx?ID=2874)');
ok(T.PF2_ABILITY[-1].extreme === null && T.PF2_ABILITY[24].extreme === 13, 'ability: no extreme at -1, +13 at 24');
ok(T.PF2_PERCEPTION[10].moderate === 19 && T.PF2_PERCEPTION[-1].terrible === 0, 'perception: moderate 19 at 10, terrible 0 at -1');
ok(eq(T.PF2_SKILL[-1], { extreme: 8, high: 5, moderate: 4, low: 2, lowMin: 1 }), 'skill row -1');
ok(eq(T.PF2_AC[5], { extreme: 25, high: 22, moderate: 21, low: 19 }), 'AC row 5');
ok(T.PF2_SAVES[20].high === 36 && T.PF2_SAVES[24].extreme === 46, 'saves: high 36 at 20, extreme 46 at 24');
ok(eq(T.PF2_HP[10].moderate, [171, 179]) && eq(T.PF2_HP[-1].high, [9, 9]) && eq(T.PF2_HP[24].high, [617, 633]), 'HP: 10 moderate, -1 high, 24 high');
ok(eq(T.PF2_RESIST[24], [13, 26]) && eq(T.PF2_RESIST[-1], [1, 1]), 'resistances: 24 and -1');
ok(T.PF2_STRIKE_ATTACK[20].high === 38 && T.PF2_STRIKE_ATTACK[-1].extreme === 10, 'strike attack: high 38 at 20, extreme 10 at -1');
ok(eq(T.PF2_STRIKE_DAMAGE[2].extreme, { avg: 11, dice: '1d12+4' }) && eq(T.PF2_STRIKE_DAMAGE[24].low, { avg: 35, dice: '4d6+21' }), 'strike damage: 2 extreme, 24 low');
ok(T.PF2_SPELL_DC[20].extreme === 47 && T.PF2_SPELL_ATTACK[15].high === 28, 'spells: DC extreme 47 at 20, attack high +28 at 15');
ok(eq(T.PF2_AREA_DAMAGE[24].limited, { avg: 88, dice: '25d6' }) && eq(T.PF2_AREA_DAMAGE[5].unlimited, { avg: 12, dice: '2d10' }), 'area damage: 24 limited, 5 unlimited');

// Column sums, computed from the fetched page text by a separate Python
// parse, not from tables.js. The shape checks above cannot see a cell nudged
// by one that stays between its neighbours (AC high at 12 going 33 -> 34
// passed them all); a sum pins every cell. Ranges count both ends, damage
// counts its avg, a printed dash counts 0, skill low counts low + lowMin.
console.log('\nPF2 column sums against the source page');
{
  const SUMS = {
    PF2_ABILITY: { extreme: 204, high: 185, moderate: 130, low: 90 },
    PF2_PERCEPTION: { extreme: 693, high: 633, moderate: 555, low: 478, terrible: 409 },
    PF2_SKILL: { extreme: 709, high: 631, moderate: 560, low: 943 },
    PF2_AC: { extreme: 913, high: 835, moderate: 809, low: 757 },
    PF2_SAVES: { extreme: 693, high: 633, moderate: 555, low: 478, terrible: 409 },
    PF2_HP: { high: 13927, moderate: 11135, low: 8347 },
    PF2_STRIKE_ATTACK: { extreme: 705, high: 652, moderate: 600, low: 504 },
    PF2_STRIKE_DAMAGE: { extreme: 942, high: 732, moderate: 612, low: 489 },
    PF2_SPELL_DC: { extreme: 913, high: 808, moderate: 730 },
    PF2_SPELL_ATTACK: { extreme: 705, high: 600, moderate: 522 },
    PF2_AREA_DAMAGE: { unlimited: 555, limited: 1150 },
  };
  for (const [name, cols] of Object.entries(SUMS)) {
    const got = {};
    for (const col of Object.keys(cols)) got[col] = LEVELS.reduce((s, L) => {
      const row = PF2[name][L];
      const c = (nums(row[col]) || [0]).reduce((a, b) => a + b, 0);
      return s + c + (name === 'PF2_SKILL' && col === 'low' ? row.lowMin : 0);
    }, 0);
    ok(eq(got, cols), `${name} column sums`, `got ${JSON.stringify(got)}\n        want ${JSON.stringify(cols)}`);
  }
  const res = LEVELS.reduce((s, L) => [s[0] + T.PF2_RESIST[L][0], s[1] + T.PF2_RESIST[L][1]], [0, 0]);
  ok(eq(res, [188, 367]), 'PF2_RESIST column sums', `got ${res}`);
}

console.log('\nPF1 Table 1-1 (aonprd.com, Bestiary pg. 291)');
const CRS = Object.keys(T.PF1_BY_CR).map(Number).sort((a, b) => a - b);
ok(CRS.length === 25 && near(CRS[0], 1 / 8) && CRS[24] === 20, 'CRs 1/8, 1/6, 1/4, 1/3, 1/2, 1..20', CRS.join(','));
{
  const cols = Object.keys(T.PF1_BY_CR[1]);
  const bad = [];
  for (const col of cols) for (let i = 1; i < CRS.length; i++)
    if (T.PF1_BY_CR[CRS[i]][col] < T.PF1_BY_CR[CRS[i - 1]][col]) bad.push(`${col} at CR ${CRS[i]}`);
  ok(bad.length === 0, `no column falls as CR rises (${cols.length} columns)`, bad.join('; '));
  const pairs = [['highAttack', 'lowAttack'], ['avgDamageHigh', 'avgDamageLow'], ['primaryDC', 'secondaryDC'], ['goodSave', 'poorSave']];
  const inv = CRS.flatMap(c => pairs.filter(([h, l]) => T.PF1_BY_CR[c][h] < T.PF1_BY_CR[c][l]).map(([h]) => `${h} at CR ${c}`));
  ok(inv.length === 0, 'high >= low, primary >= secondary, good >= poor at every CR', inv.join('; '));
}
ok(eq(T.PF1_BY_CR[0.5], { hp: 10, ac: 11, highAttack: 1, lowAttack: 0, avgDamageHigh: 4, avgDamageLow: 3, primaryDC: 11, secondaryDC: 8, goodSave: 3, poorSave: 0 }), 'CR 1/2 row');
ok(eq(T.PF1_BY_CR[10], { hp: 130, ac: 24, highAttack: 18, lowAttack: 13, avgDamageHigh: 45, avgDamageLow: 33, primaryDC: 19, secondaryDC: 13, goodSave: 13, poorSave: 9 }), 'CR 10 row');
ok(eq(T.PF1_BY_CR[20], { hp: 370, ac: 36, highAttack: 30, lowAttack: 23, avgDamageHigh: 120, avgDamageLow: 90, primaryDC: 27, secondaryDC: 20, goodSave: 22, poorSave: 17 }), 'CR 20 row');
ok(T.PF1_BY_CR[16].avgDamageHigh === 80 && T.PF1_BY_CR[13].hp === 180 && T.PF1_BY_CR[9].ac === 23, 'CR 16 damage 80, CR 13 hp 180, CR 9 AC 23');

console.log('\npf1Row and parseCr');
ok(T.parseCr('1/3') === 1 / 3 && T.parseCr('CR 1/2') === 0.5 && T.parseCr('12') === 12 && Number.isNaN(T.parseCr('x')), 'parseCr reads "1/3", "CR 1/2", "12"; NaN otherwise');
ok(CRS.every(c => Object.entries(T.PF1_BY_CR[c]).every(([k, v]) => T.pf1Row(c)[k] === v)), 'pf1Row at a printed CR is that row');
ok(near(T.pf1Row(10.5).hp, 137.5) && near(T.pf1Row('1/3').hp, 6), 'pf1Row interpolates (10.5 -> hp 137.5) and reads "1/3"');
ok(eq(T.pf1Row(0.01).hp, T.PF1_BY_CR[0.125].hp), 'pf1Row below 1/8 is the 1/8 row');
{
  const r25 = T.pf1Row(25), r30 = T.pf1Row(30);
  ok(near(r25.hp, 370 + 32.5 * 5) && near(r25.highAttack, 35) && r30.ac > r25.ac, 'pf1Row past 20 extends the CR 16-20 slope (25 -> hp 532.5, attack 35)');
}

console.log('\ncrToLevel / levelToCr against the evidence pairs');
for (const [name, cr, level] of [['goblin warrior', '1/3', -1], ['viper', '1/2', 0], ['wolf', 1, 1], ['ogre', 3, 3],
  ['owlbear', 4, 4], ['troll', 5, 5], ['young red dragon', 10, 10], ['lich', 12, 12], ['adult red dragon', 14, 14],
  ['balor', 20, 20], ['tarrasque (2e level 25, clamped)', 25, 24]])
  ok(T.crToLevel(cr) === level, `${name}: CR ${cr} -> level ${level}`, `got ${T.crToLevel(cr)}`);
ok(T.crToLevel(1 / 8) === -1 && T.crToLevel(0.75) === 0 && T.crToLevel(40) === 24, 'CR 1/8 -> -1, 3/4 -> 0, 40 -> 24');
ok(LEVELS.every(L => T.crToLevel(T.levelToCr(L)) === L), 'crToLevel(levelToCr(L)) === L for -1..24');

console.log('\ntierOf / valueAt');
{
  const bad = [];
  for (const name of TIERED) for (const L of LEVELS) {
    const row = PF2[name][L];
    for (const k of TIER_ORDER) {
      if (row[k] == null || (name === 'PF2_STRIKE_DAMAGE' && L === -1 && (k === 'high' || k === 'moderate'))) continue;
      const v = nums(row[k]), mid = v.length === 2 ? (v[0] + v[1]) / 2 : v[0];
      if (!near(T.tierOf(mid, row), T.TIERS[k])) bad.push(`${name}[${L}].${k}: tierOf ${T.tierOf(mid, row)}`);
      if (T.valueAt(T.TIERS[k], row) !== Math.round(mid)) bad.push(`${name}[${L}].${k}: valueAt ${T.valueAt(T.TIERS[k], row)}`);
    }
  }
  ok(bad.length === 0, 'every printed cell reads as its own tier, and valueAt(tier) gives it back', bad.slice(0, 5).join('; '));
}
{
  const bad = [];
  for (const name of ['PF2_AC', 'PF2_SAVES', 'PF2_PERCEPTION', 'PF2_STRIKE_ATTACK', 'PF2_SPELL_DC', 'PF2_SKILL'])
    for (const L of LEVELS) {
      const row = PF2[name][L];
      for (let v = row.low - 6; v <= row.extreme + 6; v++)
        if (T.valueAt(T.tierOf(v, row), row) !== v) bad.push(`${name}[${L}] ${v}`);
    }
  ok(bad.length === 0, 'valueAt(tierOf(v)) === v for every integer from low-6 to extreme+6 (d20 tables)', bad.slice(0, 5).join('; '));
}
{
  const bad = [];
  for (const name of TIERED) for (const L of LEVELS) {
    const row = PF2[name][L];
    let prev = -Infinity;
    for (let t = -1; t <= 5; t += 0.25) {
      const v = T.valueAt(t, row);
      if (v < prev) bad.push(`${name}[${L}] at ${t}`);
      prev = v;
    }
  }
  ok(bad.length === 0, 'valueAt never falls as tier rises, -1 to 5, every table and level', bad.slice(0, 5).join('; '));
}
ok(near(T.tierOf(3, T.PF2_STRIKE_DAMAGE[-1]), 2.5), 'a printed tie reads as the middle of it (level -1 damage 3 -> 2.5)');
ok(near(T.tierOf(21.5, T.PF2_AC[5]), 2.5) && near(T.tierOf(28, T.PF2_AC[5]), 5), 'tierOf interpolates (AC 21.5 at 5 -> 2.5) and extrapolates (28 -> 5)');
ok(near(T.tierOf(T.PF2_SAVES[10].terrible - 2, T.PF2_SAVES[10]), -1), 'tierOf extrapolates below terrible along the end step (saves 10: 14 - 2 -> -1)');
ok(T.valueAt(2, T.PF2_HP[10]) === 175 && T.valueAt(4, T.PF2_HP[10]) === 263, 'HP: moderate is the range midpoint; extreme extends the high-moderate step (175, 263)');

console.log('\npf1TierOf');
{
  // From CR 3 up the anchors are Table 1-1's own columns.
  const r = T.pf1Row(10);
  ok(near(T.pf1TierOf('hp', r.hp, 10), T.HP_ANCHOR_TIER) && T.HP_ANCHOR_TIER === 2.5, 'CR 10 table hp -> HP_ANCHOR_TIER, 2.5 (HISTORY #712)');
  ok(near(T.pf1TierOf('hp', T.pf1Anchors(1 / 3).hp, 1 / 3), 1) && near(T.pf1TierOf('hp', T.pf1Anchors(1).hp, 1), 2.5),
    'the median hp lands on low below CR 1 and on 2.5 from CR 1 (HISTORY #712)',
    `${T.pf1TierOf('hp', T.pf1Anchors(1 / 3).hp, 1 / 3)} ${T.pf1TierOf('hp', T.pf1Anchors(1).hp, 1)}`);
  ok(near(T.pf1TierOf('ac', r.ac, 10), T.AC_ANCHOR_TIER) && T.AC_ANCHOR_TIER === 2.5, 'CR 10 table AC -> 2.5');
  ok(near(T.pf1TierOf('attack', r.highAttack, 10), 3), 'CR 10 high attack -> high');
  ok(near(T.pf1TierOf('dc', r.primaryDC, 10), 3), 'CR 10 primary DC -> high');
  ok(near(T.pf1TierOf('save', r.goodSave, 10), 3), 'CR 10 good save -> high');
  ok(near(T.pf1TierOf('damage', (r.avgDamageHigh + r.avgDamageLow) / 2, 10), T.DAMAGE_ANCHOR_TIER), 'CR 10 mean damage -> DAMAGE_ANCHOR_TIER');
  // The non-anchor columns, as tabulated in tables.js's comment.
  const lo = T.pf1TierOf('attack', r.lowAttack, 10), ps = T.pf1TierOf('save', r.poorSave, 10), sd = T.pf1TierOf('dc', r.secondaryDC, 10);
  ok(near(lo, 1.25) && near(ps, 5 / 3) && near(sd, 1), 'CR 10 low attack 1.25, poor save 1.67, secondary DC 1.00', `${lo} ${ps} ${sd}`);
}
{
  // Below CR 3 the anchors are the measured medians: a CR 1/3 goblin's AC 16
  // is high-plus, not extreme (2e goblin warrior: AC 16 at level -1, tier 3.33).
  const g = T.pf1TierOf('ac', 16, '1/3');
  ok(g > 3 && g < 4, 'goblin (CR 1/3, AC 16) reads between high and extreme', `got ${g}`);
  ok(near(T.pf1Anchors(0.5).ac, 14) && near(T.pf1Anchors(0.5).attack, 3), 'CR 1/2 anchors: AC 14, attack +3 (medians, not the table 11/+1)');
  ok(near(T.pf1Anchors(3).ac, T.pf1Row(3).ac) && near(T.pf1Anchors(2.5).ac, 15), 'the low-CR anchors meet the table at CR 3');
}
{
  const bad = [];
  for (const stat of T.PF1_STATS) for (const cr of [0.25, 1, 5, 12, 20, 26]) {
    const base = T.pf1Anchors(cr)[stat];
    const vals = [0.5, 0.8, 1, 1.25, 1.6].map(f => stat === 'hp' || stat === 'damage' ? base * f : base + (f - 1) * 20);
    const tiers = vals.map(v => T.pf1TierOf(stat, v, cr));
    if (tiers.some((t, i) => i && t <= tiers[i - 1]) || tiers.some(t => !Number.isFinite(t))) bad.push(`${stat} CR ${cr}: ${tiers.map(t => t.toFixed(2))}`);
  }
  ok(bad.length === 0, 'pf1TierOf rises with the value for every stat at CR 1/4, 1, 5, 12, 20, 26', bad.join('; '));
}
{
  let threw = false;
  try { T.pf1TierOf('speed', 30, 5); } catch { threw = true; }
  ok(threw, 'pf1TierOf throws on an unknown stat');
}
ok(Object.isFrozen(T.PF2_AC[5]) && Object.isFrozen(T.PF2_STRIKE_DAMAGE[5].high) && Object.isFrozen(T.PF1_BY_CR[5]), 'rows are frozen');

console.log(`\n${checks} checks, ${failures} FAILED`.replace(', 0 FAILED', ', all passed'));
process.exit(failures ? 1 : 0);
