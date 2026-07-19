// Aphelion — a quiet life, far from anywhere.
// Entry point: wires the scene, simulation, and interactions together.

import * as THREE from 'three';
import { state, initSystems, save, load } from './state.js';
import { buildWorld, updatePlantMesh, addCurioMesh } from './ship.js';
import { PlayerControls } from './controls.js';
import * as UI from './ui.js';
import { initAudio, sfx, setHumLevel } from './audio.js';

const MINUTES_PER_SECOND = 2;          // 1 real second = 2 in-game minutes
const app = document.getElementById('app');

// ---------- Load data ----------
const [roomsData, systemsData, logData, poiData] = await Promise.all(
  ['rooms', 'systems', 'logs', 'poi'].map(n => fetch(`./data/${n}.json`).then(r => r.json()))
);
const systemDefs = systemsData.systems;

// ---------- Renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 400);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const refs = buildWorld(scene, roomsData, systemDefs, poiData);
const controls = new PlayerControls(camera, renderer.domElement, roomsData);
controls.enabled = false;

// ---------- State ----------
const hadSave = load();
initSystems(systemDefs);
updatePlantMesh(refs, state.plant.stage, state.plant.water < 25);
state.curios.forEach((_, i) => addCurioMesh(refs, i));
unlockLogsForDay(false);
UI.renderLogbook(logData);
UI.updateHUD();

const lowWarned = {};            // systemId -> warned this dip
let activeRepair = null;         // { id, step }
let scanning = null;             // { id, t }
let busy = false;                // transition lock

// ---------- Title / start ----------
let started = false;
UI.onTitleClick(async () => {
  started = true;
  initAudio();
  UI.hideTitle();
  controls.enabled = true;
  renderer.domElement.requestPointerLock();
  await UI.fade(false, 2);
  setTimeout(() => {
    UI.toast(hadSave
      ? `Welcome back. Day ${state.day}, all decks accounted for. The plants noticed you were gone; I told them you'd say hello.`
      : `Morning. I'm CERES — ship interface, weather report, and second opinion. Systems are stable. The day is yours.`);
  }, 1200);
});

// ---------- Interaction ----------
const raycaster = new THREE.Raycaster();
raycaster.far = 2.6;

const EVA_TYPES = new Set(['poi', 'airlock-outer']);

function pickInteractable() {
  if (UI.isLogbookOpen()) return null;
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  const eva = state.mode === 'eva';
  raycaster.far = eva ? 6 : 2.6;
  const eligible = refs.interactables.filter(i => EVA_TYPES.has(i.type) === eva);
  const hits = raycaster.intersectObjects(eligible.map(i => i.mesh), false);
  if (!hits.length) return null;
  return eligible.find(i => i.mesh === hits[0].object) || null;
}

function promptFor(it) {
  const E = `<span class="key">[E]</span>`;
  switch (it.type) {
    case 'system': {
      const def = systemDefs.find(s => s.id === it.id);
      if (activeRepair && activeRepair.id === it.id)
        return `${E} ${def.steps[activeRepair.step]} (${activeRepair.step + 1}/${def.steps.length})`;
      const v = Math.round(state.systems[it.id]);
      return `${E} Service ${def.name} — ${v}%`;
    }
    case 'plant': {
      if (state.plant.stage >= 3) return `${E} Harvest the crop`;
      return `${E} Water the tray — ${Math.round(state.plant.water)}%`;
    }
    case 'bed': return `${E} Sleep — end Day ${state.day}`;
    case 'airlock-inner': return `${E} Cycle airlock — go outside`;
    case 'airlock-outer': return `${E} Cycle airlock — head back in`;
    case 'poi': {
      const poi = poiData.pois.find(p => p.id === it.id);
      if (state.scannedPois.includes(it.id)) return `${poi.name} — already logged`;
      if (scanning && scanning.id === it.id) return `Scanning… hold steady`;
      return `${E} Scan: ${poi.name}`;
    }
  }
  return null;
}

async function interact(it) {
  if (busy) return;
  switch (it.type) {
    case 'system': {
      const def = systemDefs.find(s => s.id === it.id);
      if (!activeRepair || activeRepair.id !== it.id) {
        activeRepair = { id: it.id, step: 0 };
        sfx.click();
      } else {
        activeRepair.step++;
        if (activeRepair.step >= def.steps.length) {
          state.systems[it.id] = 100;
          activeRepair = null;
          lowWarned[it.id] = false;
          state.repairStreak++;
          sfx.done();
          UI.toast(def.doneMsg);
          if (state.repairStreak === 5)
            UI.toast(`Five repairs without a hitch. Somewhere, a maintenance manual is quietly proud of you.`);
          save();
        } else sfx.step();
      }
      break;
    }
    case 'plant': {
      if (state.plant.stage >= 3) {
        state.plant.stage = 0;
        state.plant.harvests++;
        state.plant.water = 90;
        updatePlantMesh(refs, 0, false);
        sfx.done();
        UI.toast(`Harvest logged. Fresh produce in the galley tonight — the good kind of ship smell.`);
        save();
      } else {
        state.plant.water = 100;
        sfx.water();
      }
      break;
    }
    case 'bed': await sleep(); break;
    case 'airlock-inner': await setEVA(true); break;
    case 'airlock-outer': await setEVA(false); break;
    case 'poi': {
      if (!state.scannedPois.includes(it.id) && !scanning) {
        const poi = poiData.pois.find(p => p.id === it.id);
        scanning = { id: it.id, t: poi.scanTime };
        sfx.scan();
      }
      break;
    }
  }
}

document.addEventListener('keydown', async (e) => {
  if (e.code === 'Tab') {
    e.preventDefault();
    if (!started || busy) return;
    const open = UI.toggleLogbook();
    controls.enabled = !open && !busy;
    if (open) { UI.renderLogbook(logData); document.exitPointerLock(); }
    else renderer.domElement.requestPointerLock();
  }
  if (e.code === 'KeyE' && controls.enabled) {
    const it = pickInteractable();
    if (it) interact(it);
  }
});

// ---------- EVA ----------
async function setEVA(on) {
  busy = true; controls.enabled = false;
  sfx.airlock();
  await UI.fade(true, 1.1);
  state.mode = on ? 'eva' : 'interior';
  controls.setEVA(on);
  if (on) {
    controls.pos.set(0, 1.5, 13);
    controls.yaw = Math.PI;
    UI.toast(`Tether's notional, oxygen's real, and both are fine. Drift gently — the view isn't going anywhere.`);
  } else {
    controls.pos.set(0, 1.6, 8);
    controls.yaw = Math.PI;
    UI.toast(`Pressure equalized. Welcome back inside — I kept the lights on.`);
    save();
  }
  await UI.fade(false, 1.1);
  controls.enabled = true; busy = false;
}

// ---------- Sleep / day cycle ----------
async function sleep() {
  busy = true; controls.enabled = false;
  await UI.fade(true, 1.6);
  state.day++;
  state.hour = 8;
  state.scannedPois = [];
  // plant growth overnight
  if (state.plant.stage < 3 && state.plant.water > 30) {
    state.plant.stage++;
    updatePlantMesh(refs, state.plant.stage, false);
  }
  state.plant.water = Math.max(10, state.plant.water - 35);
  unlockLogsForDay(true);
  UI.renderLogbook(logData);
  save();
  UI.updateHUD();
  await new Promise(r => setTimeout(r, 600));
  await UI.fade(false, 1.6);
  UI.toast(`Day ${state.day}. Systems held steady overnight. The stars, as ever, did not move an inch.`);
  controls.enabled = true; busy = false;
}

function unlockLogsForDay(announce) {
  for (const e of logData.entries) {
    if (state.day >= e.unlockDay && !state.unlockedLogs.includes(e.id)) {
      state.unlockedLogs.push(e.id);
      if (announce) UI.toast(`A new page settles into the logbook. <i>${e.title}</i> — TAB to read.`, 'SHIP');
    }
  }
}

// ---------- Simulation loop ----------
const clock = new THREE.Clock();
let hudTimer = 0, saveTimer = 0;

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.1);
  controls.update(dt);

  // time
  if (!busy) state.hour += (dt * MINUTES_PER_SECOND) / 60;
  if (state.hour >= 24) state.hour -= 24;

  // system drift
  const gameHours = (dt * MINUTES_PER_SECOND) / 60;
  let comfort = 0;
  for (const def of systemDefs) {
    const v = state.systems[def.id] = Math.max(15, state.systems[def.id] - def.decayPerHour * gameHours);
    comfort += v;
    if (v < 55 && !lowWarned[def.id]) {
      lowWarned[def.id] = true;
      sfx.chime();
      UI.toast(def.lowMsg);
    }
    // panel glow reflects health
    const p = refs.panels[def.id];
    if (p) p.mat.emissiveIntensity = 0.06 + (v / 100) * 0.22;
  }
  comfort /= systemDefs.length * 100;
  setHumLevel(comfort);

  // lighting responds to power — dimmer, cozier-but-dinger when neglected
  const powerFrac = state.systems.power / 100;
  for (const id in refs.roomLights)
    refs.roomLights[id].intensity = 4 + 8 * (0.35 + 0.65 * powerFrac);
  refs.growLight.intensity = 1 + 1.5 * powerFrac;

  // plant water decay + wilt check
  state.plant.water = Math.max(0, state.plant.water - 1.4 * gameHours);
  const wilted = state.plant.water < 25;
  if (wilted !== tick._wilt) { tick._wilt = wilted; updatePlantMesh(refs, state.plant.stage, wilted); }

  // POI scan progress
  if (scanning) {
    const it = pickInteractable();
    if (it && it.type === 'poi' && it.id === scanning.id) {
      scanning.t -= dt;
      if (scanning.t <= 0) {
        const poi = poiData.pois.find(p => p.id === scanning.id);
        state.scannedPois.push(poi.id);
        state.parts += poi.yields.parts;
        if (!state.curios.includes(poi.yields.curio)) {
          state.curios.push(poi.yields.curio);
          addCurioMesh(refs, state.curios.length - 1);
        }
        if (poi.discoveryId && !state.unlockedDiscoveries.includes(poi.discoveryId)) {
          state.unlockedDiscoveries.push(poi.discoveryId);
          UI.renderLogbook(logData);
        }
        sfx.done();
        UI.toast(poi.ceresMsg);
        scanning = null;
        save();
      }
    } else scanning = null; // looked away — no penalty, just start over
  }

  // slow POI tumble
  for (const id in refs.pois) refs.pois[id].group.rotation.y += dt * 0.05;

  // prompt + HUD refresh (throttled)
  hudTimer += dt;
  if (hudTimer > 0.2) {
    hudTimer = 0;
    const it = controls.enabled ? pickInteractable() : null;
    if (!it && activeRepair) activeRepair = null; // walked away mid-repair — fine, no harm
    UI.setPrompt(it ? promptFor(it) : null);
    UI.updateHUD();
  }

  // autosave every 30s
  saveTimer += dt;
  if (saveTimer > 30) { saveTimer = 0; save(); }

  renderer.render(scene, camera);
}
tick();
