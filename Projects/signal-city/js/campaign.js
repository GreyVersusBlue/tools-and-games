// Signal City: the campaign (M8). The starred levels in pack order, each
// opened by a star on the one before it, and a shop that spends stars on
// what a level would otherwise not give you. Plain functions over the save
// and the level data: the world never sees this file, it sees the level
// `loadout` hands it.
//
// Nothing here adds a field to the save. What is open is read off
// `levels` (a star on the level before, or a play of this one, so nobody
// loses a board they already reached); what is bought is `unlocks`, the
// list the save has carried since M4; stars to spend are the stars earned
// less the price of everything in `unlocks`.

import { LEVELS, levelById } from './levels/pack-01.js';
import { standardPhases, extraPhases } from './signals.js';
import { totalStars } from './save.js';

export const CAMPAIGN = LEVELS.filter(l => !l.sandbox).map(l => l.id);

// `after`: the level whose star puts the item on the shelf, the one that
// teaches it. `cost` in stars. The roundabout is not here yet: it wants the
// node type M9 builds.
export const SHOP = [
  {
    id: 'lefts', name: 'Protected turns', cost: 3, after: 'four-ways',
    blurb: 'An arrow phase for each street\'s lefts, on every board without one. The cycle never runs it: press it, or name it in a rule.',
  },
  {
    id: 'split', name: 'Extra phases', cost: 4, after: 'stem',
    blurb: 'One phase per leg, everything off it at once with its left protected. For the approach that needs the box to itself.',
  },
  {
    id: 'sensors', name: 'Sensors', cost: 5, after: 'crossing',
    blurb: 'Induction loops in every lane on every board with rules, so a queue rule fires when its lane fills.',
  },
];

export const shopItem = id => SHOP.find(s => s.id === id) || null;

const starsOn = (save, id) => (save.levels[id] && save.levels[id].stars) || 0;
const played = (save, id) => !!save.levels[id] && (save.levels[id].plays > 0 || save.levels[id].stars > 0);

// A starred level opens on a star from the one before it in the campaign;
// the first is always open, and so is the sandbox.
export function isOpen(save, id) {
  const lvl = levelById(id);
  if (!lvl) return false;
  if (lvl.sandbox) return true;
  const i = CAMPAIGN.indexOf(id);
  return i <= 0 || starsOn(save, CAMPAIGN[i - 1]) > 0 || played(save, id);
}

// The first open level with no star yet: where the select points you.
export function nextLevel(save) {
  return CAMPAIGN.find(id => isOpen(save, id) && starsOn(save, id) === 0) || null;
}

export const owned = save => SHOP.filter(s => save.unlocks.includes(s.id)).map(s => s.id);

export function spent(save) {
  return owned(save).reduce((n, id) => n + shopItem(id).cost, 0);
}

// Stars to spend. A hand-edited save that owns more than it earned reads 0,
// not a debt.
export function wallet(save) { return Math.max(0, totalStars(save) - spent(save)); }

// { ok, why }: why is 'owned' | 'shut' (its level has no star yet) | 'short'
export function canBuy(save, id) {
  const item = shopItem(id);
  if (!item) return { ok: false, why: 'unknown' };
  if (save.unlocks.includes(id)) return { ok: false, why: 'owned' };
  if (starsOn(save, item.after) === 0) return { ok: false, why: 'shut' };
  if (wallet(save) < item.cost) return { ok: false, why: 'short' };
  return { ok: true, why: '' };
}

export function buy(save, id) {
  const c = canBuy(save, id);
  if (c.ok) save.unlocks.push(id);
  return c;
}

// What of `bought` a level would take. A timed plan takes no phases (the
// plan is the lesson and never presses one), a level that already runs its
// lefts protected takes no arrows, and sensors go only where there are
// rules to fire.
export function applies(level, bought) {
  const ctl = level.controller || {};
  const legs = (level.network && level.network.legs) || ['N', 'E', 'S', 'W'];
  const timed = ctl.mode === 'timed';
  const own = ctl.phases || standardPhases(legs, { lefts: !!ctl.lefts, peds: !!ctl.peds, main: ctl.main || 'NS' });
  const out = [];
  for (const id of bought) {
    if (id === 'sensors') { if (!level.sensors && (level.unlocks || []).includes('auto')) out.push(id); continue; }
    if (timed) continue;
    if (extraPhases(legs, [id], own).length) out.push(id);
  }
  return out;
}

// The level the world is built from: a copy with what was bought folded in.
// The level itself is never changed, and a level that takes nothing comes
// back as the same object.
export function loadout(level, bought) {
  const use = applies(level, bought);
  if (!use.length) return level;
  const out = { ...level, controller: { ...(level.controller || {}) }, unlocks: (level.unlocks || []).slice(), bought: use };
  const phases = use.filter(id => id !== 'sensors');
  if (phases.length) out.controller.extra = phases;
  if (use.includes('sensors')) { out.sensors = true; if (!out.unlocks.includes('sensors')) out.unlocks.push('sensors'); }
  return out;
}
