// dossier-template.test.mjs: characters.html carries a commented-out
// <template> of one dossier, and it has to stay true to the real ones.
//
//   node Pathfinder/tests/dossier-template.test.mjs      (from the repo root)
//
// Exits non-zero on any failure.
//
// WHY. A template is documentation, and documentation of markup rots the day
// someone adds a part to a real dossier and not to the copy everyone pastes
// from (#627). So: every class a real dossier uses is in the template, every
// class the template uses has a rule in the page's <style>, every section
// heading a real dossier uses is in the template or its notes, and the notes'
// three claims about the real dossiers are checked against all of them.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, '..', 'characters.html'), 'utf8');

let checks = 0, failures = 0;
const ok = (cond, label, detail = '') => {
  checks++;
  if (cond) console.log(`  ok    ${label}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};

const classes = (html) => new Set([...html.matchAll(/class="([^"]+)"/g)].flatMap(m => m[1].split(/\s+/)));
const headings = (html) => new Set([...html.matchAll(/<h3>([^<]+)<\/h3>/g)].map(m => m[1]));

const comments = [...SRC.matchAll(/<!--([\s\S]*?)-->/g)];
const found = comments.filter(m => /^\s*dossier template\b/.test(m[1]));

console.log('\nthe template');
ok(found.length === 1, 'characters.html has exactly one "dossier template" comment', `it has ${found.length}`);
if (found.length !== 1) { console.log(`\n${checks} checks, ${failures} FAILED`); process.exit(1); }

const comment = found[0][1];
const tpl = (comment.match(/<template>([\s\S]*?)<\/template>/) || [])[1] ?? '';
ok((tpl.match(/<article class="dossier"/g) || []).length === 1, 'the comment holds a <template> with one <article class="dossier">');
ok(!comment.includes('--'), 'the comment has no "--" in its body, so it closes where it looks like it does');

const live = SRC.replace(/<!--[\s\S]*?-->/g, '');
const dossiers = [...live.matchAll(/<article class="dossier" id="([^"]+)"[\s\S]*?<\/article>/g)]
  .map(m => ({ id: m[1], html: m[0] }));
ok(dossiers.length > 0, `the page has real dossiers to hold it to (${dossiers.length})`);

const tplClasses = classes(tpl);
const used = new Set(dossiers.flatMap(d => [...classes(d.html)]));
const missing = [...used].filter(c => !tplClasses.has(c));
ok(missing.length === 0, `every class the ${dossiers.length} real dossiers use is in the template (${used.size})`,
  `not in the template: ${missing.join(', ')}`);

const css = SRC.slice(SRC.indexOf('<style'), SRC.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, '');
const unstyled = [...tplClasses].filter(c => !new RegExp(`\\.${c.replace(/-/g, '\\-')}(?![\\w-])`).test(css));
ok(unstyled.length === 0, `every class the template uses has a rule in the page's <style> (${tplClasses.size})`,
  `no rule for: ${unstyled.join(', ')}`);

const sections = new Set(dossiers.flatMap(d => [...headings(d.html)]));
const unnamed = [...sections].filter(h => !comment.includes(h));
ok(unnamed.length === 0, `every section heading a real dossier uses is in the template or its notes (${sections.size})`,
  `not mentioned: ${unnamed.join(', ')}`);

console.log('\nthe notes\' claims, against every real dossier');
const vitals = (html) => [...html.matchAll(/<span>([^<]+)<span class="vital-val">/g)].map(m => m[1]);
const bad = dossiers.filter(d => vitals(d.html).slice(0, 3).join(',') !== 'HP,AC,Perc');
ok(bad.length === 0, 'vitals-row always opens HP, AC, Perc', bad.map(d => `${d.id}: ${vitals(d.html).join(', ')}`).join('\n        '));

const both = dossiers.filter(d => /<h3>Who They Are<\/h3>/.test(d.html) === /class="placeholder-flag"/.test(d.html));
ok(both.length === 0, 'each dossier has Who They Are or Backstory pending, never both or neither',
  both.map(d => d.id).join(', '));

const orgOf = (d) => ({
  cls: (d.html.match(/class="dossier-class">(\w+) Society/) || [])[1],
  pill: { PFS: 'Pathfinder', SFS: 'Starfinder' }[(d.html.match(/class="pill">(\w+)</) || [])[1]],
  record: (d.html.match(/<h3>(\w+) Society Record<\/h3>/) || [])[1],
});
const split = dossiers.filter(d => { const o = orgOf(d); return !o.cls || o.cls !== o.pill || (o.record && o.record !== o.cls); });
ok(split.length === 0, 'dossier-class, pill and record box name the same society',
  split.map(d => `${d.id}: ${JSON.stringify(orgOf(d))}`).join('\n        '));

console.log(`\n${checks} checks, ${failures ? `${failures} FAILED` : '0 failed'}`);
process.exit(failures ? 1 : 0);
