#!/usr/bin/env node
// generate.mjs — turns structured JSON into the HTML blocks campaigns.html
// hand-authors today: <article class="campaign">, <div class="scenario-group">,
// and <div class="scenario">. Prints to stdout; paste the result into the page
// and commit it like any other edit. Does not touch campaigns.html itself.
//
// Usage:
//   node generate.mjs campaign        [path/to/data.json]
//   node generate.mjs scenario-group  [path/to/data.json]
//   node generate.mjs scenario        [path/to/data.json]
//
// With no path, runs against the matching file in examples/ so you can see
// the shape before writing your own.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function readData(kind, argPath) {
  const file = argPath || path.join(__dirname, 'examples', `${kind}.json`);
  const raw = readFileSync(file, 'utf8');
  return JSON.parse(raw);
}

// ---------------------------------------------------------------- campaign

function renderPill(pill) {
  if (typeof pill === 'string') return `<span class="pill">${esc(pill)}</span>`;
  const statusClass = pill.status ? ` status-${pill.status}` : '';
  return `<span class="pill${statusClass}">${esc(pill.text)}</span>`;
}

function renderRosterEntry(entry) {
  const aside = entry.aside ? ` <span style="opacity:.7">(${esc(entry.aside)})</span>` : '';
  return `              <li>${esc(entry.name)}${aside}\n                <span class="bio">${esc(entry.bio)}</span>\n              </li>`;
}

function renderCampaign(data) {
  const comingSoonClass = data.comingSoon ? ' coming-soon' : '';
  const ribbon = data.ribbon
    ? `\n            <span class="ribbon${data.ribbon.sequel ? ' sequel' : ''}">${esc(data.ribbon.text)}</span>`
    : '';
  const pills = (data.pills || []).map(p => `            ${renderPill(p)}`).join('\n');
  const roster = (data.roster && data.roster.length)
    ? `\n          <div class="roster">\n            <h3>Party Roster</h3>\n            <ul>\n${data.roster.map(renderRosterEntry).join('\n')}\n            </ul>\n          </div>`
    : '';

  return `      <article class="campaign${comingSoonClass}" style="--spine-color:${data.spineColor}">
        <div class="spine"></div>
        <span class="stud s1"></span><span class="stud s2"></span><span class="stud s3"></span><span class="stud s4"></span>
        <div class="body">
          <div class="campaign-head">
            <h2 class="campaign-title">${esc(data.title)}</h2>${ribbon}
          </div>
          <div class="pill-row">
${pills}
          </div>
          <p class="blurb">${esc(data.blurb)}</p>${roster}
        </div>
      </article>`;
}

// ---------------------------------------------------------- scenario-group

function renderRow(cells, numColumns) {
  const tds = cells.map((cell, i) => {
    const cls = numColumns && numColumns[i] ? ' class="num"' : '';
    return `<td${cls}>${cell}</td>`;
  }).join('');
  return `            <tr>${tds}</tr>`;
}

function renderScenarioGroup(data) {
  const headCells = data.columns.map(c => `<th>${esc(c)}</th>`).join('');
  const rows = data.rows.map(r => renderRow(r.cells, data.numColumns)).join('\n');
  const link = data.characterAnchor
    ? `<a href="characters.html#${esc(data.characterAnchor)}">${esc(data.characterName)}</a>`
    : esc(data.characterName);

  return `      <div class="scenario-group" id="${esc(data.id)}">
        <div class="scenario-group-head">
          <h3>${link}</h3>
          <span class="log-summary">${esc(data.summary)}</span>
        </div>
        <table class="chronicle">
          <thead><tr>${headCells}</tr></thead>
          <tbody>
${rows}
          </tbody>
        </table>
        <div class="log-totals">${esc(data.totals)}</div>
      </div>`;
}

// --------------------------------------------------------------- scenario

function renderScenario(data) {
  return `      <div class="scenario" id="${esc(data.id)}">
        <div class="seal">${esc(data.seal)}</div>
        <h3 class="scenario-title">${esc(data.title)}</h3>
        <div class="scenario-meta">${esc(data.meta)}</div>
        <p class="scenario-note">Played as <a href="characters.html#${esc(data.characterAnchor)}">${esc(data.characterName)}</a>.</p>
      </div>`;
}

// --------------------------------------------------------------------- run

const RENDERERS = {
  campaign: renderCampaign,
  'scenario-group': renderScenarioGroup,
  scenario: renderScenario,
};

const [, , kind, argPath] = process.argv;

if (!RENDERERS[kind]) {
  console.error('Usage: node generate.mjs <campaign|scenario-group|scenario> [path/to/data.json]');
  process.exit(1);
}

const data = readData(kind, argPath);
console.log(RENDERERS[kind](data));
