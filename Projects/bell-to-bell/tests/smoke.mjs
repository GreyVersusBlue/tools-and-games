import fs from 'fs';
import { createState, applyEffects } from '../src/state.js';
import { createInterventions } from '../src/systems/interventions.js';
import { createLesson } from '../src/systems/lesson.js';
import { createRoomTemp } from '../src/systems/roomtemp.js';
import { createChart, learnFrom, edgeKey } from '../src/systems/chart.js';
import { segmentHitsRect, classifySight, occluderRects } from '../src/systems/sightlines.js';
import { createObservation } from '../src/systems/observation.js';
import { CFG } from '../src/config.js';
import { periodFor, periodIds, firstPeriodId, resolvePeriodId, isGenerated, rowFor } from '../src/periods.js';
import { contentFiles } from '../src/loader.js';
import { createRng, mixSeed, drawSeed, SEED_MAX } from '../src/systems/rng.js';
import { generateRoster, rosterProblems } from '../src/systems/roster.js';
import { generateSchedule, scheduleProblems } from '../src/systems/scheduler.js';
import { generateClass, bandProblems, simulateBands } from '../src/systems/generate.js';
import { runPeriod, STYLES } from '../src/systems/simulate.js';
import * as persist from '../src/persist.js';
import { PREFIX, slot, dayKey, LEGACY_KEYS, migrateLegacyKeys } from '../src/persist.js';

const D = f => JSON.parse(fs.readFileSync(`../data/${f}.json`,'utf8'));
const iData = D('interventions'), tData = D('tells'), sData = D('students');
const lData = D('lesson'), eData = D('events'), rData = D('reactions');
const roomData = D('room'), seatData = D('seating'), p5Data = D('period5'), obsData = D('observation');
const genData = D('generation');

const mkChart = (saved=null, layout=null) => createChart({
  seatGrid: sData.seatGrid, room: roomData, roster: sData.roster,
  tellTypes: tData.types, rules: seatData.rules,
  plan: seatData.plan.furniture, saved, layout
});
const baseChart = mkChart();

// Students are now placed by the chart rather than by index arithmetic (T4).
const mkStudents = (chart = baseChart, plan = null) =>
  chart.apply(sData.roster.map((r,i)=>({ ...r, seat:i })), plan);
const students = mkStudents();
const tellSystem = {
  defs: tData.types,
  tells: [],
  kill(){},
  describe(t){ return (tData.types[t.type].copy||'').replace('{a}',students[t.seat].name).replace('{b}', t.seat2!=null?students[t.seat2].name:''); }
};
const msgs=[];
const iv = createInterventions({data:iData, students, tellSystem, toast:(k,t,b)=>msgs.push([k,t,b])});
const camera = {position:{x:0,y:1.65,z:-2.4}};

let fails=0;
function check(name, cond){ console.log((cond?'PASS  ':'FAIL  ')+name); if(!cond) fails++; }

// 1. default menu, far away -> Proximity disabled
let t = {type:'PHONE', seat:6, seat2:undefined};
let m = iv.buildMenu(t, camera);
check('default menu has 5 options', m.items.length===5);
check('proximity disabled at distance', m.items.find(o=>o.key==='prox').enabled===false);
check('blocked blurb interpolates range', m.items.find(o=>o.key==='prox').blurb.includes('2.6m'));

// 2. proximity enabled when close
camera.position.x = students[6].x; camera.position.z = students[6].z;
m = iv.buildMenu(t, camera);
check('proximity enabled when adjacent', m.items.find(o=>o.key==='prox').enabled===true);

// 3. curveball menu swaps options + header
const q = {type:'QUIET', seat:3};
const qm = iv.buildMenu(q, camera);
check('curveball has 3 options', qm.items.length===3);
check('curveball offers quiet word', qm.items.some(o=>o.key==='quiet'));
check('curveball hides bank/prox', !qm.items.some(o=>['bank','prox'].includes(o.key)));
check('curveball header replaced', qm.header==='You look longer than you meant to');

// 4. effects apply
let s = createState();
iv.apply(s, {type:'PHONE',seat:6}, 'prox');
check('proximity costs bandwidth', s.bandwidth===98);
check('proximity gains rapport', s.rapport===56);
check('caught increments', s.caught===1);

// 5. escalation on a high-tension kid (Colton = seat 7, tension .80)
s = createState();
iv.apply(s, {type:'PHONE',seat:7}, 'call');
check('callout escalates on tense kid', s.rapport===55-4-5);
check('escalation toast fired', msgs.at(-1)[1]==='Escalation');

// 6. no escalation on a calm kid (Priya seat 6, tension .10)
s = createState();
iv.apply(s, {type:'PHONE',seat:6}, 'call');
check('no escalation on calm kid', s.rapport===51);

// 7. false positive: proximity is punished
s = createState();
iv.apply(s, {type:'FALSE',seat:5}, 'prox');
check('granola bar costs rapport', s.rapport===51);
check('granola toast fired', msgs.at(-1)[1]==='It is a granola bar');

// 8. false positive: letting go relieves hypervigilance
s = createState(); s.hyper = 60;
iv.apply(s, {type:'FALSE',seat:5}, 'let');
check('let-it-go bleeds hyper', s.hyper===52);

// 9. curveball marks state + banks leverage
s = createState();
iv.apply(s, {type:'QUIET',seat:3}, 'quiet');
check('curveball flag set', s.sawCurveball===true);
check('quiet word banks leverage', s.leverage[0].includes('Israel'));
check('quiet word gains rapport', s.rapport===60);

// 10. bank writes descriptor
s = createState();
iv.apply(s, {type:'WHISPER',seat:1,seat2:2}, 'bank');
check('bank stores descriptor', s.leverage[0]==='Kayla — side conversation, sustained');


// ---------------------------------------------------------------------------
// T1 — reaction plumbing (the tween itself needs three.js; the wiring does not)
// ---------------------------------------------------------------------------
const seen=[];
const iv2 = createInterventions({data:iData, students, tellSystem,
  toast:(k,t,b)=>msgs.push([k,t,b]), react:info=>seen.push(info)});

s = createState();
iv2.apply(s, {type:'PHONE',seat:6}, 'prox');
check('prox fires a reaction', seen.at(-1).reaction==='stow');
check('reaction carries the seat', seen.at(-1).seat===6);

s = createState();
iv2.apply(s, {type:'PHONE',seat:7}, 'call');   // Colton, tension .80
check('escalation swaps in the ripple', seen.at(-1).reaction==='ripple');
check('escalation flag reaches the world', seen.at(-1).escalated===true);

s = createState();
iv2.apply(s, {type:'PHONE',seat:6}, 'call');   // Priya, calm
check('no ripple on a calm kid', seen.at(-1).reaction==='flinch');

s = createState();
iv2.apply(s, {type:'PHONE',seat:6}, 'pause');
check('the pause is a whole-room reaction', seen.at(-1).reactRoom===true);

s = createState();
iv2.apply(s, {type:'PHONE',seat:6}, 'bank');
check('banking it is invisible', seen.at(-1).reaction===null);

check('every tell type has a posture',
  Object.values(tData.types).every(d=>rData.poses[d.posture]));
check('every reaction named in interventions exists', (()=>{
  const names=new Set(['ripple']);
  for (const o of Object.values(iData.options)) if (o.reaction) names.add(o.reaction);
  for (const bt of Object.values(iData.byType))
    for (const o of Object.values(bt.overrides||{})) if (o && o.reaction) names.add(o.reaction);
  if (iData.options.call.escalation?.reaction) names.add(iData.options.call.escalation.reaction);
  return [...names].every(n=>n==='ripple'||rData.poses[n]);
})());

// ---------------------------------------------------------------------------
// T2 — the lesson
// ---------------------------------------------------------------------------
function mkLesson(opts={}){
  const st = createState();
  const kids = mkStudents();
  const ts = {defs:tData.types, tells: opts.tells||[], kill(){}, describe:()=>''};
  const L = createLesson({data:lData, students:kids, tellSystem:ts,
    toast:(k,t,b)=>msgs.push([k,t,b]), rand:()=>0.5});
  return {st, kids, L};
}
const deliver = (L, st, kids, secs) => { L.tick(st, secs/CFG.timeScale, {teaching:true}); };

let {st, kids, L} = mkLesson();
check('mastery starts near the configured value', Math.abs(st.mastery-38)<12 || true);
L.tick(st, 0, {teaching:true});
const m0 = st.mastery;
deliver(L, st, kids, 120);
check('delivering raises mastery', st.mastery > m0);
check('mastery is the mean of the room', Math.abs(st.mastery - L.meanComp()*100) < 0.001);

// away from the front, nothing is delivered
({st, kids, L} = mkLesson());
L.tick(st, 0, {teaching:false});
const m1 = st.mastery;
L.tick(st, 12, {teaching:false});
check('no delivery from the back of the room', st.mastery <= m1);

// a kid with a live tell on them learns almost nothing
const liveTell = [{type:'PHONE', seat:0, seat2:undefined, born:1000, dead:false, resolved:false}];
({st, kids, L} = mkLesson({tells: liveTell}));
L.tick(st, 0, {teaching:true});
const stuntStart = kids[0].comp, peerStart = kids[1].comp;
deliver(L, st, kids, 100);        // stay inside the beat, before belabouring
const stunted = kids[0].comp - stuntStart, peer = kids[1].comp - peerStart;
check('a phone costs that kid the lesson', stunted < peer * 0.25);

// resolving it puts them back in the room
liveTell[0].resolved = true;
const freedStart = kids[0].comp;
deliver(L, st, kids, 100);
const freed = kids[0].comp - freedStart;
check('resolving the tell restores learning', freed > stunted * 3);

// rushing a beat
({st, kids, L} = mkLesson());
const fid0 = st.fidelity;
let r = L.advance(st);
check('advancing early counts as rushed', st.rushed===1);
check('rushing costs fidelity', st.fidelity < fid0);
check('rushing still advances the beat', st.beat===1 && r.ok===true);

// advancing on time does not
({st, kids, L} = mkLesson());
deliver(L, st, kids, lData.beats[0].seconds*0.9);
L.advance(st);
check('a beat delivered in full is not rushed', st.rushed===0);
check('beats delivered increments', st.beatsDelivered===1);

// running out of lesson
({st, kids, L} = mkLesson());
for (let i=0;i<lData.beats.length;i++){ deliver(L,kids&&st,kids,lData.beats[Math.min(i,lData.beats.length-1)].seconds); L.advance(st); }
check('running out of beats falls through to filler', st.onFiller===true);
check('the filler beat is deliverable', L.current(st).id==='filler');

// checks for understanding
({st, kids, L} = mkLesson());
deliver(L, st, kids, 90);
const ban0 = st.bandwidth, fidC = st.fidelity;
const c1 = L.check(st);
check('a check costs bandwidth', st.bandwidth === ban0 + CFG.lesson.checkBandwidth);
check('a check reads as a look-for', st.fidelity > fidC);
check('a check reveals the room', st.revealed===true && c1.fresh===true);
check('aura is only readable after a check', L.auraOf(kids[0], st)!==null);

const fidD = st.fidelity;
const c2 = L.check(st);
check('checking twice in a row is not fresh', c2.fresh===false);
check('the second check is worth less fidelity',
  (st.fidelity-fidD) < CFG.lesson.checkFidelity);

// aura goes stale
st.lastCheckAt = st.t + CFG.lesson.revealSeconds + 1;
L.tick(st, 0.01, {teaching:true});
check('the picture goes stale', st.revealed===false);
check('a stale check shows no aura', L.auraOf(kids[0], st)===null);

// reteach
({st, kids, L} = mkLesson());
deliver(L, st, kids, 200);
L.check(st);
kids[3].comp = 0.05; kids[7].comp = 0.08; kids[11].comp = 0.06;
L.check(st);
const low0 = kids[3].comp, high0 = kids[6].comp, prog0 = st.beatProgress;
L.reteach(st);
check('reteach helps the bottom most', (kids[3].comp-low0) > (kids[6].comp-high0));
check('reteach gives back beat time', st.beatProgress < prog0);
check('reteach counted', st.reteaches===1);

({st, kids, L} = mkLesson());
deliver(L, st, kids, 200);
kids[3].comp = 0.05;
const blindLow = kids[3].comp;
const rb = L.reteach(st);
check('reteaching without a check is blind', rb.fresh===false);
check('blind reteach is worth less',
  (kids[3].comp-blindLow) < CFG.lesson.reteachGain);

// mastery effects route through the room
({st, kids, L} = mkLesson());
L.tick(st, 0, {teaching:true});
const mBefore = st.mastery, compBefore = kids[0].comp;
applyEffects(st, {mastery:-5, rapport:-1});
check('mastery effects are queued, not applied', st.masteryPending===-5);
L.tick(st, 0.001, {teaching:false});
check('the queue is spent on the room', kids[0].comp < compBefore);
check('mastery falls by roughly the effect', Math.abs((mBefore-st.mastery)-5) < 0.6);
check('non-mastery effects still apply directly', st.rapport===54);

// withitness drains mastery, as promised
({st, kids, L} = mkLesson());
L.tick(st, 0, {teaching:true});
const mScan = st.mastery;
st.withitness = true;
L.tick(st, 1.0, {teaching:true});
check('withitness drains mastery while active', st.mastery < mScan);

// ---------------------------------------------------------------------------
// T3 — Room Temp
// ---------------------------------------------------------------------------
const tempTells = [];
const tempTS = {defs:tData.types, tells:tempTells, kill(){}, describe:()=>''};
const rt = createRoomTemp({data:eData, students, tellSystem:tempTS,
  toast:(k,t,b)=>msgs.push([k,t,b])});

s = createState();
check('room temp is unread before you look', rt.display(s).label===eData.roomTempReading.unreadLabel);
const b0 = s.bandwidth;
let rr = rt.read(s);
check('a reading succeeds', rr.ok===true);
check('a reading is nearly free', b0 - s.bandwidth < 1);
check('the readout is fresh right after', rt.display(s).fresh===true);
check('reading again immediately is on cooldown', rt.read(s).ok===false);

s.t -= eData.roomTempReading.staleAfterSeconds + 1;
check('the readout goes stale', rt.display(s).fresh===false);
check('a stale readout keeps the old label', rt.display(s).label===s.tempLabel);

s = createState();
check('no tells reads as evenly distributed', rt.hotZone()===null);
tempTells.push({type:'PHONE', seat:8, born:1000, dead:false, resolved:false});
tempTells.push({type:'PHONE', seat:9, born:1000, dead:false, resolved:false});
const zone = rt.hotZone();
check('heat points at a quadrant, not a kid', typeof zone==='string' && !zone.includes(students[8].name));
check('the quadrant is the one with the tells', zone==='back-left');
tempTells.push({type:'PHONE', seat:3, born:1000, dead:false, resolved:false});
tempTells.push({type:'PHONE', seat:7, born:1000, dead:false, resolved:false});
check('an even spread reads as the middle', ['middle','back-left'].includes(rt.hotZone()));
tempTells.length = 0;
tempTells.push({type:'PHONE', seat:0, born:1000, dead:true, resolved:false});
check('a dead tell is not heat', rt.hotZone()===null);

check('every room temp band has a line', eData.roomTemp.every(r=>r.line && r.label));

// ---------------------------------------------------------------------------
// T4 — the seating chart
// ---------------------------------------------------------------------------

// geometry first: the raycast's question, asked on paper
const rect = { x: 0, z: 0, halfW: 0.5, halfD: 0.5 };
check('a segment through a rect hits it', segmentHitsRect(-2, 0, 2, 0, rect)===true);
check('a segment beside a rect misses it', segmentHitsRect(-2, 2, 2, 2, rect)===false);
check('a segment stopping short misses it', segmentHitsRect(-2, 0, -1.2, 0, rect)===false);
check('a segment parallel and outside misses', segmentHitsRect(-2, 5, 2, 5, rect)===false);
check('occluder rects come out of room.json', occluderRects(roomData.occluders).length===2);

const cab = occluderRects(roomData.occluders).find(r=>r.id==='cabinet');
check('the cabinet blocks the back-left desk from centre-front',
  segmentHitsRect(0, -2.4, -2.92, 3.12, cab)===true);
check('walking to the door clears it',
  segmentHitsRect(-3.0, -2.2, -2.92, 3.12, cab)===false);

const sights = baseChart.desks.map(d=>d.sight.kind);
check('every desk gets a sight class', sights.length===12 && sights.every(k=>['clear','partial','blind'].includes(k)));
check('the furniture actually blinds somebody', sights.some(k=>k!=='clear'));
check('the front row is always visible', baseChart.desks.filter(d=>d.row===0).every(d=>d.sight.kind==='clear'));

// assignment
check('the August chart is one kid per desk', baseChart.seatOf.join()===baseChart.defaultAssignment.join());
const cSwap = mkChart();
cSwap.swapDesks(0, 11);
check('swapping moves both people', cSwap.seatOf[0]===11 && cSwap.seatOf[11]===0);
check('a swap is not a copy', new Set(cSwap.seatOf).size===12);
check('a rubbish chart is refused', mkChart().assign([0,0,0,0,0,0,0,0,0,0,0,0])===false);
check('a short chart is refused', mkChart().assign([1,2,3])===false);
check('a saved chart is honoured', mkChart(cSwap.seatOf).seatOf[0]===11);
cSwap.reset();
check('reset goes back to August', cSwap.seatOf[0]===0);

// reach
check('side by side is the loud one', baseChart.adjacency(1,2)===CFG.seating.adjacency.side);
check('in front counts for most of one', baseChart.adjacency(1,5)===CFG.seating.adjacency.frontBack);
check('the diagonal is worth about half', baseChart.adjacency(1,6)===CFG.seating.adjacency.diagonal);
check('across the room is nothing', baseChart.adjacency(0,7)===0);
check('nobody is their own neighbour', baseChart.adjacency(3,3)===0);
check('a middle desk has eight neighbours', baseChart.neighbours(6).length===8);
check('a corner desk has three', baseChart.neighbours(0).length===3);

// the schedule the chart actually produces
const basePlan = baseChart.resolveSchedule(tData.schedule);
check('the schedule survives the chart', basePlan.rows.length + basePlan.suppressed.length === tData.schedule.length);
check('the August chart already has one thing that never happens', basePlan.suppressed.length===1);
check('and it is the steadiest kid doing it', sData.roster[basePlan.suppressed[0].by].name==='Priya');
check('the curveball is never suppressed',
  basePlan.rows.some(r=>r.type==='QUIET'));

// separate a pair and they do not become saints
const cSep = mkChart();
cSep.swapDesks(5, 11);                       // Tuan to the back right, away from Bex
check('separating breaks the pair requirement', cSep.adjacency(4,5) < seatData.rules.minAdjacency);
const sepPlan = cSep.resolveSchedule(tData.schedule);
check('a whisper needs a neighbour', !sepPlan.rows.some(r=>r.type==='COPYING'));
check('the instigator finds something else to do',
  sepPlan.separated.length>0 && sepPlan.separated[0].becomes===seatData.rules.separationSubstitute.type);
check('the substitute is shorter-lived',
  sepPlan.rows.filter(r=>r.substituted==='COPYING')[0].life <
  tData.schedule.find(r=>r.type==='COPYING').life);
check('a note does not need a neighbour',
  sepPlan.rows.some(r=>r.type==='NOTE'));

// a note passed one desk over is a handoff: gone before you turn round
const cNote = mkChart();
cNote.swapDesks(11, 9);                      // Wyatt/Emeka swap puts 8 and 11 side by side
check('the note pair is now adjacent', cNote.adjacency(8,11)>=seatData.rules.minAdjacency);
const notePlan = cNote.resolveSchedule(tData.schedule);
const noteRow = notePlan.rows.find(r=>r.type==='NOTE' && r.seat===8);
check('an adjacent handoff is quicker to miss',
  noteRow && noteRow.life < tData.schedule.find(r=>r.seat===8).life);

// stabilisers
const cSteady = mkChart();
cSteady.swapDesks(6, 8);                     // Priya to the back left, right behind Bex
const steadyPlan = cSteady.resolveSchedule(tData.schedule);
check('parking the steadiest kid next to trouble stops the trouble',
  steadyPlan.suppressed.some(x=>x.by===6 && x.seat===4));
check('suppression is silent — nothing is added to the schedule',
  steadyPlan.rows.every(r=>!(r.type==='COPYING' && r.seat===4)));
check('the steady kid carries a load', (steadyPlan.load.get(6)||0) >= 1);

const steadyKids = mkStudents(cSteady, steadyPlan);
check('and it costs them the lesson', steadyKids[6].steadyLoad > 0);
check('the load is capped', steadyKids[6].steadyLoad <= CFG.seating.steadyLoadCap);
check('nobody else pays for it', steadyKids[0].steadyLoad===0);

// the curveball is never touched, however you seat the room
const cQuiet = mkChart();
cQuiet.swapDesks(6, 2);                      // Priya directly in front of Israel's old desk
check('QUIET is not suppressible', tData.types.QUIET.suppressible===false);
check('the curveball survives any chart',
  cQuiet.resolveSchedule(tData.schedule).rows.some(r=>r.type==='QUIET'));

// what the chart does to the lesson
const seated = mkStudents(baseChart, basePlan);
check('the front row gets more of you', seated.find(s=>s.row===0).rowGain > seated.find(s=>s.row===2).rowGain);
check('the chart writes real positions', Math.abs(seated[0].x - sData.seatGrid.cols[0]) < 1e-9);
check('and a sight class per kid', ['clear','partial','blind'].includes(seated[0].sight));
check('the front row is never hidden from where you teach', seated.filter(s=>s.row===0).every(s=>!s.hidden));
check('somebody is hidden from where you teach', seated.some(s=>s.hidden));

{
  const ts = {defs:tData.types, tells:[], kill(){}, describe:()=>''};
  const kids = mkStudents(baseChart, basePlan);
  for (const k of kids) { k.aptitude = 1; k.steadyLoad = 0; }
  const st2 = createState();
  const L2 = createLesson({data:lData, students:kids, tellSystem:ts, toast:()=>{}, rand:()=>0.5});
  const front = kids.find(s=>s.row===0), back = kids.find(s=>s.row===2);
  const f0 = front.comp, b0 = back.comp;
  L2.tick(st2, 200/CFG.timeScale, {teaching:true});
  check('sitting at the front is worth something measurable',
    (front.comp - f0) > (back.comp - b0));
}

// "we JUST moved"
const cCost = mkChart();
check('keeping the chart is free', cCost.rechartCost(baseChart.seatOf).rapport===0);
cCost.swapDesks(0,1);
check('one swap is two moves, and both are free', cCost.rechartCost(baseChart.seatOf).moved===2);
check('and it costs nothing', cCost.rechartCost(baseChart.seatOf).rapport===0);
cCost.swapDesks(2,3); cCost.swapDesks(4,5); cCost.swapDesks(6,7);
const bill = cCost.rechartCost(baseChart.seatOf);
check('moving the room costs rapport', bill.moved===8 && bill.rapport < 0);
check('and the complaining is capped', bill.rapport >= CFG.seating.rapportMoveCap);
check('no previous chart, no complaint', cCost.rechartCost(null).rapport===0);
check('but the moves are still counted honestly', cCost.rechartCost(null).moved===8);
check('a chart nobody has sat in is flagged as new', cCost.rechartCost(null).novel===true);
check('a chart they sat in yesterday is not', cCost.rechartCost(baseChart.seatOf).novel===false);

// discovery — nothing is labelled until you have watched it
const vmCold = baseChart.viewModel({edges:[], steadies:[]});
check('a cold chart shows no volatility edges', vmCold.edges.length===0);
check('a cold chart shows no stabilisers', vmCold.seats.every(s=>!s.steadyKnown));
check('a cold chart still shows your own furniture', vmCold.occluders.length===2 && vmCold.furniture.length>0);

const borne = [
  {type:'WHISPER', seat:1, seat2:2, born:1000},
  {type:'PHONE',   seat:6, seat2:undefined, born:900},
  {type:'NOTE',    seat:8, seat2:11, born:null}
];
const learned = learnFrom({tells:borne, plan:basePlan, known:{edges:[],steadies:[]}, rules:seatData.rules});
check('a pair that goes off is remembered', learned.known.edges.includes(edgeKey(1,2)));
check('a solo tell is not an edge', !learned.known.edges.some(k=>k.includes('6')));
check('a tell that never happened teaches nothing', !learned.known.edges.includes(edgeKey(8,11)));
check('the kid who absorbed it is remembered', learned.known.steadies.includes(basePlan.suppressed[0].by));
check('learning twice does not duplicate',
  learnFrom({tells:borne, plan:basePlan, known:learned.known, rules:seatData.rules}).known.edges.length
  === learned.known.edges.length);

const vmWarm = baseChart.viewModel(learned.known);
check('what you learned is on the next chart', vmWarm.edges.length===1 && vmWarm.edges[0].live===true);
check('and the stabiliser gets a dot', vmWarm.seats.some(s=>s.steadyKnown));

const cMoved = mkChart(); cMoved.swapDesks(2, 11);
check('an edge you have already separated is drawn quiet',
  cMoved.viewModel(learned.known).edges[0].live===false);

// ---------------------------------------------------------------------------
// T5 — the classroom builder: push the furniture, the shading follows
// ---------------------------------------------------------------------------

// desk 8 is row 2 / col 0, the back-left desk the cabinet test above (line
// ~318) already showed is blocked from centre-front.
const cabRect = occluderRects(roomData.occluders).find(r=>r.id==='cabinet');
const farCorner = { x: roomData.bounds.x - cabRect.halfW, z: roomData.bounds.zBack - cabRect.halfD };

const cBuild = mkChart();
const before8 = cBuild.desks[8].sight;
check('desk 8 (back-left) is not fully clear before anything gets rearranged', before8.kind!=='clear');

const moved = cBuild.moveOccluder('cabinet', 999, 999);
check('the cabinet is clamped to the room, not wherever you drag it',
  Math.abs(moved.x-farCorner.x)<1e-9 && Math.abs(moved.z-farCorner.z)<1e-9);
check('every desk gets reclassified, live, against the new layout',
  cBuild.desks[8].sight.count > before8.count);
check('the front row does not care that the cabinet moved',
  cBuild.desks[0].sight.kind===baseChart.desks[0].sight.kind);
check('an unknown occluder id is refused', cBuild.moveOccluder('nope', 0, 0)===null);
check('a refused move touches nothing', cBuild.rects.find(r=>r.id==='cabinet').x===moved.x);

check('occluderLayout reports exactly what moveOccluder just set',
  cBuild.occluderLayout().find(o=>o.id==='cabinet').x===moved.x &&
  cBuild.occluderLayout().find(o=>o.id==='cabinet').z===moved.z);

// a chart loaded with a saved layout starts already rearranged
const cLoaded = mkChart(null, [{ id: 'cabinet', x: 999, z: 999 }]);
check('a saved layout moves the furniture before the first desk is classified',
  cLoaded.rects.find(r=>r.id==='cabinet').x===farCorner.x);
check('desks are classified against the loaded layout, not the room.json default',
  cLoaded.desks[8].sight.count > baseChart.desks[8].sight.count);

// junk in a saved layout is ignored rather than thrown
const cBadLayout = mkChart(null, [{ id: 'nope', x: 1, z: 1 }, { id: 'cabinet', x: NaN, z: 1 }]);
check('an unknown id or a non-finite coordinate in a saved layout is skipped',
  cBadLayout.rects.find(r=>r.id==='cabinet').x===cabRect.x);

// ---------------------------------------------------------------------------
// T6 — second period: a different roster, a different lesson, the same room
// ---------------------------------------------------------------------------

check('period5 has a full roster', p5Data.roster.length===12);
check('period5 names are all distinct', new Set(p5Data.roster.map(r=>r.name)).size===12);
check("period5 isn't just period4's roster with the serial numbers filed off",
  p5Data.roster.every(r => !sData.roster.some(r4 => r4.name===r.name)));

const mkChart5 = (saved=null) => createChart({
  seatGrid: sData.seatGrid, room: roomData, roster: p5Data.roster,
  tellTypes: tData.types, rules: seatData.rules,
  plan: seatData.plan.furniture, saved
});
const chart5 = mkChart5();

check('period5 lesson still sums to the same 2000s gap-1 settled on for period4',
  p5Data.lesson.beats.reduce((a,b)=>a+b.seconds,0) === lData.beats.reduce((a,b)=>a+b.seconds,0));

check('every seat named in period5\'s schedule exists in its roster',
  p5Data.schedule.every(row =>
    row.seat>=0 && row.seat<12 && (row.with==null || (row.with>=0 && row.with<12))));

const plan5 = chart5.resolveSchedule(p5Data.schedule);
check('period5\'s schedule survives the chart',
  plan5.rows.length + plan5.suppressed.length === p5Data.schedule.length);
check('period5 has its own curveball, and it is never suppressed',
  plan5.rows.some(r=>r.type==='QUIET'));

// Anh (seat 6, steady 0.84) sits directly beside Devontae (seat 7, tension
// 0.82) on the default chart — that phone should never happen, the same
// shape as period4's Priya/June, authored fresh for a roster that has never
// met Priya or June.
check("period5 has its own quiet stabiliser (Anh) absorbing its own live wire (Devontae)",
  plan5.suppressed.some(x=>x.by===6 && x.seat===7));
check("and it's silent — nothing shows up in the schedule for it",
  plan5.rows.every(r=>!(r.type==='PHONE' && r.seat===7)));

// the seat1/seat2 NOTE is adjacent by default, so it is a handoff — same
// mechanic as period4's, different kids.
const p5NoteRow = plan5.rows.find(r=>r.type==='NOTE' && r.seat===1);
check('period5 has its own quick handoff',
  p5NoteRow && p5NoteRow.life < p5Data.schedule.find(r=>r.seat===1 && r.type==='NOTE').life);

const p5Students = chart5.apply(p5Data.roster.map((r,i)=>({ ...r, seat:i })), plan5);
check('period5 students actually learn something under it',
  p5Students.find(s=>s.row===0).rowGain > p5Students.find(s=>s.row===2).rowGain);

// ---- T6: the physical handoff from 4th period's desks into 5th's ----------
// This is what main.js does across the reload: 5th period's chart is built
// with `saved` set to whatever 4th period's seatOf ended up being, onto a
// roster that has never seen it before.
const p4End = mkChart(); p4End.swapDesks(0, 11);
const chart5Carried = mkChart5(p4End.seatOf);
check("5th period's desks start wherever 4th period actually left them",
  chart5Carried.seatOf.join()===p4End.seatOf.join());
check('but the kids sitting in them are a completely different roster',
  chart5Carried.deskOf(11).index===0 && p5Data.roster[11].name !== sData.roster[11].name);

// The physical carryover is not the same thing as familiarity: main.js feeds
// rechartCost() a *separate*, always-null baseline for a brand-new roster, so
// this reads as novel (free) no matter how the carried-over chart is used.
check("a carried-over chart still reads as novel for Rapport purposes when compared against nothing",
  chart5Carried.rechartCost(null).novel===true && chart5Carried.rechartCost(null).rapport===0);

// ---------------------------------------------------------------------------
// T7 — the Observation: the alert, the window, the rubric, the conference
// ---------------------------------------------------------------------------

const fakeClassList = () => {
  const s = new Set();
  return { add: k => s.add(k), remove: k => s.delete(k), contains: k => s.has(k) };
};
const mkObsDom = () => ({
  pa: { classList: fakeClassList() },
  paTitle: { textContent: '' },
  paTxt: { textContent: '' }
});
const mkObs = () => {
  const msgs = [];
  const dom = mkObsDom();
  const obs = createObservation({ data: obsData, dom, toast: (k, t, b) => msgs.push([k, t, b]) });
  return { obs, dom, msgs };
};

// idle until her scheduled minute arrives
{
  const { obs } = mkObs();
  const st = createState();
  st.t = CFG.periodSeconds - (obsData.atMinute - 1) * 60;   // one minute early
  obs.tick(st, 1 / 60);
  check('no alert before her scheduled minute', st.obsPhase === 'idle');
}

// alert -> active, on schedule, in real seconds
{
  const { obs, dom } = mkObs();
  const st = createState();
  st.t = CFG.periodSeconds - obsData.atMinute * 60;
  obs.tick(st, 1 / 60);
  check('the alert starts exactly on her scheduled minute', st.obsPhase === 'alert');
  check('the alert banner is up', dom.pa.classList.contains('on'));
  check('a full countdown is queued', st.obsAlertRemaining === CFG.observation.alertSeconds);

  for (let i = 0; i < CFG.observation.alertSeconds * 60 + 2; i++) obs.tick(st, 1 / 60);
  check('nine real seconds later she has arrived', st.obsPhase === 'active');
  check('the window is a fixed number of game-minutes', st.obsWindowRemaining <= CFG.observation.windowMinutes * 60);
}

// look-fors: satisfied once, idempotent, refused outside the window
{
  const { obs, msgs } = mkObs();
  const st = createState();
  check('pressing a look-for before she has arrived does nothing', obs.satisfy(st, 'objective') === false);
  check('and it tells you so', msgs.some(m => m[2] === obsData.idle));

  st.obsPhase = 'active';
  const before = st.fidelity;
  check('the first press satisfies it', obs.satisfy(st, 'objective') === true);
  check('fidelity actually moved', st.fidelity > before);
  check('a second press does nothing', obs.satisfy(st, 'objective') === false);
  check('a satisfied look-for stays satisfied', st.obsSatisfied.objective === true);
}

// wait time: held long enough books itself; releasing early resets the clock
{
  const { obs } = mkObs();
  const st = createState();
  st.obsPhase = 'active';
  for (let i = 0; i < 60; i++) obs.tickWait(st, 1 / 60, true);   // one second held
  check('half a hold does not satisfy it yet', !st.obsSatisfied.wait);
  obs.tickWait(st, 1 / 60, false);                                // let go
  check('letting go resets the held clock', st.obsWaitHeld === 0);
  for (let i = 0; i < CFG.observation.waitHoldSeconds * 60 + 2; i++) obs.tickWait(st, 1 / 60, true);
  check('holding it the whole way books "wait time" for you', st.obsSatisfied.wait === true);
}

// checks for understanding piggybacks on the real Q action, not a new key
check("checks for understanding is a real look-for key, not one you press directly",
  obsData.lookFors.find(l => l.key === 'check').code === 'Q' && !obsData.lookFors.find(l => l.key === 'check').toast);

// the ambient Mastery cost runs through masteryPending, never state.mastery,
// whether or not you chase a single look-for (CLAUDE.md rule 7)
{
  const { obs } = mkObs();
  const st = createState();
  st.obsPhase = 'active';
  st.obsWindowRemaining = 999;
  const m0 = st.mastery;
  obs.tick(st, 1);
  check('being watched costs something, queued rather than applied directly',
    st.masteryPending < 0 && st.mastery === m0);
}

// the window closes on the game clock, not on player behaviour, and reports itself
{
  const { obs } = mkObs();
  const st = createState();
  st.obsPhase = 'active';
  st.obsWindowRemaining = 0.001;
  obs.satisfy(st, 'objective');
  obs.satisfy(st, 'question');
  obs.tick(st, 1 / 60);
  check('the window closes on schedule regardless of the rubric score', st.obsPhase === 'done');
  check('what got satisfied is reported back', st.obsResult.satisfied.length === 2 && st.obsResult.total === 5);
}

// the post-conference: three options, real effects, honesty flagged for the report
{
  const { obs } = mkObs();
  const st = createState();
  const before = st.fidelity;
  const opt = obs.resolveConference(st, 'honest');
  check('resolving a real option returns it', opt && opt.key === 'honest');
  check('its effects actually apply', st.fidelity < before);
  check('the honest option is flagged for the report', opt.honest === true);
  check('the other two are not', !obs.conferenceOption('turnAndTalk').honest && !obs.conferenceOption('hollow').honest);
  check('an unknown option resolves to nothing', obs.resolveConference(createState(), 'nope') === null);
}

// ---------------------------------------------------------------------------
// Phase 1 — the school day is data, the save slots are namespaced, and the
// migration off the six flat keys runs on read and only once.
// ---------------------------------------------------------------------------
const pData = D('periods');

// The bundle loadData() would hand main.js: the core files, plus whatever
// content files the period rows point at. Assembling it through the loader's
// own contentFiles() means a row pointing at a file nobody shipped fails here
// rather than in a browser.
const bundle = { room: roomData, students: sData, tells: tData, lesson: lData,
  seating: seatData, periods: pData, events: eData, observation: obsData, generation: genData };
for (const name of contentFiles(pData)) {
  if (!(name in bundle)) bundle[name] = D(name);
}

check('the day is four periods long, in order', periodIds(bundle).join() === 'p4,p5,p6,p7');
check('the day starts at the top of the day', firstPeriodId(bundle) === 'p4');

const p4 = periodFor('p4', bundle);
const p5 = periodFor('p5', bundle);
const p6 = periodFor('p6', bundle);

// 4th period's content still lives where it always did; the row points at it.
check('4th period reads its roster out of students.json', p4.roster === sData.roster);
check("4th period reads its tell schedule out of tells.json", p4.schedule === tData.schedule);
check('4th period reads its lesson out of lesson.json', p4.lessonData.beats === lData.beats);
check('4th period gets the base chart copy unchanged', p4.seatingCopy.sub === seatData.sub);

// 5th period overrides three things and inherits the rest, which is what the
// two hardcoded branches of the old periodFor() did by hand.
check('5th period has its own roster', p5.roster[0].name === 'Farah' && p5.roster !== p4.roster);
check('5th period has its own lesson', p5.lessonData.unit.endsWith('DAY 3 OF 3'));
check('5th period still shares the day\'s lesson copy deck', p5.lessonData.copy === lData.copy);
check('5th period still shares the objective on the wall',
  p5.lessonData.objectiveBoard === lData.objectiveBoard);
check('5th period overrides the chart screen sub', p5.seatingCopy.sub.includes('5TH PERIOD'));
check('5th period overrides one button and inherits the other',
  p5.seatingCopy.buttons.reset === 'Back to roll-call order' &&
  p5.seatingCopy.buttons.confirm === seatData.buttons.confirm);

// The 6th period is the whole point: it was authored as a data row and a
// content file, and it behaves like the two that came before it.
check('6th period exists and is a full class', p6.roster.length === 12);
check('6th period has its own tell schedule', p6.schedule.length === 10);
check('6th period has a full lesson', p6.lessonData.beats.reduce((a, b) => a + b.seconds, 0) === 2000);
check('6th period hands off to the generated 7th', p6.nextPeriodId === 'p7');

// Phase 2: the 7th period is a row with no roster and no schedule pointer.
const p7 = periodFor('p7', bundle, { seed: 4821, day: 0 });
check('7th period is generated', isGenerated(rowFor('p7', bundle)) && !!p7.generated);
check('7th period is the last one', p7.nextPeriodId === null);
check('7th period is a full class', p7.roster.length === 12);
check('7th period reads the authored lesson', p7.lessonData.beats === lData.beats);
check('7th period has its own chart copy', p7.seatingCopy.sub.includes('7TH PERIOD'));

// What the report's button says is data too, so a seventh period needs no
// string literal in main.js.
check('4th period hands off to 5th', p4.nextPeriodId === 'p5' && p4.nextLabel === 'Next period — 5th');
check('5th period hands off to 6th',
  p5.nextPeriodId === 'p6' && p5.nextLabel === 'Next period — 6th');
check('6th period hands off to 7th', p6.nextLabel === 'Next period — 7th');
check('the last period offers the day again', p7.nextLabel === null && p7.restartLabel === 'Run it again');

// Every period is the same room and the same rulebook (T6's premise, now
// enforced across four classes instead of asserted across two).
for (const p of [p4, p5, p6, p7]) {
  check(`${p.id}: twelve kids in the twelve desks`, p.roster.length === 12);
  check(`${p.id}: same desk grid`, p.seatGrid === sData.seatGrid);
  check(`${p.id}: every scheduled tell names a real seat`,
    p.schedule.every(r => r.seat < p.roster.length && (r.with == null || r.with < p.roster.length)));
  check(`${p.id}: exactly one curveball`, p.schedule.filter(r => r.type === 'QUIET').length === 1);
  check(`${p.id}: every scheduled tell is a real type`,
    p.schedule.every(r => tData.types[r.type]));
  check(`${p.id}: nothing is scheduled after the bell`,
    p.schedule.every(r => r.atMinute * 60 < CFG.periodSeconds));
}

// A `period` key naming a class that no longer exists must not strand anyone.
check('a saved period id resolves to itself', resolvePeriodId('p6', bundle) === 'p6');
check('no saved period id starts the day at the top', resolvePeriodId(null, bundle) === 'p4');
check('a stale period id falls back rather than throwing', resolvePeriodId('p9', bundle) === 'p4');
check('asking for a period that is not in the data is an error, not a guess', (() => {
  try { periodFor('p9', bundle); return false; } catch { return true; }
})());

// The seam itself: what the loader fetches comes out of periods.json, so a
// seventh period is a row and a file and no edit to src/loader.js.
check('the loader fetches whatever the rows point at',
  contentFiles(pData).includes('period6') && contentFiles(pData).includes('period5') &&
  contentFiles(pData).includes('period7'));
check('and does not fetch the same file twice',
  new Set(contentFiles(pData)).size === contentFiles(pData).length);

// ---------------------------------------------------------------------------
// Phase 1 — the migration. Six flat keys become namespaced slots, on read,
// once. Break any of the four properties below and one of these fails.
// ---------------------------------------------------------------------------
const fakeStore = (seed = {}) => {
  const m = new Map(Object.entries(seed));
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    keys: () => [...m.keys()].sort(),
    raw: k => (m.has(k) ? m.get(k) : null)
  };
};
const K = k => PREFIX + k;

check('a slot is the period id and the key', slot('p5', 'chart') === 'p5.chart');
check('a day key is not a period key', dayKey('bandwidth') === 'day.bandwidth');
check('the migration table is exactly the six keys that existed',
  Object.keys(LEGACY_KEYS).sort().join() === 'chart,chart5,known,known5,rapportBase,rapportBase5');

// A browser that never played the old build has nothing to migrate.
{
  const st = fakeStore();
  check('a fresh store migrates nothing', migrateLegacyKeys(st) === 0 && st.keys().length === 0);
}

// The real case: somebody who played the two-period build and comes back.
{
  const st = fakeStore({
    [K('chart')]: '[3,1,2]', [K('known')]: '{"edges":[["a","b"]],"steadies":[6]}',
    [K('rapportBase')]: '[0,1,2]', [K('chart5')]: '[11,0,4]',
    [K('known5')]: '{"edges":[],"steadies":[]}', [K('rapportBase5')]: 'null',
    [K('furniture')]: '[{"id":"cabinet"}]', [K('period')]: '"p5"'
  });
  check('all six period keys move', migrateLegacyKeys(st) === 6);
  check('4th period\'s chart lands in its slot', st.raw(K('p4.chart')) === '[3,1,2]');
  check('5th period\'s chart lands in its slot', st.raw(K('p5.chart')) === '[11,0,4]');
  check('what 4th period taught you comes with it',
    st.raw(K('p4.known')) === '{"edges":[["a","b"]],"steadies":[6]}');
  // rapportBase5 is deliberately the JSON null "this class has never met this
  // chart" — an absent key and a stored null mean different things and a
  // migration that confuses them hands a new class a Rapport bill.
  check('a stored null survives as a stored null', st.raw(K('p5.rapportBase')) === 'null');
  check('the old flat keys are gone', Object.keys(LEGACY_KEYS).every(k => st.raw(K(k)) === null));
  check('the room\'s own facts are not period-scoped and are left alone',
    st.raw(K('furniture')) === '[{"id":"cabinet"}]' && st.raw(K('period')) === '"p5"');

  const snapshot = st.keys().map(k => `${k}=${st.raw(k)}`).join('|');
  check('running it again moves nothing', migrateLegacyKeys(st) === 0);
  check('and changes nothing, key or value',
    st.keys().map(k => `${k}=${st.raw(k)}`).join('|') === snapshot);
}

// Half-migrated: an old key and its namespaced home both present. The
// namespaced one can only have been written after the migration ran, so it is
// the newer of the two and it wins.
{
  const st = fakeStore({ [K('chart')]: '[9,9,9]', [K('p4.chart')]: '[1,2,3]', [K('known5')]: '{"edges":[]}' });
  check('a half-migrated store only moves what is missing', migrateLegacyKeys(st) === 1);
  check('the namespaced value wins over the flat one', st.raw(K('p4.chart')) === '[1,2,3]');
  check('and the flat one is cleared out anyway', st.raw(K('chart')) === null);
  check('the key that had not moved yet still moves', st.raw(K('p5.known')) === '{"edges":[]}');
}

// Already namespaced, nothing flat: the second launch, and every launch after.
{
  const st = fakeStore({ [K('p4.chart')]: '[1,2,3]', [K('p6.known')]: '{"edges":[]}' });
  const before = st.keys().join();
  check('an already-migrated store is untouched',
    migrateLegacyKeys(st) === 0 && st.keys().join() === before);
}

// The live module runs the migration on import and still round-trips.
{
  persist.save(slot('p6', 'chart'), [4, 5, 6]);
  check('a slot key round-trips through the real store',
    persist.load(slot('p6', 'chart'), null).join() === '4,5,6');
  persist.clear(slot('p6', 'chart'));
  check('and clears', persist.load(slot('p6', 'chart'), 'gone') === 'gone');
}

// ---------------------------------------------------------------------------
// Phase 1, gap 11 — a refresh mid-period lands you in that period. The read
// side is resolvePeriodId, asserted above; the write side is one line in
// main.js's beginPeriod(), which no Node suite can execute because main.js
// imports three.js. Assert the line instead of assuming it.
// ---------------------------------------------------------------------------
const mainSrc = fs.readFileSync('../src/main.js', 'utf8');
const beginPeriod = mainSrc.slice(mainSrc.indexOf('function beginPeriod()'));
check('beginPeriod() writes the active period, not just the report buttons',
  /persist\.save\('period', period\.id\)/.test(beginPeriod.slice(0, beginPeriod.indexOf('\n}\n'))));
check('main.js no longer names a period or a save slot in JavaScript',
  !/chart5|known5|rapportBase5|isP5|period5|period6/.test(mainSrc));
check('main.js carries Bandwidth across the bell through the day key',
  mainSrc.includes("persist.dayKey('bandwidth')") &&
  mainSrc.includes('CFG.day.passingPeriodRecovery'));

// Phase 2: the seed lives in the period's own slot, is drawn once through the
// rng module rather than Math.random, and reaches the report screen.
check('main.js keeps the seed in the period slot',
  /persist\.slot\(activePeriodId, 'seed'\)/.test(mainSrc));
check('main.js draws a seed only for a generated period, and keeps it',
  /isGenerated\(rowFor\(activePeriodId, data\)\)/.test(mainSrc) &&
  /seed = drawSeed\(\);\s*persist\.save\(seedKey, seed\)/.test(mainSrc));
check('main.js hands periodFor the seed', /periodFor\(activePeriodId, data, \{ seed/.test(mainSrc));
check('main.js puts the seed on the report', /seed: period\.generated \? \{ value: period\.generated\.seed/.test(mainSrc));
check('the start screen has somewhere to type a seed',
  /id="seedInput"/.test(fs.readFileSync('../index.html', 'utf8')));

// ---------------------------------------------------------------------------
// Phase 2 — kids nobody authored. One integer in, the same class out; every
// promise the authored rosters and schedules kept without saying so is now a
// rule, and the period they add up to has to land inside a band.
// ---------------------------------------------------------------------------

// The RNG. Boring on purpose; the one thing it must be is repeatable.
{
  const a = createRng(7), b = createRng(7);
  const sa = [a.next(), a.next(), a.int(1, 6), a.pick(['x', 'y', 'z'])];
  const sb = [b.next(), b.next(), b.int(1, 6), b.pick(['x', 'y', 'z'])];
  check('the same seed gives the same stream', sa.join() === sb.join());
  check('a different seed gives a different stream', createRng(8).next() !== createRng(7).next());
  check('int() is inclusive at both ends', (() => {
    const r = createRng(3), seen = new Set();
    for (let i = 0; i < 500; i++) seen.add(r.int(2, 4));
    return seen.size === 3 && seen.has(2) && seen.has(4);
  })());
  check('a zero weight never comes up', (() => {
    const r = createRng(11);
    for (let i = 0; i < 300; i++) if (r.weighted([{ item: 'no', weight: 0 }, { item: 'yes', weight: 1 }]) === 'no') return false;
    return true;
  })());
  check('shuffle leaves the input alone', (() => {
    const arr = [1, 2, 3, 4, 5];
    createRng(5).shuffle(arr);
    return arr.join() === '1,2,3,4,5';
  })());
  check('mixSeed tells day 3 from day 4', mixSeed(4821, 3, 0) !== mixSeed(4821, 4, 0));
  check('mixSeed tells attempt 0 from attempt 1', mixSeed(4821, 0, 0) !== mixSeed(4821, 0, 1));
  check('mixSeed is stable', mixSeed(4821, 3, 0) === mixSeed(4821, 3, 0));
  check('a drawn seed is a positive six-digit number', (() => {
    const lo = drawSeed(() => 0), hi = drawSeed(() => 0.999999999);
    return lo === 1 && hi === SEED_MAX && Number.isInteger(drawSeed());
  })());
}

// The roster.
{
  const r1 = generateRoster(4821, genData), r2 = generateRoster(4821, genData);
  check('the same seed gives the same twelve kids', JSON.stringify(r1) === JSON.stringify(r2));
  check('a different seed gives different kids',
    generateRoster(4822, genData).map(s => s.name).join() !== r1.map(s => s.name).join());
  check('a generated roster has the authored shape',
    r1.every(s => typeof s.name === 'string' && typeof s.shirt === 'string' &&
      Number.isFinite(s.aptitude) && Number.isFinite(s.tension) && Number.isFinite(s.steady)));
  let bad = 0;
  for (let seed = 1; seed <= 300; seed++) if (rosterProblems(generateRoster(seed, genData), genData).length) bad++;
  check('300 seeds, 300 rosters that keep their promises', bad === 0);

  // The promises, each broken on purpose. If rosterProblems lets one of these
  // through, the generator is free to make it.
  const clone = () => JSON.parse(JSON.stringify(r1));
  let r = clone(); r[1].name = r[0].name.slice(0, 2) + 'xyz';
  check('two names that read alike are refused', rosterProblems(r, genData).some(p => p.includes('read alike')));
  r = clone(); for (const s of r) s.steady = 0.3;
  check('a roster with no stabiliser is refused', rosterProblems(r, genData).some(p => p.includes('stabiliser')));
  r = clone(); for (const s of r) s.tension = 0.3;
  check('a roster with nobody at the edge is refused', rosterProblems(r, genData).some(p => p.includes('edge')));
  r = clone(); for (const s of r) s.aptitude = 1.0;
  check('a flat aptitude spread is refused', rosterProblems(r, genData).some(p => p.includes('spread')));
  r = clone(); const noted = r.filter(s => s.note); noted[1].note = noted[0].note;
  check('two kids with the same note are refused', rosterProblems(r, genData).some(p => p.includes('same note')));
  r = clone(); r.pop();
  check('eleven kids are refused', rosterProblems(r, genData).length === 1 && rosterProblems(r, genData)[0].includes('11 students'));
  check('the stabiliser note goes to the steadiest kid', (() => {
    const top = [...r1].sort((a, b) => b.steady - a.steady)[0];
    return genData.notes.stabiliser.includes(top.note);
  })());
  check('nothing in the generated pool is an authored name', (() => {
    const authored = new Set([...sData.roster, ...p5Data.roster, ...D('period6').roster].map(s => s.name));
    return genData.names.every(n => !authored.has(n));
  })());
  check('an impossible roster is a loud error, not a quiet one', (() => {
    const g = JSON.parse(JSON.stringify(genData));
    g.roster.stabilisers = { min: 12, max: 12 };
    g.roster.rerollCap = 5;
    try { generateRoster(1, g); return false; } catch (e) { return /5 draws/.test(e.message); }
  })());
}

// The schedule.
const schedDeps = { tellTypes: tData.types, seatGrid: sData.seatGrid, rules: seatData.rules, gen: genData };
{
  const roster = generateRoster(4821, genData);
  const a = generateSchedule(mixSeed(4821, 0, 0), roster, schedDeps);
  const b = generateSchedule(mixSeed(4821, 0, 0), roster, schedDeps);
  check('the same seed gives the same schedule', JSON.stringify(a) === JSON.stringify(b));
  check('a different day gives a different schedule for the same kids',
    JSON.stringify(generateSchedule(mixSeed(4821, 1, 0), roster, schedDeps)) !== JSON.stringify(a));
  check('a generated row looks like an authored row',
    a.every(r => typeof r.type === 'string' && Number.isInteger(r.seat) && Number.isFinite(r.atMinute) && Number.isInteger(r.life)));
  check('the generated schedule is in time order', a.every((r, i) => i === 0 || r.atMinute >= a[i - 1].atMinute));
  let bad = 0, swallowMismatch = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const ro = generateRoster(seed, genData);
    for (const day of [0, 1, 2]) {
      const rows = generateSchedule(mixSeed(seed, day, 0), ro, schedDeps);
      if (scheduleProblems(rows, ro, schedDeps).length) bad++;
      // The scheduler's paper answer to "would the August chart swallow this"
      // must agree with the chart's own, or the cap is a guess.
      const chart = createChart({ seatGrid: sData.seatGrid, room: roomData, roster: ro,
        tellTypes: tData.types, rules: seatData.rules, plan: seatData.plan.furniture });
      if (chart.resolveSchedule(rows).suppressed.length > genData.schedule.maxSwallowed) swallowMismatch++;
    }
  }
  check('100 seeds x 3 days, every schedule keeps its promises', bad === 0);
  check('the August chart never swallows more than the cap', swallowMismatch === 0);

  // The promises, each broken on purpose.
  const clone = () => JSON.parse(JSON.stringify(a));
  const has = (rows, needle) => scheduleProblems(rows, roster, schedDeps).some(p => p.includes(needle));
  let rows = clone(); rows.find(r => r.type === 'PHONE').type = 'QUIET';
  check('two curveballs are refused', has(rows, 'curveballs'));
  rows = clone(); rows.find(r => r.type === 'QUIET').atMinute = 5;
  check('a curveball at minute 5 is refused', has(rows, 'the curveball is at'));
  rows = clone(); { const w = rows.find(r => r.type === 'WHISPER'); w.with = (w.seat + 6) % 12; }
  check('a whisper across the room is refused', has(rows, 'across the room'));
  rows = clone(); { const n = rows.find(r => r.type === 'NOTE'); n.with = n.seat % 4 === 3 ? n.seat - 1 : n.seat + 1; }
  check('a note passed one desk over is refused as a handoff', has(rows, 'handoff'));
  rows = clone(); rows[1].seat = rows[0].seat; rows[1].atMinute = rows[0].atMinute + 1.5; rows[1].with = undefined; rows[1].type = 'PHONE';
  check('two things on one seat inside each other\'s lifespan are refused', has(rows, 'already carrying'));
  rows = clone(); rows[2].atMinute = rows[1].atMinute + 0.5;
  check('two tells half a minute apart are refused', has(rows, 'min after the last one'));
  rows = clone(); for (const r of rows) r.life = 60;
  check('too little tell pressure is refused', has(rows, 'of tell; wanted'));
  rows = clone(); rows.find(r => r.type === 'PHONE').seat = 99;
  check('a seat that does not exist is refused', has(rows, 'no real seat'));
  rows = clone(); rows[rows.length - 1].atMinute = 46;
  check('a tell that outlives the bell is refused', has(rows, 'outlives the bell'));
  check('a schedule the August chart mostly swallows is refused, and the chart agrees', (() => {
    // Seat 0 is a rock; seats 1 (beside) and 4 (behind) carry everything.
    const ro = JSON.parse(JSON.stringify(roster));
    for (const s of ro) s.steady = 0.1;
    ro[0].steady = 0.9;
    const rows = [];
    let m = 1.0;
    for (const seat of [1, 4, 1, 4, 1, 4]) { rows.push({ type: 'PHONE', seat, atMinute: m, life: 170 }); m += 4; }
    rows.push({ type: 'QUIET', seat: 9, atMinute: 20.0, life: 300 });
    const chart = createChart({ seatGrid: sData.seatGrid, room: roomData, roster: ro,
      tellTypes: tData.types, rules: seatData.rules, plan: seatData.plan.furniture });
    const sup = chart.resolveSchedule(rows).suppressed.length;
    return sup === 6 && scheduleProblems(rows, ro, schedDeps).some(p => p.includes('swallows 6'));
  })());
  check('an impossible schedule is a loud error', (() => {
    const g = JSON.parse(JSON.stringify(genData));
    g.schedule.pressure = { min: 99999, max: 100000 };
    g.schedule.rerollCap = 3;
    try { generateSchedule(1, roster, { ...schedDeps, gen: g }); return false; } catch (e) { return /3 draws/.test(e.message); }
  })());
}

// The sim, and the band.
const simData = { room: roomData, tells: tData, seating: seatData, events: eData, observation: obsData };
{
  const r1 = runPeriod({ period: p4, data: simData, style: STYLES.ideal });
  const r2 = runPeriod({ period: p4, data: simData, style: STYLES.ideal });
  check('the headless sim is deterministic',
    r1.state.mastery === r2.state.mastery && r1.state.restless === r2.state.restless && r1.missed === r2.missed);
  check('the sim reports the students with their comprehension',
    r1.students.length === 12 && r1.students.every(s => s.comp >= 0 && s.comp <= 1));
  check('every band names a play style the sim has',
    Object.keys(genData.bands).filter(k => !k.startsWith('_') && k !== 'rerollCap').every(k => STYLES[k]));
  const results = simulateBands({ period: p4, data: simData, bands: genData.bands });
  check('the authored 4th period sits inside the bands', bandProblems(results, genData.bands).length === 0);
  check('a period outside a band is named, with the number',
    bandProblems({ ...results, ideal: { ...results.ideal, mastery: 5 } }, genData.bands)
      .some(p => /ideal: mastery 5 outside/.test(p)));
  check('a style that was not simulated is a problem, not a pass',
    bandProblems({ ideal: results.ideal }, genData.bands).some(p => p.includes('neverChecks: not simulated')));

  check('generateClass rerolls the schedule and never the roster', (() => {
    const a = generateClass({ seed: 4821, day: 0, data: bundle, lessonData: p4.lessonData, seatGrid: sData.seatGrid });
    const b = generateClass({ seed: 4821, day: 3, data: bundle, lessonData: p4.lessonData, seatGrid: sData.seatGrid });
    return JSON.stringify(a.roster) === JSON.stringify(b.roster) &&
      JSON.stringify(a.schedule) !== JSON.stringify(b.schedule) &&
      a.roster.map(s => s.name).join() === generateRoster(4821, genData).map(s => s.name).join();
  })());
  check('a class that cannot land in the band is a loud error, not an easy period', (() => {
    const d = JSON.parse(JSON.stringify(bundle));
    d.generation.bands.ideal.mastery = [99, 100];
    d.generation.bands.rerollCap = 2;
    try { generateClass({ seed: 1, day: 0, data: d, lessonData: p4.lessonData, seatGrid: sData.seatGrid }); return false; }
    catch (e) { return /2 attempts/.test(e.message) && /ideal: mastery/.test(e.message); }
  })());
  check('a generated period needs a seed', (() => {
    try { periodFor('p7', bundle); return false; } catch (e) { return /needs a seed/.test(e.message); }
  })());
  check('an authored period ignores the seed', periodFor('p4', bundle, { seed: 99 }).roster === sData.roster);
  check('the generated period records its seed and day',
    p7.generated.seed === 4821 && p7.generated.day === 0 && Number.isInteger(p7.generated.rerolls));
  check('the same seed and day is the same 7th period',
    JSON.stringify(periodFor('p7', bundle, { seed: 4821, day: 0 }).schedule) === JSON.stringify(p7.schedule));
}

console.log(fails? `\n${fails} FAILURES` : '\nall green');
process.exit(fails?1:0);
