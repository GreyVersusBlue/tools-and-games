// Hearth's unit suite (TG-26): the functions, called one at a time in Node, with no browser and no install.
//
//   node unit.mjs            (from Projects/hearth/test)
//
// Until this file every check of Hearth drove the real page through Playwright, so no test could say "this function is wrong",
// only "this island went wrong somewhere". load.mjs runs the real scripts in a vm context; this calls into them directly and sets up
// exactly the state each function reads. Each check names the thing it guards, and each was broken once in the code and watched
// fail on its own line (#34) — the break is written beside it.
import { loadHearth } from './load.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

// ---- a deer across a narrow neck (TG-48) ----
// Two meadows, 20 by 5 and 8 by 5, with a two-tile strip of sea between them, and a woodcutter on the west one. The flight straight
// away from the axe ends on the far meadow, which used to be enough: the deer ran to the shore and stood there.
section(16, () => {
  const rig = (land) => {
    const h = fresh();
    h.ev(`(()=>{tiles.fill(WATER);for(const [x0,x1,y0,y1] of ${JSON.stringify(land)})for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)tiles[idx(x,y)]=GRASS;
      trees=[];people=[];wild=[];fires=[];rain=false;storm=false;time=dayLen*.4;snowD=0})()`);
    return h;
  };
  const flee = (h, deer, from) => h.ev(`(()=>{const w={k:'deer',x:${deer[0]},y:${deer[1]},tx:0,ty:0,home:{x:${deer[0]},y:${deer[1]},hp:1},st:'graze',t:9,chk:0,f:1};trees=[w.home];
    people=[{name:'T',x:${from[0]},y:${from[1]},task:'chop',inside:false,dead:false,child:false}];wild=[w];stepWild(.01);
    return {st:w.st,tx:w.tx,ty:w.ty,dry:dryRoute(w.x,w.y,w.tx,w.ty)}})()`);
  let h = rig([[10, 29, 10, 14], [32, 39, 10, 14]]);
  let o = flee(h, [28.5, 12.5], [25, 12.5]);
  check('deer: scared at the neck, it picks a flight that stays on land', o.st === 'flee' && o.dry && h.ev(`landAt(${o.tx},${o.ty})`), JSON.stringify(o));
  check('deer: and the flight is on its own meadow, not the far side of the water', o.tx < 31, JSON.stringify(o));
  // the same deer with the axe on the east side flees west along the long meadow, as any deer does
  o = flee(h, [20.5, 12.5], [23, 12.5]);
  check('deer: with room behind it the flight is the one it always was, straight away', o.st === 'flee' && o.dry && o.tx < 20.5, JSON.stringify(o));
  // nowhere dry to go at all: one tile of grass in the sea. The old behaviour stays, and nothing throws or goes non-finite.
  h = rig([[20, 20, 12, 12]]);
  o = flee(h, [20.5, 12.5], [19, 12.5]);
  check('deer: on a one-tile island there is no dry route, and it flees anyway', o.st === 'flee' && !o.dry && isFinite(o.tx) && isFinite(o.ty), JSON.stringify(o));
  check('deer: and no warning was raised', h.warns.length === 0, h.warns.join(';'));
});

// ---- a lone child (TG-48) ----
section(17, () => {
  const lone = (setup) => {
    const h = fresh();
    h.ev(`for(let i=0;i<2800*6;i++)step(.05)`);
    h.ev(`(()=>{const k=addPerson(center.x,center.y,{child:true,age:6,name:'Tam',parents:[],how:'test'});k.age0=6;k.born=dayCount;k.child=true;k.keeper=1;
      for(const p of people)if(p!==k)p.dead=true;people=[k];arrivalT=1e9;tgt=null;${setup}})()`);
    return h;
  };
  const days = (h, n) => h.ev(`(()=>{const t={};let alone=true;for(let i=0;i<2800*${n};i++){arrivalT=1e9;step(.05);if(people.length!==1){alone=false;break}t[people[0].task]=(t[people[0].task]||0)+1}return {t,alone,n:people.length}})()`);
  // a dry summer, a well, and a field wanting water: the child fetches it
  let h = lone(`dry01=1;if(!hasB('well'))bldg.push({kind:'well',x:center.x+3,y:center.y+3,w:2,h:2,done:true});for(const f of farms)f.g=0;`);
  let r = days(h, 2);
  check('lone child: a dry field and a well, and the child fetches water', r.alone && (r.t.water || 0) > 0, JSON.stringify(r));
  // ripe grain: the child cuts it
  h = lone(`dry01=0;for(const f of farms)f.g=1;`);
  r = days(h, 1);
  check('lone child: ripe fields, and the child cuts them', r.alone && (r.t.harvest || 0) > 0, JSON.stringify(r));
  // the chronicle says it once
  const e = h.ev(`events.filter(e=>e.kind==='keeperwork').length`);
  check('lone child: one chronicle line the first time, however many fields', e === 1, String(e));
  const e2 = days(h, 4) && h.ev(`events.filter(e=>e.kind==='keeperwork').length`);
  check('lone child: and still one after four more days of it', e2 === 1, String(e2));
  // nothing to do in the fields: the shore and the fire, as before
  h = lone(`dry01=0;farms.length=0;`);
  r = days(h, 1);
  check('lone child: no fields to work, and they tend the shore and the fire as before', r.alone && (r.t.tend || 0) > 0 && !r.t.water && !r.t.harvest, JSON.stringify(r));
  // and a child with a grown one on the island plays, as before
  h = fresh(); h.ev('for(let i=0;i<2800*6;i++)step(.05)');
  h.ev(`(()=>{const k=addPerson(center.x,center.y,{child:true,age:6,name:'Tam',parents:[],how:'test'});k.age0=6;k.born=dayCount;k.child=true;k.task='idle';k.t=0;
    for(const f of farms)f.g=1;dry01=1})()`);
  r = h.ev(`(()=>{const k=byName('Tam'),t={};for(let i=0;i<2800;i++){arrivalT=1e9;step(.05);t[k.task]=(t[k.task]||0)+1}return t})()`);
  check('lone child: with a grown one about, a child does not cut the grain', !r.harvest && !r.water, JSON.stringify(r));
  check('lone child: no warnings', h.warns.length === 0, h.warns.join(';'));
});

// ---- a feud and an old death on one morning (TG-48) ----
// newDay called feudDay near its top and the old-age deaths ran after it, so a feud whose second name died that same morning stood
// naming nobody until the next one, and `strain`'s daily audit read it on seed 20260819 day 39 once the deer changed the stream.
section(18, () => {
  const { ev } = fresh();
  ev('for(let i=0;i<2800*4;i++)step(.05)');
  const o = ev(`(()=>{const ad=people.filter(p=>!isKid(p)&&!p.dead);const a=ad[0],b=ad[1];arrivalT=1e9;
    a.age0=30;a.born=dayCount;b.age0=95;b.born=dayCount;startFeud(a,b);const names=[a.name,b.name];
    newDay();return {feud:!!feud,alive:!!byName(names[1]),aliveA:!!byName(names[0])}})()`);
  check('feud: the old die in newDay after the first feudDay, and the feud ends that morning, not a day on', o.alive === false && o.aliveA && o.feud === false, JSON.stringify(o));
});

// ---- one top-level name, one file (A0) ----
// The scripts share one global scope, so a name declared at column 0 in two files is a redeclaration the browser reports as a SyntaxError
// on the second file (let, const) or a silent overwrite (function), and the first failure takes the whole page's later scripts with it.
// This reads the files as text, so the page is not what catches it. Break: `let seed` at the top of js/look.js names `seed` (core.js).
section(19, () => {
  const ORDER = ['js/core.js', 'js/flavor.js', 'js/life.js', 'js/watcher.js', 'js/sim.js', 'assets/sprites/buildings.js',
    'js/render.js', 'js/look.js', 'js/folk.js', 'js/goods.js', 'js/audio.js', 'js/save.js', 'js/main.js'];
  const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  // the names one file declares at column 0: `let a,b=1,c`, `const x=..`, `function f(`; strings, comments and brackets are skipped
  // so a comma or semicolon inside them does not end or split a declaration
  function declared(src) {
    const names = [];
    const re = /^(let|const|function\*?)[ \t]+([A-Za-z_$][\w$]*)/gm;
    let m;
    while ((m = re.exec(src))) {
      if (m[1].startsWith('function')) { names.push(m[2]); continue; }
      let i = m.index + m[1].length, depth = 0, start = i, q = null;
      const parts = [];
      for (; i < src.length; i++) {
        const c = src[i];
        if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
        if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
        if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 1; continue; }
        if (c === "'" || c === '"' || c === '`') { q = c; continue; }
        if ('([{'.includes(c)) depth++;
        else if (')]}'.includes(c)) depth--;
        else if (depth === 0 && c === ',') { parts.push(src.slice(start, i)); start = i + 1; }
        else if (depth === 0 && c === ';') break;
        else if (depth === 0 && c === '\n') {
          const before = src.slice(start, i).trimEnd().slice(-1);
          if (before !== ',' && before !== '=') break;
        }
      }
      parts.push(src.slice(start, i));
      for (const p of parts) { const n = /^\s*([A-Za-z_$][\w$]*)/.exec(p); if (n) names.push(n[1]); }
    }
    return names;
  }
  const seen = new Map(), dup = [];
  const per = {};
  for (const f of ORDER) {
    const ns = declared(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    per[f] = ns;
    for (const n of new Set(ns)) { if (seen.has(n)) dup.push(`${n} in ${seen.get(n)} and ${f}`); else seen.set(n, f); }
  }
  // a scanner that finds nothing would pass anything: it has to find known names, including one from a comma list
  check('names: the scanner finds core.js\'s own declarations', seen.get('newWorld') === 'js/core.js' && seen.get('zoom') === 'js/main.js' && seen.get('camX') === 'js/main.js' && seen.size > 200, `${seen.size} names; zoom in ${seen.get('zoom')}, camX in ${seen.get('camX')}`);
  check('names: no top-level name is declared in two files', dup.length === 0, dup.join('; '));
  check('names: the three look scripts load after render.js and before audio.js', ['js/look.js', 'js/folk.js', 'js/goods.js'].every(f => ORDER.indexOf(f) > ORDER.indexOf('js/render.js') && ORDER.indexOf(f) < ORDER.indexOf('js/audio.js')));
});

// ---- stock you can point at (B1, unit section 22) ----
// goods.js draws wood, grain and fish as objects whose count is the number. The counts are a pure function of wood, granary and food, and the
// spots are a pure function of center and what stands on the island: all land, none inside a house, a building, a plot or a work.
// The footprints below are the sprites' own pixels (a house frame is 16 by 16 at its tile), not goods.js's wider margins, so this does not
// re-run the function it checks. Break: read `food` where `wood` belongs in stockWant, and the wood line of the first check fails.
section(22, () => {
  const { ev } = fresh(7);
  const want = (w, g, f) => ev(`(wood=${w},granary=${g},food=${f},stockWant())`);
  check('stock: wood 12 is 3 logs, 96 is a full stack of 24, more stays 24', want(12, 0, 0).wood === 3 && want(96, 0, 0).wood === 24 && want(500, 0, 0).wood === 24 && want(0, 0, 0).wood === 0 && want(1, 0, 0).wood === 1, JSON.stringify([12, 96, 500, 0, 1].map(w => want(w, 0, 0).wood)));
  check('stock: granary 25 is 1 sack, 26 is 2, capped at 16', want(0, 25, 0).sack === 1 && want(0, 26, 0).sack === 2 && want(0, 400, 0).sack === 16 && want(0, 0, 0).sack === 0, JSON.stringify([25, 26, 400, 0].map(g => want(0, g, 0).sack)));
  check('stock: food 20 is 1 fish, 21 is 2, capped at 8', want(0, 0, 20).fish === 1 && want(0, 0, 21).fish === 2 && want(0, 0, 400).fish === 8 && want(0, 0, 0).fish === 0, JSON.stringify([20, 21, 400, 0].map(f => want(0, 0, f).fish)));
  check('stock: the three counts do not read each other', want(96, 0, 0).sack === 0 && want(96, 0, 0).fish === 0 && want(0, 400, 0).wood === 0 && want(0, 0, 400).wood === 0 && want(0, 0, 400).sack === 0);
  // the ease: a seeded island shows its stock at once, then moves one object per 0.4 s of animT, and stands still while animT does
  const e = fresh(7); e.ev('wood=0;granary=0;food=0;animT=0;stockEase()');
  e.ev('wood=96;granary=0;food=0');
  const c0 = e.ev('stockEase().wood'); e.ev('animT=0.39'); const c1 = e.ev('stockEase().wood'); e.ev('animT=0.4'); const c2 = e.ev('stockEase().wood'); e.ev('animT=0.4'); const c3 = e.ev('stockEase().wood');
  e.ev('animT=3.2'); const c4 = e.ev('stockEase().wood'); e.ev('animT=60'); const c5 = e.ev('stockEase().wood');
  check('stock: logs arrive one per 0.4 s of animT and not before', c0 === 0 && c1 === 0 && c2 === 1 && c3 === 1 && c4 === 8 && c5 === 24, JSON.stringify([c0, c1, c2, c3, c4, c5]));
  e.ev('wood=0'); e.ev('animT=61'); const d1 = e.ev('stockEase().wood');
  check('stock: logs leave one per 0.4 s as well', d1 === 22, `${d1} after 1 s of animT with the pile at 24`);
  // positions
  const bad = [];
  for (const seed of [7, 42, 20260819]) {
    const h = fresh(seed);
    for (const day of [1, 12]) {
      while (h.ev('dayCount') < day) h.ev('for(let i=0;i<280;i++)step(.05)');
      const sp = h.ev('stockSpots()'), at = (x, y) => h.ev(`at(${x},${y})`);
      const hs = h.ev('houses.map(o=>[o.x,o.y])'), bs = h.ev('bAll().map(o=>[o.x,o.y,o.w,o.h])'), pl = h.ev('plots.map(o=>[o.x,o.y])');
      for (const k of ['wood', 'sack', 'fish']) {
        const s = sp[k], x0 = s.x - s.w / 2, x1 = s.x + s.w / 2, y0 = s.y - s.h, y1 = s.y;
        const tag = `seed ${seed} day ${day} ${k}`;
        if (!s.ok) bad.push(`${tag} found no free spot`);
        for (let ty = Math.floor(y0 / 8); ty * 8 < y1; ty++) for (let tx = Math.floor(x0 / 8); tx * 8 < x1; tx++) { const t = at(tx, ty); if (t === 0 || t === 3) bad.push(`${tag} on ${t === 0 ? 'water' : 'rock'} at ${tx},${ty}`); }
        const over = (a0, b0, a1, b1) => x0 < a1 && x1 > a0 && y0 < b1 && y1 > b0;
        for (const [hx, hy] of hs) if (over(hx * 8, hy * 8, hx * 8 + 16, hy * 8 + 16)) bad.push(`${tag} inside the house at ${hx},${hy}`);
        for (const [px, py] of pl) if (over(px * 8, py * 8, px * 8 + 16, py * 8 + 16)) bad.push(`${tag} inside the plot at ${px},${py}`);
        for (const [bx, by, bw, bh] of bs) if (!(k === 'sack' && h.ev('getB("hall")') && bx === h.ev('getB("hall").x') && by === h.ev('getB("hall").y')) && !(s.on === 'line' && h.ev('getB("hut")') && bx === h.ev('getB("hut").x') && by === h.ev('getB("hut").y')) && over(bx * 8, by * 8, (bx + bw) * 8, (by + bh) * 8)) bad.push(`${tag} inside the building at ${bx},${by}`);
      }
    }
  }
  check('stock: for seeds 7, 42 and 20260819 at days 1 and 12 every pile is on land, clear of houses, plots and buildings', bad.length === 0, bad.slice(0, 4).join('; '));
  // a hall with a house on its south side: the sacks move off it
  const f = fresh(7), cx = f.ev('center.x'), cy = f.ev('center.y');
  f.ev(`bldg.push({kind:'hall',x:${cx + 8},y:${cy - 6},w:3,h:2,done:true,prog:0,work:80})`);
  const s0 = f.ev('stockSpots().sack');
  f.ev(`houses.push({x:${Math.round(s0.x / 8) - 1},y:${Math.round(s0.y / 8) - 1},r:'#8a3d2f',owners:[]})`);
  const s1 = f.ev('stockSpots().sack');
  check('stock: sacks stand at the hall\'s south wall, and move when a house takes that spot', s0.ok && s0.y / 8 > cy - 6 + 2 && s0.x / 8 > cx + 8 && s1.ok && (s1.x !== s0.x || s1.y !== s0.y), JSON.stringify([s0, s1]));
});

// ---- a save cannot carry markup (C1, unit section 26) ----
// unpack() makes every string in the save plain text on every load (#37): no < > & " or backtick, none over 400 characters.
// The log writes names and chronicle text through innerHTML, and a save is about to be something a server accepts and republishes.
section(26, () => {
  const BAD = /[<>&"`]/, XSS = '<b onmouseover=x>';
  const strings = (v, out = []) => { if (typeof v === 'string') out.push(v); else if (Array.isArray(v)) v.forEach(x => strings(x, out)); else if (v && typeof v === 'object') Object.values(v).forEach(x => strings(x, out)); return out; };
  // a hundred days from seed 7, taken before any repair: the repair has to be a no-op on a real island, or this list is what it found
  const { H, ev } = fresh(7);
  ev('for(let i=0;i<2800*100;i++)step(.05)');
  const clean = H.pack(), cleanStr = JSON.stringify(clean);
  const found = strings(clean).filter(x => BAD.test(x) || x.length > 400);
  check('save: a 100-day island from seed 7 carries none of the five characters and no long string before repair', found.length === 0 && strings(clean).length > 100, `${strings(clean).length} strings; found ${JSON.stringify(found.slice(0, 5))}`);
  // pack -> unpack -> pack on a 100-day island is not byte-identical on main either: a voyage that "stayed" (o.vo) is dropped by
  // unpack's `voyage.p` guard and packs as 0. That is older than this repair and not this increment's to fix, so the 100-day check
  // names every key but vo, and the whole-object byte check runs on a six-day island below, where there is no voyage.
  H.unpack(JSON.parse(cleanStr));
  const re = H.pack(), drift = Object.keys(clean).filter(k => JSON.stringify(clean[k]) !== JSON.stringify(re[k]));
  check('save: unpack leaves every key of that 100-day island as it was, but the voyage', drift.every(k => k === 'vo'), drift.join(','));
  { const g = fresh(7); g.ev('for(let i=0;i<2800*6;i++)step(.05)'); const six = JSON.stringify(g.H.pack()); g.H.unpack(JSON.parse(six));
    check('save: pack -> unpack -> pack is still byte-identical on a clean six-day island', JSON.stringify(g.H.pack()) === six); }
  // one person's name, the village name, one chronicle label and one life line, each carrying markup
  const o = JSON.parse(cleanStr);
  const who = o.pe[0][2];
  o.pe[0][2] = who + XSS; o.vn = 'Mill' + XSS; o.ch[0][3] = 'a label' + XSS; o.pe[0][7].push([o.d, 'a life line' + XSS]);
  check('save: the doctored save really carries markup before repair', strings(o).filter(x => BAD.test(x)).length >= 4);
  H.unpack(o);
  const after = H.pack();
  check('save: after unpack no string anywhere in pack() contains <', strings(after).every(x => !x.includes('<')), JSON.stringify(strings(after).filter(x => x.includes('<')).slice(0, 3)));
  check('save: and none contains any of the five characters', strings(after).every(x => !BAD.test(x)));
  check('save: the chronicle label kept its text and lost only the markup', after.ch[0][3] === 'a labelb onmouseover=x', after.ch[0][3]);
  check('save: the name, the village and the life line did too', after.pe[0][2] === who + 'b onmouseover=x' && after.vn === 'Millb onmouseover=x' && after.pe[0][7].at(-1)[1] === 'a life lineb onmouseover=x', JSON.stringify([after.pe[0][2], after.vn, after.pe[0][7].at(-1)]));
  // the log is innerHTML: nothing the load wrote there may carry a tag either
  check('save: the log the load wrote has no markup from the save', !/<b onmouseover/.test(ev("document.getElementById('log').innerHTML")));
  // the cut: 400 and no more, and a string under the cut is untouched
  const long = JSON.parse(cleanStr);
  long.ch[0][3] = 'x'.repeat(900); long.vn = 'y'.repeat(400);
  H.unpack(long);
  const lp = H.pack();
  check('save: a string over 400 characters is cut to 400, one of exactly 400 is left alone', lp.ch[0][3].length === 400 && lp.vn.length === 400, `${lp.ch[0][3].length}, ${lp.vn.length}`);
  // a repair on every load, not only the first: a second pass changes nothing
  const twice = JSON.stringify(lp);
  H.unpack(JSON.parse(twice));
  check('save: repairing twice is the same as repairing once', JSON.stringify(H.pack()) === twice);
});

console.log(`${fail ? 'FAIL' : 'PASS'}: ${pass} of ${pass + fail} unit checks`);
process.exit(fail ? 1 : 0);
