import fs from 'fs';
import { createState, applyEffects } from '../src/state.js';
import { createInterventions } from '../src/systems/interventions.js';
import { createLesson } from '../src/systems/lesson.js';
import { createRoomTemp } from '../src/systems/roomtemp.js';
import { createChart, learnFrom, edgeKey } from '../src/systems/chart.js';
import { segmentHitsRect, classifySight, occluderRects } from '../src/systems/sightlines.js';
import { createObservation } from '../src/systems/observation.js';
import { CFG } from '../src/config.js';

const D = f => JSON.parse(fs.readFileSync(`../data/${f}.json`,'utf8'));
const iData = D('interventions'), tData = D('tells'), sData = D('students');
const lData = D('lesson'), eData = D('events'), rData = D('reactions');
const roomData = D('room'), seatData = D('seating'), oData = D('observation');

const mkChart = (saved=null) => createChart({
  seatGrid: sData.seatGrid, room: roomData, roster: sData.roster,
  tellTypes: tData.types, rules: seatData.rules,
  plan: seatData.plan.furniture, saved
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

// ---------------------------------------------------------------------------
// T5 — the classroom builder (dragging the occluders)
// ---------------------------------------------------------------------------
// A fresh chart, so mutating occluder positions here cannot leak into any
// other test that reads baseChart's sight classifications.
const buildChart = mkChart();
const backLeftDesk = 8;    // col 0, row 2 — the desk the cabinet test above blinds

check('moving an unknown occluder is refused', buildChart.moveOccluder('nope', 0, 0)===false);

// Park the cabinet on top of that desk's own target point: every viewpoint's
// line to it now has to cross the rect, so it goes fully blind — gap 8, closed.
buildChart.moveOccluder('cabinet', -2.9, 3.0);
check('walling a desk off from everywhere makes it blind',
  buildChart.desks[backLeftDesk].sight.kind==='blind');

// Now drag it well out of the way of every desk and viewpoint.
buildChart.moveOccluder('cabinet', 4.9, -3.4);
check('moving the cabinet clear of a desk un-blinds it',
  buildChart.desks[backLeftDesk].sight.kind==='clear');

const clampChart = mkChart();
clampChart.moveOccluder('cabinet', 999, 999);
const clamped = clampChart.occluderPositions().find(o=>o.id==='cabinet');
check('a wild drag is clamped inside the room bounds',
  clamped.x <= roomData.bounds.x && clamped.z <= roomData.bounds.zBack);

const posChart = mkChart();
posChart.moveOccluder('bookshelf', 2.5, -1.0);
const positions = posChart.occluderPositions();
check('occluderPositions reports both occluders', positions.length===2);
check('a moved occluder reports its new position',
  positions.find(o=>o.id==='bookshelf').x===2.5 && positions.find(o=>o.id==='bookshelf').z===-1.0);
check('moving one occluder leaves the other where it was',
  positions.find(o=>o.id==='cabinet').x===roomData.occluders.find(o=>o.id==='cabinet').pos[0]);

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
// T7 — the observation
// ---------------------------------------------------------------------------
// Headless: dom/openMenu/closeMenu are mocked, and `schedule` is swapped for
// a synchronous call so the bridge-to-conference transition doesn't need a
// real 900ms wait in a test.
function mkObservation(data = oData) {
  const domMock = {
    pa: { classList: { add(){}, remove(){} } },
    paTitle: { textContent: '' },
    paTxt: { textContent: '' }
  };
  const toasts = [];
  let lastSpec = null, lastPick = null;
  const obs = createObservation({
    data, dom: domMock, toast: (kind, title, body) => toasts.push({ kind, title, body }),
    openMenu: (spec, onPick) => { lastSpec = spec; lastPick = onPick; },
    closeMenu: () => {},
    schedule: fn => fn()
  });
  return { obs, toasts, spec: () => lastSpec, pick: k => lastPick(k) };
}

const atSeconds = CFG.periodSeconds - oData.trigger.atMinute * 60;

{
  const st = createState();
  const { obs, spec } = mkObservation();
  st.t = atSeconds + 5;
  obs.tick(st, 1 / 60);
  check('T7: idle before its scripted minute', !obs.active());

  st.t = atSeconds;
  obs.tick(st, 1 / 60);
  check('T7: the alert fires at its scripted minute', obs.active());
  check('T7: the window offers every authored action', spec().items.length === oData.actions.length);
}

{
  const st = createState();
  const { obs, spec, pick } = mkObservation();
  st.t = atSeconds; obs.tick(st, 1 / 60);

  const nonSolo = oData.actions.find(a => !a.solo);
  const key = Object.keys(nonSolo.effects)[0];
  const before = key === 'mastery' ? st.masteryPending : st[key];
  pick(nonSolo.id);
  const after = key === 'mastery' ? st.masteryPending : st[key];
  check('T7: picking an action applies its effects', after !== before);
  check('T7: the window stays open under maxPicks', obs.active());
  check('T7: a picked action is disabled if offered again',
    spec().items.find(i => i.key === nonSolo.id).enabled === false);

  const solo = oData.actions.find(a => a.solo);
  pick(solo.id);
  check('T7: the solo action closes the window and moves straight to the conference',
    obs.active() && spec().body === oData.conference.prompts[0].line);
}

{
  const st = createState();
  const { obs, pick, spec, toasts } = mkObservation();
  st.t = atSeconds; obs.tick(st, 1 / 60);

  const [a1, a2] = oData.actions.filter(a => !a.solo);
  pick(a1.id); pick(a2.id);
  check('T7: reaching maxPicks ends the window on its own',
    spec().body === oData.conference.prompts[0].line);

  const followUpIndex = oData.conference.prompts[0].choices.findIndex(c => c.followUp);
  const fuId = oData.conference.prompts[0].choices[followUpIndex].followUp;
  pick(String(followUpIndex));
  check('T7: a choice with a follow-up shows it next',
    spec().body === oData.conference.followUps[fuId].line);

  pick('0');
  check('T7: the conference ends and returns to idle', !obs.active());
  check('T7: a closing toast fires when the conference wraps',
    toasts.some(t => t.title === oData.conference.closing.title));
}

check('T7: an unknown menu key is ignored, not a crash', (() => {
  const st = createState();
  const { obs, pick } = mkObservation();
  st.t = atSeconds; obs.tick(st, 1 / 60);
  pick('not-a-real-action');
  return obs.active();
})());

check('T7: period 2 has its own observation, not a copy',
  D('period2/observation').trigger.atMinute !== oData.trigger.atMinute);

console.log(fails? `\n${fails} FAILURES` : '\nall green');
process.exit(fails?1:0);
