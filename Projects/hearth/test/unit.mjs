// Hearth's unit suite (TG-26): the functions, called one at a time in Node, with no browser and no install.
//
//   node unit.mjs            (from Projects/hearth/test)
//
// Until this file every check of Hearth drove the real page through Playwright, so no test could say "this function is wrong",
// only "this island went wrong somewhere". load.mjs runs the real scripts in a vm context; this calls into them directly and sets up
// exactly the state each function reads. Each check names the thing it guards, and each was broken once in the code and watched
// fail on its own line (#34) — the break is written beside it.
import { loadHearth } from './load.mjs';

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++; else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}
// a section that throws is a failed check with its number on it, not a dead suite: a crash is red, but it is not the assertion
function section(n, fn) { try { fn(); } catch (e) { fail++; console.log(`  FAIL section ${n} threw — ${String(e.stack || e).split('\n').slice(0, 2).join(' ')}`); } }
function fresh(seed = 7) { const h = loadHearth(); h.H.newWorld(seed); return h; }

// ---- the stream ----
section(1, () => {
  const { ev } = fresh();
  const a = ev('(()=>{const r=mulberry(12345);return [r(),r(),r()]})()'), b = ev('(()=>{const r=mulberry(12345);return [r(),r(),r()]})()');
  check('mulberry: one seed, one sequence', JSON.stringify(a) === JSON.stringify(b) && a.every(x => x >= 0 && x < 1));
  check('hash: FNV-1a of "abc" is 0x1a47e90b', ev('hash("abc")') === 0x1a47e90b);
});
section(2, () => {
  // two islands from one seed, stepped the same, pack the same. Node's V8 is not the pinned Chromium's, so this compares Node with Node.
  const one = fresh(7), two = fresh(7);
  for (const h of [one, two]) h.ev('for(let i=0;i<2800*2;i++)step(.05)');
  check('newWorld + step: one seed, one island, in Node', JSON.stringify(one.H.pack()) === JSON.stringify(two.H.pack()));
});

// ---- the save ----
section(3, () => {
  const { H, ev } = fresh();
  ev('for(let i=0;i<2800*3;i++)step(.05)');
  const a = JSON.stringify(H.pack());
  H.unpack(JSON.parse(a));
  check('pack -> unpack -> pack is byte-identical', a === JSON.stringify(H.pack()));
  const cur = H.pack(), bad = [];
  for (let v = H.SAVE_MIN; v < H.SAVE_V; v++) {
    const o = H.forge(JSON.parse(JSON.stringify(cur)), v);
    if (o.v !== v) { bad.push(`forge stopped at v${o.v} for v${v}`); continue; }
    if (!H.canLoad(o)) bad.push(`canLoad refused v${v}`);
    H.migrate(o);
    if (o.v !== H.SAVE_V) bad.push(`v${v} migrated to v${o.v}`);
  }
  check('the ladder: every shape SAVE_MIN..SAVE_V-1 forges down and migrates back up', !bad.length, bad.join('; '));
  check('canLoad: v4 and v18 are refused, v17 accepted', !H.canLoad({ ...cur, v: 4 }) && !H.canLoad({ ...cur, v: 18 }) && H.canLoad({ ...cur, v: 17 }));
});

// ---- the bounded lists ----
section(4, () => {
  const { ev } = fresh();
  const n = ev('(()=>{const p=people[0];p.hist=[];for(let i=0;i<100;i++)p.hist.push({d:i,s:"line "+i});trimHist(p);return [p.hist.length,p.hist[0].s,p.hist[p.hist.length-1].s]})()');
  check('trimHist: a hundred lines keep the first and the last 59', n[0] === 60 && n[1] === 'line 0' && n[2] === 'line 99', JSON.stringify(n));
  const e = ev('(()=>{for(let i=0;i<100;i++)addEvent("t"+i,"label "+i,null);return [events.length,events[events.length-1].label]})()');
  check('addEvent: the recent-events list holds forty', e[0] === 40 && e[1] === 'label 99', JSON.stringify(e));
});

// ---- who may tell a child about the dead (TG-26) ----
// Day 1000 of a forced island: a grave `ago` days old (seventy by default), nobody related to it, and a child of six who was two
// when it was dug, or with `ago` 240 a child of seven born after it. The teller is whoever else is set up. Break: put `elds` back
// to elders only, and "an adult who was there" tells nobody in 300 rolls.
function tellRig(teller, ago = 70) {
  const h = fresh(), { ev, ctx } = h;
  ev('dayCount=1000');
  ev(`(()=>{const ps=people.slice(0,4);
    for(const p of ps){p.rels=[];p.age0=30;p.born=dayCount-10}            /* everyone else arrived last week: they knew nobody up there */
    const kd=ps[0];kd.age0=0;kd.born=dayCount-(${ago}>100?140:120);
    graves.push({x:1,y:1,name:'Tamsin',d:dayCount-${ago},y2:1,age:71,vn:0});dead.push({name:'Tamsin',rels:[],dead:true,hist:[],tr:[]});
    ${teller}})()`);
  const said = [];
  const real = ctx.say;
  ctx.say = (s, f, t) => { if (t === 'tolddead') said.push(s.match(/<b>([^<]+)<\/b>/)[1]); return real(s, f, t); };
  let rolls = 0;
  while (rolls < 300 && !said.length) { h.H.tellOfDead(); rolls++; }
  return { said, rolls, names: ev('people.slice(0,4).map(p=>p.name)'), line: ev('(people[0].hist.find(x=>x.s.includes("Tamsin"))||{}).s||""') };
}
section(5, () => {
  const r = tellRig('const t=ps[1];t.age0=20;t.born=dayCount-200;');   // thirty, here since before the grave, twenty-six when it was dug
  check('teller: a grown adult who was there tells, when no elder can', r.said[0] === r.names[1] && r.line.includes('too small'), `${r.rolls} rolls, said ${r.said}, "${r.line}"`);
});
section(6, () => {
  const r = tellRig('const t=ps[1];t.age0=0;t.born=dayCount-320;', 240); // sixteen, born here, four when it was dug
  check('teller: an adult who was under five at the death does not', !r.said.length, `told by ${r.said}`);
});
section(7, () => {
  const r = tellRig('');                                                  // nobody but newcomers and the child
  check('teller: nobody who arrived after the stone tells', !r.said.length, `told by ${r.said}`);
});
section(8, () => {
  const r = tellRig('const t=ps[1];t.age0=0;t.born=dayCount-320;t.rels=[{who:"Tamsin",k:"parent"}];', 240);   // four at the death, but it was their parent
  check('teller: and says the child was not yet born', r.line.includes('before'), r.line);
  check('teller: an adult whose parent it was tells, however small they were', r.said[0] === r.names[1], `told by ${r.said}`);
});
section(9, () => {
  // an elder and an adult who both qualify: the elder, every time. Break: drop the elders-first pass, and the adult tells some of them.
  const tellers = new Set();
  for (let i = 0; i < 12; i++) {
    const r = tellRig('const t=ps[1];t.age0=20;t.born=dayCount-200;const e=ps[2];e.age0=55;e.born=dayCount-200;');
    if (r.said[0]) tellers.add(r.said[0] === r.names[2] ? 'elder' : 'adult');
    // a fresh island per run: the stream moves with the newWorld seed draw, so 12 islands are 12 different picks
  }
  check('teller: an elder goes first when there is one', tellers.size === 1 && tellers.has('elder'), [...tellers].join(','));
});

// ---- a house going up survives the night and the save (TG-26) ----
section(10, () => {
  const { H, ev } = fresh();
  ev('wood=200;food=200');
  const s = ev('(()=>{const s=freeSpot(3,11,2);plots.push({x:s.x,y:s.y,prog:6,forCouple:null});return s})()');
  // nobody is on it; someone free picks it up, and the house stands on the plot. Break: drop the orphan branch, and it is never finished.
  let steps = 0;
  while (steps < 2800 * 3 && !ev(`houses.some(h=>h.x===${s.x}&&h.y===${s.y})`)) { H.step(.05); steps++; }
  check('plot: a dropped plot is picked up and finished where it was paced', ev(`houses.some(h=>h.x===${s.x}&&h.y===${s.y})`) && !H.plots.some(q => q.x === s.x && q.y === s.y), `${steps} steps`);
  ev(`plots.length=0;plots.push({x:${s.x}+20,y:${s.y},prog:7.4,forCouple:['A','B']})`);
  const o = JSON.parse(JSON.stringify(H.pack()));
  check('plot: pack writes it', JSON.stringify(o.hp) === JSON.stringify([[s.x + 20, s.y, 7.4, ['A', 'B']]]), JSON.stringify(o.hp));
  H.unpack(o);
  check('plot: unpack brings it back at its progress', H.plots.length === 1 && H.plots[0].prog === 7.4 && H.plots[0].forCouple.join() === 'A,B');
  const f = H.forge(JSON.parse(JSON.stringify(H.pack())), 16);
  check('plot: a v16 save has no hp and comes back with no plots', f.hp === undefined && (H.unpack(f), H.plots.length === 0));
});
section(11, () => {
  // and the ground under it is not free. Break: drop plots from freeSpot, and a second plot lands on the first.
  const { ev } = fresh();
  const near = ev(`(()=>{const s=freeSpot(3,11,2);plots.push({x:s.x,y:s.y,prog:1,forCouple:null});let n=0;
    for(let i=0;i<400;i++){const q=freeSpot(3,11,2);if(q&&Math.abs(q.x-s.x)<2.6&&Math.abs(q.y-s.y)<2.6)n++}return n})()`);
  check('plot: freeSpot never offers the ground under a plot', near === 0, `${near} of 400`);
});

// ---- nobody sails off the beach in the island's first ten days (TG-26) ----
// The store empty and hunger full, newDay rolled forty times on day 10 and forty on day 11. Break: drop `dayCount>FIRST_DAYS`, and
// day 10 loses people like any other day.
section(13, () => {
  const { ev } = fresh();
  ev('for(let i=0;i<4;i++)addPerson(center.x+i,center.y)');
  const gone = d => ev(`(()=>{const n0=gone.length;for(let i=0;i<40;i++){dayCount=${d};food=0;granary=0;hunger=1;newDay()}return gone.length-n0})()`);
  const early = gone(10), late = gone(11);
  check('first days: a starving island keeps everyone through day 10', early === 0, `${early} gone`);
  check('first days: and from day 11 hunger sends people off again', late > 0, `${late} gone`);
});

// ---- the non-finite guard leaves a crumb that says which went first (TG-26) ----
section(12, () => {
  const { H, ev, warns } = fresh();
  ev('people[0].tx=NaN;people[0].task="gather"');
  H.step(.05);
  const p = H.people[0];
  check('non-finite: a bad target is healed in one step', isFinite(p.x) && isFinite(p.tx) && isFinite(p.ty));
  check('non-finite: the crumb names the task and says it was the target', warns.some(w => w.includes('non-finite') && w.includes('gather') && w.includes('target')), warns.join(' | '));
});

// ---- the ground under a new way, and the morning walk out to it (TG-29, #922) ----
// LORE_PLACE.way.at() finds its way by the words wayDay wrote into the chronicle, so each way here comes through the real wayDay
// (its roll and its condition forced, the other three marked learned) and is then grown the way a third telling grows it.
// Breaks, each watched: reword 'the sail' or 'the plough' in WAYS, or in WAY_AT; swap WAY_AT's two names; have at() take the
// first grown way whatever it is (the old line).
function wayRig(order, { hut = true, farm = false } = {}) {
  const h = fresh(), { ev } = h;
  ev(`(()=>{while(seaDay()!==3||dayCount<=YEAR)dayCount++;
    ${hut ? "if(!getB('hut'))bldg.push({kind:'hut',x:shore[0].x,y:shore[0].y});" : "bldg=bldg.filter(b=>b.kind!=='hut');"}
    ${farm ? 'if(!farms.length)farms.push({x:Math.round(center.x),y:Math.round(center.y)});' : ''}
    const r=R;R=()=>0;
    for(const i of ${JSON.stringify(order)}){const c=WAYS[i].cond;WAYS[i].cond=()=>true;ways=15&~(1<<i);wayYr=0;wayDay(900+i);WAYS[i].cond=c}
    R=r;for(const e of chron)if(e.kind==='way')e.gr=1})()`);
  return h;
}
section(14, () => {
  const names = fresh().ev('WAYS.map(w=>w.n)');
  check('the ways: there are four, and wayDay writes each one\'s name into its chronicle label', names.length === 4 &&
    names.every((n, i) => { const l = wayRig([i]).ev("chron.filter(e=>e.kind==='way').map(e=>e.label)"); return l.length === 1 && l[0].includes(n); }));
  const sail = wayRig([0]).ev("(()=>{const p=LORE_PLACE.way.at(),h=getB('hut'),s=nearestShore(h.x,h.y);return [p&&p.x,p&&p.y,s.x,s.y]})()");
  check('the ways: the sail\'s ground is the shore by the fishing hut', sail[0] === sail[2] && sail[1] === sail[3] && sail[0] != null, JSON.stringify(sail));
  check('the ways: and nowhere while there is no hut', wayRig([0], { hut: false }).ev('LORE_PLACE.way.at()') === null);
  const plough = wayRig([1], { farm: true }).ev('(()=>{const p=LORE_PLACE.way.at();return [p&&p.x,p&&p.y,farms[0].x+.5,farms[0].y+.5]})()');
  check('the ways: the plough\'s ground is the first field', plough[0] === plough[2] && plough[1] === plough[3], JSON.stringify(plough));
  check('the ways: and nowhere while there is no field', wayRig([1]).ev('farms.length?0:LORE_PLACE.way.at()') === null);
  check('the ways: the kiln and the book of days have no ground', wayRig([2], { farm: true }).ev('LORE_PLACE.way.at()') === null && wayRig([3], { farm: true }).ev('LORE_PLACE.way.at()') === null);
  // the defect: `chron.find(x=>x.kind==='way'&&x.gr)` took the first grown way, so a kiln ahead of the sail answered null for good
  const late = wayRig([2, 3, 0]).ev("(()=>{const p=LORE_PLACE.way.at(),h=getB('hut'),s=nearestShore(h.x,h.y);return [p&&p.x,p&&p.y,s.x,s.y]})()");
  check('the ways: a kiln and a book learned first do not hide the sail\'s shore', late[0] === late[2] && late[1] === late[3] && late[0] != null, JSON.stringify(late));
  const both = wayRig([1, 0], { farm: true }).ev('(()=>{const p=LORE_PLACE.way.at();return [p&&p.x,p&&p.y,farms[0].x+.5,farms[0].y+.5]})()');
  check('the ways: of two with ground, the one the chronicle has first keeps it', both[0] === both[2] && both[1] === both[3], JSON.stringify(both));
  check('the ways: the two with ground are named as WAYS names them', fresh().ev('WAY_AT.length===2&&WAY_AT.every(n=>WAYS.some(w=>w.n===n))'));
});
// queueStoryWalk() is the line newDay runs the morning after a fire night. `q` calls it with R() counted and, when `roll` is given,
// forced. Breaks, each watched: put `un` back to the first unnamed story whatever its ground (the old line); drop the `named.length`
// guard; pick the repeat from `cand`; take the call out of newDay, or make it two mornings after the fire.
function q(h, roll) {
  return h.ev(`(()=>{const r=R;let n=0;R=()=>{n++;return ${roll == null ? 'r()' : roll}};walkP=null;queueStoryWalk();R=r;
    return {k:walkP&&walkP.k,named:walkP&&walkP.named,d:walkP&&walkP.d===dayCount,draws:n}})()`);
}
const grown = kind => `chron.push({d:dayCount,y:yearOf(dayCount),kind:'${kind}',label:'a made-up ${kind}',st:'told',gr:1,tl:3});`;
section(15, () => {
  let h = wayRig([2]);
  let w = q(h);
  check('story walk: a grown kiln alone queues nothing and rolls nothing', w.k === null && w.draws === 0, JSON.stringify(w));
  h.ev(grown('rainscame'));
  w = q(h);
  check('story walk: a story with ground behind a grown kiln is walked', w.k === 'rainscame' && w.named === false && w.d && w.draws === 0, JSON.stringify(w));
  h.ev("lorePl.push('rainscame')");
  w = q(h, 0);
  check('story walk: and once it is named it is walked again on a roll under one in four', w.k === 'rainscame' && w.named === true && w.draws === 2, JSON.stringify(w));
  w = q(h, .25);
  check('story walk: and not on a roll of one in four or over', w.k === null && w.draws === 1, JSON.stringify(w));
  h.ev(grown('shoal'));
  w = q(h, 0);
  check('story walk: an unnamed story with ground goes before any repeat, and rolls nothing', w.k === 'shoal' && w.named === false && w.draws === 0, JSON.stringify(w));
  // the repeat is drawn from the named stories only: three grown, the kiln first in the chronicle, and the roll that would land on it
  h.ev("lorePl.push('shoal')");
  w = q(h, 0);
  check('story walk: the repeat never lands on the story with no ground', w.k === 'rainscame' && w.draws === 2, JSON.stringify(w));
  w = q(h, .24);
  check('story walk: the repeat is rolled across the named stories', w.k === 'rainscame' && w.draws === 2, JSON.stringify(w));
  // an island with no such story makes the draws it always made: none for an unnamed story, one or two for a repeat
  h = fresh(); h.ev('dayCount=30;' + grown('rainscame'));
  w = q(h);
  check('story walk: an island with no groundless story rolls nothing for its first walk', w.k === 'rainscame' && w.draws === 0, JSON.stringify(w));
  check('story walk: no grown story, nothing queued', (w = q(fresh())).k === null && w.draws === 0, JSON.stringify(w));
  // and newDay is what calls it: a fire night, the day turns, somebody walks out, and the ground has its name
  h = wayRig([2]); h.ev(grown('rainscame') + 'storyDay=dayCount');
  const out = h.ev(`(()=>{const d=dayCount;let i=0;for(;i<2800*3&&!lorePl.length;i++)step(.05);
    return {days:dayCount-d,lp:lorePl.slice(),spot:spots.some(s=>s.lore&&s.k==='rainscame'),n:loreN.rainscame||0}})()`);
  check('story walk: the morning after a fire, behind a grown kiln, the rain\'s ground gets its name', out.lp.join() === 'rainscame' && out.spot && out.n === 1 && out.days === 1, JSON.stringify(out));
});

console.log(`${fail ? 'FAIL' : 'PASS'}: ${pass} of ${pass + fail} unit checks`);
process.exit(fail ? 1 : 0);
