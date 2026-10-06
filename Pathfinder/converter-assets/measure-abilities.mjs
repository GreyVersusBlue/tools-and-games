// measure-abilities.mjs: how the converter words every special ability its
// fixtures hold, and which constructions are still in PF1e wording.
//
//   node Pathfinder/converter-assets/measure-abilities.mjs          writes data/ability-patterns.md
//   node Pathfinder/converter-assets/measure-abilities.mjs --check  exits 1 if that file is stale
//
// It converts every stat block in Pathfinder/tests/fixtures/pf1 and counts the
// abilities on the result by how their text was written: by a rule in
// js/abilities.js, by the converter's wording for a universal ability
// (UMR_TEXT in js/convert.js), or left in PF1e wording. The ones left are then
// counted by the construction their text holds, which is the list the next
// rule is picked from. It changes nothing but its own report.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PF = path.join(HERE, '..');
const OUT = path.join(HERE, 'data', 'ability-patterns.md');
const imp = (p) => import(pathToFileURL(path.join(HERE, 'js', p)).href);
const read = (p) => JSON.parse(fs.readFileSync(path.join(PF, p), 'utf8'));

// The constructions looked for in text no rule rewrote. One ability can hold
// several; the table counts each.
export const PATTERNS = [
  ['a save DC in a sentence', /\bDC \d+/],
  ['damage dice', /\b\d+d\d+/],
  ['a radius or an area ("within 60 feet", "10-foot cube")', /\bwithin \d+ feet\b|\b\d+-f(?:oo)?t\.?\b|\b\d+-foot\b|\bradius\b/i],
  ['a use limit ("3/day", "once per day", "once every 1d4+1 rounds")', /\b\d+\/(?:day|minute|\d+ minutes)|\b(?:once|twice|three times) (?:per|every|a) |\bonce every\b|\bat will\b/i],
  ['an action cost ("as 2 actions", "as a free action")', /\bas (?:\d actions?|a free action|a reaction)\b/i],
  ['a condition with a duration ("paralyzed for 3d6 rounds")', /\b(?:paralyzed|confused|blinded|dazed|stunned|sickened|slowed|frightened|petrified) for \d/i],
  ['a poison or disease stat line', /;\s*frequency\s+\d\//i],
  ['a breath weapon', /\bbreath weapon\b/i],
  ['only a parenthesis from the stat line ("PF1e: DC 29.")', /^(?:.*\. )?PF1e: [^.]*\.{1,2}$/],
];

export async function measure() {
  const { parsePf1 } = await imp('parse-pf1.js');
  const C = await imp('convert.js');
  const S = await imp('spells.js');
  const index = S.buildSpellIndex({
    pf1: read('converter-assets/data/pf1-spells.json'),
    pf2: read('data/spell.json'),
    map: read('converter-assets/data/spell-map.json'),
  });
  const dir = path.join(PF, 'tests', 'fixtures', 'pf1');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.txt')).sort();
  const rows = [];
  for (const f of files) {
    const o = C.convertCreature(parsePf1(fs.readFileSync(path.join(dir, f), 'utf8')), { spellIndex: index });
    for (const a of [...o.defAbilities, ...o.offAbilities, ...o.otherAbilities]) {
      if (/^(Regeneration|Fast Healing) \d/.test(a.name) || a.name === 'Reactive Strike') continue; // numbers on the HP line, and a feat
      rows.push({ file: f.replace(/\.txt$/, ''), name: a.name, wording: a.wording, rule: a.rule || '', text: a.text || '' });
    }
  }
  return { files, rows };
}

const tally = (xs) => {
  const m = new Map();
  for (const x of xs) m.set(x, (m.get(x) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
};
const pct = (n, d) => `${Math.round((n / d) * 100)}%`;

export function render({ files, rows }) {
  const total = rows.length;
  const by = (w) => rows.filter((r) => r.wording === w);
  const rule = by('rule'), umr = by('umr'), pf1e = by('pf1e'), name = by('name');
  const L = [];
  L.push('# Special abilities: how each is worded', '');
  L.push('Written by `node Pathfinder/converter-assets/measure-abilities.mjs`. Do not edit by hand:');
  L.push('`converter-abilities.test.mjs` fails when this file is not what the script writes.', '');
  L.push(`${files.length} stat blocks in \`Pathfinder/tests/fixtures/pf1\` (three are a second layout of a creature`);
  L.push(`already there: \`balor-collapsed\`, \`npc-war-priest-wrapped\`, \`d20pfsrd-owlbear\`), ${total} abilities on the`);
  L.push('converted creatures. Regeneration and fast healing are numbers on the HP line and Reactive');
  L.push('Strike comes from a feat, so none of the three is counted.', '');
  L.push(`These ${files.length} are every PF1e stat block the repo holds: the converter ships spell data and PF2e`);
  L.push('tables, and no creatures of its own, so there is no wider set to measure. A share here is a');
  L.push('share of these fixtures and of nothing else.', '');
  L.push('| How the text was written | Abilities | Share |', '| --- | ---: | ---: |');
  L.push(`| A rule in \`js/abilities.js\`, or the breath weapon rule in \`js/convert.js\` | ${rule.length} | ${pct(rule.length, total)} |`);
  L.push(`| The converter's wording for a universal ability (\`UMR_TEXT\`) | ${umr.length} | ${pct(umr.length, total)} |`);
  L.push(`| PF1e wording, DCs and action costs converted, marked "PF1e wording" | ${pf1e.length} | ${pct(pf1e.length, total)} |`);
  L.push(`| A name with no text in the stat block | ${name.length} | ${pct(name.length, total)} |`, '');
  L.push('## By rule', '', '| Rule | Abilities | Creatures |', '| --- | ---: | --- |');
  for (const [r, n] of tally(rule.map((x) => x.rule))) L.push(`| ${r} | ${n} | ${rule.filter((x) => x.rule === r).map((x) => x.file).join(', ')} |`);
  L.push('', '## What the PF1e wording holds', '');
  L.push(`The ${pf1e.length} abilities no rule rewrote, by the constructions in their text. An ability with two`);
  L.push('constructions is counted under both.', '', '| Construction | Abilities |', '| --- | ---: |');
  const counts = PATTERNS.map(([label, re]) => [label, pf1e.filter((r) => re.test(r.text)).length]).sort((a, b) => b[1] - a[1]);
  for (const [label, n] of counts) L.push(`| ${label} | ${n} |`);
  L.push(`| none of these | ${pf1e.filter((r) => !PATTERNS.some(([, re]) => re.test(r.text))).length} |`);
  L.push('', '## Not rewritten, by name', '', 'PF1e wording and bare names together, most frequent first.', '', '| Ability | Times | Creatures |', '| --- | ---: | --- |');
  const left = [...pf1e, ...name];
  for (const [n, k] of tally(left.map((x) => x.name))) L.push(`| ${n} | ${k} | ${left.filter((x) => x.name === n).map((x) => x.file).join(', ')} |`);
  return L.join('\n') + '\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const text = render(await measure());
  if (process.argv.includes('--check')) {
    const have = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (have !== text) { console.error('data/ability-patterns.md is stale: run measure-abilities.mjs'); process.exit(1); }
    console.log('data/ability-patterns.md is current');
  } else {
    fs.writeFileSync(OUT, text);
    console.log(`wrote ${path.relative(PF, OUT)}`);
  }
}
