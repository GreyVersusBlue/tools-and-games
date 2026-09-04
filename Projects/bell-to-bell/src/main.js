import * as THREE from 'three';
import { CFG } from './config.js';
import { createState, clamp01to100 } from './state.js';
import { loadData } from './loader.js';
import { periodFor, resolvePeriodId, firstPeriodId, rowFor, isGenerated } from './periods.js';
import { drawSeed, SEED_MAX } from './systems/rng.js';
import { createMaterials, createRegistry } from './world/materials.js';
import { createModelLoader } from './world/models.js';
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
import { showConference } from './ui/conference.js';
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

try {

// Models and textures now make boot a real network-bound wait, not the near-
// instant thing it used to be — without this, the button sits there looking
// clickable for however long that takes, and clicking it does nothing until
// the script reaches dom.startBtn.addEventListener() at the very bottom.
dom.startBtn.disabled = true;
dom.startBtn.textContent = 'Loading…';

const data = await loadData();
const state = createState();

// T6: which class is in front of you right now. A fresh browser (or "Run it
// again" from the last period's own report) always starts back at the top of
// the day; the only way forward is a report handing you off.
// Phase 1: beginPeriod() writes this too, so a refresh mid-6th is still 6th,
// and a `period` key naming a class data/periods.json no longer has falls back
// to the first row rather than throwing.
const activePeriodId = resolvePeriodId(persist.load('period', null), data);

// Phase 2: a generated period is twelve kids out of one integer. The integer
// lives in the period's own slot, drawn once and kept, so a refresh mid-7th is
// the same 7th, and typed back in from the report screen it is that class
// again. An authored period has no seed and ignores the one it is handed.
const seedKey = persist.slot(activePeriodId, 'seed');
let seed = persist.load(seedKey, null);
if (isGenerated(rowFor(activePeriodId, data)) && !(Number.isInteger(seed) && seed > 0 && seed <= SEED_MAX)) {
  seed = drawSeed();
  persist.save(seedKey, seed);
}
const period = periodFor(activePeriodId, data, { seed, day: 0 });

// Phase 1: Bandwidth crosses the bell. Everything else in CFG.start is a fact
// about walking into a room and resets at each one; Bandwidth is a fact about
// how much day you have already taught, and the hallway only gives back
// CFG.day.passingPeriodRecovery of it.
const carriedBandwidth = persist.load(persist.dayKey('bandwidth'), null);
if (carriedBandwidth != null) state.bandwidth = clamp01to100(carriedBandwidth);

// ---------- renderer ----------
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

// ---------- world ----------
const registry = createRegistry();
const mats = createMaterials(data.assets);
// Shared across the room and the roster so a desk.glb used by both the
// teacher's desk and every student desk is only ever fetched once.
const modelLoader = createModelLoader();
const room = await buildRoom(scene, registry, mats, data.room, { loader: modelLoader, assets: data.assets });

// T4: the chart decides who sits where before anything is built. It survives
// between periods; the first period of a fresh browser gets the August chart.
// T5: so does the furniture — move the cabinet once and it stays moved.
// T6: 5th period keeps its own chart/discovery history, seeded once from
// whatever 4th period's desks looked like the moment you handed off — see
// rapportBase below for why that seeding is not the same thing as "familiar."
const chartKey = persist.slot(period.id, 'chart');
const knownKey = persist.slot(period.id, 'known');
const rapportKey = persist.slot(period.id, 'rapportBase');

let savedChart = persist.load(chartKey, null);
let savedLayout = persist.load('furniture', null);
// A brand-new roster has no opinion about any chart yet, however the desks
// happen to be sitting — that's what rapportBase (not savedChart) tracks.
let rapportBase = persist.load(rapportKey, savedChart);
let known = persist.load(knownKey, { edges: [], steadies: [] });
const chart = createChart({
  seatGrid: period.seatGrid,
  room: data.room,
  roster: period.roster,
  tellTypes: data.tells.types,
  rules: data.seating.rules,
  plan: data.seating.plan.furniture,
  saved: savedChart,
  layout: savedLayout
});

const students = await buildStudents(scene, registry, mats, period, chart, { loader: modelLoader, assets: data.assets });
let plan = chart.resolveSchedule(period.schedule);
chart.apply(students, plan);

camera.position.set(room.spawn.x, CFG.eyeHeight, room.spawn.z);
dom.cbTitle.textContent = period.periodLabel;
dom.cbRoom.textContent = data.room.meta.room;
dom.startSub.textContent = `SLICE 001 — "ONE PERIOD" · ${period.ordinal} · 47 minutes · 12 students`;

const reactions = createReactions({ students, data: data.reactions, camera });

// ---------- systems ----------
const audio = createAudio();
const input = createInput(renderer.domElement, room.spawn);

const tellSystem = createTellSystem({
  scene, camera, students, data: data.tells, occluders: room.occluders,
  schedule: plan.rows,
  // T1: a tell arriving changes how the kid sits. Subtle enough to be deniable,
  // which is the point — the posture is a Tier 1 tell and the phone is Tier 2.
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

const withitness = createWithitness({ scene, registry, tellSystem, audio, dom });

const interventions = createInterventions({
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

const lesson = createLesson({
  data: period.lessonData, students, tellSystem, toast,
  onBoard: beat => room.screens.board?.set(beat.board),
  onRoomReact: kind => {
    const cfg = data.reactions.room[kind];
    if (cfg) reactions.wave(cfg.pose, { scale: cfg.scale, delayPerMetre: cfg.delayPerMetre });
    if (kind === 'check') flashCFU();
  }
});

const temp = createRoomTemp({
  data: data.events, students, tellSystem, toast,
  onPulse: () => {
    dom.tempBox.classList.remove('pulse');
    void dom.tempBox.offsetWidth;
    dom.tempBox.classList.add('pulse');
    audio.blip();
  }
});

const events = createEvents({
  data: data.events, dom, toast,
  react: ev => {
    if (!ev.reaction) return;
    reactions.wave(ev.reaction, { scale: 0.9, delayPerMetre: 0.02 });
  }
});

// T7: the Observation. Shared across periods on purpose — it is the same
// rubric and the same AP regardless of whose desks are in the room.
const observation = createObservation({ data: data.observation, dom, toast });

room.screens.board?.set(lesson.current(state).board);
room.screens.objective?.set(period.lessonData.objectiveBoard);

const projector = new THREE.Vector3();

function flashCFU() {
  dom.cfu.classList.remove('on');
  void dom.cfu.offsetWidth;
  dom.cfu.classList.add('on');
  audio.chime();
}

// T7: the rubric panel is visible from the Admin Proximity Alert through the
// end of the window, so you can see what it wants before she's even in the
// room, and it goes away the moment she's done writing.
function drawObservationHUD(state) {
  const show = state.obsPhase === 'alert' || state.obsPhase === 'active';
  dom.observation.classList.toggle('hide', !show);
  if (!show) return;
  for (const row of dom.observation.querySelectorAll('.obsrow')) {
    row.classList.toggle('got', !!state.obsSatisfied[row.dataset.key]);
  }
}

function handleTellClick(t) {
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

addEventListener('keydown', e => { if (e.code === 'Escape') { closeMenu(); state.openTell = null; } });
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
    if (action === 'roomTemp') { temp.read(state); continue; }
    if (state.openTell) continue;              // one thing at a time
    if (action === 'advance') lesson.advance(state);
    else if (action === 'check') { if (lesson.check(state).ok) observation.satisfy(state, 'check'); }
    else if (action === 'reteach') lesson.reteach(state);
    else if (action === 'postObjective') observation.satisfy(state, 'objective');
    else if (action === 'askQuestion') observation.satisfy(state, 'question');
    else if (action === 'discourse') observation.satisfy(state, 'discourse');
  }

  withitness.tick(state, dt);
  const liveTells = tellSystem.tells.filter(t => t.born !== null && !t.dead && !t.resolved).length;
  tickMeters(state, dt, teaching, liveTells);
  lesson.tick(state, dt, { teaching });
  observation.tick(state, dt);
  observation.tickWait(state, dt, input.wantsWait());
  drawObservationHUD(state);

  if (state.hyper > CFG.hyperThreshold && !state.falseSpawned && state.t > 420) {
    state.falseSpawned = true;
    tellSystem.spawnFalsePositive(state);
    toast('bad', 'New indicator', 'Confidence: HIGH.');
  }

  events.tick(state);
  tellSystem.update(state, onExpire);
  reactions.tick(dt, {
    auraFor: state.withitness ? (s => lesson.auraOf(s, state)) : null
  });
  audio.setMurmur(state.restless / 100, state.withitness);

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

  // What this period taught you about the room. Next chart knows it; nothing
  // about it was labelled in advance. A new roster next period gets none of
  // this — it is genuinely about these kids, not the desks (T6).
  const learned = learnFrom({ tells: tellSystem.tells, plan, known, rules: data.seating.rules });
  known = learned.known;
  persist.save(knownKey, known);

  // T6: each period hands off into the next; the last period's own report just
  // restarts the day at the top, which is what "Run it again" always meant.
  // Phase 1: which period that is, and what the button says, are both rows in
  // data/periods.json now rather than string literals in here.
  const next = period.nextPeriodId;
  const restart = next ? {
    label: period.nextLabel,
    onClick: () => {
      // The room's desks carry forward as a fact about the room. Whether
      // moving further from them costs Rapport is a fact about the kids, and
      // the next class has never met this chart, so that resets to novel.
      persist.save(persist.slot(next, 'chart'), chart.seatOf);
      persist.save(persist.slot(next, 'rapportBase'), null);
      persist.clear(persist.slot(next, 'known'));
      // Phase 1: and Bandwidth goes with you, minus everything this period
      // cost, plus whatever four minutes in the hallway are worth.
      persist.save(persist.dayKey('bandwidth'),
        clamp01to100(state.bandwidth + CFG.day.passingPeriodRecovery));
      persist.save('period', next);
      location.reload();
    }
  } : {
    label: period.restartLabel,
    onClick: () => {
      // A new day, which is the only thing that gives Bandwidth back in full.
      persist.clear(persist.dayKey('bandwidth'));
      persist.save('period', firstPeriodId(data));
      location.reload();
    }
  };

  function report() {
    showReport(state, data.events, {
      lesson: lesson.summary(state), students,
      seating: { plan, copy: data.seating.report, chart, learned },
      periodTag: period.periodTag,
      // Phase 2: a class nobody authored says which number made it.
      seed: period.generated ? { value: period.generated.seed, copy: data.periods.copy.seed } : null,
      observation: state.obsResult ? {
        result: state.obsResult,
        labels: observation.lookFors.filter(l => state.obsSatisfied[l.key]).map(l => l.label),
        option: observation.conferenceOption(state.obsConference),
        copy: observation.report
      } : null,
      restart
    });
  }

  // T7: if she came today, the post-conference happens before the report —
  // the day is not over until you've answered her, one way or another.
  if (state.obsPhase === 'done') {
    showConference(observation.conference, key => {
      observation.resolveConference(state, key);
      report();
    });
  } else {
    report();
  }
}

// ---------- the seating chart, then the bell ----------
const seating = createSeatingScreen({
  copy: period.seatingCopy,
  onSwap: (a, b) => { chart.swapDesks(a, b); redrawChart(); },
  onReset: () => { chart.reset(); redrawChart(); },
  // T5: dragging furniture reclassifies sight live; the drag path in
  // ui/seating.js patches in place rather than re-rendering, so this hands
  // back a fresh view model rather than calling redrawChart() itself.
  onMoveOccluder: (id, x, z) => (chart.moveOccluder(id, x, z) ? chart.viewModel(known) : null),
  onConfirm: () => beginPeriod()
});

function redrawChart() {
  seating.update(chart.viewModel(known), { cost: chart.rechartCost(rapportBase) });
}

function beginPeriod() {
  // Everything the chart decides is decided here, once, and then the room is
  // whatever you made it.
  plan = chart.resolveSchedule(period.schedule);
  chart.apply(students, plan);
  placeStudents(students, chart, period.seatGrid.bodyOffsetZ);
  tellSystem.load(plan.rows);

  const cost = chart.rechartCost(rapportBase);
  state.rechart = cost;
  if (cost.rapport) state.rapport += cost.rapport;
  // Phase 1, gap 11: the period you are in is written when you take it, not
  // only when a report hands you on. Refresh mid-6th and you are still in 6th.
  persist.save('period', period.id);
  persist.save(chartKey, chart.seatOf);
  persist.save(rapportKey, chart.seatOf);
  persist.save('furniture', chart.occluderLayout());

  seating.close();
  audio.init();
  state.running = true;
  last = performance.now();
}

// Phase 2: the seed, on the start screen, for a generated period only. Type a
// different one in and the page reloads into that class.
if (period.generated) {
  const copy = data.periods.copy.seed;
  dom.seedLabel.textContent = copy.label;
  dom.seedBtn.textContent = copy.use;
  dom.seedHint.textContent = copy.hint;
  dom.seedInput.value = String(period.generated.seed);
  dom.seedRow.classList.remove('hide');
  dom.seedBtn.addEventListener('click', () => {
    const typed = parseInt(dom.seedInput.value, 10);
    if (!(Number.isInteger(typed) && typed > 0 && typed <= SEED_MAX)) {
      dom.seedInput.value = String(period.generated.seed);
      return;
    }
    if (typed === period.generated.seed) return;
    persist.save(seedKey, typed);
    location.reload();
  });
}

dom.startBtn.textContent = 'Seating chart';
dom.startBtn.disabled = false;
dom.startBtn.addEventListener('click', () => {
  dom.startScreen.classList.add('hide');
  seating.open(chart.viewModel(known), { cost: chart.rechartCost(rapportBase) });
});

drawHUD(state, true, temp.display(state), lesson.summary(state));
requestAnimationFrame(frame);

} catch (err) {
  showFatalError(err);
}
