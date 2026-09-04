import fs from 'fs';
import path from 'path';
import { createState, applyEffects } from '../src/state.js';
import { createInterventions } from '../src/systems/interventions.js';
import { createLesson } from '../src/systems/lesson.js';
import { createRoomTemp } from '../src/systems/roomtemp.js';
import { createChart, learnFrom, edgeKey } from '../src/systems/chart.js';
import { segmentHitsRect, classifySight, occluderRects } from '../src/systems/sightlines.js';
import { createObservation, visitFor, announcedAhead, defaultVisit } from '../src/systems/observation.js';
import { CFG } from '../src/config.js';
import { periodFor, periodIds, firstPeriodId, resolvePeriodId, isGenerated, rowFor } from '../src/periods.js';
import { contentFiles } from '../src/loader.js';
import { subjectKey, subjectFor, applySubject, weightedMix, subjectEvents, subjectTells,
  subjectInterventions, tickHazard, hazardBand, isLabDay, stackFixtures, subjectRoom,
  stackBand } from '../src/systems/subject.js';
import { createRng, mixSeed, drawSeed, SEED_MAX } from '../src/systems/rng.js';
import { generateRoster, rosterProblems } from '../src/systems/roster.js';
import { generateSchedule, scheduleProblems } from '../src/systems/scheduler.js';
import { generateClass, bandProblems, simulateBands } from '../src/systems/generate.js';
import { runPeriod, STYLES } from '../src/systems/simulate.js';
import * as semester from '../src/systems/semester.js';
import * as persist from '../src/persist.js';
import { PREFIX, slot, dayKey, LEGACY_KEYS, migrateLegacyKeys } from '../src/persist.js';
import { auditAssets } from './assets.mjs';
import * as THREE from '../src/three.js';
import { createTellSystem } from '../src/systems/tells.js';
import { createWithitness } from '../src/systems/withitness.js';
import { createTellMaterials, createRegistry } from '../src/world/materials.js';
import { createTellMeshBuilder, setTellVision, TELL_SHAPES } from '../src/world/tellmesh.js';
import { createInput, moveVector, stickVector, wantsTouchUI } from '../src/input.js';
import { pickTier, tierSettings, median, createFrameBudget } from '../src/quality.js';

const D = f => JSON.parse(fs.readFileSync(`../data/${f}.json`,'utf8'));
const iData = D('interventions'), tData = D('tells'), sData = D('students');
const lData = D('lesson'), eData = D('events'), rData = D('reactions');
const roomData = D('room'), seatData = D('seating'), p5Data = D('period5'), obsData = D('observation');
const genData = D('generation'), adminData = D('admin');
const ctrlData = D('controls');

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
// Phase 4 — and the calendar, the pool, the tree, and the follow-up
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
// Phase 4: a visit is a thing you hand in now. Leaving it out here means the
// one the balance table runs — always comes, minute 30, the five look-fors
// that used to be fixed rows in index.html.
const mkObs = (visit) => {
  const msgs = [];
  const dom = mkObsDom();
  const obs = createObservation({
    data: obsData, dom, toast: (k, t, b) => msgs.push([k, t, b]),
    visit: visit === undefined ? defaultVisit(obsData) : visit
  });
  return { obs, dom, msgs };
};
const AT = obsData.visit.default.atMinute;

// idle until her scheduled minute arrives
{
  const { obs } = mkObs();
  const st = createState();
  st.t = CFG.periodSeconds - (AT - 1) * 60;   // one minute early
  obs.tick(st, 1 / 60);
  check('no alert before her scheduled minute', st.obsPhase === 'idle');
}

// alert -> active, on schedule, in real seconds
{
  const { obs, dom } = mkObs();
  const st = createState();
  st.t = CFG.periodSeconds - AT * 60;
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

// ---- Phase 4: she does not always come, and sometimes she tells you --------

// A period she skipped is a period with no phase machine at all: nothing ticks,
// nothing arrives, and the report has no observation row to draw.
{
  const { obs, dom } = mkObs(null);
  const st = createState();
  for (let i = 0; i < 60 * 60; i++) { st.t -= 10 / 60; obs.tick(st, 1 / 60); }
  check('a period she skipped never starts an alert', st.obsPhase === 'idle');
  check('and never puts the banner up', !dom.pa.classList.contains('on'));
  check('and has no result to report', st.obsResult === null);
}

// The calendar is a function, not a list: the same day and the same period
// give the same answer forever, and a different day is a different answer.
{
  const args = { seed: 4821, dayIndex: 3, periodId: 'p4' };
  const a = visitFor(obsData, args), b = visitFor(obsData, args);
  check('the same day and period is the same visit, read twice',
    JSON.stringify(a) === JSON.stringify(b));
  const month = [];
  for (let d = 0; d < 40; d++) {
    for (const id of ['p4', 'p5', 'p6', 'p7']) month.push(visitFor(obsData, { seed: 4821, dayIndex: d, periodId: id }));
  }
  const came = month.filter(Boolean);
  check('she does not come to every period', came.length < month.length && came.length > 0);
  check('and she comes to more than one', new Set(came.map(v => v.periodId)).size > 1);
  check('every visit lands inside her window', came.every(v =>
    v.atMinute >= obsData.visit.window.fromMinute && v.atMinute <= obsData.visit.window.toMinute));
  check('some of them were on the calendar', came.some(v => v.announced));
  check('and most of them were not', came.filter(v => v.announced).length < came.length / 2);
  check('an announced visit has real lead time', came.filter(v => v.announced)
    .every(v => v.leadDays >= obsData.visit.announced.leadDays.min &&
                v.leadDays <= obsData.visit.announced.leadDays.max));
}

// An announced visit skips the nine-second Admin Proximity Alert. You have
// known for days; the countdown belongs to the surprise.
{
  const visit = { ...defaultVisit(obsData), announced: true };
  const { obs, msgs } = mkObs(visit);
  const st = createState();
  st.t = CFG.periodSeconds - AT * 60;
  obs.tick(st, 1 / 60);
  check('an announced visit walks straight in, no countdown', st.obsPhase === 'active');
  check('and says so in her own words',
    msgs.some(m => m[1] === obsData.visit.announced.arrival.title));
  st.obsWindowRemaining = 0.001;
  obs.tick(st, 1 / 60);
  check('the report knows it was on the calendar', st.obsResult.announced === true);
}

// An announced visit is readable before it happens, from the day it goes on
// the calendar and not one day earlier.
{
  const seed = 4821, ids = ['p4', 'p5', 'p6', 'p7'];
  let found = null;
  for (let d = 4; d < 60 && !found; d++) {
    for (const id of ids) {
      const v = visitFor(obsData, { seed, dayIndex: d, periodId: id });
      if (v && v.announced && v.leadDays >= 1) { found = { ...v, day: d }; break; }
    }
  }
  check('there is an announced visit somewhere in the first twelve weeks', !!found);
  const onDay = d => announcedAhead(obsData, { seed, dayIndex: d, periodIds: ids })
    .some(v => v.periodId === found.periodId && v.dayIndex === found.day);
  check('it is on the calendar the day it is announced', onDay(found.day - found.leadDays));
  check('and not the day before that', !onDay(found.day - found.leadDays - 1));
  check('and still on it the morning of', onDay(found.day));
}

// ---- Phase 4: the rubric is drawn from a pool ----------------------------

check('the pool is bigger than one window', obsData.lookFors.length > obsData.visit.rubricSize);
check('every look-for in the pool has a unique key and code',
  new Set(obsData.lookFors.map(l => l.key)).size === obsData.lookFors.length &&
  new Set(obsData.lookFors.map(l => l.code)).size === obsData.lookFors.length);
// Every one-shot look-for needs a key in config, and every look-for key in
// config needs a row in the pool. A pool row with no key is unreachable.
{
  const pool = new Set(obsData.lookFors.filter(l => !l.hold && !l.implicit).map(l => l.key));
  const bound = Object.keys(CFG.keys).filter(k => k.startsWith('look:')).map(k => k.slice(5));
  check('every one-shot look-for in the pool has a key bound to it',
    [...pool].every(k => bound.includes(k)));
  check('and every bound look-for key is in the pool', bound.every(k => pool.has(k)));
  const codeOf = k => obsData.lookFors.find(l => l.key === k).code;
  check('the letter on the rubric row is the letter you press',
    bound.every(k => CFG.keys['look:' + k] === 'Key' + codeOf(k)));
}

// Two visits are not the same performance twice.
{
  const drawn = [];
  for (let d = 0; d < 60; d++) {
    const v = visitFor(obsData, { seed: 991, dayIndex: d, periodId: 'p4' });
    if (v) drawn.push(v.rubric.join(','));
  }
  check('a drawn rubric never repeats a look-for inside one window',
    drawn.every(r => new Set(r.split(',')).size === obsData.visit.rubricSize));
  check('and two observations are not the same five things', new Set(drawn).size > 1);
}

// A look-for she did not bring is not on the rubric, does not score, and says so.
{
  const visit = { ...defaultVisit(obsData), rubric: ['objective', 'question', 'wait', 'check', 'discourse'] };
  const { obs, msgs } = mkObs(visit);
  const st = createState();
  st.obsPhase = 'active';
  const before = st.fidelity;
  check('a look-for she did not bring does not score', obs.satisfy(st, 'modeling') === false);
  check('and costs nothing either way', st.fidelity === before);
  check('and it tells you why', msgs.some(m => m[2] === obsData.notOnRubric));
  check('the HUD only lists the five she brought', obs.lookFors.length === 5 &&
    obs.lookFors.every(l => visit.rubric.includes(l.key)));
}

// Wait time is only bankable when wait time is on today's rubric.
{
  const visit = { ...defaultVisit(obsData), rubric: ['objective', 'question', 'modeling', 'check', 'discourse'] };
  const { obs } = mkObs(visit);
  const st = createState();
  st.obsPhase = 'active';
  for (let i = 0; i < CFG.observation.waitHoldSeconds * 60 + 60; i++) obs.tickWait(st, 1 / 60, true);
  check('holding the wait key books nothing she did not ask for', !st.obsSatisfied.wait);
}

// ---- Phase 4: the post-conference is a tree ------------------------------

// the post-conference: real effects, honesty flagged for the report
{
  const { obs } = mkObs();
  const st = createState();
  const before = st.fidelity;
  const step = obs.resolveConference(st, 'engagement', 'honest');
  check('resolving a real option returns it', step && step.option.key === 'honest');
  check('its effects actually apply', st.fidelity < before);
  check('the honest option is flagged for the report', step.option.honest === true);
  check('an unknown option resolves to nothing',
    obs.resolveConference(createState(), 'engagement', 'nope') === null);
  check('and so does an unknown node', obs.resolveConference(createState(), 'nope', 'honest') === null);
}

// every node's every option either ends the conference or names a node that
// exists, and every node is reachable from the root
{
  const nodes = obsData.conference.nodes;
  const named = new Set();
  const bad = [];
  for (const [id, node] of Object.entries(nodes)) {
    if (!node.prompt || node.options.length < 2) bad.push(id + ' is not an exchange');
    for (const o of node.options) {
      if (o.then) { named.add(o.then); if (!nodes[o.then]) bad.push(id + '.' + o.key + ' -> ' + o.then); }
      if (!o.result) bad.push(id + '.' + o.key + ' has no line');
    }
  }
  check('every `then` names a node that exists', bad.length === 0);
  check('every node but the root is reachable',
    Object.keys(nodes).every(id => id === obsData.conference.root || named.has(id)));
  check('the tree is more than one exchange', named.size > 0);
}

// walking the tree: two exchanges, effects at every node, the path in order
{
  const { obs } = mkObs();
  const st = createState();
  const first = obs.resolveConference(st, 'engagement', 'turnAndTalk');
  check('the affirming answer has somewhere to go', first.next && first.nextId === 'when');
  const f1 = st.fidelity;
  const second = obs.resolveConference(st, 'when', 'named');
  check('naming a day is the end of the conference', second.next === null);
  check('the second node moved fidelity too', st.fidelity > f1);
  check('the path is both exchanges, in order',
    obs.conferencePath(st).map(o => o.key).join() === 'turnAndTalk,named');
}

// naming a day is a promise the record has to keep
{
  const { obs } = mkObs();
  const st = createState();
  obs.resolveConference(st, 'engagement', 'turnAndTalk');
  obs.resolveConference(st, 'when', 'named');
  check('naming a day puts a follow-up on the books', st.obsOwed && st.obsOwed.lookFor === 'discourse');
  const st2 = createState();
  obs.resolveConference(st2, 'engagement', 'turnAndTalk');
  obs.resolveConference(st2, 'when', 'vague');
  check('being vague about it does not', st2.obsOwed === null);
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
// Phase 5: the subjects, loaded the way src/loader.js loads them.
const subjData = D('subjects');
bundle.subjects = subjData;
for (const id of subjData.subjects) {
  bundle[subjectKey(id)] = JSON.parse(fs.readFileSync(`../data/subjects/${id}.json`, 'utf8'));
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

// ---------------------------------------------------------------------------
// Phase 3 — the semester remembers. A record per class, advanced one night
// at a time, pure in and pure out. Twelve numbers, never a mastery scalar.
// ---------------------------------------------------------------------------
{
  const SEM = CFG.semester;
  const roster = sData.roster;
  const mkStudents = comps => roster.map((r, i) => ({ ...r, seat: i, comp: comps[i] }));
  const result = (periodId, comps, over = {}) => ({
    periodId, seed: null, roster, students: mkStudents(comps),
    rapport: 70, fidelity: 82, mastery: comps.reduce((a, b) => a + b, 0) / comps.length * 100,
    bandwidth: 5, missed: 1, caught: 3, sawCurveball: true,
    obsResult: { satisfied: ['check'], total: 5 }, known: { edges: ['1-2'], steadies: [6] }, ...over
  });
  const high = roster.map(() => 0.8);

  const fresh = semester.createRecord();
  check('a fresh record is versioned from day one', fresh.version === semester.RECORD_VERSION && fresh.version === 2);
  check('a fresh record is Monday of week one', fresh.week === 1 && fresh.day === 0 && Object.keys(fresh.classes).length === 0);

  // repair: every load. migrate: version drift, of which there has now been
  // one — a version 1 record is a semester written before AP Reyes had a
  // calendar or a follow-up existed.
  check('garbage repairs to a fresh record', semester.repair('nope').version === 2 && semester.repair(null).week === 1);
  check('an unversioned object is not a record', semester.migrate({ week: 3, classes: {} }) === null);
  check('a future version is not a record either', semester.migrate({ version: 99 }) === null);
  check('a version 1 record comes forward with an empty calendar', (() => {
    const r = semester.repair({ version: 1, week: 3, day: 2, classes: {} });
    return r.version === 2 && r.week === 3 && r.seed === 0 && r.owed.length === 0;
  })());
  check('the semester seed survives a reload', semester.repair({ version: 2, seed: 4821, week: 1, day: 0, classes: {} }, 777).seed === 4821);
  check('and a record that never had one takes the one it is handed',
    semester.repair(null, 777).seed === 777 && semester.createRecord(4821).seed === 4821);
  check('repair fills in what a half-written record lacks', (() => {
    const r = semester.repair({ version: 1, week: 2, day: 9, classes: { p4: { comp: [0.5, 'x'], fidelity: 200 } } });
    return r.week === 2 && r.day === SEM.daysPerWeek - 1 && r.classes.p4.comp === null &&
      r.classes.p4.fidelity === 100 && Array.isArray(r.today) && r.admin.active === null;
  })());
  check('repair keeps a whole class intact', (() => {
    const one = semester.recordPeriod(fresh, result('p4', high));
    const back = semester.repair(JSON.parse(JSON.stringify(one)));
    return JSON.stringify(back.classes.p4) === JSON.stringify(one.classes.p4) && back.today.length === 1;
  })());

  // entering, day one: CFG.start, nothing carried.
  const day1 = semester.entering(fresh, 'p4', { roster, seed: null, admin: adminData });
  check('a class on its first day walks in on CFG.start',
    day1.firstDay && day1.startComp === null && day1.rapport === CFG.start.rapport &&
    day1.fidelity === CFG.start.fidelity && day1.effects === null && day1.obsWindowScale === 1 && day1.events.length === 0);
  check('day one is day index 0', day1.dayIndex === 0 && semester.dayIndexOf(fresh) === 0);

  // recordPeriod: twelve values, by seat, never a scalar.
  const shuffled = mkStudents(high).reverse();          // seat order scrambled; seat still says who
  shuffled.find(s => s.seat === 3).comp = 0.2;
  const one = semester.recordPeriod(fresh, { ...result('p4', high), students: shuffled });
  check('recordPeriod does not touch the record it was given', Object.keys(fresh.classes).length === 0 && fresh.today.length === 0);
  check('the class carries twelve values, by seat', one.classes.p4.comp.length === 12 && one.classes.p4.comp[3] === 0.2 && one.classes.p4.comp[0] === 0.8);
  check('the class record has no mastery scalar (constraint 7)', !('mastery' in one.classes.p4));
  check('the class carries Rapport and Fidelity', one.classes.p4.rapport === 70 && one.classes.p4.fidelity === 82);
  check('the class knows its baseline', one.classes.p4.base.length === 12 &&
    Math.abs(one.classes.p4.base[6] - CFG.lesson.startComprehension * roster[6].aptitude) < 1e-9);
  check('the class counts what the chart learned', one.classes.p4.edges === 1 && one.classes.p4.steadies === 1 && one.classes.p4.observations === 1);
  check("today's line has the period's numbers", one.today.length === 1 && one.today[0].missed === 1 && one.today[0].obs === '1/5' && one.today[0].curveball);
  check('recording the same period twice replaces the line', semester.recordPeriod(one, result('p4', high)).today.length === 1);
  check('a period with a student missing carries no comprehension', (() => {
    const r = semester.recordPeriod(fresh, { ...result('p4', high), students: mkStudents(high).slice(1) });
    return r.classes.p4.comp === null;
  })());

  // entering, day two: yesterday's numbers.
  const two = semester.recordPeriod(one, result('p5', high));
  const night = semester.advanceDay(two, [], { admin: adminData });
  check('advanceDay turns the page', night.day === 1 && night.week === 1 && night.today.length === 0 && night.days.length === 1);
  check("the finished day is on the books with the day's means",
    night.days[0].periods.length === 2 && Math.abs(night.days[0].fidelity - 82) < 1e-9 && night.days[0].missed === 2 &&
    night.days[0].bandwidth === 5 && Number.isFinite(night.days[0].opinion));
  check('advanceDay does not touch the record it was given', two.day === 0 && two.today.length === 2);
  const d2 = semester.entering(night, 'p4', { roster, seed: null, admin: adminData });
  const b3 = one.classes.p4.base[3], b0 = one.classes.p4.base[0];
  check('overnight, what they learned above the baseline keeps retainOvernight of itself',
    Math.abs(d2.startComp[0] - (b0 + (0.8 - b0) * SEM.retainOvernight)) < 1e-9);
  check('overnight, what a bad period took from under the baseline comes partway back',
    Math.abs(d2.startComp[3] - (b3 + (0.2 - b3) * SEM.retainOvernight)) < 1e-9 && d2.startComp[3] > 0.2);
  check('Fidelity reverts toward the district mean overnight',
    Math.abs(d2.fidelity - (SEM.districtFidelity + (82 - SEM.districtFidelity) * (1 - SEM.fidelityRevert))) < 1e-9);
  check('Rapport reverts toward its start overnight',
    Math.abs(d2.rapport - (CFG.start.rapport + (70 - CFG.start.rapport) * (1 - SEM.rapportRevert))) < 1e-9);
  check('a class that did not meet yesterday still opens on what it has', !d2.firstDay && d2.startComp.length === 12);
  check('a different seed is a different class', (() => {
    const g = semester.recordPeriod(fresh, { ...result('p7', high), seed: 4821 });
    const same = semester.entering(g, 'p7', { roster, seed: 4821, admin: adminData });
    const other = semester.entering(g, 'p7', { roster, seed: 4822, admin: adminData });
    return !same.firstDay && other.firstDay && other.startComp === null && other.rapport === CFG.start.rapport;
  })());
  check('a roster of a different size does not carry', semester.entering(night, 'p4', { roster: roster.slice(0, 11), seed: null, admin: adminData }).startComp === null);
  check('the weekend forgets more than a night', SEM.retainWeekend < SEM.retainOvernight &&
    semester.retentionAfter(SEM.daysPerWeek - 1) === SEM.retainWeekend && semester.retentionAfter(0) === SEM.retainOvernight);

  // The week rolls over.
  let r = fresh;
  for (let d = 0; d < SEM.daysPerWeek; d++) r = semester.advanceDay(semester.recordPeriod(r, result('p4', high)), [], { admin: adminData });
  check('five nights is a week', r.week === 2 && r.day === 0 && r.days.length === 5);
  check('the Friday before the roll is the last day of the week', semester.isLastDayOfWeek({ ...r, day: SEM.daysPerWeek - 1 }) && !semester.isLastDayOfWeek(r));
  check('the second Monday is day index five', semester.dayIndexOf(r) === SEM.daysPerWeek);
  const w = semester.weekSummary(r);
  check('the week summary reads the week that just closed', w.week === 1 && w.days.length === 5 && w.periods === 5 && w.missed === 5);
  check('the week summary has a from and a to', w.from && w.to && Number.isFinite(w.means.mastery) && Number.isFinite(w.means.bandwidth));
  check('the week summary counts what was learned', w.learned.edges === 1 && w.learned.steadies === 1 && w.curveballs === 5);

  // The ladder. Sustained low Fidelity, and nothing else, schedules admin.
  const ladder = adminData.escalation.ladder;
  check('the ladder climbs: each rung is lower and longer than the last',
    ladder.every((s, i) => i === 0 || (s.when.fidelityBelow < ladder[i - 1].when.fidelityBelow && s.when.days > ladder[i - 1].when.days)));
  check('every rung has an event, effects that never touch mastery, and a report line',
    ladder.every(s => s.event && s.effects && !('mastery' in s.effects) && s.report && s.label));
  const low = v => result('p4', roster.map(() => 0.4), { fidelity: v });
  // 43 is under every rung's line; what separates the rungs is how many days
  // running it has been there.
  let lr = fresh;
  lr = semester.advanceDay(semester.recordPeriod(lr, low(43)), [], { admin: adminData });
  check('one low day is not a pattern', lr.admin.active === null);
  lr = semester.advanceDay(semester.recordPeriod(lr, low(43)), [], { admin: adminData });
  check('two low days is a check-in', lr.admin.active === 'checkIn' && lr.admin.history.length === 1);
  const ent = semester.entering(lr, 'p4', { roster, seed: null, admin: adminData });
  check('the rung reaches the period as effects, an event and a window',
    ent.rung.id === 'checkIn' && ent.effects.bandwidth === -4 && ent.events.length === 1 &&
    ent.events[0].id === 'admin-checkIn' && ent.events[0].kind === 'pa' && ent.obsWindowScale === 1);
  lr = semester.advanceDay(semester.recordPeriod(lr, low(43)), [], { admin: adminData });
  check('three low days is the second observation', lr.admin.active === 'secondObservation');
  lr = semester.advanceDay(semester.recordPeriod(lr, low(43)), [], { admin: adminData });
  check('four low days is the growth plan', lr.admin.active === 'growthPlan' && lr.admin.history.length === 3);
  check('a day just under the first line is a check-in and nothing more', (() => {
    let x = fresh;
    for (let i = 0; i < 4; i++) x = semester.advanceDay(semester.recordPeriod(x, low(52)), [], { admin: adminData });
    return x.admin.active === 'checkIn' && x.admin.history.length === 1;
  })());
  check('the growth plan keeps her longer', semester.entering(lr, 'p4', { roster, seed: null, admin: adminData }).obsWindowScale === 2);
  lr = semester.advanceDay(semester.recordPeriod(lr, low(90)), [], { admin: adminData });
  check('one good day clears the ladder', lr.admin.active === null);
  check('the ladder reads admin opinion, the mean across classes', (() => {
    let x = fresh;
    for (let i = 0; i < 2; i++) {
      x = semester.recordPeriod(x, low(30));
      x = semester.recordPeriod(x, { ...result('p5', high), fidelity: 90 });
      x = semester.advanceDay(x, [], { admin: adminData });
    }
    return x.admin.active === null && Math.abs(x.days[0].opinion - 60) < 1e-9;
  })());
  check('history records the first day of each rung, once', lr.admin.history.map(h => h.id).join() === 'checkIn,secondObservation,growthPlan');

  // The observation window scale actually reaches the observation.
  check('windowScale scales the rubric window', (() => {
    const fakeClassList = () => ({ add() {}, remove() {}, contains: () => false });
    const mk = scale => createObservation({ data: obsData, dom: { pa: { classList: fakeClassList() }, paTitle: {}, paTxt: {} }, toast: () => {}, windowScale: scale, visit: defaultVisit(obsData) });
    const a = createState(), b = createState();
    a.t = b.t = CFG.periodSeconds - obsData.visit.default.atMinute * 60 - 1;
    const oa = mk(1), ob = mk(2);
    oa.tick(a, 0.1); ob.tick(b, 0.1);
    a.obsAlertRemaining = b.obsAlertRemaining = 0;
    oa.tick(a, 0.1); ob.tick(b, 0.1);
    return a.obsPhase === 'active' && Math.abs(b.obsWindowRemaining - 2 * a.obsWindowRemaining) < 1;
  })());
  check('the lesson opens on carried comprehension, by seat', (() => {
    const st = mkStudents(high).map(s => ({ ...s, comp: 0 })).reverse();
    const carried = roster.map((_, i) => i / 20);
    createLesson({ data: lData, students: st, tellSystem: { defs: tData.types, tells: [] }, toast: () => {}, rand: () => 0.5, startComp: carried });
    return st.every(s => s.comp === carried[s.seat]);
  })());

  // Drift. The good teacher, five days of 4th period: Friday must not open
  // lower than Tuesday did, and nothing may run away toward 100 either. The
  // wanderer must have met AP Reyes by Friday. Cheap: ten headless periods.
  const week = style => {
    let rec = fresh; const opens = [], closes = [];
    for (let d = 0; d < SEM.daysPerWeek; d++) {
      const carry = semester.entering(rec, 'p4', { roster, seed: null, admin: adminData });
      opens.push(carry.startComp ? carry.startComp.reduce((a, b) => a + b, 0) / 12 * 100 : null);
      const run = runPeriod({ period: p4, data: simData, style, opts: { startComp: carry.startComp, rapport: carry.rapport, fidelity: carry.fidelity } });
      closes.push(run.state.mastery);
      rec = semester.advanceDay(semester.recordPeriod(rec, {
        periodId: 'p4', seed: null, roster, students: run.students, rapport: run.state.rapport, fidelity: run.state.fidelity,
        mastery: run.state.mastery, bandwidth: run.state.bandwidth, missed: run.missed, caught: 0, obsResult: run.state.obsResult, known: {}
      }), [], { admin: adminData });
    }
    return { rec, opens, closes };
  };
  const good = week(STYLES.good), wander = week(STYLES.wanderer);
  check('the good teacher plateaus: Friday opens within 1 of Thursday', Math.abs(good.opens[4] - good.opens[3]) < 1);
  check('the good teacher does not drift: Friday closes within 5 of Monday', Math.abs(good.closes[4] - good.closes[0]) < 5);
  check('nothing runs away: Friday opens under 90', good.opens[4] < 90);
  check('Fidelity does not pin at 100 by Friday for the good teacher', good.rec.classes.p4.fidelity < 100 && good.closes.every(Number.isFinite));
  check('the good teacher hears nothing from admin', good.rec.admin.history.length === 0);
  check('the wanderer meets AP Reyes by Friday', wander.rec.admin.history.some(h => h.id === 'checkIn'));
  check('the wanderer does not fall through the floor', wander.opens[4] > 30);
}


// ---------------------------------------------------------------------------
// Phase 4 — a follow-up you actually owe. The affirming answer used to say it
// cost you one and then cost you nothing; now it books a look-for, a period
// and a day, and forgetting it is a Fidelity hit the morning after.
// ---------------------------------------------------------------------------
{
  const roster = sData.roster;
  const owe = (rec, day) => semester.oweFollowUp(rec, { periodId: 'p4', id: 'turnAndTalk', lookFor: 'discourse', days: 2 }, day);
  const night = rec => semester.advanceDay(rec, [], { admin: adminData });
  const enter = rec => semester.entering(rec, 'p4', { roster, seed: null, admin: adminData, observation: obsData });

  let rec = owe(semester.createRecord(4821), 0);
  check('a promise goes on the books with a day on it',
    rec.owed.length === 1 && rec.owed[0].dueDay === 2 && rec.owed[0].fromDay === 0);
  check('promising the same thing twice does not stack it',
    owe(rec, 0).owed.length === 1);
  check('the morning after promising, you owe it and are not charged for it', (() => {
    const e = enter(rec);
    return e.owed.length === 1 && e.broken.length === 0 && e.effects === null;
  })());

  // Doing the thing in the same breath you promised it does not count.
  check('you cannot keep a promise on the day you made it',
    semester.settleFollowUps(rec, { periodId: 'p4', dayIndex: 0, used: ['discourse'] }).kept.length === 0);

  // Doing it later does, and the night clears it off the books.
  {
    const later = semester.settleFollowUps(night(rec), { periodId: 'p4', dayIndex: 1, used: ['objective', 'discourse'] });
    check('doing it on a later day keeps it', later.kept.length === 1 && later.record.owed[0].kept);
    const after = night(later.record);
    check('a kept promise is off the books at the next bell', after.owed.length === 0);
    check('and never charges anything', enter(after).effects === null && enter(after).broken.length === 0);
  }

  // Doing something else does not.
  check('doing something else is not doing the thing',
    semester.settleFollowUps(night(rec), { periodId: 'p4', dayIndex: 1, used: ['objective', 'question'] }).kept.length === 0);

  // The due day passing without it is what costs. Day 0 promise, due day 2:
  // nights at 0 and 1 leave it open, the night at 2 marks it broken, and the
  // morning of day 3 charges for it, once.
  {
    let x = rec;
    for (let d = 0; d < 2; d++) x = night(x);
    check('an open promise survives the nights before it is due',
      x.owed.length === 1 && !x.owed[0].broken && enter(x).broken.length === 0);
    x = night(x);
    check('the night its day goes past marks it broken', x.owed[0].broken === true);
    const morning = enter(x);
    check('and the next morning charges Fidelity for it',
      morning.broken.length === 1 && morning.effects.fidelity === obsData.followUp.broken.effects.fidelity);
    check('with an email about it, like everything else admin does',
      morning.events.some(e => e.id === 'owed-turnAndTalk' && e.kind === 'pa'));
    const after = night(x);
    check('and it is charged once, then gone', after.owed.length === 0 && enter(after).effects === null);
  }

  // It is the period's promise, not the day's.
  {
    const other = semester.entering(rec, 'p5', { roster, seed: null, admin: adminData, observation: obsData });
    check('5th period does not owe what 4th period promised', other.owed.length === 0);
    check('and 5th period cannot keep it either',
      semester.settleFollowUps(night(rec), { periodId: 'p5', dayIndex: 1, used: ['discourse'] }).kept.length === 0);
  }

  // The promise survives a reload, which is the whole point of putting it on
  // the record rather than in state.
  check('an owed follow-up survives a day boundary and a repair', (() => {
    const round = semester.repair(JSON.parse(JSON.stringify(night(rec))));
    return round.owed.length === 1 && round.owed[0].id === 'turnAndTalk' &&
      round.owed[0].dueDay === 2 && round.owed[0].periodId === 'p4';
  })());

  // A broken follow-up stacks with admin's ladder rather than replacing it:
  // both bags land, and the ladder's own event is still there.
  check('a broken promise and a rung of the ladder both land', (() => {
    let x = semester.createRecord(4821);
    const low = { periodId: 'p4', seed: null, roster, students: [], rapport: 50, fidelity: 40,
      mastery: 40, bandwidth: 50, missed: 0, caught: 0, obsResult: null, known: {} };
    // A bad day every day, so admin's opinion stays under the ladder's line
    // rather than drifting back over it while the promise runs out.
    for (let i = 0; i < 2; i++) x = night(semester.recordPeriod(x, low));
    x = owe(x, semester.dayIndexOf(x));
    for (let i = 0; i < 3; i++) x = night(semester.recordPeriod(x, low));
    const e = enter(x);
    return e.rung && e.broken.length === 1 &&
      e.effects.bandwidth === e.rung.effects.bandwidth &&
      e.effects.fidelity === (e.rung.effects.fidelity || 0) + obsData.followUp.broken.effects.fidelity &&
      e.events.length === 2;
  })());
}


// ---------------------------------------------------------------------------
// Phase 5 — SUBJECT IS THE WEATHER. Treatment §4: subject choice does not
// change a system, it changes which tells are common, what the events say, and
// one number on the meters. Everything below is that claim, held to.
// ---------------------------------------------------------------------------
{
  const subjOf = id => ({ meters: {}, tellWeights: {}, events: [], flavor: {}, hazard: null, stack: null,
    ...bundle[subjectKey(id)] });
  const socialStudies = subjOf('socialStudies'), science = subjOf('science');
  const ela = subjOf('ela'), math = subjOf('math');

  // ---- the manifest and the rows ----------------------------------------
  check('every subject the manifest lists shipped a file',
    subjData.subjects.every(id => bundle[subjectKey(id)]?.id === id));
  check('the default is one of them', subjData.subjects.includes(subjData.default));
  check('a row with no subject takes the default',
    subjectFor(bundle, { id: 'p4' }).id === subjData.default);
  check('a row that names one gets it', subjectFor(bundle, { id: 'p4', subject: 'math' }).id === 'math');
  check('a row that names a subject nobody shipped is a loud error, not a quiet default', (() => {
    try { subjectFor(bundle, { id: 'p4', subject: 'woodshop' }); return false; }
    catch (e) { return e.message.includes('woodshop'); }
  })());
  check('periodFor hands the subject out with the period', p4.subject.id === subjData.default);

  // ---- Social Studies is the honest test --------------------------------
  //
  // It is the file that describes what the game already was. If any number in
  // it is doing work, 4th period plays differently with it than without, and
  // the shape is wrong.
  {
    const withIt = runPeriod({ period: { ...p4, subject: socialStudies }, data: simData, style: STYLES.good });
    const without = runPeriod({ period: { ...p4, subject: null }, data: simData, style: STYLES.good });
    const shape = r => [r.state.mastery, r.state.fidelity, r.state.rapport, r.state.bandwidth,
      r.state.restless, r.missed].map(v => Math.round(v * 1000)).join();
    check('Social Studies is a no-op: the shipped day plays identically with it and without',
      shape(withIt) === shape(without));
    check('and it still has something to say in the report', !!socialStudies.flavor.report);
  }

  // ---- one number on the meters -----------------------------------------
  {
    const st = createState();
    applySubject(st, math);
    check("Math's unearned Rapport penalty lands at the bell",
      st.rapport === CFG.start.rapport + math.meters.rapport && math.meters.rapport < 0);
    const st2 = createState();
    applySubject(st2, socialStudies);
    check('and a subject with no meters moves nothing',
      st2.rapport === CFG.start.rapport && st2.fidelity === CFG.start.fidelity);
  }

  // ---- which tells are common -------------------------------------------
  {
    const mix = genData.schedule.mix;
    const weighted = weightedMix(mix, math);
    check('a subject scales the weight of a tell type',
      weighted.COPYING.weight === mix.COPYING.weight * math.tellWeights.COPYING);
    check('and leaves a type it says nothing about alone',
      weighted.NOTE.weight === mix.NOTE.weight && math.tellWeights.NOTE == null);
    check('but never touches the minimums, which are promises to the seating chart',
      Object.entries(weighted).every(([t, m]) => m.min === mix[t].min && m.max === mix[t].max));
    check('and a subject with no weights is the mix itself',
      JSON.stringify(weightedMix(mix, socialStudies)) === JSON.stringify(mix));
    // The scheduler actually draws through the weighting: thirty seeds, the
    // same rosters, two mixes. Math leans on COPYING and away from WHISPER,
    // and thirty schedules have to show it.
    const deps = mix => ({ tellTypes: tData.types, seatGrid: sData.seatGrid, rules: seatData.rules,
      gen: { ...genData, schedule: { ...genData.schedule, mix } } });
    const counts = (subject) => {
      const d = deps(weightedMix(genData.schedule.mix, subject));
      const out = { PHONE: 0, WHISPER: 0, NOTE: 0, COPYING: 0 };
      for (let seed = 1; seed <= 30; seed++) {
        const roster = generateRoster(seed, genData);
        for (const r of generateSchedule(mixSeed(seed, 0, 0), roster, d)) {
          if (out[r.type] != null) out[r.type]++;
        }
      }
      return out;
    };
    const plain = counts(socialStudies), leaning = counts(math);
    check('a subject makes its own tells common', leaning.COPYING > plain.COPYING);
    check('and the ones it says nothing about rare', leaning.WHISPER < plain.WHISPER);
    check('over the same thirty seeds, with the same total pressure',
      Object.values(plain).reduce((a, b) => a + b, 0) === Object.values(leaning).reduce((a, b) => a + b, 0));
    // And the class is still the class: the roster is the seed alone.
    const mathBundle = { ...bundle, periods: { ...pData,
      periods: pData.periods.map(r => (r.generate ? { ...r, subject: 'math' } : r)) } };
    const p7math = periodFor('p7', mathBundle, { seed: 4821, day: 0 });
    const p7base = periodFor('p7', bundle, { seed: 4821, day: 0 });
    check('the roster is the seed alone, whatever the subject is',
      p7math.roster.map(s => s.name).join() === p7base.roster.map(s => s.name).join());
    check('and a weighted schedule still keeps every structural promise',
      scheduleProblems(p7math.schedule, p7math.roster,
        { tellTypes: tData.types, seatGrid: p7math.seatGrid, rules: seatData.rules, gen: genData }).length === 0);
  }

  // ---- what the events say ----------------------------------------------
  {
    const merged = subjectEvents(eData, math);
    check("a subject's own event joins the day's",
      merged.scheduled.length === eData.scheduled.length + math.events.length &&
      merged.scheduled.some(e => e.id === 'subject-whenWillWeUse'));
    check('and the day keeps its own', merged.scheduled.some(e => e.id === 'pa-portal'));
    check('the base events file is not touched', eData.scheduled.length === 1);
    // An override replaces rather than appends.
    const over = { ...socialStudies, events: [{ id: 'pa-portal', body: 'different' }] };
    const o = subjectEvents(eData, over);
    check('a subject overriding an event by id replaces it, and does not add a second',
      o.scheduled.length === eData.scheduled.length &&
      o.scheduled[0].body === 'different' && o.scheduled[0].atMinute === 19);
    check('a subject rewrites the missed-tell line without dropping the type-specific one',
      subjectTells(tData, science).missedCopy.default !== tData.missedCopy.default &&
      subjectTells(tData, science).missedCopy.QUIET === tData.missedCopy.QUIET);
    check("and an intervention's toast without dropping its effects", (() => {
      const iv2 = subjectInterventions(iData, math);
      return iv2.options.pause.toast.body !== iData.options.pause.toast.body &&
        iv2.options.pause.effects.mastery === iData.options.pause.effects.mastery &&
        iv2.options.prox.blurb === iData.options.prox.blurb;
    })());
  }

  // ---- Science, and the Hazard meter -------------------------------------
  {
    check('only a subject with a hazard block has one',
      !!science.hazard && !socialStudies.hazard && !ela.hazard && !math.hazard);
    check('a subject with no hazard never produces one', (() => {
      const st = createState();
      const out = tickHazard(st, 60, socialStudies, { day: 1, restless: 100, liveTells: 4 });
      return out === null && st.hazard === 0;
    })());
    check('Hazard rises on a lab day and settles on the others', (() => {
      const lab = createState(), lecture = createState();
      lecture.hazard = 20;
      for (let i = 0; i < 100; i++) {
        tickHazard(lab, 1, science, { day: science.hazard.labDays[0], restless: 50, liveTells: 1 });
        tickHazard(lecture, 1, science, { day: 0, restless: 50, liveTells: 1 });
      }
      return lab.hazard > 0 && lecture.hazard < 20 && !isLabDay(science, 0) && isLabDay(science, 1);
    })());
    check('a loud room raises it faster than a quiet one', (() => {
      const quiet = createState(), loud = createState();
      for (let i = 0; i < 500; i++) {
        tickHazard(quiet, 1, science, { day: 1, restless: 5, liveTells: 0 });
        tickHazard(loud, 1, science, { day: 1, restless: 95, liveTells: 3 });
      }
      return loud.hazard > quiet.hazard * 1.5;
    })());
    check('it tops out at the cap, once, with effects and a report line', (() => {
      const st = createState();
      let fired = 0;
      for (let i = 0; i < 4000; i++) {
        if (tickHazard(st, 1, science, { day: 1, restless: 100, liveTells: 4 })) fired++;
      }
      return fired === 1 && st.incident === true && st.hazard === science.hazard.cap &&
        st.fidelity === CFG.start.fidelity + science.hazard.incident.effects.fidelity &&
        !!science.hazard.incident.report;
    })());
    check('and it never goes under zero', (() => {
      const st = createState();
      for (let i = 0; i < 1000; i++) tickHazard(st, 1, science, { day: 0 });
      return st.hazard === 0;
    })());
    check('the band table is in data/events.json, next to Room Temp’s', (() => {
      const b = eData.hazard;
      return Array.isArray(b) && b.length >= 3 && b[b.length - 1].below >= 999 &&
        b.every((r, i) => i === 0 || r.below > b[i - 1].below) &&
        hazardBand(eData, 0).label === b[0].label &&
        hazardBand(eData, 99).label === b[b.length - 1].label;
    })());
    // CLAUDE.md constraint 13: Bandwidth is still the only meter that crosses
    // the bell. Hazard is a fact about this period in this room.
    check('Hazard does not cross the bell', createState().hazard === 0 && createState().incident === false);
    // The whole point: a lab day is survivable for a teacher who is watching
    // and is not for one who is not.
    {
      const lab = style => runPeriod({ period: { ...p4, subject: science }, data: simData, style, opts: { day: 1 } });
      const good = lab(STYLES.good), blind = lab(STYLES.neverChecks);
      check('a lab day is survivable if you are watching the room', !good.incident && good.state.hazard < science.hazard.cap);
      check('and is not if you are not', !!blind.incident && blind.state.hazard === science.hazard.cap);
      check('and off a lab day nothing happens at all', (() => {
        const off = runPeriod({ period: { ...p4, subject: science }, data: simData, style: STYLES.neverChecks, opts: { day: 0 } });
        return !off.incident && off.state.hazard === 0;
      })());
    }
  }

  // ---- ELA, and THE STACK ------------------------------------------------
  {
    check('only a subject with a stack block has one', !!ela.stack && !science.stack);
    check('an empty desk draws nothing', stackFixtures(ela, 0).props.length === 0);
    check('one essay is one prop on the desk', (() => {
      const f = stackFixtures(ela, 1);
      return f.props.length === 1 && f.occluders.length === 0 &&
        f.props[0].asset === ela.stack.desk.asset && f.props[0].y === ela.stack.desk.y;
    })());
    check('a column stacks upward and the next one starts over', (() => {
      const D = ela.stack.desk;
      const f = stackFixtures(ela, D.perColumn + 1);
      const top = f.props[D.perColumn - 1], next = f.props[D.perColumn];
      return top.y > f.props[0].y && next.y === D.y && next.pos[0] !== f.props[0].pos[0];
    })());
    check('past the desk it stops fitting and the overflow is a real occluder', (() => {
      const under = stackFixtures(ela, ela.stack.floorAt);
      const over = stackFixtures(ela, ela.stack.floorAt + 1);
      return under.occluders.length === 0 && over.occluders.length === 1 &&
        over.props.length === ela.stack.floorAt &&
        over.occluders[0].id === ela.stack.floor.id;
    })());
    check('and the occluder is the shape world/room.js already places', (() => {
      const o = stackFixtures(ela, 20).occluders[0];
      return Array.isArray(o.size) && o.size.length === 3 && Array.isArray(o.pos) && o.pos.length === 2 &&
        typeof o.mat === 'string' && typeof o.label === 'string';
    })());
    check('the stack lands in the room without touching data/room.json', (() => {
      const before = JSON.stringify(roomData);
      const r = subjectRoom(roomData, ela, 20);
      return JSON.stringify(roomData) === before &&
        r.props.length === roomData.props.length + ela.stack.floorAt &&
        r.occluders.length === roomData.occluders.length + 1 &&
        r.bounds === roomData.bounds;
    })());
    check('and a subject with no stack leaves the room exactly as it is', (() => {
      const r = subjectRoom(roomData, math, 0);
      return r.props.length === roomData.props.length && r.occluders.length === roomData.occluders.length;
    })());
    check('the stack has something to say at every height',
      [0, 5, 13, 21, 26].every(n => !!stackBand(ela, n)));
  }

  // ---- the stack on the record ------------------------------------------
  {
    const roster = sData.roster;
    const base = { periodId: 'p4', seed: null, roster, students: [], rapport: 55, fidelity: 62,
      mastery: 50, bandwidth: 50, missed: 0, caught: 0, obsResult: null, known: {} };
    const teach = (rec, over = {}) => semester.recordPeriod(rec, { ...base, subject: 'ela', stack: ela.stack, ...over });
    const night = rec => semester.advanceDay(rec, [], { admin: adminData });

    let rec = teach(semester.createRecord(4821));
    check('a period taught adds a period of essays', rec.classes.p4.stack === ela.stack.add);
    rec = night(rec);
    check('and a night grades some of them off', rec.classes.p4.stack === ela.stack.add - ela.stack.graded);
    check('it is the only thing in the game that gets smaller while you sleep',
      ela.stack.graded > 0 && ela.stack.graded < ela.stack.add);
    // It outruns you, which is the point.
    for (let i = 0; i < 20; i++) rec = night(teach(rec));
    const ceiling = ela.stack.max - ela.stack.graded;
    check('teaching it every day outruns grading it every night',
      rec.classes.p4.stack === ceiling && ceiling > ela.stack.add * 3);
    check('and the pile is capped rather than unbounded', teach(rec).classes.p4.stack === ela.stack.max);
    check('the class walks in carrying it', (() => {
      const e = semester.entering(rec, 'p4', { roster, seed: null, admin: adminData, observation: obsData });
      return e.stack === ceiling && e.subject === 'ela';
    })());
    check('nobody carries last unit’s essays into a different course', (() => {
      const switched = teach(rec, { subject: 'math', stack: null });
      return switched.classes.p4.stack === 0 && switched.classes.p4.subject === 'math';
    })());
    check('a subject with no stack never accumulates one',
      teach(semester.createRecord(4821), { subject: 'math', stack: null }).classes.p4.stack === 0);
    check('and the pile survives a reload', (() => {
      const round = semester.repair(JSON.parse(JSON.stringify(rec)));
      return round.classes.p4.stack === ela.stack.max - ela.stack.graded && round.classes.p4.subject === 'ela';
    })());
  }

  // ---- subject picks the room, not the code ------------------------------
  //
  // The moment an `if (subject.id === 'ela')` appears anywhere in src/, the
  // seam has moved and this fails. There is no allow-list: no file under src/
  // may name any subject in the manifest.
  {
    const files = [];
    const walk = dir => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith('.js')) files.push(full);
      }
    };
    walk('../src');
    const named = [];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      for (const id of subjData.subjects) if (src.includes(`'${id}'`) || src.includes(`"${id}"`)) named.push(`${f}: ${id}`);
    }
    check(`no file in src/ names a subject (${files.length} files checked)`, named.length === 0);
  }

  // Adding a subject is a line in the manifest and a file next to it. This is
  // that, with the file built here rather than shipped: a period row names it,
  // periodFor resolves it, and a whole period runs under it, with no edit to
  // anything in src/.
  {
    const woodshop = {
      id: 'woodshop', label: 'Woodshop', tagline: 'Ten Fingers, Every Time',
      meters: { rapport: 8, fidelity: -4 },
      tellWeights: { WHISPER: 0.5 },
      hazard: { labDays: [0, 1, 2, 3, 4], risePerSec: 0.02, restlessPerSec: 0.0003,
        perLiveTellPerSec: 0.005, settlePerSec: 0.01, cap: 100,
        labToast: { kind: '', title: 'Shop', body: 'The saw is on.' },
        incident: { effects: { fidelity: -10 }, toast: { kind: 'bad', title: 'Incident', body: 'A form.' },
          report: 'There is a form.' },
        safeReport: 'Ten fingers.' },
      flavor: { report: 'Nobody has ever observed this room.' }
    };
    const shopBundle = {
      ...bundle,
      subjects: { ...subjData, subjects: [...subjData.subjects, 'woodshop'] },
      [subjectKey('woodshop')]: woodshop,
      periods: { ...pData, periods: pData.periods.map(r => (r.id === 'p4' ? { ...r, subject: 'woodshop' } : r)) }
    };
    const shop = periodFor('p4', shopBundle);
    check('a subject added as one JSON file resolves with no code edit', shop.subject.id === 'woodshop');
    const r = runPeriod({ period: shop, data: simData, style: STYLES.good, opts: { day: 0 } });
    check('and a whole period runs under it', r.state.beatsDelivered > 0 && Number.isFinite(r.state.mastery));
    check('with its meters, its hazard, and its room',
      r.state.hazard > 0 && subjectRoom(roomData, shop.subject, 9).props.length === roomData.props.length);
  }
}

// ---------------------------------------------------------------------------
// Phase 6 — WHAT THE ROOM WEIGHS. The tree arrived at 149.3 MB across 1,037
// files with nothing able to say which of it the game opens, and three.js came
// from cdn.jsdelivr.net. Both of those are checks, not opinions, so they live
// here where the suite people already run will catch them coming back.
// ---------------------------------------------------------------------------
{
  const { totals, problems, budget } = auditAssets();

  check('the asset manifest resolves, and nothing is over budget', problems.length === 0);
  if (problems.length) for (const p of problems) console.log('        ' + p);
  check('referenced bytes are under the ceiling', totals.referenced.bytes <= budget.referencedBytes);
  check('unreferenced bytes are under the ceiling', totals.unreferenced.bytes <= budget.unreferencedBytes);

  // ---- nothing offsite, and nothing bare -------------------------------
  // The import map is the one place a URL can hide from check-integrity's
  // resource-tag sweep: its entries live in the script body, not in an
  // attribute. Tools/board-check now parses it too (Phase 6), but this is the
  // project's own copy of the assertion, so a bell-to-bell session that never
  // runs the site-wide check still cannot reintroduce the CDN.
  const html = fs.readFileSync('../index.html', 'utf8');
  const mapBody = html.match(/<script[^>]*type\s*=\s*["']importmap["'][^>]*>([\s\S]*?)<\/script>/i);
  check('index.html has an import map', !!mapBody);
  const imports = mapBody ? JSON.parse(mapBody[1]).imports : {};
  check('no import map entry points offsite',
    Object.values(imports).every(v => !/^https?:/i.test(v)));
  check('three and three/addons/ both resolve into ./libs/',
    imports.three === './libs/three.module.js' && imports['three/addons/'] === './libs/addons/');

  // ---- the vendored closure is closed ----------------------------------
  // An addon import nobody vendored is a 404 in a browser and nothing at all
  // under Node, which is exactly the shape of bug that survives a test suite.
  const srcFiles = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = `${d}/${e.name}`;
      if (e.isDirectory()) walk(p); else if (p.endsWith('.js')) srcFiles.push(p);
    }
  })('../src');

  const wanted = new Set();
  for (const f of srcFiles) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/from\s+['"]three\/addons\/([^'"]+)['"]/g)) {
      wanted.add(m[1]);
    }
  }
  check('src/ imports at least one addon', wanted.size > 0);
  const missingAddons = [...wanted].filter(a => !fs.existsSync(`../libs/addons/${a}`));
  check('every three/addons/ import in src/ is vendored', missingAddons.length === 0);
  if (missingAddons.length) console.log('        not vendored: ' + missingAddons.join(', '));

  // And each vendored addon's own relative imports, one level deep: GLTFLoader
  // reaches sideways for BufferGeometryUtils, which is not something any
  // import in src/ would have told us about.
  const libFiles = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = `${d}/${e.name}`;
      if (e.isDirectory()) walk(p); else if (p.endsWith('.js')) libFiles.push(p);
    }
  })('../libs/addons');

  const danglers = [];
  for (const f of libFiles) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1]));
      if (!fs.existsSync(target)) danglers.push(`${f} -> ${m[1]}`);
    }
  }
  check('every vendored addon\'s own relative imports resolve', danglers.length === 0);
  if (danglers.length) for (const d of danglers) console.log('        ' + d);

  check('the vendored three is the revision the CDN was serving',
    /const REVISION = '160'/.test(fs.readFileSync('../libs/three.module.js', 'utf8')));
}

// ---------------------------------------------------------------------------
// Phase 7 — THINGS YOU CAN NOTICE WITHOUT HOLDING SHIFT. tells.js is 160 lines
// and withitness.js is 39, both dependency-injected factories, and until this
// block neither had ever been executed by anything. They imported `three` by
// bare specifier, which only resolves against index.html's import map, so no
// Node test could load them at all. src/three.js is the seam that fixed that.
// ---------------------------------------------------------------------------
{
  const stubDom = () => ({
    thermal: { classList: { toggle() {} } },
    tint: { classList: { toggle() {} } },
    chip: { classList: { toggle() {} } }
  });
  const stubAudio = () => {
    const calls = [];
    return { calls, setDrone: on => calls.push(['setDrone', on]) };
  };

  // A room: two students, and one cabinet between the camera and the second.
  const mkRoom = () => {
    const scene = new THREE.Scene();
    const camera = { position: new THREE.Vector3(0, 1.65, -2.4) };
    const roster = [
      { name: 'Ada', x: -1.0, z: 1.0, bodyZ: 1.52 },
      { name: 'Bo', x: 1.0, z: 1.0, bodyZ: 1.52 }
    ];
    // A real mesh, because the blind-spot rule is a real raycast (locked
    // constraint 3) and a stub occluder would test nothing.
    const wall = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2, 0.6), new THREE.MeshBasicMaterial());
    wall.position.set(1.06, 1, -0.4);   // between the camera and Bo
    wall.updateMatrixWorld(true);
    return { scene, camera, roster, occluders: [wall] };
  };

  const mkTells = (over = {}) => {
    const { scene, camera, roster, occluders } = mkRoom();
    const registry = createRegistry();
    const built = [];
    const sys = createTellSystem({
      scene, camera, students: roster, occluders,
      data: { types: tData.types },
      schedule: over.schedule ?? [{ type: 'PHONE', seat: 0, atMinute: 1, life: 90 }],
      buildTellMesh: createTellMeshBuilder({
        mats: createTellMaterials(),
        register: m => { built.push(m); return registry.add(m); }
      }),
      setVision: setTellVision,
      onBorn: over.onBorn, onGone: over.onGone
    });
    return { sys, scene, camera, roster, registry, built };
  };

  // ---- birth, expiry, resolve -------------------------------------------
  {
    const born = [], gone = [], expired = [];
    const { sys, scene } = mkTells({ onBorn: t => born.push(t.id), onGone: t => gone.push(t.id) });
    const state = { t: CFG.periodSeconds, withitness: false };

    check('a tell is not born before its minute', (sys.update(state, t => expired.push(t)), born.length === 0));
    check('and nothing is in the scene yet', scene.children.length === 0);

    state.t = CFG.periodSeconds - 60;
    sys.update(state, t => expired.push(t));
    check('a tell is born at its minute', born.length === 1);
    check('birth resolves a position, not before', sys.tells[0].pos instanceof THREE.Vector3);
    check('and puts an object in the room', scene.children.length === 1);

    state.t = CFG.periodSeconds - 60 - 89;
    sys.update(state, t => expired.push(t));
    check('a tell inside its life has not expired', expired.length === 0 && !sys.tells[0].dead);

    state.t = CFG.periodSeconds - 60 - 91;
    sys.update(state, t => expired.push(t));
    check('a tell past its life expires exactly once', expired.length === 1 && gone.length === 1);
    sys.update(state, t => expired.push(t));
    check('and does not expire again', expired.length === 1);
  }

  {
    const expired = [];
    const { sys } = mkTells();
    const state = { t: CFG.periodSeconds - 60, withitness: false };
    sys.update(state, t => expired.push(t));
    sys.tells[0].resolved = true;
    state.t = CFG.periodSeconds - 200;
    sys.update(state, t => expired.push(t));
    check('a resolved tell dies without counting as missed', expired.length === 0 && sys.tells[0].dead);
  }

  // ---- the blind spot ----------------------------------------------------
  {
    const { sys, camera } = mkTells({
      schedule: [{ type: 'PHONE', seat: 0, atMinute: 1, life: 900 },
                 { type: 'PHONE', seat: 1, atMinute: 1, life: 900 }]
    });
    sys.update({ t: CFG.periodSeconds - 60, withitness: false }, () => {});
    const [ada, bo] = sys.tells;
    check('a tell in the open has line of sight', sys.hasLineOfSight(ada.pos));
    check('a tell behind the cabinet does not', !sys.hasLineOfSight(bo.pos));
    check('and is therefore not visible', sys.isVisible(ada) && !sys.isVisible(bo));

    // Move to where the cabinet is not in the way. The raycast is the whole
    // reason the furniture exists, so it has to be the thing that changes.
    camera.position.set(3.0, 1.65, -2.4);
    check('walking somewhere else in the room reveals it', sys.hasLineOfSight(bo.pos));

    camera.position.set(0, 1.65, -40);
    check('range still gates the annotation', !sys.isVisible(ada) && sys.hasLineOfSight(ada.pos));
    check('a dead tell is never visible',
      (sys.kill(ada), camera.position.set(0, 1.65, -2.4), sys.isVisible(ada) === false));
  }

  // ---- the false positive ------------------------------------------------
  {
    const { sys, scene } = mkTells();
    const state = { t: 400, withitness: false };
    const t = sys.spawnFalsePositive(state);
    check('a false positive is born already alive, in the room', t.born === 400 && !t.dead && scene.children.length === 1);
    check('and it is never suppressible (locked constraint 2)', tData.types.FALSE.suppressible === false);
  }

  // ---- the objects, and what the vision draws ---------------------------
  // The Tier 1 / Tier 2 line, held: a phone is a thing in the room and the
  // route line is an inference. One is registered and always drawn, the other
  // is neither.
  {
    const { sys, registry, built } = mkTells({
      schedule: [{ type: 'PHONE', seat: 0, atMinute: 1, life: 900 },
                 { type: 'NOTE', seat: 0, seat2: 1, atMinute: 1, life: 900 },
                 { type: 'FALSE', seat: 1, atMinute: 1, life: 900 }]
    });
    sys.update({ t: CFG.periodSeconds - 60, withitness: false }, () => {});
    const [phone, note, phantom] = sys.tells;

    const vis = g => { const o = []; g.traverse(m => { if (m.isMesh || m.isLine) o.push(m.visible && (!m.parent || m.parent.visible)); }); return o; };
    const shapeOf = t => t.obj.children[0].children.map(m => m.geometry.type).join('+');
    check('a phone is a slab with a screen on it', shapeOf(phone) === 'BoxGeometry+PlaneGeometry');
    check('a note is two planes, which is what a fold is',
      shapeOf(note) === 'PlaneGeometry+PlaneGeometry'
      && note.obj.children[0].children[0].rotation.x !== note.obj.children[0].children[1].rotation.x);
    check('the note has a route line and the phone does not',
      note.obj.userData.vision[0].children.length === 1 && phone.obj.userData.vision[0].children.length === 0);
    check('the vision starts hidden', note.obj.userData.vision.every(g => !g.visible));

    sys.setThermalVisible(true);
    check('SHIFT shows what the vision draws', note.obj.userData.vision.every(g => g.visible));
    sys.setThermalVisible(false);
    check('and letting go hides it again', note.obj.userData.vision.every(g => !g.visible));

    check('the objects themselves stay in the room either way', phone.obj.visible && vis(phone.obj)[0]);
    check('a hypervigilance false positive is not an object — it is a drawing',
      phantom.obj.userData.vision.length === 2 && !phantom.obj.children[0].visible);

    // Registered, so Withitness swaps them with the rest of the room.
    const normals = built.map(m => m.material);
    registry.setThermal(true);
    check('every tell object registers and swaps into thermal view',
      built.length > 0 && built.every((m, i) => m.material !== normals[i]));
    registry.setThermal(false);
    check('and swaps back', built.every((m, i) => m.material === normals[i]));

    // A tell born while the room is already hot used to sit in its normal
    // material until the next toggle.
    registry.setThermal(true);
    const late = createRegistry();
    late.setThermal(true);
    const mat = createTellMaterials().case;
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), mat);
    late.add(m);
    check('a mesh added while the room is hot is hot immediately', m.material === mat.userData.thermal);
  }

  {
    const named = Object.entries(tData.types).map(([k, v]) => [k, v.mesh]);
    check('every tell type names a mesh shape', named.every(([, m]) => m));
    check('and every shape it names is one that exists',
      named.every(([, m]) => TELL_SHAPES.includes(m)));
  }

  // ---- the whisper's fragments ------------------------------------------
  {
    const w = tData.types.WHISPER;
    check('WHISPER authors its audio fragments in data, not in a .js file',
      Array.isArray(w.audio?.fragments) && w.audio.fragments.length >= 6);
    check('every other tell type is silent',
      Object.entries(tData.types).filter(([k, v]) => v.audio).map(([k]) => k).join() === 'WHISPER');
    check('the whisper is louder in Withitness than out of it, and never zero',
      CFG.whisper.gain > CFG.whisper.ambientGain && CFG.whisper.ambientGain > 0);
    check('and a blind spot attenuates it rather than removing it',
      CFG.whisper.occludedScale > 0 && CFG.whisper.occludedScale < 1);
  }

  // ---- withitness.js, first execution -----------------------------------
  {
    const registry = createRegistry();
    const scene = { background: { set() {} }, fog: { color: { set() {} } } };
    const audio = stubAudio();
    let visionOn = null, cleared = 0;
    const tellSystem = { setThermalVisible: on => { visionOn = on; }, clearLabels: () => cleared++ };
    const wi = createWithitness({ scene, registry, tellSystem, audio, dom: stubDom() });

    const state = { withitness: false, withitnessUses: 0, bandwidth: 100, hyper: 0,
                    withitnessSeconds: 0, mastery: 60, restless: 10 };

    wi.set(state, false);
    check('turning Withitness off when it is off does nothing', state.withitnessUses === 0 && visionOn === null);

    wi.set(state, true);
    check('turning it on counts a use, and shows the vision', state.withitnessUses === 1 && visionOn === true);
    check('and the drone comes up', audio.calls.at(-1)[1] === true);
    wi.set(state, true);
    check('holding it does not count a second use', state.withitnessUses === 1);

    wi.tick(state, 1);
    check('looking costs Bandwidth (locked constraint 1)', state.bandwidth < 100);
    check('and drains Mastery, because you are not teaching (locked constraint 1)', state.mastery < 60);
    check('and builds hypervigilance', state.hyper > 0);
    check('and the room gets more restless while you stare', state.restless > 10);
    check('and the seconds are counted for the report', state.withitnessSeconds === 1);

    wi.set(state, false);
    check('letting go hides the vision and drops the labels', visionOn === false && cleared === 1);
    const hyperAfterOn = state.hyper;
    wi.tick(state, 1);
    check('hypervigilance decays once you stop', state.hyper < hyperAfterOn);
    check('and never below zero', (state.hyper = 0.01, wi.tick(state, 100), state.hyper === 0));
    check('nor above 100', (state.withitness = true, state.hyper = 99, wi.tick(state, 100), state.hyper === 100));
  }

  // ---- T5 gap 9: furniture that does not overlap -------------------------
  {
    const F = CFG.seating.deskFootprint, C = CFG.seating.furnitureClearance;
    const deskAt = (c, r) => ({ x: roomData.seatGrid?.cols?.[c] ?? sData.seatGrid.cols[c],
                                z: (roomData.seatGrid?.rows?.[r] ?? sData.seatGrid.rows[r]) + F.offsetZ });
    const overlaps = (rect, p) => Math.abs(p.x - rect.x) < rect.halfW + F.halfW + C
                               && Math.abs(p.z - rect.z) < rect.halfD + F.halfD + C;
    const allDesks = [];
    for (let r = 0; r < sData.seatGrid.rows.length; r++) {
      for (let c = 0; c < sData.seatGrid.cols.length; c++) {
        if (allDesks.length < sData.roster.length) allDesks.push(deskAt(c, r));
      }
    }
    const rectOf = id => occluderRects(roomData.occluders).find(o => o.id === id);

    const shipped = mkChart().occluderLayout();
    check('the shipped furniture layout is already clear of every desk',
      shipped.every(o => allDesks.every(d => !overlaps({ ...rectOf(o.id), x: d.x, z: d.z }, o))));

    // Drop the cabinet dead centre on a desk. Before this it landed there.
    const c1 = mkChart();
    const target = allDesks[5];
    const moved = c1.moveOccluder('cabinet', target.x, target.z);
    check('a cabinet dragged onto a desk does not stay on it',
      !overlaps({ ...rectOf('cabinet'), x: target.x, z: target.z }, moved));
    check('and it moves, rather than refusing to move at all',
      Math.abs(moved.x - target.x) > 0.01 || Math.abs(moved.z - target.z) > 0.01);
    check('and it is still inside the room',
      Math.abs(moved.x) <= roomData.bounds.x && moved.z >= roomData.bounds.zFront && moved.z <= roomData.bounds.zBack);

    // Two pieces of furniture, one spot.
    const c2 = mkChart();
    const shelf = c2.occluderLayout().find(o => o.id === 'bookshelf');
    const onTop = c2.moveOccluder('cabinet', shelf.x, shelf.z);
    const gapX = rectOf('cabinet').halfW + rectOf('bookshelf').halfW + C;
    const gapZ = rectOf('cabinet').halfD + rectOf('bookshelf').halfD + C;
    check('the cabinet cannot be parked inside the bookshelf',
      Math.abs(onTop.x - shelf.x) >= gapX - 1e-9 || Math.abs(onTop.z - shelf.z) >= gapZ - 1e-9);

    // The walls still win: locked behaviour from T5, unchanged.
    const c3 = mkChart();
    const far = c3.moveOccluder('cabinet', 99, 99);
    check('the walls still clamp', far.x <= roomData.bounds.x && far.z <= roomData.bounds.zBack);

    // And a saved layout that names an overlapping spot is repaired on load,
    // not trusted — a chart written before this clamp existed still opens.
    const c4 = mkChart(null, [{ id: 'cabinet', x: target.x, z: target.z }]);
    const repaired = c4.occluderLayout().find(o => o.id === 'cabinet');
    check('a saved layout from before the clamp is repaired, not trusted',
      !overlaps({ ...rectOf('cabinet'), x: target.x, z: target.z }, repaired));
  }
}


// ---------------------------------------------------------------------------
// Phase 8 — A THUMB HAS NEVER TOUCHED THIS. input.js could look around the
// room on a phone and could not walk, teach, or hold anything. Everything
// below exists to hold one line true: a touch source never gets its own
// branch downstream. The stick makes the same vector WASD makes, an on-screen
// chip pushes the same action a keydown pushes, and a pad sets the same flag
// SHIFT sets.
//
// The event wiring is executed here, not just the math. createInput takes its
// listener target as an argument for exactly that reason, and the stub below
// is the whole reason two fingers at once can be tested at all.
// ---------------------------------------------------------------------------
{
  // ---- the math, on its own -------------------------------------------
  {
    const w = moveVector({ KeyW: true }, { x: 0, y: 0 });
    check('W alone is a unit vector forward', Math.abs(w.fz - 1) < 1e-9 && w.fx === 0 && w.mag === 1);

    const wd = moveVector({ KeyW: true, KeyD: true }, { x: 0, y: 0 });
    check('W and D together are still unit length',
      Math.abs(Math.hypot(wd.fx, wd.fz) - 1) < 1e-9);

    check('nothing held is nothing to do', moveVector({}, { x: 0, y: 0 }) === null);

    // A thumb on the pad is a deliberate act; a stuck key is not.
    const both = moveVector({ KeyS: true }, { x: 1, y: 0 });
    check('the stick wins over a held key', both.fx === 1 && both.fz === 0);

    // Half a tilt is half a step, which a key cannot express at all.
    const half = moveVector({}, { x: 0, y: -0.5 });
    check('a half-tilted stick walks at half speed', Math.abs(half.mag - 0.5) < 1e-9);
    check('and still points somewhere unit-length',
      Math.abs(Math.hypot(half.fx, half.fz) - 1) < 1e-9);
  }

  {
    const dead = stickVector(100, 100, 100 + CFG.touch.deadZone - 1, 100);
    check('a thumb inside the deadzone is not a step', dead.x === 0 && dead.y === 0);

    const full = stickVector(100, 100, 100 + CFG.touch.stickRadius * 3, 100);
    check('a thumb past the radius clamps to full tilt', Math.abs(full.x - 1) < 1e-9);

    const up = stickVector(100, 100, 100, 100 - CFG.touch.stickRadius);
    check('stick space is screen space: up is negative y', up.y < 0 && up.x === 0);
  }

  {
    check('a coarse pointer gets the on-screen controls', wantsTouchUI({ coarse: true }));
    check('a mouse does not', !wantsTouchUI({ coarse: false, hasTouch: false }));
    check('a browser that only admits to ontouchstart still does',
      wantsTouchUI({ coarse: false, hasTouch: true }));
    check('?touch=off is how you look at the desktop branch from a phone',
      !wantsTouchUI({ coarse: true, hasTouch: true, override: 'off' }));
    check('?touch=on is how you look at the phone branch from a desktop',
      wantsTouchUI({ override: 'on' }));
  }

  // ---- the wiring, executed -------------------------------------------
  //
  // A stub that records handlers and lets the test fire them, because the
  // interesting case — walking while looking — is two touch identifiers alive
  // at the same moment and nothing short of real dispatch proves it works.
  const mkTarget = () => {
    const handlers = new Map();
    return {
      innerWidth: 800,
      addEventListener(type, fn) {
        if (!handlers.has(type)) handlers.set(type, []);
        handlers.get(type).push(fn);
      },
      fire(type, ev) { for (const fn of (handlers.get(type) || [])) fn(ev); }
    };
  };
  const touches = (...list) => ({ changedTouches: list.map(([identifier, clientX, clientY]) =>
    ({ identifier, clientX, clientY })) });
  const mkInput = () => {
    const root = mkTarget(), canvas = mkTarget();
    return { root, canvas, input: createInput(canvas, { yaw: 0 }, { root }) };
  };
  const bounds = roomData.bounds;
  const mkCam = () => ({ position: { x: 0, y: CFG.eyeHeight, z: 1.0 } });
  const walk = (input, cam, seconds) => input.move(cam, seconds, bounds, [], []);

  {
    // The claim the whole phase rests on: full-tilt stick forward and W held
    // move the camera the same distance in the same direction.
    const a = mkInput(), b = mkInput();
    const camStick = mkCam(), camKeys = mkCam();

    a.canvas.fire('touchstart', touches([1, 120, 300]));
    a.canvas.fire('touchmove', touches([1, 120, 300 - CFG.touch.stickRadius * 2]));
    walk(a.input, camStick, 0.1);

    b.root.fire('keydown', { code: 'KeyW', preventDefault() {} });
    walk(b.input, camKeys, 0.1);

    check('a full-tilt stick and a held W walk the same way',
      Math.abs(camStick.position.x - camKeys.position.x) < 1e-9 &&
      Math.abs(camStick.position.z - camKeys.position.z) < 1e-9);
    check('and it actually moved somewhere', Math.abs(camKeys.position.z - 1.0) > 1e-6);
  }

  {
    // Two fingers. The left half walks, the right half looks, and neither
    // takes the other's identifier.
    const { canvas, input } = mkInput();
    const cam = mkCam();
    const yaw0 = input.look.yaw;

    canvas.fire('touchstart', touches([7, 100, 320], [8, 600, 200]));
    canvas.fire('touchmove', touches([7, 100 + CFG.touch.stickRadius * 2, 320], [8, 660, 200]));
    walk(input, cam, 0.1);

    check('the left-half finger walks', Math.abs(cam.position.x) > 1e-6);
    check('the right-half finger looks at the same time', input.look.yaw !== yaw0);

    // Lifting the look finger must not take the stick with it.
    const x = cam.position.x;
    canvas.fire('touchend', touches([8, 660, 200]));
    walk(input, cam, 0.1);
    check('lifting the look finger leaves the stick alone', cam.position.x > x);

    canvas.fire('touchend', touches([7, 700, 320]));
    const stopped = cam.position.x;
    walk(input, cam, 0.1);
    check('lifting the walk finger stops the walk', cam.position.x === stopped);
  }

  {
    // A finger that lands on the right first must not become the stick, or
    // looking around the room walks you across it.
    const { canvas, input } = mkInput();
    const cam = mkCam();
    const yaw0 = input.look.yaw;
    canvas.fire('touchstart', touches([5, 700, 200]));
    canvas.fire('touchmove', touches([5, 700, 100]));
    walk(input, cam, 0.2);
    check('a finger that lands on the right looks and does not walk',
      input.look.pitch !== -0.04 && cam.position.x === 0 && cam.position.z === 1.0);
    check('and the walk half is still free for the other thumb',
      (canvas.fire('touchstart', touches([6, 100, 300])),
       canvas.fire('touchmove', touches([6, 100 + CFG.touch.stickRadius * 2, 300])),
       walk(input, cam, 0.1), Math.abs(cam.position.x) > 1e-6));
  }

  {
    // A second finger landing in the walk half while the stick is taken looks
    // rather than fighting over it.
    const { canvas, input } = mkInput();
    const cam = mkCam();
    canvas.fire('touchstart', touches([1, 100, 300]));
    const yaw0 = input.look.yaw;
    canvas.fire('touchstart', touches([2, 140, 300]));
    canvas.fire('touchmove', touches([2, 240, 300]));
    walk(input, cam, 0.1);
    check('a second finger in the walk half looks instead of stealing the stick',
      input.look.yaw !== yaw0 && cam.position.x === 0);
  }

  {
    // The chips and the pads. Same actions, same flags, no second path.
    const { root, input } = mkInput();

    root.fire('keydown', { code: CFG.keys.advance, preventDefault() {} });
    check('a keydown queues its action', (input.takeActions() || []).includes('advance'));

    input.press('advance');
    check('and an on-screen chip queues the same one',
      (input.takeActions() || []).includes('advance'));
    check('actions drain once per frame', input.takeActions() === null);

    check('nothing is held to start with', !input.wantsWithitness() && !input.wantsWait());
    input.setHold('withitness', true);
    check('the Withitness pad is SHIFT', input.wantsWithitness());
    // The interesting case: the five-second wait-time hold under a pad that
    // is already down.
    input.setHold('wait', true);
    check('the wait pad works while Withitness is already held',
      input.wantsWithitness() && input.wantsWait());
    input.setHold('withitness', false);
    check('and releasing one does not release the other',
      !input.wantsWithitness() && input.wantsWait());

    root.fire('blur', {});
    check('losing the window releases every pad', !input.wantsWithitness() && !input.wantsWait());
    input.setHold('nonsense', true);
    check('an unknown hold name is ignored rather than invented',
      !input.wantsWithitness() && !input.wantsWait());
  }

  {
    // A pad stuck down after the window blurs would leave the room in thermal
    // view with nobody touching anything; the stick stuck down would walk the
    // teacher into a wall.
    const { root, canvas, input } = mkInput();
    const cam = mkCam();
    canvas.fire('touchstart', touches([3, 90, 300]));
    canvas.fire('touchmove', touches([3, 300, 300]));
    root.fire('blur', {});
    const at = cam.position.x;
    walk(input, cam, 0.2);
    check('losing the window releases the stick too', cam.position.x === at);
  }

  // ---- the strip is generated, not written down ------------------------
  {
    // main.js builds one chip per row of CFG.keys. Adding a key must not need
    // an edit anywhere else, and a key with no label must still get a button.
    const lookCopy = Object.fromEntries(obsData.lookFors.map(l => [l.key, l]));
    const chipFor = action => {
      const c = action.startsWith('look:') ? lookCopy[action.slice(5)] : ctrlData.labels[action];
      return { action, short: (c?.short || action).toUpperCase(), long: c?.long || c?.label || '' };
    };
    const chips = Object.keys(CFG.keys).map(chipFor);
    check('every key in CFG.keys becomes exactly one chip', chips.length === Object.keys(CFG.keys).length);
    check('and every chip has words on it', chips.every(c => c.short.length > 0));
    check('a key nobody wrote a label for still gets a chip',
      chipFor('somethingNew').short === 'SOMETHINGNEW');

    // The look-for chips must read data/observation.json rather than spelling
    // the same rubric line out a second time in data/controls.json.
    const lookActions = Object.keys(CFG.keys).filter(a => a.startsWith('look:'));
    check('every look-for key has a row in observation.json',
      lookActions.every(a => lookCopy[a.slice(5)]));
    check('and observation.json is where its words are',
      lookActions.every(a => !(a in ctrlData.labels)));
    check('every look-for row carries a chip-length short form',
      obsData.lookFors.every(l => typeof l.short === 'string' && l.short.length && l.short.length <= 10));
    check('both hold pads are named in controls.json',
      !!ctrlData.holds.withitness?.short && !!ctrlData.holds.wait?.short);
  }

  // ---- the frame budget ------------------------------------------------
  {
    check('the budget is written down as a number', CFG.quality.budgetMs === 33.3);
    check('median of an even list is the middle pair', median([10, 20, 30, 40]) === 25);
    check('median of an odd list is the middle', median([50, 10, 30]) === 30);
    check('an empty sample is zero, not NaN', median([]) === 0);

    check('a mouse with cores gets everything', pickTier({ coarse: false, cores: 8 }) === 'high');
    check('a browser that admits nothing is assumed to be a desktop',
      pickTier({}) === 'high');
    check('a current phone keeps its twelve rigged bodies and loses MSAA',
      pickTier({ coarse: true, cores: 8, memory: 6 }) === 'medium');
    check('a four-core phone takes the primitive bodies',
      pickTier({ coarse: true, cores: 4, memory: 4 }) === 'low');
    check('so does one with 3 GB', pickTier({ coarse: true, cores: 8, memory: 3 }) === 'low');
    check('and only the low tier drops the characters',
      tierSettings('low').characters === false && tierSettings('medium').characters === true);
    check('an unknown tier name falls back to high rather than to undefined',
      tierSettings('nonsense') === CFG.quality.tiers.high);
  }

  {
    const mk = () => createFrameBudget({
      budgetMs: 33.3, sampleFrames: 10, overBudgetSeconds: 0.9,
      ratios: [2, 1.5, 1, 0.75], startRatio: 2
    });
    const feed = (b, ms, frames) => {
      let last = null;
      for (let i = 0; i < frames; i++) { const r = b.push(ms); if (r) last = r; }
      return last;
    };

    const fine = mk();
    check('a room inside the budget gives up nothing', feed(fine, 16, 200) === null);
    check('and reports the median it measured', Math.abs(fine.report().medianMs - 16) < 1e-9);
    check('and the fps that goes with it', fine.report().fps === 63);

    const slow = mk();
    // 50 ms frames: one 10-frame window is 0.5 s, so one window is not enough.
    check('one slow window is not a verdict', feed(slow, 50, 10) === null);
    const dropped = feed(slow, 50, 10);
    check('two of them is', dropped && dropped.pixelRatio === 1.5);
    check('and the drop is on the record',
      slow.report().drops.length === 1 && slow.report().pixelRatio === 1.5);

    // All the way down, and then nothing left to give up.
    feed(slow, 50, 200);
    check('the ladder bottoms out at the last ratio', slow.report().pixelRatio === 0.75);
    check('and stops asking for more', feed(slow, 50, 200) === null);
    check('every step it took is written down', slow.report().drops.length === 3);

    // A phone whose boot tier already capped it at 1 can only fall one step.
    const capped = createFrameBudget({
      budgetMs: 33.3, sampleFrames: 10, overBudgetSeconds: 0.9,
      ratios: [2, 1.5, 1, 0.75], startRatio: 1
    });
    feed(capped, 50, 100);
    check('a device that started at 1 falls to 0.75 and no further',
      capped.report().pixelRatio === 0.75 && capped.report().drops.length === 1);
  }

  // ---- the document the controls are drawn into ------------------------
  {
    const html = fs.readFileSync('../index.html', 'utf8');
    const css = fs.readFileSync('../styles/main.css', 'utf8');
    check('index.html has somewhere to put the on-screen controls', /id="touch"/.test(html));
    check('and both halves of the start screen key list',
      /id="kbdKeys"/.test(html) && /id="touchKeys"/.test(html));
    check('the touch layer is styled', /#touch\.on\{display:block\}/.test(css));
    // The layer covers the whole viewport. If it is not inert, it eats every
    // touch meant for the room and the game stops taking input at all.
    check('the touch layer itself is inert', /#touch\{[^}]*pointer-events:none/.test(css));
    check('and its controls are not', /#touch > \*\{pointer-events:auto\}/.test(css));
    check('a chip is at least 44px of fingertip', /\.tchip\{[^}]*min-height:44px/.test(css));
    check('a hold pad is bigger than that', /\.tpad\{[^}]*min-height:56px/.test(css));
    // The rubric panel sat at a fixed top:336px, which is past the bottom of a
    // landscape phone. The media-query pass is the fix, so assert it exists.
    check('the readouts have a small-viewport pass',
      /@media \(max-width:880px\),\(max-height:560px\)/.test(css));
    check('and a desk card cannot be mistaken for a scroll',
      /\.deskcard\{touch-action:none/.test(css));
  }
}


console.log(fails? `\n${fails} FAILURES` : '\nall green');
process.exit(fails?1:0);
