// main.js — boot, phase machine, HUD.
// DAY: walk the empty room, manage at the glowing stations, open the doors.
// NIGHT: the floor — patrons, tickets, your crew, and you.
// REPORT: box score, settle the books, tomorrow's ledger.

import * as THREE from "three";
import { NightEngine, hourName } from "./engine.js";
import { buildWorld, drawBroadcast, PASS_FOOD_SHELF, PASS_DRINK_SHELF, seats, KITCHEN } from "./world.js";
import { Patron, Server, itemMesh, personMesh } from "./patrons.js";
import { Player } from "./player.js";
import { DayPhase } from "./day.js";
import { DevPanel } from "./dev.js";
import * as C from "./campaign.js";
import * as audio from "./audio.js";
import { mountSaveBar } from "../../../assets/js/gvb-save.js";

const $ = s => document.querySelector(s);

// ---- renderer / scene ----
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const NIGHT_BG = new THREE.Color(0x0b0805), DAY_BG = new THREE.Color(0x232a33);
scene.background = DAY_BG.clone();
scene.fog = new THREE.Fog(0x0b0805, 12, 26);
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 60);
scene.add(camera);

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---- world, campaign, phases ----
// The slot is the shared save system (assets/js/gvb-save.js). It owns the
// storage probe, so nothing here touches localStorage directly — see
// campaign.js's campaignSlot().
const slot = C.campaignSlot();
let campaign = slot.load() || C.newCampaign();
const save = () => slot.save(campaign);

let { group: worldGroup, tvs, nightRig, dayRig } = buildWorld(scene, campaign.venue);

let phase = "day"; // day | night | report
let engine = null, patrons = [], patronsById = new Map(), servers = [], cookMeshes = [], passDisplays = new Map();
let broadcast = null, started = false, speed = 1;

const player = new Player(camera, renderer.domElement, null);
player.onInteract = () => {
  if (phase === "day") day.interact(player.pos);
  else if (phase === "night") {
    const r = player.tryInteract(scene, patronsById);
    if (r && r.msg) flash(r.msg, r.good);
  }
};

// mountBar is a hoisted function declaration further down the file; DayPhase only
// calls it when the Tonight panel renders, long after both exist.
const day = new DayPhase(scene, () => campaign, { save, openDoors: beginNight, flash, onMove: rebuildVenue, closedNight, mountBar });

function setLighting(night) {
  nightRig.visible = night; dayRig.visible = !night;
  scene.background.copy(night ? NIGHT_BG : DAY_BG);
}

/** Tear down the current room and build the new venue's — called right after
 *  a successful moveVenue(). Only ever fires during the day phase (moves
 *  happen at the Real Estate desk), so there's no active night sim/patrons
 *  to clean up here. */
function rebuildVenue() {
  scene.remove(worldGroup);
  const built = buildWorld(scene, campaign.venue);
  worldGroup = built.group; tvs = built.tvs; nightRig = built.nightRig; dayRig = built.dayRig;
  setLighting(false); // still day phase right after a move
  day.rebuildStations();
  camera.position.set(0, 1.62, 3.4);
}

/** A closed "moving in" night: bills land, no patrons, day counter advances.
 *  Stays in the day phase throughout — there's no night sim to run. */
function closedNight() {
  const books = C.settleDarkNight(campaign);
  save();
  const billed = Math.round(books.wages + books.rent + books.upgFees);
  tick(`Closed for the move. −$${billed} in bills, doors stay shut tonight.`, "b");
  if (campaign.darkNightsLeft === 0) tick(`Ready to open at ${C.venueDef(campaign).name} tomorrow.`, "hl");
  updateHUD();
}

function enterDay() {
  phase = "day";
  audio.stopLoop("barBed", 1.2);
  setLighting(false);
  day.setVisible(true);
  camera.position.set(0, 1.62, 3.4);
  player.clearCarry();
  broadcast = { gameNight: false, started: false, finished: false, flicker: 0, tick: 0, mules: 0, sharks: 0, clockText: "" };
  $("#boxOverlay").style.display = "none";
  $("#ticker").innerHTML = "";
  tick(`Day ${campaign.day}, ${C.weekday(campaign)}. Quiet room, full to-do list.`, "hl");
  tick(C.isGameNight(campaign)
    ? "Mules game tonight — stock the beer and staff up."
    : "No game tonight. A theme can still fill some stools.", "");
  updateHUD();
}

function beginNight() {
  phase = "night";
  setLighting(true);
  day.setVisible(false);
  engine = new NightEngine({
    crowdTarget: C.forecast(campaign),
    gameNight: C.isGameNight(campaign),
    hourLenSec: 45,
    // The physical room's own seat count, not the venue tier's — world.js builds
    // the same 30-stool-and-table room at every tier (see world.js's buildWorld()
    // and campaign.js's VENUES comment), so this is the one true cap. Reading it
    // straight from `seats` (imported from world.js, already used below to reset
    // occupancy) means the engine's arrival gate can never drift from the room a
    // player can actually see.
    seats: seats.length,
    stock: campaign.stock,        // shared — the night eats the shelves
    promo: C.promoDef(campaign).id,
    foodMult: C.roleMult(campaign, "cook"),
    drinkMult: C.roleMult(campaign, "bartender"),
    beerMult: C.beerMult(campaign),
  });
  player.engine = engine;
  seats.forEach(s => (s.taken = false));
  patrons = []; patronsById = new Map();
  const spread = [0.4, -3.4, 2.6];
  const floorStaff = campaign.staff.filter(s => s.role !== "cook");
  servers = floorStaff.map((s, i) => new Server(scene, engine, s.name.split(" ")[0], spread[i % 3], s.speed * C.speedMult(campaign, s.role), s.role));
  cookMeshes = campaign.staff.filter(s => s.role === "cook").map((s, i) => {
    const m = personMesh(0x8a6a42, true);
    m.position.set((KITCHEN.x0 + KITCHEN.x1) / 2 - 0.6 + i * 0.5, 0, KITCHEN.z0 + 1.3);
    m.rotation.y = Math.PI;
    scene.add(m);
    return m;
  });
  if (!C.hasCook(campaign)) tick("No cook on shift — the kitchen's closed tonight.", "b");
  if (!C.hasBartender(campaign)) tick("No bartender — servers are covering the taps, badly.", "b");
  // Warm these five now, at the top of the night, rather than the first time
  // playSfx()/startLoop() builds their Audio element mid-event — the storm-out
  // clip in particular used to start fetching the moment a patron first gave up,
  // and be asked to play before it had buffered.
  audio.preload("stormOut", "stingerKickoff", "stingerFinal", "sizzle", "pour");
  passDisplays = new Map();
  broadcast = { gameNight: engine.gameNight, started: false, finished: false, win: null, mules: 0, sharks: 0, clockText: "Q1 15:00", flicker: 0, tick: 0 };
  $("#ticker").innerHTML = "";
  tick(`Doors open. ${engine.gameNight ? "Mules game tonight — kickoff 7 PM." : "No game — just the regulars and the jukebox."}`, "hl");
  const pd = C.promoDef(campaign);
  if (pd.id !== "none") tick(`Tonight's theme: ${pd.name}.`, "hl");
  audio.startLoop("barBed", 0.35);
  save();
  renderer.domElement.requestPointerLock(); // still inside the click gesture — no extra click needed
}

// ---- HUD ----
function flash(msg, good) {
  const el = $("#prompt-flash");
  el.textContent = msg;
  el.className = good ? "good" : "";
  el.style.opacity = 1;
  clearTimeout(flash.t);
  flash.t = setTimeout(() => (el.style.opacity = 0), 2200);
}
function tick(txt, cls) {
  const el = $("#ticker");
  const d = document.createElement("div");
  const stamp = phase === "night" && engine ? hourName(Math.min(7, engine.hour)) : "DAY";
  d.innerHTML = `<span class="t">[${stamp}]</span><span class="${cls || ""}">${txt}</span>`;
  el.appendChild(d);
  while (el.children.length > 7) el.removeChild(el.firstChild);
}

function updateHUD() {
  $("#hDay").textContent = `Day ${campaign.day} · ${C.weekday(campaign)}`;
  $("#hCash").textContent = "$" + Math.round(campaign.cash + (phase === "night" && engine ? engine.revenue + engine.tips : 0));
  $("#hCash").classList.toggle("hurt", campaign.cash < 0);
  if (phase === "night" && engine) {
    $("#hHour").textContent = engine.done ? "CLOSE" : hourName(Math.min(7, engine.hour));
    $("#hCrowd").textContent = engine.inBar;
    const pct = Math.round(engine.mood * 100);
    $("#hMoodFill").style.width = pct + "%";
    $("#hMoodFill").style.background = pct >= 60 ? "var(--green)" : pct >= 40 ? "var(--amber)" : "var(--red)";
    $("#hMood").textContent = pct >= 80 ? "Electric" : pct >= 60 ? "Good" : pct >= 40 ? "Restless" : "Ugly";
    $("#prompt").textContent = day.panelOpen() ? "" : player.promptText(patronsById);
  } else {
    $("#hHour").textContent = "DAY";
    $("#hCrowd").textContent = "—";
    $("#hMoodFill").style.width = "0%";
    $("#hMood").textContent = "—";
    $("#prompt").textContent = (phase === "report" || day.panelOpen()) ? "" : day.prompt(player.pos);
  }
}

// ---- broadcast score theater (visual only; engine decides the winner) ----
function updateBroadcast(dt) {
  broadcast.flicker += dt * 30;
  broadcast.tick += dt;
  if (broadcast.started && !broadcast.finished && broadcast.tick > 1 && engine) {
    broadcast.tick = 0;
    const q = Math.min(4, 1 + Math.floor((engine.hour - 2) / 1.2));
    const clockMin = 15 - Math.floor(((engine.t / engine.hourLenSec) % 1.2) / 1.2 * 15);
    broadcast.clockText = `Q${q} ${String(Math.max(0, clockMin)).padStart(2, "0")}:${String(Math.floor(Math.random() * 60)).padStart(2, "0")}`;
    if (Math.random() < 0.06) {
      const pts = Math.random() < 0.55 ? 7 : 3;
      if (Math.random() < 0.5) broadcast.mules += pts; else broadcast.sharks += pts;
    }
  }
  drawBroadcast(tvs, broadcast);
}
function settleScore(win) {
  if (win && broadcast.mules <= broadcast.sharks) broadcast.mules = broadcast.sharks + (Math.random() < 0.5 ? 3 : 7);
  if (!win && broadcast.sharks <= broadcast.mules) broadcast.sharks = broadcast.mules + (Math.random() < 0.5 ? 3 : 7);
}

// ---- pass counter displays ----
function syncPassDisplays() {
  for (const tk of engine.tickets) {
    if (tk.state === "ready" && !passDisplays.has(tk.id)) {
      const m = itemMesh(tk.itemId);
      const shelf = tk.kind === "food" ? PASS_FOOD_SHELF : PASS_DRINK_SHELF;
      const n = [...passDisplays.values()].filter(x => x.userData.kind === tk.kind).length;
      m.position.set(shelf.x + (n % 4) * 0.38 - 0.57, shelf.y, shelf.z);
      m.userData.kind = tk.kind;
      scene.add(m);
      passDisplays.set(tk.id, m);
    } else if (tk.state !== "ready" && passDisplays.has(tk.id)) {
      scene.remove(passDisplays.get(tk.id));
      passDisplays.delete(tk.id);
    }
  }
}

// ---- night events from the engine ----
function handleEvents(evts) {
  for (const e of evts) {
    switch (e.type) {
      case "log": tick(e.txt, e.cls); break;
      case "spawn": {
        const p = new Patron(scene, engine, e.mulesFan);
        patrons.push(p); patronsById.set(p.id, p);
        break;
      }
      case "ready": audio.playSfx("ticketReady"); break;
      case "kickoff": broadcast.started = true; audio.playSfx("stingerKickoff"); break;
      case "final": {
        broadcast.finished = true; broadcast.win = e.win;
        settleScore(e.win);
        audio.playSfx("stingerFinal");
        // no crowd-cheer asset yet (see audio.js TODO) — a win only gets the
        // whistle sting; a loss additionally gets the groan
        if (!e.win) audio.playSfx("crowdGroan");
        if (e.win) for (const p of patrons) if (p.state !== "gone" && p.mulesFan) p.cheer = 2.5;
        break;
      }
      case "impatient": {
        const p = patronsById.get(e.ticket.patronId);
        if (p && p.state === "waiting") {
          p.stormOut(); // plays its own sound — see Patron.stormOut()
          tick("A table gave up waiting and walked. That stings.", "b");
        }
        break;
      }
      case "lastCall": setTimeout(showBoxScore, 2500); break;
    }
  }
}

// ---- box score & settlement ----
function showBoxScore() {
  phase = "report";
  const s = engine.summary();
  const books = C.settleNight(campaign, s);
  save();
  const empt = patrons.filter(p => p.emptyShelves).length;
  $("#boxTitle").textContent = `Night ${campaign.day - 1} — Box Score`;
  $("#boxBody").innerHTML = `
    <div class="row"><span>Food & drink</span><span class="money">$${s.revenue}</span></div>
    <div class="row"><span>Tips</span><span class="money">$${s.tips.toFixed(2)}</span></div>
    <div class="row"><span>Wages</span><span class="bad">−$${books.wages}</span></div>
    <div class="row"><span>Rent</span><span class="bad">−$${books.rent}</span></div>
    ${books.promoCost ? `<div class="row"><span>Theme</span><span class="bad">−$${books.promoCost}</span></div>` : ""}
    ${books.upgFees ? `<div class="row"><span>Upgrade upkeep</span><span class="bad">−$${books.upgFees}</span></div>` : ""}
    <div class="row total"><span>Net</span><span class="${books.net >= 0 ? "good" : "bad"}">${books.net >= 0 ? "+" : "−"}$${Math.abs(books.net)}</span></div>
    <div class="row"><span>Cash</span><span class="${campaign.cash >= 0 ? "money" : "bad"}">$${Math.round(campaign.cash)}</span></div>
    <div class="sec">The Floor</div>
    <div class="row"><span>Orders served</span><span>${s.served}</span></div>
    <div class="row"><span>Run by the boss</span><span class="${s.bossServes ? "good" : ""}">${s.bossServes}</span></div>
    <div class="row"><span>Cooked/poured by hand</span><span class="${s.crafted ? "good" : ""}">${s.crafted}</span></div>
    <div class="row"><span>Walkouts</span><span class="${s.walkouts ? "bad" : ""}">${s.walkouts}${empt ? ` (${empt} found bare shelves)` : ""}</span></div>
    <div class="row"><span>Service rate</span><span class="${s.serviceRate >= 90 ? "good" : s.serviceRate >= 70 ? "warn" : "bad"}">${s.serviceRate}%</span></div>
    ${engine.gameNight ? `<div class="sec">The Game</div>
    <div class="row"><span>Final</span><span class="${s.game.win ? "good" : "bad"}">${s.game.win ? "Mules win — the room erupted" : "Mules dropped it"}</span></div>` : ""}`;
  $("#boxOverlay").style.display = "flex";
  document.exitPointerLock();
}
$("#nextDayBtn").addEventListener("click", () => {
  audio.playSfx("uiClick");
  teardownNightMeshes();
  enterDay();
});

/** Clear out patron/server/cook meshes and null the night engine — shared by
 *  the normal Tomorrow's Ledger flow and a dev-menu reset triggered mid-night. */
function teardownNightMeshes() {
  for (const p of patrons) if (p.state !== "gone") scene.remove(p.mesh);
  for (const sv of servers) { sv.dropCarry(); scene.remove(sv.mesh); }
  for (const m of cookMeshes) scene.remove(m);
  for (const m of passDisplays.values()) scene.remove(m);
  patrons = []; servers = []; cookMeshes = []; passDisplays = new Map();
  engine = null; player.engine = null;
}

/** Swap in a different set of books — a wipe, or a save imported from a file.
 *  Either can arrive from any venue tier and any day, so the room gets rebuilt
 *  and the day restarted rather than assuming a Day 1 Corner Tap. */
function adoptCampaign(c) {
  teardownNightMeshes();
  campaign = c;
  save();
  rebuildVenue();
  refreshStartTag();
  enterDay();
}

/** Full wipe — shared by the start-screen wipe button and the dev menu's reset. */
function resetProgress() {
  adoptCampaign(slot.reset());
  flash("Fresh books. Day 1.", true);
}

const dev = new DevPanel(() => campaign, {
  save, flash, rebuild: rebuildVenue, resetProgress,
  /**
   * Dev only: shove the sim clock to last call.
   *
   * A night is eight sim hours at 45 real seconds each — six minutes at 1×, and
   * the speed buttons can't be clicked while pointer lock owns the mouse. That
   * made the box score the most expensive screen in the game to look at, which is
   * a bad property for the screen that now hosts a save bar. This runs the real
   * closing path rather than faking it: the next engine.update() rolls the hour
   * past 8, which fires lastCall, which schedules showBoxScore().
   */
  skipToClose: () => {
    if (phase !== "night" || !engine) return false;
    engine.t = engine.hourLenSec * 8 - 0.001;
    return true;
  },
});

// ---- speed buttons ----
document.querySelectorAll("[data-speed]").forEach(b => b.addEventListener("click", () => {
  audio.playSfx("uiClick");
  speed = +b.dataset.speed;
  document.querySelectorAll("[data-speed]").forEach(x => x.classList.toggle("on", x === b));
}));

// ---- mute toggle ----
// setMuted()/isMuted() have been exported from audio.js with no caller since they
// were added; this is the whole job, in the one control cluster that's visible in
// every phase of the game.
function syncMuteBtn() {
  const b = $("#muteBtn");
  b.textContent = audio.isMuted() ? "🔇" : "🔊";
  b.classList.toggle("on", audio.isMuted());
  b.title = audio.isMuted() ? "Unmute" : "Mute";
}
$("#muteBtn").addEventListener("click", () => {
  audio.setMuted(!audio.isMuted());
  audio.playSfx("uiClick"); // silent while muting, audible confirmation on unmute
  syncMuteBtn();
});
syncMuteBtn();

// ---- start overlay ----
/** The line under the title. Two fixes over the version that shipped:
 *
 *  It reads the venue off the campaign rather than naming the Corner Tap, since
 *  an imported save — or any campaign past its first move — can open at any tier.
 *
 *  And it treats any day past the first as a campaign in progress. Keying that
 *  off `stats.nights` alone was wrong: `settleDarkNight()` advances the day for
 *  each closed night of a venue move without counting a night played, so a player
 *  who moved to the Fieldhouse on day one came back to "Day 1 at The Fieldhouse"
 *  on day two. */
function refreshStartTag() {
  const where = C.venueDef(campaign).name;
  const inProgress = campaign.day > 1 || campaign.stats.nights > 0;
  $("#startTag").textContent = inProgress
    ? `Day ${campaign.day} at ${where} — the books remember.`
    : `Day 1 at ${where}`;
}
refreshStartTag();

/**
 * The shared save bar, mounted the same way everywhere it appears.
 *
 * Three places: the start overlay, the box score, and the Tonight panel's footer.
 * One function rather than three call sites because the thing that would go wrong
 * is drift — the same button doing slightly different work depending on which
 * screen you found it on. Every mount gets the same two buttons and the same
 * setState, so there is one export affordance in this game, shown in three places.
 *
 * "Start over" is left off all three. #wipeBtn on the start screen already erases
 * a campaign, and the other two mounts are screens the player passes through every
 * single night — a campaign-eraser on the box score is a footgun you'd walk past
 * a hundred times a playthrough. The dev menu's "Reset all progress" covers the
 * developer case.
 */
function mountBar(container) {
  return mountSaveBar(container, slot, {
    buttons: ["export", "import"],
    getState: () => campaign,
    setState: c => {
      // An import can arrive while the Tonight panel is open, and that panel's
      // rows describe the campaign that just got replaced. adoptCampaign() puts
      // the player back in the day phase, so leaving a stale panel on top of it
      // is the one way this lands wrong.
      if (day.panelOpen()) day.closePanel();
      adoptCampaign(c);
      tick(`Save loaded — day ${campaign.day} at ${C.venueDef(campaign).name}.`, "hl");
    },
  });
}
mountBar($("#saveBar"));
mountBar($("#boxSaveBar"));

$("#startBtn").addEventListener("click", () => {
  audio.playSfx("uiClick");
  $("#startOverlay").style.display = "none";
  started = true;
  renderer.domElement.requestPointerLock();
});
$("#wipeBtn").addEventListener("click", () => {
  audio.playSfx("uiClick");
  resetProgress();
});

// ---- loop ----
enterDay();
let last = performance.now();
let hudT = 0;
renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (started) {
    if (phase === "night" && engine) {
      const simDt = dt * speed;
      handleEvents(engine.update(simDt));
      for (const p of patrons) if (p.state !== "gone") p.update(simDt);
      for (const sv of servers) sv.update(simDt, patronsById);
      syncPassDisplays();
    } else if (phase === "day") {
      day.update(dt);
    }
    if (!day.panelOpen() && !dev.isOpen()) player.update(dt);
    hudT += dt;
    if (hudT > 0.12) { hudT = 0; updateHUD(); updateBroadcast(0.12 * (phase === "night" ? speed : 1)); }
  }
  renderer.render(scene, camera);
});
