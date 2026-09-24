// chronicle.test.mjs: campaigns.html's two chronicle views have to say the
// same thing.
//
//   node Pathfinder/tests/chronicle.test.mjs      (from the repo root)
//
// Exits non-zero on any drift.
//
// WHY A TEST AND NOT THE MERGE STEP. The "As Player" panel carries every
// scenario twice: once under its character (By Character) and once in one
// table per org sorted by scenario number (Chronological). Both are hand-kept.
// The generator's README names the merge/sort step that would derive the
// second from the first as a known gap, to be built "if the two views actually
// drift, not speculatively". On 2026-09-24 they had not drifted (#626), so the
// honest increment was the check that says when they do. When this fails on a
// real edit, that is the day the merge step in
// campaigns-assets/generator/ earns its keep.
//
// WHAT IT COMPARES. Per org, the multiset of (character, scenario, XP, reward,
// reputation) rows in each view; the Chronological table's order; and each
// view's own summary line against the rows under it. A one-shot `.scenario`
// card counts as one By Character row, its numbers read from its meta line
// and '—' where the meta line has none.
//
// WHAT IT DOES NOT. The dim `<span>` asides in a scenario cell are dropped
// before comparing: By Character says "(holding for Level 3)" where
// Chronological says "(holding)", on purpose, and the XP of 0 carries the fact
// either way. The By Character `.log-totals` lines are not summed; that is one
// view against itself, not the two views against each other.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, '..', 'campaigns.html'), 'utf8');

let checks = 0, failures = 0;
const ok = (cond, label, detail = '') => {
  checks++;
  if (cond) console.log(`  ok    ${label}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};

/* ------------------------------------------------------------- parsing ---- */

const text = (html) => html
  .replace(/<span\b[^>]*>[\s\S]*?<\/span>/g, '')   // the dim asides
  .replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ')
  .trim();

const cells = (tr, tag) => [...tr.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'g'))].map(m => m[1]);
const rowsOf = (html) => [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(m => m[1]);
const anchorOf = (html) => (html.match(/href="characters\.html#([^"]+)"/) || [])[1] ?? null;

function between(src, startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  if (a < 0) throw new Error(`campaigns.html has no ${startMarker}`);
  const b = endMarker ? src.indexOf(endMarker, a) : src.length;
  if (b < 0) throw new Error(`campaigns.html has no ${endMarker} after ${startMarker}`);
  return src.slice(a, b);
}

/** Splits a view into { org: html } on its <h2 class="org-header"> headings. */
function byOrg(view) {
  const parts = view.split(/<h2 class="org-header">/).slice(1);
  return Object.fromEntries(parts.map(p => [text(p.slice(0, p.indexOf('</h2>'))), p]));
}

/** One view's blocks: each .scenario-group or .scenario, in document order. */
function blocks(html) {
  const re = /<div class="(scenario-group|scenario)"[^>]*>/g;
  const starts = [...html.matchAll(re)];
  return starts.map((m, i) => ({
    kind: m[1],
    html: html.slice(m.index, i + 1 < starts.length ? starts[i + 1].index : html.length),
  }));
}

/** A row keyed so the two views can be compared: header name -> cell text. */
function record(org, character, anchor, byHeader) {
  const reward = byHeader.Gold ?? byHeader.Credits ?? byHeader.Reward ?? '—';
  return {
    org, character, anchor,
    scenario: byHeader.Scenario,
    xp: byHeader.XP ?? '—',
    reward,
    rep: byHeader.Reputation ?? null,
  };
}
const key = (r) => [r.org, r.anchor, r.character, r.scenario, r.xp, r.reward, r.rep ?? ''].join(' | ');

const summaryOf = (html) => text((html.match(/<span class="log-summary">([\s\S]*?)<\/span>/) || [])[1] ?? '');

/** By Character: every group's rows plus every one-shot card, per org. */
function parseByCharacter(view) {
  const out = {};
  for (const [org, html] of Object.entries(byOrg(view))) {
    const rows = (out[org] = { rows: [], groups: [] });
    for (const b of blocks(html)) {
      if (b.kind === 'scenario-group') {
        const h3 = b.html.match(/<h3>([\s\S]*?)<\/h3>/)[1];
        const character = text(h3), anchor = anchorOf(h3);
        const head = cells(b.html.match(/<thead>([\s\S]*?)<\/thead>/)[1], 'th').map(text);
        const group = { character, summary: summaryOf(b.html), rows: [] };
        for (const tr of rowsOf(b.html.match(/<tbody>([\s\S]*?)<\/tbody>/)[1])) {
          const tds = cells(tr, 'td');
          const r = record(org, character, anchor, Object.fromEntries(head.map((h, i) => [h, text(tds[i])])));
          group.rows.push(r); rows.rows.push(r);
        }
        rows.groups.push(group);
      } else {
        const title = text(b.html.match(/<h3 class="scenario-title">([\s\S]*?)<\/h3>/)[1]);
        const meta = text(b.html.match(/<div class="scenario-meta">([\s\S]*?)<\/div>/)[1]).split(' · ');
        const note = b.html.match(/<p class="scenario-note">([\s\S]*?)<\/p>/)[1];
        const played = note.match(/<a\b[^>]*>([\s\S]*?)<\/a>/);
        const xp = meta.find(m => /^\d+ XP$/.test(m));
        const reward = meta.find(m => /^[\d,]+ (gp|cr)\b/.test(m));
        const rep = meta.filter(m => m !== meta[0] && m !== xp && m !== reward).join(', ');
        const byHeader = { Scenario: title, XP: xp ? xp.replace(' XP', '') : '—', Reward: reward ?? '—' };
        if (org === 'Pathfinder Society') byHeader.Reputation = rep || '—';
        rows.rows.push(record(org, text(played[1]), anchorOf(note), byHeader));
      }
    }
  }
  return out;
}

/** Chronological: one table per org, with a Character column. */
function parseChronological(view) {
  const out = {};
  for (const [org, html] of Object.entries(byOrg(view))) {
    const head = cells(html.match(/<thead>([\s\S]*?)<\/thead>/)[1], 'th').map(text);
    const rows = rowsOf(html.match(/<tbody>([\s\S]*?)<\/tbody>/)[1]).map(tr => {
      const tds = cells(tr, 'td');
      const byHeader = Object.fromEntries(head.map((h, i) => [h, text(tds[i])]));
      return { ...record(org, byHeader.Character, anchorOf(tds[0]), byHeader), raw: tr };
    });
    out[org] = { rows, summary: summaryOf(html) };
  }
  return out;
}

/* ------------------------------------------------------ chronicle order ---- */
/* Season-number, as Paizo numbers them: "5-07" is season 5, scenario 7, and
   "Special 4-99" sorts as 4-99. The Beginner Box predates season 1. Anything
   else unnumbered sorts last. Ties (two parts of one 7-09) go by title. */
function order(scenario) {
  const m = scenario.match(/^(?:Special )?(\d+)-(\d+)/);
  if (m) return [+m[1], +m[2]];
  if (/^Beginner Box\b/.test(scenario)) return [0, 0];
  return [1e9, 0];
}
function compare(a, b) {
  const [x, y] = [order(a.scenario), order(b.scenario)];
  return (x[0] - y[0]) || (x[1] - y[1]) || a.scenario.localeCompare(b.scenario);
}

/* --------------------------------------------------------------- checks ---- */

function counted(rows) {
  const m = new Map();
  for (const r of rows) m.set(key(r), (m.get(key(r)) || 0) + 1);
  return m;
}
const xpSum = (rows) => rows.reduce((n, r) => n + (/^\d+$/.test(r.xp) ? +r.xp : 0), 0);

const byChar = parseByCharacter(between(SRC, 'id="view-by-character"', 'id="view-chronological"'));
const chrono = parseChronological(between(SRC, 'id="view-chronological"', '</section>'));

console.log('\norgs');
ok(JSON.stringify(Object.keys(byChar)) === JSON.stringify(Object.keys(chrono)),
  `both views list the same orgs in the same order: ${Object.keys(byChar).join(', ')}`,
  `By Character ${JSON.stringify(Object.keys(byChar))}, Chronological ${JSON.stringify(Object.keys(chrono))}`);

for (const org of Object.keys(byChar)) {
  const a = byChar[org], b = chrono[org];
  if (!b) continue;
  console.log(`\n${org}`);

  const ca = counted(a.rows), cb = counted(b.rows);
  const missing = [...ca].filter(([k, n]) => (cb.get(k) || 0) < n).map(([k]) => k);
  const extra = [...cb].filter(([k, n]) => (ca.get(k) || 0) < n).map(([k]) => k);
  ok(missing.length === 0,
    `every By Character row (${a.rows.length}) is in Chronological`,
    missing.map(k => `By Character only: ${k}`).join('\n        '));
  ok(extra.length === 0,
    `every Chronological row (${b.rows.length}) is in By Character`,
    extra.map(k => `Chronological only: ${k}`).join('\n        '));

  const bad = b.rows.findIndex((r, i) => i > 0 && compare(b.rows[i - 1], r) > 0);
  ok(bad === -1, 'Chronological is in scenario-number order',
    bad === -1 ? '' : `"${b.rows[bad - 1].scenario}" is above "${b.rows[bad].scenario}"`);

  const want = `${b.rows.length} scenarios · ${xpSum(b.rows)} XP tallied`;
  ok(b.summary === want, `Chronological summary reads "${want}"`, `it reads "${b.summary}"`);

  for (const g of a.groups) {
    const holding = g.rows.filter(r => r.xp === '0').length;
    const want = `${g.rows.length} scenarios${holding ? ` (${holding} holding)` : ''} · ${xpSum(g.rows)} XP`;
    ok(g.summary === want, `${g.character}'s summary reads "${want}"`, `it reads "${g.summary}"`);
  }
}

console.log(`\n${checks} checks, ${failures ? `${failures} FAILED` : '0 failed'}`);
process.exit(failures ? 1 : 0);
