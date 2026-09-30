// app.js — boots the Conversion Codex: tabs, data, hash routes.
//
// Routes: #creature (default) and #spell/<PF1e spell name>. Nothing is saved
// to browser storage; a pasted stat block lives only in the page.

import { buildSpellIndex } from './spells.js';
import { initSpells } from './ui-spells.js';
import { initCreature } from './ui-creature.js';

const $ = (id) => document.getElementById(id);
let index = null;
const getIndex = () => index;

function selectTab(name) {
  for (const t of ['creature', 'spells']) {
    $(`tab-${t}`).setAttribute('aria-selected', String(t === name));
    $(`panel-${t}`).hidden = t !== name;
  }
}

const creature = initCreature(getIndex);
const spells = initSpells(getIndex);

$('tab-creature').addEventListener('click', () => { selectTab('creature'); history.replaceState(null, '', '#creature'); });
$('tab-spells').addEventListener('click', () => { selectTab('spells'); history.replaceState(null, '', '#spells'); $('spell-q').focus(); });

function route() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (h.startsWith('spell')) {
    selectTab('spells');
    const name = h.split('/')[1];
    if (name && index) spells.show(name);
  } else selectTab('creature');
}
window.addEventListener('hashchange', route);
route();

const getJson = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
};

Promise.all([
  getJson('converter-assets/data/pf1-spells.json'),
  getJson('converter-assets/data/spell-map.json'),
  getJson('data/spell.json'),
  getJson('converter-assets/data/embeds.json'),
]).then(([pf1, map, pf2, embeds]) => {
  index = buildSpellIndex({ pf1, pf2, map, embeds });
  const withMatch = Object.values(map.map || {}).filter((v) => v.fit !== 'none').length;
  $('spell-status').textContent = `${pf1.length.toLocaleString()} PF1e spells, ${withMatch.toLocaleString()} with a PF2e equivalent`;
  document.body.dataset.ready = 'true';
  route();
  creature.rerun();
}).catch((err) => {
  console.error(err);
  $('spell-status').textContent = `Spell lists failed to load (${err.message}). Creature conversion still works without spells.`;
  document.body.dataset.ready = 'error';
});
