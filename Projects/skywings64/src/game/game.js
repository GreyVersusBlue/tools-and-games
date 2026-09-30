// Game state machine: TITLE -> SELECT -> BRIEFING -> COUNTDOWN -> FLIGHT (<-> PAUSED) -> ENDING -> RESULTS
import * as THREE from 'three';
import { MISSIONS, getPad } from './missions.js';
import { scoreRun, saveBest, loadBests, livePoints, fmtTime } from './scoring.js';
import { VEHICLE_INFO, titleHTML, selectHTML, briefingHTML, pauseHTML, resultsHTML } from './ui.js';
import { lockedSet, isUnlocked, newlyUnlocked, requirementText } from './progress.js';
import { FlightHints } from './hints.js';
import { FlightRecorder, ReplayDirector } from './replay.js';
import { TouchControls } from '../core/touch.js';

const V3 = THREE.Vector3;
const KEYMAP = {
  Enter: 'confirm', Space: 'confirm', Escape: 'back', Backspace: 'back', KeyP: 'back',
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
  KeyA: 'left', KeyD: 'right', KeyW: 'up', KeyS: 'down', KeyR: 'retry', KeyM: 'menu', KeyQ: 'menu',
};
const _f = new V3();
function headingOf(v) {
  _f.set(0, 0, -1).applyQuaternion(v.mesh.quaternion);
  return Math.atan2(_f.x, -_f.z);
}

export class Game {
  constructor(ctx) {
    Object.assign(this, ctx); // renderer, scene, camera, world, input, chase, hud, audio, particles, effects, VEHICLES, uiRoot
    this.state = 'TITLE';
    this.elapsed = 0;
    this.sel = 0;
    this.mission = MISSIONS[0];
    this.vehicleKey = 'hangGlider';
    this.sandboxVehicle = 'hangGlider';
    this.vehicles = {};
    this.vehicle = null;
    this.course = null;
    this.flightTime = 0;
    this.stateT = 0;
    this.hasFlown = false;
    this.outcome = null;
    this.endTimer = 0;
    this.landingInfo = null;
    this.ignorePauseUntil = 0;
    this.evCool = {};
    this.padPrev = {};
    this.resultAnim = null;
    this.minimapReady = false;
    this.lastCount = -1;
    this.lastTitleKey = '';
    this.hints = new FlightHints();
    this.recorder = new FlightRecorder();
    this.replay = null;
    try { this.touch = new TouchControls(this.input); } catch (e) { this.touch = null; }

    this.uiRoot.addEventListener('click', (e) => {
      const t = e.target.closest && e.target.closest('[data-act]');
      if (!t) return;
      this.resumeAudio();
      const act = t.getAttribute('data-act');
      if (act === 'card') { this.sel = +t.getAttribute('data-i'); this.act('confirm'); }
      else if (act === 'veh') this.setSandboxVehicle(t.getAttribute('data-v'));
      else this.act(act);
    });
    this.uiRoot.addEventListener('mouseover', (e) => {
      const t = e.target.closest && e.target.closest('[data-act="card"]');
      if (t && this.state === 'SELECT') {
        const i = +t.getAttribute('data-i');
        if (i !== this.sel) { this.sel = i; this.refreshSelect(); }
      }
    });
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('pointerdown', () => this.resumeAudio(), { once: false });

    this.enterTitle();
    this.installDebug();
  }

  // ------------------------------------------------------------------ test / debug hooks
  // URL: ?mission=<id|index>[&vehicle=hangGlider|gyrocopter|rocketBelt][&autostart=1] jumps straight to
  // the briefing, or (autostart) straight into flight with no countdown. window.__qa exposes:
  //   start(id, vehicle)          -> enter FLIGHT immediately
  //   sim(seconds, ctrl, {dt})    -> step the game synchronously without rendering; ctrl(input, game, dt)
  //                                  writes pitch/roll/yaw/throttle/action... each step. Returns a summary.
  //   info()                      -> current state/vehicle/course summary
  installDebug() {
    const g = this;
    const findMission = (id) => MISSIONS.find((m) => m.id === id) || MISSIONS[+id] || null;
    window.__qa = {
      MISSIONS,
      start(id, veh) {
        const m = findMission(id); if (!m) throw new Error('no mission ' + id);
        if (veh) g.sandboxVehicle = veh;
        g.sel = MISSIONS.indexOf(m);
        g.enterBriefing(m);
        g.prepare();
        g.startFlight();
        return g.info();
      },
      sim(seconds, ctrl, opts = {}) {
        const dt = opts.dt || 1 / 60;
        const inp = g.input;
        const orig = inp.update;
        let t = 0;
        inp.update = function (d) { orig.call(inp, d); if (ctrl) ctrl(inp, g, d); };
        try {
          while (t < seconds) {
            g.update(dt, g.elapsed + dt);
            t += dt;
            if (opts.until && opts.until(g)) break;
          }
        } finally { inp.update = orig; }
        return Object.assign({ simulated: +t.toFixed(2) }, g.info());
      },
      info: () => g.info(),
      game: g,
    };
    let q; try { q = new URLSearchParams(location.search); } catch (e) { return; }
    const mid = q.get('mission');
    if (!mid) return;
    const m = findMission(mid);
    if (!m) return;
    if (q.get('vehicle')) this.sandboxVehicle = q.get('vehicle');
    this.sel = MISSIONS.indexOf(m);
    if (q.get('autostart') === '1') window.__qa.start(m.id);
    else this.enterBriefing(m);
  }

  info() {
    const v = this.vehicle, c = this.course;
    const r = (x) => Math.round(x * 10) / 10;
    return {
      state: this.state, mission: this.mission && this.mission.id, vehicle: this.vehicleKey, outcome: this.outcome,
      t: r(this.flightTime),
      v: v ? { state: v.state, pos: [r(v.position.x), r(v.position.y), r(v.position.z)], speed: r(v.speed || 0), agl: r(v.altitude || 0), fuel: r(v.fuel != null ? v.fuel : 1) } : null,
      rings: c ? c.hits + '/' + c.ringsTotal : null, targets: c ? c.targetHits + '/' + c.targetsTotal : null,
      landing: this.landingInfo ? { d: r(this.landingInfo.distance), r: this.landingInfo.radius, q: this.landingInfo.quality && this.landingInfo.quality.rating } : null,
      result: this.lastResult ? { total: this.lastResult.total, medal: this.lastResult.medal, grade: this.lastResult.grade, completed: this.lastResult.completed } : null,
    };
  }

  // ------------------------------------------------------------------ helpers
  resumeAudio() { try { this.audio && this.audio.resume && this.audio.resume(); } catch (e) { /* ignore */ } }
  sfx(n, pos) { try { this.audio && this.audio.playSfx && this.audio.playSfx(n, pos ? { position: pos } : undefined); } catch (e) { /* ignore */ } }
  music(n) { try { this.audio && this.audio.startMusic && this.audio.startMusic(n); } catch (e) { /* ignore */ } }
  cool(name, secs) {
    const now = this.elapsed;
    if ((this.evCool[name] || -99) + secs > now) return false;
    this.evCool[name] = now; return true;
  }
  stopEngine() { try { this.audio && this.audio.stopEngine && this.audio.stopEngine(); } catch (e) { /* ignore */ } }
  setUI(html) { this.uiRoot.innerHTML = html || ''; }
  clearUI() { this.uiRoot.innerHTML = ''; }

  onKey(e) {
    const a = KEYMAP[e.code];
    if (!a) return;
    if (this.state === 'FLIGHT' || this.state === 'ENDING') return;
    if (e.repeat && (a === 'confirm' || a === 'back' || a === 'retry' || a === 'menu')) { e.preventDefault(); return; }
    e.preventDefault();
    this.resumeAudio();
    this.act(a);
  }

  pollPad(dt) {
    let pad = null;
    try { const ps = navigator.getGamepads ? navigator.getGamepads() : []; for (const p of ps) { if (p && p.connected) { pad = p; break; } } } catch (e) { pad = null; }
    if (!pad) return;
    const b = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed);
    const ax = pad.axes || [];
    const cur = {
      confirm: b(0) || b(9), back: b(1), up: b(12) || (ax[1] || 0) < -0.6, down: b(13) || (ax[1] || 0) > 0.6,
      left: b(14) || (ax[0] || 0) < -0.6, right: b(15) || (ax[0] || 0) > 0.6,
    };
    for (const k in cur) {
      if (cur[k] && !this.padPrev[k] && this.state !== 'FLIGHT' && this.state !== 'ENDING') {
        // Start button (9) toggles pause in flight via InputState; here it is a confirm
        this.act(k);
      }
      this.padPrev[k] = cur[k];
    }
  }

  // ------------------------------------------------------------------ menu actions
  act(a) {
    switch (this.state) {
      case 'TITLE':
        if (a === 'confirm') { this.sfx('select'); this.enterSelect(); }
        break;
      case 'SELECT': {
        const n = MISSIONS.length, cols = 4;
        if (a === 'left') { this.sel = (this.sel + n - 1) % n; this.sfx('menu'); this.refreshSelect(); }
        else if (a === 'right') { this.sel = (this.sel + 1) % n; this.sfx('menu'); this.refreshSelect(); }
        else if (a === 'up') { this.sel = this.sel - cols >= 0 ? this.sel - cols : this.sel; this.sfx('menu'); this.refreshSelect(); }
        else if (a === 'down') { this.sel = this.sel + cols < n ? this.sel + cols : this.sel; this.sfx('menu'); this.refreshSelect(); }
        else if (a === 'confirm') {
          const m = MISSIONS[this.sel];
          if (!isUnlocked(m, loadBests())) { this.sfx('stall'); this.flashMenu(); break; }
          this.sfx('select'); this.enterBriefing(m);
        }
        else if (a === 'back') { this.sfx('menu'); this.enterTitle(); }
        break;
      }
      case 'BRIEFING':
        if (a === 'confirm') { this.sfx('select'); this.startCountdown(); }
        else if (a === 'back' || a === 'menu') { this.sfx('menu'); this.enterSelect(); }
        else if ((a === 'left' || a === 'right') && this.mission.vehicleChoice) {
          const keys = Object.keys(VEHICLE_INFO);
          const i = keys.indexOf(this.sandboxVehicle);
          this.setSandboxVehicle(keys[(i + (a === 'left' ? keys.length - 1 : 1)) % keys.length]);
        }
        break;
      case 'COUNTDOWN':
        if (a === 'back') { this.enterSelect(); }
        break;
      case 'PAUSED':
        if (a === 'confirm' || a === 'back') this.resume();
        else if (a === 'retry') this.retry();
        else if (a === 'menu') this.enterSelect();
        break;
      case 'RESULTS':
        if (a === 'confirm') {
          if (this.lastResult && this.lastResult.completed && this.hasNext()) this.nextMission();
          else this.retry();
        } else if (a === 'retry') this.retry();
        else if (a === 'menu' || a === 'back') this.enterSelect();
        break;
      default: break;
    }
  }

  hasNext() {
    const i = MISSIONS.indexOf(this.mission);
    return i >= 0 && i < MISSIONS.length - 1 && isUnlocked(MISSIONS[i + 1], loadBests());
  }
  nextMission() {
    const i = MISSIONS.indexOf(this.mission);
    this.sel = Math.min(MISSIONS.length - 1, i + 1);
    this.enterBriefing(MISSIONS[this.sel]);
  }

  // ------------------------------------------------------------------ scene management
  getVehicle(key) {
    if (!this.vehicles[key]) {
      const C = this.VEHICLES && this.VEHICLES[key];
      if (!C) throw new Error('Vehicle class missing: ' + key);
      this.vehicles[key] = new C(this.world);
    }
    return this.vehicles[key];
  }

  disposeCourse() {
    if (this.course) { try { this.course.dispose(); } catch (e) { /* ignore */ } this.course = null; }
  }

  detachVehicle() {
    if (this.vehicle && this.vehicle.mesh && this.vehicle.mesh.parent) this.vehicle.mesh.parent.remove(this.vehicle.mesh);
    this.vehicle = null;
  }

  // Build course + place vehicle at its pad, ready (frozen) for countdown.
  prepare() {
    this.disposeCourse();
    this.detachVehicle();
    const m = this.mission;
    this.vehicleKey = m.vehicleChoice ? this.sandboxVehicle : m.vehicle;
    this.course = m.build(this.world, this.scene);
    const v = this.getVehicle(this.vehicleKey);
    this.vehicle = v;
    if (v.events) v.events.length = 0;
    this.scene.add(v.mesh);
    const pad = getPad(this.world, this.vehicleKey);
    v.reset(pad.position.clone(), -pad.heading); // world headings are mirrored vs vehicle yaw
    if (v.mesh && v.position) v.mesh.position.copy(v.position);
    v.fuelBurnScale = m.fuelBurn || 1; // per-mission fuel tuning (rocket belt reads it)
    this.offPadNotice = false;
    this.lastResult = null;
    this.flightTime = 0;
    this.hasFlown = false;
    this.outcome = null;
    this.landingInfo = null;
    this.input.reset && this.input.reset();
  }

  setSandboxVehicle(k) {
    if (!VEHICLE_INFO[k] || this.state !== 'BRIEFING') return;
    this.sandboxVehicle = k;
    this.sfx('menu');
    this.prepare();
    this.setUI(briefingHTML(this.mission, null, this.vehicleKey));
  }

  // ------------------------------------------------------------------ state entry points
  goto(s) {
    this.state = s; this.stateT = 0;
    if (this.touch) this.touch.show(s === 'FLIGHT');
    if (s !== 'FLIGHT' && s !== 'ENDING') this.hints && this.hints.stop();
    if (s !== 'RESULTS') this.replay = null;
  }

  enterTitle() {
    this.goto('TITLE');
    this.hud && this.hud.show && this.hud.show(false);
    this.disposeCourse();
    this.detachVehicle();
    this.stopEngine();
    this.setUI(titleHTML());
    this.music('title');
    this.camera.fov = 65; this.camera.updateProjectionMatrix();
  }

  enterSelect() {
    this.goto('SELECT');
    this.hud && this.hud.show && this.hud.show(false);
    this.hud && this.hud.clearFlash && this.hud.clearFlash();
    this.disposeCourse();
    this.detachVehicle();
    this.stopEngine();
    this.refreshSelect();
    this.music('title');
    this.camera.fov = 65; this.camera.updateProjectionMatrix();
  }

  refreshSelect() {
    const bests = loadBests();
    this.setUI(selectHTML(MISSIONS, bests, this.sel, lockedSet(MISSIONS, bests), (m) => requirementText(m, MISSIONS)));
  }

  // shake the description panel (which shows the unlock requirement) when a locked mission is picked
  flashMenu() {
    const d = document.querySelector('#ui .sw-desc');
    if (!d) return;
    d.classList.remove('shake'); void d.offsetWidth; d.classList.add('shake');
  }

  enterBriefing(m) {
    this.mission = m;
    this.goto('BRIEFING');
    this.prepare();
    this.camera.fov = 60; this.camera.updateProjectionMatrix();
    this.setUI(briefingHTML(m, loadBests()[m.id], this.vehicleKey));
  }

  startCountdown() {
    this.prepare(); // fresh course each attempt
    this.goto('COUNTDOWN');
    this.lastCount = -1;
    this.setUI('<div id="sw-count"></div>');
    this.hud && this.hud.show && this.hud.show(false);
    this.chase && this.chase.snap && this.chase.snap(this.vehicle, this.world);
  }

  retry() {
    this.sfx('select');
    this.hud && this.hud.clearFlash && this.hud.clearFlash();
    this.startCountdown();
  }

  showCount(txt, go) {
    const el = document.getElementById('sw-count');
    if (!el) return;
    el.innerHTML = `<div class="sw-cnum ${go ? 'go' : ''}">${txt}</div>`;
  }

  startFlight() {
    this.goto('FLIGHT');
    this.clearUI();
    const v = this.vehicle;
    this.hud.show(true);
    if (!this.minimapReady && this.hud.createMinimap) {
      try { this.hud.createMinimap(this.world); this.minimapReady = true; } catch (e) { console.warn(e); }
    }
    this.hud.setFuelVisible && this.hud.setFuelVisible(this.vehicleKey === 'rocketBelt' ? true : null);
    this.hud.showMinimap && this.hud.showMinimap(true);
    this.input.reset && this.input.reset();
    const kind = VEHICLE_INFO[this.vehicleKey].kind;
    try { this.audio.startEngine && this.audio.startEngine(kind); } catch (e) { /* ignore */ }
    this.music('flight');
    this.chase.snap && this.chase.snap(v, this.world);
    this.hud.flash && this.hud.flash('GO!', 900);
    this.sfx('go');
    if (this.hud.flash) this.hud.flash(VEHICLE_INFO[this.vehicleKey].hint, 2600);
    this.ignorePauseUntil = this.elapsed + 0.3;
    this.recorder.clear();
    const touchOn = !!(this.touch && this.touch.enabled);
    this.hints.start(this.vehicleKey, { touch: touchOn, bombs: !!this.course.bombsLeft });
    if (this.touch) this.touch.setActionLabel(this.vehicleKey === 'hangGlider' ? 'LAUNCH' : this.course.bombsLeft ? 'BOMB' : 'BURST');
  }

  pause() {
    if (this.state !== 'FLIGHT') return;
    this.goto('PAUSED');
    this.setUI(pauseHTML(this.mission.sandbox));
    this.stopEngine();
    this.sfx('menu');
  }

  resume() {
    this.goto('FLIGHT');
    this.clearUI();
    this.ignorePauseUntil = this.elapsed + 0.35;
    try { this.audio.startEngine && this.audio.startEngine(VEHICLE_INFO[this.vehicleKey].kind); } catch (e) { /* ignore */ }
    this.sfx('select');
  }

  // ------------------------------------------------------------------ flight
  processVehicleEvents(v) {
    const evs = v.events;
    if (!evs || !evs.length) return;
    const p = v.position;
    this._frameEvents = evs.slice();
    for (const e of evs.splice(0, evs.length)) {
      switch (e) {
        case 'crash':
          this.effects.explosion && this.effects.explosion(p.clone());
          this.sfx('crash', p); this.chase.addShake && this.chase.addShake(1);
          break;
        case 'splash':
          this.effects.splash && this.effects.splash(p.clone());
          this.sfx('splash', p); this.chase.addShake && this.chase.addShake(0.5);
          break;
        case 'touchdown':
          this.effects.dustPuff && this.effects.dustPuff(p.clone());
          this.sfx('touchdown', p);
          break;
        case 'liftoff':
          if (this.cool('liftoff', 3)) this.hud.flash && this.hud.flash('LIFTOFF!', 900);
          break;
        case 'stall':
          if (this.cool('stall', 3)) { this.sfx('stall'); this.hud.flash && this.hud.flash('STALL!', 900); }
          break;
        case 'thermal':
          if (this.cool('thermal', 2.5)) this.sfx('thermal');
          if (this.cool('thermalMsg', 12)) this.hud.flash && this.hud.flash('THERMAL LIFT!', 1100);
          break;
        case 'boost':
          if (this.cool('boost', 1)) this.sfx('boost');
          break;
        default: break;
      }
    }
  }

  handleCourseEvents(evs) {
    const c = this.course;
    for (const e of evs) {
      if (e.type === 'ring') {
        this.sfx('ring', e.position);
        this.effects.ringPass && this.effects.ringPass(e.position);
        this.hud.flash && this.hud.flash('RING ' + c.hits + '/' + c.ringsTotal, 700);
      } else if (e.type === 'target') {
        this.hud.flash && this.hud.flash('TARGET DESTROYED ' + c.targetHits + '/' + c.targetsTotal, 1000);
        this.sfx('ring');
      }
    }
  }

  checkEnd() {
    const v = this.vehicle, m = this.mission, c = this.course;
    if (v.state === 'flying') this.hasFlown = true;
    if (v.state === 'crashed') return this.end('crashed');
    if (v.state === 'splashed') return this.end('splashed');
    if (!isFinite(v.position.y) || v.position.y < -40) return this.end('splashed');
    if (v.state === 'landed' && this.hasFlown && c.landing) {
      const dx = v.position.x - c.landing.position.x, dz = v.position.z - c.landing.position.z;
      const dist = Math.hypot(dx, dz);
      const onPad = dist <= c.landing.radius * 1.05;
      // Powered craft may touch down off the pad and lift off again (rocket-belt hops) as long as they
      // still have fuel; the glider cannot relaunch, so any landing ends its run.
      const canRelaunch = this.vehicleKey !== 'hangGlider' && (v.fuel == null || v.fuel > 0.02);
      if (!onPad && canRelaunch) {
        if (!this.offPadNotice) { this.offPadNotice = true; this.hud.flash && this.hud.flash('OFF THE PAD - LIFT OFF AGAIN!', 1600); }
        return null;
      }
      this.landingInfo = { distance: dist, radius: c.landing.radius, quality: v.landingQuality || {} };
      return this.end(onPad ? 'landed' : 'missed');
    }
    if (v.state === 'flying') this.offPadNotice = false;
    // free flight: a landed glider can't relaunch -> respawn at the pad (finishEnding handles sandbox)
    if (m.sandbox && v.state === 'landed' && this.hasFlown && this.vehicleKey === 'hangGlider') return this.end('landed');
    if (m.timeLimit > 0 && this.flightTime >= m.timeLimit) return this.end('timeup');
    return null;
  }

  end(outcome) {
    if (this.state !== 'FLIGHT') return;
    this.outcome = outcome;
    this.goto('ENDING');
    const msg = { landed: 'PERFECT LANDING!', missed: 'MISSED THE PAD!', crashed: 'CRASH!', splashed: 'SPLASHDOWN!', timeup: "TIME'S UP!" }[outcome];
    this.hud.flash && this.hud.flash(msg, 1800);
    this.endTimer = outcome === 'landed' || outcome === 'missed' ? 1.8 : outcome === 'timeup' ? 1.2 : 2.3;
    this._urgent = false;
    try { this.audio.setIntensity && this.audio.setIntensity(null); } catch (e) { /* ignore */ }
    // silence engine
    this.stopEngine();
  }

  finishEnding() {
    const m = this.mission, c = this.course;
    if (m.sandbox) {
      // respawn immediately
      this.prepare();
      this.startFlight();
      return;
    }
    const run = {
      outcome: this.outcome, time: this.flightTime,
      ringsHit: c.hits, ringsTotal: c.ringsTotal, targetsHit: c.targetHits, targetsTotal: c.targetsTotal,
      hasLanding: !!c.landing, landing: this.outcome === 'landed' ? this.landingInfo : null,
    };
    const res = scoreRun(m, run);
    const bestsBefore = loadBests();
    const sv = saveBest(m.id, res, this.flightTime);
    const unlocked = newlyUnlocked(MISSIONS, bestsBefore, loadBests()).map((u) => u.name);
    if (res.completed) this.hints.complete();
    const title = { landed: 'MISSION COMPLETE', missed: 'OFF TARGET', crashed: 'CRASHED', splashed: 'SPLASHDOWN', timeup: "TIME'S UP" }[this.outcome];
    const rows = [['TIME', fmtTime(this.flightTime)]];
    if (c.ringsTotal) rows.push(['RINGS  ' + c.hits + ' / ' + c.ringsTotal, '+' + res.rings]);
    if (c.targetsTotal) rows.push(['TARGETS  ' + c.targetHits + ' / ' + c.targetsTotal, '+' + res.targets]);
    if (c.landing) rows.push(['LANDING', res.completed ? '+' + res.landing : '--']);
    rows.push(['COMPLETION', '+' + res.complete]);
    if (m.timeLimit > 0) rows.push(['TIME BONUS', '+' + res.timeBonus]);
    this.lastResult = res;
    this.goto('RESULTS');
    this.hud.show(false);
    this.hud.setTargetBearing && this.hud.setTargetBearing(null);
    this.setUI(resultsHTML({
      title, mission: m.tag + ' - ' + m.name.toUpperCase(), rows, completed: res.completed, medal: res.medal, grade: res.grade,
      newBest: sv.newBest && res.completed, best: sv.best, hasNext: this.hasNext(), unlocked,
    }));
    this.lastUnlocked = unlocked;
    const rd = new ReplayDirector(this.recorder, this.world);
    this.replay = rd.usable ? rd : null;
    if (this.replay) { const tag = document.createElement('div'); tag.className = 'replay-tag'; tag.textContent = '\u25CF REPLAY'; this.uiRoot.appendChild(tag); }
    this.resultAnim = { t: -(0.3 + rows.length * 0.18), target: res.total };
    this.music('results');
    if (res.medal !== 'none') {
      this.sfx('medal');
      this.effects.confetti && this.effects.confetti(this.vehicle.position.clone().add(new V3(0, 6, 0)));
    }
    this.camera.fov = 60; this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ per-frame
  update(dt, elapsed) {
    this.elapsed = elapsed;
    this.stateT += dt;
    const input = this.input;
    input.update && input.update(dt);
    this.pollPad(dt);

    // world/fx always run
    try { this.world.update(dt, elapsed, this.camera.position); } catch (e) { this.softError(e); }

    switch (this.state) {
      case 'TITLE': this.camTitle(dt, 0); break;
      case 'SELECT': this.camTitle(dt, 1); break;
      case 'BRIEFING': this.camOrbit(dt); break;
      case 'COUNTDOWN': this.updateCountdown(dt); break;
      case 'FLIGHT': this.updateFlight(dt); break;
      case 'ENDING': this.updateEnding(dt); break;
      case 'RESULTS': this.updateResults(dt); break;
      case 'PAUSED': input.consumeEdges && input.consumeEdges(); break;
      default: break;
    }
    try { this.particles && this.particles.update && this.particles.update(dt); } catch (e) { this.softError(e); }
    try { this.effects && this.effects.update && this.effects.update(dt); } catch (e) { this.softError(e); }
  }

  softError(e) {
    if (this.cool('softerr', 3)) { console.error(e); if (window.__swShowError) window.__swShowError(e); }
  }

  camTitle(dt, mode) {
    const t = this.elapsed * 0.05 + (mode ? 2 : 0);
    const R = 1250 + Math.sin(t * 1.7) * 150;
    const x = Math.cos(t) * R, z = Math.sin(t) * R;
    let h = 0; try { h = this.world.heightAt(x, z); } catch (e) { h = 0; }
    const y = Math.max(h + 90, 170 + Math.sin(t * 2.3) * 60);
    this.camera.position.set(x, y, z);
    const t2 = t + 0.25;
    let ty = 60; try { ty = Math.max(30, this.world.heightAt(Math.cos(t2) * 500, Math.sin(t2) * 500) * 0.5); } catch (e) { /* ignore */ }
    this.camera.lookAt(Math.cos(t2) * 450, ty, Math.sin(t2) * 450);
  }

  camOrbit(dt) {
    const v = this.vehicle;
    if (!v) return;
    const a = this.stateT * 0.35 + 0.6;
    const r = this.vehicleKey === 'hangGlider' ? 16 : 13;
    const p = v.position;
    this.camera.position.set(p.x + Math.sin(a) * r, p.y + 4.5, p.z + Math.cos(a) * r);
    this.camera.lookAt(p.x, p.y + 1.5, p.z);
    if (this.camera.position.y < this.world.heightAt(this.camera.position.x, this.camera.position.z) + 1.5) {
      this.camera.position.y = this.world.heightAt(this.camera.position.x, this.camera.position.z) + 1.5;
    }
  }

  updateCountdown(dt) {
    this.camOrbit(dt);
    // blend into chase view during countdown
    if (this.stateT > 2.0 && this.chase && this.chase.update) { try { this.chase.update(dt, this.vehicle, this.world); } catch (e) { this.softError(e); } }
    const step = Math.floor(this.stateT / 0.9);
    if (step !== this.lastCount) {
      this.lastCount = step;
      if (step < 3) { this.showCount(String(3 - step)); this.sfx('countdown'); }
      else { this.startFlight(); }
    }
  }

  updateFlight(dt) {
    const v = this.vehicle, input = this.input, c = this.course, m = this.mission;
    // pause / camera edges
    const pz = !!input.pause;
    const camT = !!input.camToggle;
    input.consumeEdges && input.consumeEdges();
    if (camT && this.chase.toggleMode) this.chase.toggleMode();
    if (pz && this.elapsed > this.ignorePauseUntil) { this.pause(); return; }

    this.flightTime += dt;
    this.stepVehicle(dt, true);
    const ctx = { input, effects: this.effects, audio: this.audio, particles: this.particles, hud: this.hud };
    let evs = [];
    try { evs = c.update(dt, v, ctx); } catch (e) { this.softError(e); }
    this.handleCourseEvents(evs);
    this.recorder.sample(dt, v.mesh);
    try { this.hints.update(dt, { vehicle: v, course: c, events: this._frameEvents }); } catch (e) { this.softError(e); }
    this._frameEvents = null;
    if (this.audio && this.audio.setIntensity) {
      const urgent = m.timeLimit > 0 && m.timeLimit - this.flightTime < 20;
      if (urgent !== this._urgent) { this._urgent = urgent; try { this.audio.setIntensity(urgent ? 1 : null); } catch (e) { /* ignore */ } }
    }
    this.updateHUD();
    this.checkEnd();
  }

  stepVehicle(dt, useInput) {
    const v = this.vehicle;
    try { v.update(dt, useInput ? this.input : this.neutralInput(), this.world); } catch (e) { this.softError(e); }
    this.processVehicleEvents(v);
    try { this.chase.update(dt, v, this.world); } catch (e) { this.softError(e); }
    try { this.effects.windStreaks && this.effects.windStreaks(v, this.camera); } catch (e) { this.softError(e); }
    if (this.state === 'FLIGHT') try {
      this.audio.setEngine && this.audio.setEngine({ speed: v.speed || 0, throttle: v.throttle || 0, altitude: v.altitude || 0, kind: VEHICLE_INFO[this.vehicleKey].kind });
    } catch (e) { /* ignore */ }
  }

  neutralInput() {
    if (!this._neutral) this._neutral = { pitch: 0, roll: 0, yaw: 0, throttle: 0, boost: false, brake: false, action: false, action2: false, camToggle: false, pause: false };
    this._neutral.throttle = this.input.throttle;
    return this._neutral;
  }

  updateHUD() {
    const v = this.vehicle, c = this.course, m = this.mission, hud = this.hud;
    const hd = headingOf(v);
    let state = v.state;
    if (state === 'grounded' && this.vehicleKey !== 'hangGlider') state = 'flying';
    hud.update({
      speed: v.speed || 0, altitude: v.altitude != null ? v.altitude : v.position.y, heading: hd,
      fuel: v.fuel != null ? v.fuel : 1, throttle: v.throttle || 0, vspeed: v.velocity ? v.velocity.y : 0, state,
      timer: m.timeLimit > 0 ? Math.max(0, m.timeLimit - this.flightTime) : null,
      score: m.sandbox ? 0 : livePoints(c.hits, c.targetHits),
      objective: c.getObjective(), ringsHit: c.hits, ringsTotal: c.ringsTotal,
    });
    const tgt = c.getTarget(v);
    if (tgt && hud.setTargetBearing) {
      _f.set(0, 0, -1).applyQuaternion(v.mesh.quaternion); _f.y = 0;
      if (_f.lengthSq() < 1e-6) _f.set(0, 0, -1);
      _f.normalize();
      const dx = tgt.x - v.position.x, dz = tgt.z - v.position.z;
      const fwd = dx * _f.x + dz * _f.z;
      const right = dx * -_f.z + dz * _f.x;
      hud.setTargetBearing(Math.atan2(right, fwd), Math.hypot(dx, dz, tgt.y - v.position.y));
    } else if (hud.setTargetBearing) hud.setTargetBearing(null);
    if (hud.updateMinimap) hud.updateMinimap(v.position.x, v.position.z, hd, c.markers());
  }

  updateEnding(dt) {
    this.input.consumeEdges && this.input.consumeEdges();
    this.stepVehicle(dt, false);
    this.recorder.sample(dt, this.vehicle.mesh);
    this.endTimer -= dt;
    if (this.endTimer <= 0) this.finishEnding();
  }

  updateResults(dt) {
    // cinematic replay of the finish (falls back to an orbit if the flight was too short to record)
    let played = false;
    if (this.replay) { try { played = this.replay.update(dt, this.vehicle.mesh, this.camera); } catch (e) { this.softError(e); this.replay = null; } }
    if (!played) this.camOrbitWide(dt);
    const a = this.resultAnim;
    if (a) {
      a.t += dt;
      const el = document.getElementById('sw-total');
      if (el && a.t > 0) {
        const f = Math.min(1, a.t / 1.2);
        el.textContent = String(Math.round(a.target * (1 - Math.pow(1 - f, 3))));
        if (f >= 1) this.resultAnim = null;
      }
    }
  }

  camOrbitWide(dt) {
    const v = this.vehicle;
    if (!v) return;
    const a = this.stateT * 0.25;
    const p = v.position;
    this.camera.position.set(p.x + Math.sin(a) * 30, p.y + 12, p.z + Math.cos(a) * 30);
    this.camera.lookAt(p.x, p.y + 1, p.z);
    const gh = this.world.heightAt(this.camera.position.x, this.camera.position.z);
    if (this.camera.position.y < gh + 3) this.camera.position.y = gh + 3;
  }
}
