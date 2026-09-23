// node test/campaign.mjs
//
// The campaign (M8): which levels are open off the save, the stars to
// spend, the shop's refusals, and what loadout folds into a level, down to
// a World built from it. Exits non-zero on any FAIL (#13). Imports through
// pathToFileURL (Windows rule).

import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const load = f => import(pathToFileURL(path.join(HERE, '..', 'js', f)).href);
const { CAMPAIGN, SHOP, isOpen, nextLevel, owned, spent, wallet, canBuy, buy, applies, loadout, convertible, shopItem } = await load('campaign.js');
const { LEVELS, levelById } = await load('levels/pack-01.js');
const { fresh, repair, recordResult } = await load('save.js');
const { World } = await load('sim.js');

let passed = 0, failed = 0;
const ok = (cond, what, detail = '') => {
  if (cond) { passed++; console.log(`  ok    ${what}${detail ? '  ' + detail : ''}`); }
  else { failed++; console.log(`  FAIL  ${what}${detail ? '  ' + detail : ''}`); }
};
const group = name => console.log(`\n${name}`);
const withStars = pairs => { const s = fresh(); for (const [id, n] of pairs) s.levels[id] = { stars: n, best: 100, plays: 1 }; return s; };

group('the order');

ok(CAMPAIGN.join() === 'first-light,stem,four-ways,crossing,two-blocks,rush-hour,school-run,main-street',
  'the campaign is the eight starred levels in pack order, Free Play out of it', CAMPAIGN.join());

group('what is open');

{
  const s = fresh();
  const open = LEVELS.filter(l => isOpen(s, l.id)).map(l => l.id);
  ok(open.join() === 'first-light,free-play', 'a fresh save opens First Light and Free Play and nothing else', open.join());
  ok(nextLevel(s) === 'first-light', 'and points at First Light');
  recordResult(s, 'first-light', { stars: 0, points: 40 });
  ok(!isOpen(s, 'stem'), 'a run on First Light with no star leaves the Stem shut');
  recordResult(s, 'first-light', { stars: 1, points: 90 });
  ok(isOpen(s, 'stem') && !isOpen(s, 'four-ways') && nextLevel(s) === 'stem', 'one star on First Light opens the Stem, and only the Stem', nextLevel(s));
  // a save from before the campaign that played Rush Hour keeps it, whatever came before
  const old = repair({ levels: { 'first-light': { stars: 3 }, 'rush-hour': { stars: 0, plays: 2 } } });
  ok(isOpen(old, 'rush-hour') && !isOpen(old, 'two-blocks') && isOpen(old, 'stem'),
    'a level already played stays open with no star on the one before it (a save from before M8)');
  ok(!isOpen(fresh(), 'no-such-level'), 'a level that does not exist is not open');
  const all = withStars(CAMPAIGN.map(id => [id, 1]));
  ok(nextLevel(all) === null && CAMPAIGN.every(id => isOpen(all, id)), 'a star on every level opens them all and points nowhere');
}

group('stars to spend');

{
  const s = withStars([['first-light', 3], ['stem', 2], ['four-ways', 1]]);
  ok(wallet(s) === 6 && spent(s) === 0 && owned(s).length === 0, 'six stars earned and nothing bought is six to spend', String(wallet(s)));
  ok(canBuy(s, 'sensors').why === 'shut', 'Sensors are shut until Crossing has a star');
  ok(buy(s, 'lefts').ok && s.unlocks.join() === 'phases,lefts' && wallet(s) === 3 && spent(s) === 3, 'protected turns cost 3 and go into unlocks, the list the save already had', s.unlocks.join());
  ok(canBuy(s, 'lefts').why === 'owned' && !buy(s, 'lefts').ok && s.unlocks.length === 2, 'bought once, never twice');
}
{
  const s = withStars([['first-light', 3], ['stem', 2], ['four-ways', 1]]);
  buy(s, 'lefts');
  const c = canBuy(s, 'split');
  ok(!c.ok && c.why === 'short' && !buy(s, 'split').ok && s.unlocks.join() === 'phases,lefts', 'with 3 to spend, extra phases (4) are refused as short and nothing changes', c.why);
  const r = repair(JSON.parse(JSON.stringify(s)));
  ok(r.unlocks.join() === 'phases,lefts' && wallet(r) === 3, 'what was bought comes back through repair with no new field', r.unlocks.join());
  const cheat = repair({ levels: {}, unlocks: ['lefts', 'split', 'sensors', 'roundabout-someday'] });
  ok(wallet(cheat) === 0 && spent(cheat) === 12 && owned(cheat).join() === 'lefts,split,sensors', 'a hand-edited save owning more than it earned has 0 to spend, not a debt, and an unknown unlock costs nothing', `${spent(cheat)} spent`);
}

group('loadout');

{
  const all = ['lefts', 'split', 'sensors'];
  const table = Object.fromEntries(LEVELS.map(l => [l.id, applies(l, all).join('+') || '-']));
  const want = {
    'first-light': 'lefts+split+sensors', stem: 'lefts+split+sensors', 'four-ways': 'split+sensors', crossing: 'split',
    'two-blocks': '-', 'rush-hour': 'lefts+split+sensors', 'school-run': 'lefts+split+sensors', 'main-street': 'lefts+split+sensors', 'free-play': 'lefts+split+sensors',
  };
  const bad = Object.keys(want).filter(id => table[id] !== want[id]);
  ok(!bad.length, 'what each level takes: no arrows where the lefts are protected, no phases on a timed plan, sensors only where there are rules and no loops yet',
    bad.map(id => `${id}: ${table[id]} (want ${want[id]})`).join('; ') || 'all nine as expected');
  ok(LEVELS.every(l => loadout(l, []) === l), 'with nothing bought every level is the same object, untouched');
  const fl = levelById('first-light');
  const before = JSON.stringify(fl);
  const got = loadout(fl, all);
  ok(JSON.stringify(fl) === before && got !== fl, 'loadout copies and never changes the level');
  ok(got.controller.extra.join() === 'lefts,split' && got.sensors === true && got.unlocks.includes('sensors') && got.bought.join() === 'lefts,split,sensors',
    'First Light with everything: both kinds of phase, the loops live and the sensors note', JSON.stringify(got.controller.extra));
  const w = new World(got, 1);
  const names = w.controller.phases.map(p => p.name);
  ok(names.length === 8 && names.slice(0, 2).join() === 'N-S,E-W' && w.controller.cycle === 2 && w.sensors,
    'a World built from it has First Light\'s two phases first, six bought after, and loops', names.join(', '));
  const tb = new World(loadout(levelById('two-blocks'), all), 1);
  ok(tb.controllers.every(c => c.phases.length === 2), 'Two Blocks keeps two phases a box: its plan is the lesson');
  // the level's own run is the same run with things bought and never pressed
  const a = new World(levelById('rush-hour'), 3), b = new World(loadout(levelById('rush-hour'), all), 3);
  for (let i = 0; i < 60 * 240; i++) a.step();
  for (let i = 0; i < 60 * 240; i++) b.step();
  ok(a.stats.cleared === b.stats.cleared && a.stats.collisions === b.stats.collisions && a.controller.log.length === b.controller.log.length,
    'Rush Hour with everything bought and nothing pressed runs as it does without: bought phases sit idle', `${a.stats.cleared}/${b.stats.cleared} cleared, ${a.controller.log.length}/${b.controller.log.length} changes`);
}

group('the roundabout (#594 to #599)');

{
  const conv = LEVELS.filter(convertible).map(l => l.id);
  ok(conv.join() === 'first-light,stem,free-play', 'it converts one box, one lane each way, no walks, no timed plan, no events: First Light, the Stem and Free Play', conv.join());
  ok(conv.every(id => { const r = levelById(id).ring; return r && r.target > 0 && r.waitTarget > 0; }), 'and every board it converts carries its own calibration');
  const item = shopItem('roundabout');
  ok(item && item.cost === 6 && item.after === 'rush-hour', 'on the shelf at 6 once Rush Hour has a star');
  // a star on every campaign level up to Rush Hour is the least a buyer can
  // hold; the most the ring can win back is two more on each board it converts
  const most = conv.filter(id => !levelById(id).sandbox).length * 2;
  ok(item.cost > most, 'it cannot pay for itself: it wins back at most two stars on each of its starred boards', `${most} < ${item.cost}`);
  const s = withStars(CAMPAIGN.slice(0, 5).map(id => [id, 3]));
  ok(canBuy(s, 'roundabout').why === 'shut', 'shut with 15 stars and no star on Rush Hour');
  s.levels['rush-hour'] = { stars: 1, best: 60, plays: 1 };
  ok(buy(s, 'roundabout').ok && wallet(s) === 10 && s.unlocks.includes('roundabout'), 'bought with Rush Hour\'s star: 16 earned, 10 left', String(wallet(s)));
}
{
  const every = ['lefts', 'split', 'sensors', 'roundabout'];
  const table = Object.fromEntries(LEVELS.map(l => [l.id, applies(l, every).join('+') || '-']));
  ok(table['first-light'] === 'roundabout' && table.stem === 'roundabout' && table['free-play'] === 'roundabout' && table['four-ways'] === 'split+sensors' && table['rush-hour'] === 'lefts+split+sensors' && table['two-blocks'] === '-',
    'with everything owned a converted board takes the ring alone, and every other board takes what it took before', JSON.stringify(table));
  const fl = levelById('first-light');
  const before = JSON.stringify(fl);
  const got = loadout(fl, every);
  ok(JSON.stringify(fl) === before, 'loadout leaves First Light itself alone');
  ok(got.network.roundabout === true && got.network.lanesPerDir === 1 && got.unlocks.length === 0 && got.bought.join() === 'roundabout' && !got.controller.extra && !got.sensors,
    'the copy is a ring: nothing on the panel, no bought phases, no loops', JSON.stringify(got.network));
  ok(got.target === fl.ring.target && got.waitTarget === fl.ring.waitTarget && got.target !== fl.target, 'and scored on the ring\'s calibration, not the signals\'', `${got.target} / ${got.waitTarget} s`);
  const w = new World(got, 1);
  ok(w.nodes[0].roundabout && w.controller.roundabout && w.controller.stage === 'dark', 'a World built from it has a ring and a dark controller');
  ok(loadout(fl, ['lefts', 'split', 'sensors']).network.roundabout === undefined, 'switched off (left out of what is bought), First Light is its signals again');
  // a signalled level with the ring owned runs as it does without
  // (built one after the other: car ids come from a module counter)
  const a = new World(levelById('main-street'), 2).run(120);
  const b = new World(loadout(levelById('main-street'), ['roundabout']), 2).run(120);
  ok(a.hash() === b.hash() && loadout(levelById('main-street'), ['roundabout']) === levelById('main-street'), 'Main Street with the ring owned is the same object and the same run', `${a.hash()} ${b.hash()}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
