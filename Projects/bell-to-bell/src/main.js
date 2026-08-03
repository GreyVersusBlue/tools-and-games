import * as THREE from 'three';
import { CFG } from './config.js';
import { createState } from './state.js';
import { loadData } from './loader.js';
import { createMaterials, createRegistry } from './world/materials.js';
import { buildRoom } from './world/room.js';
import { buildStudents, placeStudents, createReactions } from './world/students.js';
import { createChart, learnFrom } from './systems/chart.js';
import { createTellSystem } from './systems/tells.js';
import { createWithitness } from './systems/withitness.js';
import { createInterventions } from './systems/interventions.js';
import { createEvents } from './systems/events.js';
import { createLesson } from './systems/lesson.js';
import { createRoomTemp } from './systems/roomtemp.js';
import { createObservation } from './systems/observation.js';
import { inTeachingZone, tickMeters } from './systems/meters.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { dom } from './ui/dom.js';
import { drawHUD } from './ui/hud.js';
import { toast } from './ui/toast.js';
import { updateLabels } from './ui/labels.js';
import { openMenu, closeMenu } from './ui/menu.js';
import { showReport } from './ui/report.js';
import { createSeatingScreen } from './ui/seating.js';
import * as persist from './persist.js';

// If anything below throws — a bad fetch, a data-shape mismatch, whatever —
// the old failure mode was total silence: the script would die mid-init and
// dom.startBtn.addEventListener() at the bottom would simply never run, so
// clicking "Seating chart" did nothing and gave no clue why. This puts the
// real error on screen (and in the console) instead of leaving a dead button.
function showFatalError(err) {
  console.error('Bell to Bell failed to start:', err);
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;inset:0;z-index:999;background:#1a1006;' +
    'color:#F4E9D8;font:13px/1.5 "SFMono-Regular",Consolas,monospace;' +
    'padding:32px;overflow:auto;white-space:pre-wrap;';
  const msg = (err && err.stack) ? err.stack : String(err);
  box.textContent =
    'Bell to Bell did not start.\n\n' +
    'If you opened index.html directly (file://), that is almost certainly why:\n' +
    'ES modules cannot fetch data/*.json across the file:// origin. Serve the\n' +
    'folder instead, e.g.  python3 -m http.server 8000  and open localhost:8000.\n\n' +
    'The actual error was:\n\n' + msg;
  document.body.appendChild(box);
}

// T6 — the periods this browser tab knows about, in order. Same room both
// times; a different data/ folder is a different roster, lesson and Room
// Temp baseline. Add a period by adding a folder and an entry here.
const PERIODS = [
  { dataDir: './data' },
  { dataDir: './data/period2' }
];

// Period 1 keeps the original, unprefixed keys so a save from before T6
// still loads. Later periods get their own chart and discoveries — a
// volatility edge you found in one roster's kids says nothing about a
// different roster's kids, even if they land in the same desk.
const chartKey = index => index === 0 ? 'chart' : `chart:period${index + 1}`;
const knownKey = index => index === 0 ? 'known' : `known:period${index + 1}`;

try {

// ---------- renderer (built once; the room inside it is rebuilt per period) ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xB9BDB2);
scene.fog = new THREE.Fog(0xB9BDB2, 14, 30);

const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.05, 100);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
dom.app.appendChild(renderer.domElement);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const mats = createMaterials();
const audio = createAudio();
const projector = new THREE.Vector3();

// ---------- everything below is rebuilt by startPeriod() -------------------
let periodIndex = -1;
let periodGroup = null;
let data, registry, room, chart, students, plan, reactions, tellSystem,
    withitness, interventions, lesson, temp, events, observation, state,
    savedChart, known;
let input = null;

function flashCFU() {
  dom.cfu.classList.remove('on');
  void dom.cfu.offsetWidth;
  dom.cfu.classList.add('on');
  audio.chime();
}

function handleTellClick(t) {
  if (observation.active()) return;    // T7: the alert owns your attention
  state.openTell = t;
  openMenu(interventions.buildMenu(t, camera), key => {
    closeMenu();
    interventions.apply(state, t, key);
    state.openTell = null;
  });
}

function onExpire(t) {
  state.missed++;
  state.restless += CFG.missedRestless;
  state.masteryPending += CFG.missedMastery;
  const copy = data.tells.missedCopy[t.type] || data.tells.missedCopy.default;
  toast('', 'Missed it', copy);
}

// T8 — the room's one live whisper, if it has one, panned to where it
// actually is and audible only in Withitness. Room noise otherwise; the
// same conversation the murmur bed already implies, just not resolvable.
function updateWhisperAudio() {
  const t = tellSystem.tells.find(x => x.type === 'WHISPER' && x.born !== null && !x.dead);
  if (!t || !state.withitness) { audio.setWhisper(0, 0); return; }

  const dx = t.pos.x - camera.position.x, dz = t.pos.z - camera.position.z;
  const dist = Math.hypot(dx, dz);
  const level = Math.max(0, 1 - dist / CFG.whisper.range);
  if (level <= 0) { audio.setWhisper(0, 0); return; }

  const yaw = input.look.yaw;
  const lateral = dx * Math.cos(yaw) - dz * Math.sin(yaw);
  const pan = Math.max(-1, Math.min(1, lateral / CFG.whisper.panSpan));
  audio.setWhisper(pan, level);
}

addEventListener('keydown', e => {
  if (e.code !== 'Escape') return;
  if (observation.active()) return;   // T7: no dismissing the alert or the AP
  closeMenu(); state.openTell = null;
});
document.addEventListener('click', e => {
  if (state.openTell && !e.target.closest('#menu') && !e.target.closest('.tell')) {
    closeMenu();
    state.openTell = null;
  }
});

// ---------- loop ----------
let last = performance.now();

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (!state.running || state.ended) { renderer.render(scene, camera); return; }

  state.t -= dt * CFG.timeScale;
  if (state.t <= 0) { state.t = 0; endPeriod(); }

  withitness.set(state, input.wantsWithitness() && state.bandwidth > 0);
  input.move(camera, dt, room.bounds, students, room.occluders);
  camera.rotation.set(input.look.pitch, input.look.yaw, 0, 'YXZ');

  const teaching = inTeachingZone(camera, room.teachingZone);

  for (const action of input.takeActions() || []) {
    if (observation.active()) continue;        // T7: the alert owns your attention
    if (action === 'roomTemp') { temp.read(state); continue; }
    if (state.openTell) continue;              // one thing at a time
    if (action === 'advance') lesson.advance(state);
    else if (action === 'check') lesson.check(state);
    else if (action === 'reteach') lesson.reteach(state);
  }

  withitness.tick(state, dt);
  const liveTells = tellSystem.tells.filter(t => t.born !== null && !t.dead && !t.resolved).length;
  tickMeters(state, dt, teaching, liveTells);
  lesson.tick(state, dt, { teaching });

  if (state.hyper > CFG.hyperThreshold && !state.falseSpawned && state.t > 420) {
    state.falseSpawned = true;
    tellSystem.spawnFalsePositive(state);
    toast('bad', 'New indicator', 'Confidence: HIGH.');
  }

  events.tick(state);
  observation.tick(state, dt);
  tellSystem.update(state, onExpire);
  reactions.tick(dt, {
    auraFor: state.withitness ? (s => lesson.auraOf(s, state)) : null
  });
  audio.setMurmur(state.restless / 100, state.withitness);
  updateWhisperAudio();

  updateLabels({ state, camera, tellSystem, students, onClick: handleTellClick, projector });
  drawHUD(state, teaching, temp.display(state), lesson.summary(state));
  renderer.render(scene, camera);
}

function endPeriod() {
  state.ended = true;
  state.running = false;
  withitness.set(state, false);
  closeMenu();
  audio.bell();

  // What this period taught you about the room. Next chart of THIS roster
  // knows it; nothing about it was labelled in advance.
  const learned = learnFrom({ tells: tellSystem.tells, plan, known, rules: data.seating.rules });
  known = learned.known;
  persist.save(knownKey(periodIndex), known);

  showReport(state, data.events, {
    lesson: lesson.summary(state), students,
    seating: { plan, copy: data.seating.report, chart, learned },
    periodLabel: data.room.meta.period,
    onNextPeriod: periodIndex + 1 < PERIODS.length ? nextPeriod : null
  });
}

// ---------- the seating chart, then the bell ----------
const seating = createSeatingScreen({
  copy: null,   // set per period in startPeriod(), before open() ever reads it
  onSwap: (a, b) => { chart.swapDesks(a, b); redrawChart(); },
  onReset: () => { chart.reset(); redrawChart(); },
  onConfirm: () => beginPeriod(),
  // T5: drag feedback only — the raycast the room actually uses doesn't move
  // until beginPeriod() commits it, same as desk swaps.
  onMoveOccluder: (id, x, z) => {
    if (chart.moveOccluder(id, x, z)) seating.patch(chart.viewModel(known));
  }
});

function redrawChart() {
  seating.update(chart.viewModel(known), { cost: chart.rechartCost(savedChart) });
}

function beginPeriod() {
  // Everything the chart decides is decided here, once, and then the room is
  // whatever you made it.
  plan = chart.resolveSchedule(data.tells.schedule);
  chart.apply(students, plan);
  placeStudents(students, chart, data.students.seatGrid.bodyOffsetZ);
  tellSystem.load(plan.rows);

  // T5: the cabinet and bookshelf you dragged on paper are the cabinet and
  // bookshelf the raycast and collision see for the rest of this period.
  const occPositions = chart.occluderPositions();
  for (const mesh of room.occluders) {
    const p = occPositions.find(o => o.id === mesh.userData.id);
    if (p) mesh.position.set(p.x, mesh.position.y, p.z);
  }
  persist.save('occluders', occPositions);   // the room, not the roster — shared across periods

  const cost = chart.rechartCost(savedChart);
  state.rechart = cost;
  if (cost.rapport) state.rapport += cost.rapport;
  persist.save(chartKey(periodIndex), chart.seatOf);

  seating.close();
  audio.init();
  state.running = true;
  last = performance.now();
}

function openChartScreen() {
  seating.open(chart.viewModel(known), { cost: chart.rechartCost(savedChart) });
}

// T6 — load a period's own data set and (re)build everything that depends on
// it. The renderer, camera, materials and the seating-screen UI are session-
// level and stay untouched; only the room, roster and systems churn.
async function startPeriod(index) {
  periodIndex = index;
  data = await loadData(PERIODS[index].dataDir);
  state = createState();

  // T5: the furniture you left the room in last period is the furniture you
  // walk into this one — shared physical state, not roster-specific.
  const savedOccluders = persist.load('occluders', null);
  if (savedOccluders) {
    for (const o of data.room.occluders || []) {
      const p = savedOccluders.find(s => s.id === o.id);
      if (p) o.pos = [p.x, p.z];
    }
  }

  if (periodGroup) scene.remove(periodGroup);
  periodGroup = new THREE.Group();
  scene.add(periodGroup);
  registry = createRegistry();

  room = buildRoom(periodGroup, registry, mats, data.room);

  // T4/T6: the chart decides who sits where before anything is built. Each
  // period keeps its own saved chart and discoveries (see chartKey/knownKey).
  savedChart = persist.load(chartKey(index), null);
  known = persist.load(knownKey(index), { edges: [], steadies: [] });
  chart = createChart({
    seatGrid: data.students.seatGrid,
    room: data.room,
    roster: data.students.roster,
    tellTypes: data.tells.types,
    rules: data.seating.rules,
    plan: data.seating.plan.furniture,
    saved: savedChart
  });

  students = buildStudents(periodGroup, registry, mats, data.students, chart);
  plan = chart.resolveSchedule(data.tells.schedule);
  chart.apply(students, plan);

  camera.position.set(room.spawn.x, CFG.eyeHeight, room.spawn.z);
  if (!input) input = createInput(renderer.domElement, room.spawn);
  else { input.look.yaw = room.spawn.yaw ?? Math.PI; input.look.pitch = -0.04; }

  dom.cbTitle.textContent = data.room.meta.period;
  dom.cbRoom.textContent = data.room.meta.room;

  reactions = createReactions({ students, data: data.reactions, camera });

  tellSystem = createTellSystem({
    scene: periodGroup, camera, students, data: data.tells, occluders: room.occluders,
    schedule: plan.rows,
    // T1: a tell arriving changes how the kid sits. Subtle enough to be
    // deniable, which is the point — the posture is a Tier 1 tell and the
    // phone is Tier 2.
    onBorn: t => {
      const def = data.tells.types[t.type];
      if (!def.posture) return;
      reactions.play(students[t.seat], def.posture, { key: `tell${t.id}`, partner: students[t.seat2] });
      if (t.seat2 != null) {
        reactions.play(students[t.seat2], def.posture, { key: `tell${t.id}`, partner: students[t.seat] });
      }
      audio.scrape(0.35);
    },
    onGone: t => {
      reactions.release(students[t.seat], `tell${t.id}`);
      if (t.seat2 != null) reactions.release(students[t.seat2], `tell${t.id}`);
    }
  });

  withitness = createWithitness({ scene, registry, tellSystem, audio, dom });

  interventions = createInterventions({
    data: data.interventions, students, tellSystem, toast,
    react: ({ seat, seat2, reaction, reactRoom, escalated }) => {
      const subject = students[seat];
      if (escalated && reaction === 'ripple') {
        reactions.play(subject, 'flinch');
        reactions.ripple(subject, data.reactions.ripple);
        audio.scrape(1);
        return;
      }
      if (!reaction) return;
      if (reactRoom) {
        // The pause. Eleven heads turn toward the silence, which is the whole move.
        reactions.wave(reaction, { scale: 0.8, delayPerMetre: 0.06 });
      } else {
        reactions.play(subject, reaction, { partner: seat2 != null ? students[seat2] : null });
        if (seat2 != null) reactions.play(students[seat2], reaction, { partner: subject });
      }
      audio.scrape(0.5);
    }
  });

  lesson = createLesson({
    data: data.lesson, students, tellSystem, toast,
    onBoard: beat => room.screens.board?.set(beat.board),
    onRoomReact: kind => {
      const cfg = data.reactions.room[kind];
      if (cfg) reactions.wave(cfg.pose, { scale: cfg.scale, delayPerMetre: cfg.delayPerMetre });
      if (kind === 'check') flashCFU();
    }
  });

  temp = createRoomTemp({
    data: data.events, students, tellSystem, toast,
    onPulse: () => {
      dom.tempBox.classList.remove('pulse');
      void dom.tempBox.offsetWidth;
      dom.tempBox.classList.add('pulse');
      audio.blip();
    }
  });

  events = createEvents({
    data: data.events, dom, toast,
    react: ev => {
      if (!ev.reaction) return;
      reactions.wave(ev.reaction, { scale: 0.9, delayPerMetre: 0.02 });
    }
  });

  observation = createObservation({ data: data.observation, dom, toast, openMenu, closeMenu });

  room.screens.board?.set(lesson.current(state).board);
  room.screens.objective?.set(data.lesson.objectiveBoard);

  seating.setCopy(data.seating);
  drawHUD(state, true, temp.display(state), lesson.summary(state));
}

async function nextPeriod() {
  dom.endScreen.classList.add('hide');
  await startPeriod(periodIndex + 1);
  openChartScreen();
}

await startPeriod(0);

dom.startBtn.addEventListener('click', () => {
  dom.startScreen.classList.add('hide');
  openChartScreen();
});

requestAnimationFrame(frame);

} catch (err) {
  showFatalError(err);
}
