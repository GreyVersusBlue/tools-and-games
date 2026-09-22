// Signal City: the page. Owns the screens (level select, playing, the end
// card), the fixed-step loop, the HUD and the save. The world never sees the
// DOM; this file is the only one that reads it.
//
// ?debug exposes window.__signalCity = { game, world, step(n), score() } for
// the browser suite and for poking at a run from the console.

import { World, DT } from './sim.js';
import { Renderer } from './render.js';
import { bindInput } from './input.js';
import { meters, score, failedEarly, starString } from './scoring.js';
import { LEVELS, levelById } from './levels/pack-01.js';
import { makeSlot, recordResult, totalStars } from './save.js';
import { mountSaveBar } from '../../../assets/js/gvb-save.js';
import { waveModel, WaveHistory, drawWave } from './wave.js';

const $ = id => document.getElementById(id);
const DEBUG = new URLSearchParams(location.search).has('debug');

class Game {
  constructor() {
    this.canvas = $('board');
    this.renderer = new Renderer(this.canvas);
    this.world = null;
    this.level = null;
    this.state = 'select';   // select | playing | ended
    this.paused = false;
    this.speed = 1;
    this.acc = 0;
    this.last = 0;
    this.result = null;
    this.slot = makeSlot();
    this.save = this.slot.load() || this.slot.fresh();
    this.seed = 1;
    this.node = 0;           // the box the panel drives (a corridor has two)
    this.wave = new WaveHistory();   // the platoon diagram's samples (M7)
    this.hudEls = {};
    bindInput({ canvas: this.canvas, renderer: this.renderer, game: this });
    window.addEventListener('resize', () => this.layout());
    this.layout();
    this.buildLevelSelect();
    this.mountSave();
    requestAnimationFrame(t => this.frame(t));
  }

  // ---- screens --------------------------------------------------------------

  layout() {
    const wrap = $('boardWrap');
    const r = wrap.getBoundingClientRect();
    // a corridor is wider than it is tall: size the board by the world's aspect
    const aspect = this.world ? this.renderer.aspect(this.world) : 1;
    const size = Math.max(280, Math.min(r.width / Math.max(1, aspect), window.innerHeight - 40));
    this.renderer.resize(Math.floor(r.width), Math.floor(size), Math.min(2, window.devicePixelRatio || 1));
    if (this.world) this.renderer.fit(this.world);
  }

  // The controller the panel edits.
  get ctl() { return this.world ? this.world.controllers[Math.min(this.node, this.world.controllers.length - 1)] : null; }

  buildLevelSelect() {
    const list = $('levelList');
    list.innerHTML = '';
    for (const lvl of LEVELS) {
      const rec = this.save.levels[lvl.id] || { stars: 0, best: 0, plays: 0 };
      const card = document.createElement('button');
      card.className = 'level-card';
      card.dataset.level = lvl.id;
      card.innerHTML = `<div class="lv-name">${lvl.name}</div><div class="lv-blurb">${lvl.blurb}</div>` +
        `<div class="lv-stars">${lvl.sandbox ? 'no stars here' : starString(rec.stars)}${rec.best ? ` · best ${rec.best}` : ''}</div>` +
        `<div class="lv-meta">${Math.round(lvl.duration / 60)} min · ${lvl.mode === 'hard' ? 'one collision ends it' : 'collisions cost a star'} · clear ${lvl.target}</div>`;
      card.addEventListener('click', () => this.start(lvl.id));
      list.appendChild(card);
    }
    $('starTotal').textContent = `${totalStars(this.save)} stars`;
  }

  start(levelId, seed = null) {
    const lvl = levelById(levelId);
    if (!lvl) return;
    this.level = lvl;
    this.seed = seed ?? ((Date.now() % 100000) + 1);
    if (DEBUG) this.seed = seed ?? 7;
    this.world = new World(lvl, this.seed);
    this.node = 0;
    this.wave.reset();
    this.renderer.reset();
    this.layout();
    this.state = 'playing';
    this.paused = false;
    this.result = null;
    this.acc = 0;
    $('selectScrim').classList.remove('show');
    $('endScrim').classList.remove('show');
    $('levelName').textContent = lvl.name;
    $('hint').textContent = lvl.hint || '';
    this.buildNodeButtons();
    this.buildPhaseButtons();
    this.showUnlocks();
    this.buildTiming();
    this.buildRules();
    this.buildCalls();
    this.buildWave();
    this.updateHud(true);
  }

  // A level's unlocks list decides which panel controls show (stars are not
  // spent on anything yet: that is M8).
  showUnlocks() {
    const u = new Set(this.level.unlocks || []);
    $('flashBox').classList.toggle('hidden', !u.has('flash'));
    $('timingBox').classList.toggle('hidden', !u.has('allred'));
    $('rulesBox').classList.toggle('hidden', !u.has('auto'));
    $('leftsNote').classList.toggle('hidden', !u.has('lefts'));
    $('phases').classList.toggle('hidden', !u.has('phases'));
    $('pedsBox').classList.toggle('hidden', !u.has('peds'));
    $('sensorsNote').classList.toggle('hidden', !u.has('sensors'));
    $('waveBox').classList.toggle('hidden', !(u.has('offset') && this.world.controllers.length > 1 && this.world.controllers[0].plan));
    $('nodes').classList.toggle('hidden', this.world.controllers.length < 2);
  }

  // A corridor: which box the panel drives. The phases, the sliders and the
  // rules all read `this.ctl`.
  buildNodeButtons() {
    const box = $('nodes');
    box.innerHTML = '';
    if (this.world.controllers.length < 2) return;
    const names = this.world.controllers.length === 2 ? ['West box', 'East box'] : this.world.controllers.map((c, i) => `Box ${i + 1}`);
    this.world.controllers.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'node' + (i === this.node ? ' on' : '');
      b.dataset.node = i;
      b.textContent = names[i];
      b.addEventListener('click', () => this.selectNode(i));
      box.appendChild(b);
    });
  }

  selectNode(i) {
    if (!this.world || i < 0 || i >= this.world.controllers.length || i === this.node) return;
    this.node = i;
    for (const b of $('nodes').children) b.classList.toggle('on', +b.dataset.node === i);
    this.buildPhaseButtons();
    this.buildTiming();
    this.buildRules();
    this.buildCalls();
    this.updateHud(true);
  }

  // A click on the map that hit no car: on a corridor, the nearer box
  // becomes the one the panel drives.
  clickMap(x, y) {
    if (!this.world || this.world.nodes.length < 2) return;
    let best = 0, bd = Infinity;
    this.world.nodes.forEach((n, i) => { const d = Math.hypot(n.origin[0] - x, n.origin[1] - y); if (d < bd) { bd = d; best = i; } });
    this.selectNode(best);
  }

  // The pedestrian call buttons: one per leg the selected box has a walk
  // for. The player can press them; the level's own calls press them too.
  buildCalls() {
    const box = $('calls');
    box.innerHTML = '';
    const ctl = this.ctl;
    if (!ctl) return;
    for (const leg of this.world.nodes[this.node].legs) {
      if (!ctl.phases.some(p => p.walks.includes(`P-${leg}`))) continue;
      const b = document.createElement('button');
      b.className = 'call';
      b.dataset.leg = leg;
      b.innerHTML = `<span class="leg">${leg}</span><span class="state">don't walk</span>`;
      b.addEventListener('click', () => this.callPed(leg));
      box.appendChild(b);
    }
  }

  callPed(leg) {
    if (this.state !== 'playing' || !this.world) return;
    this.world.callPed(leg, { node: this.node, walkers: 1 });
    this.updateHud(true);
  }

  end() {
    this.state = 'ended';
    this.result = score(this.world);
    const r = this.result;
    if (!this.level.sandbox) {
      recordResult(this.save, this.level.id, r);
      this.slot.save(this.save);
    }
    $('endTitle').textContent = r.survived ? (r.stars === 3 ? 'Clean board.' : r.stars === 2 ? 'Moving.' : 'Survived.') : 'Not this time.';
    $('endStars').textContent = this.level.sandbox ? '' : starString(r.stars);
    $('endBody').innerHTML =
      `<div class="end-row"><span>Cleared</span><b>${r.cleared} / ${r.target}</b></div>` +
      `<div class="end-row"><span>Average wait</span><b>${r.avgWait.toFixed(0)} s (target ${r.waitTarget})</b></div>` +
      `<div class="end-row"><span>Collisions</span><b>${r.collisions}</b></div>` +
      `<div class="end-row"><span>Honks</span><b>${r.honks}</b></div>` +
      (this.world.controller.hasPeds ? `<div class="end-row"><span>Walks served · kept waiting</span><b>${r.pedServed} · ${r.pedLate}</b></div>` : '') +
      (r.ambulances ? `<div class="end-row"><span>Ambulances on time · late</span><b>${r.ambulances - r.ambulanceLate} · ${r.ambulanceLate}</b></div>` : '') +
      (r.platoons ? `<div class="end-row"><span>Platoons kept together · split</span><b>${r.platoons - r.splits} · ${r.splits}</b></div>` : '') +
      `<div class="end-row"><span>Satisfaction bonus</span><b>${r.bonus}</b></div>` +
      `<div class="end-row total"><span>Points</span><b>${r.points}</b></div>` +
      (r.reasons.length ? `<p class="end-why">${r.reasons.join('. ')}.</p>` : '');
    $('endScrim').classList.add('show');
    this.buildLevelSelect();
  }

  escape() {
    if (this.state === 'playing') { this.state = 'select'; $('selectScrim').classList.add('show'); }
  }

  // ---- loop -----------------------------------------------------------------

  frame(t) {
    const now = t / 1000;
    let dt = Math.min(0.25, now - (this.last || now));
    this.last = now;
    if (this.state === 'playing' && !this.paused) {
      this.acc += dt * this.speed;
      let steps = 0;
      while (this.acc >= DT && steps < 12) {
        this.world.step();
        this.wave.sample(this.world);
        this.acc -= DT;
        steps++;
        if (this.world.over || failedEarly(this.world)) { this.end(); break; }
      }
    }
    if (this.world) {
      this.renderer.takeEvents(this.world);
      this.renderer.draw(this.world, now);
      this.updateHud();
    }
    requestAnimationFrame(t2 => this.frame(t2));
  }

  // ---- inputs ---------------------------------------------------------------

  // Pressing the phase already green holds it (M7): its elapsed rule counts
  // from now again, which is how a hand keeps a green under a platoon.
  requestPhase(i) {
    if (this.state !== 'playing' || !this.world) return;
    if (i >= this.ctl.phases.length) return;
    if (!this.world.requestPhase(i, this.node)) this.world.holdGreen(this.node);
    this.updateHud(true);
  }

  // ---- the M5 controls -------------------------------------------------------

  setFlash(mode) {
    if (this.state !== 'playing' || !this.world) return;
    const ctl = this.ctl;
    // through the world, which refuses while the power is out (M7)
    this.world.setFlash(mode === 'red' ? 'red' : mode === 'yellow' ? { major: ctl.majorLegs() } : null, this.node);
    this.updateHud(true);
  }

  setTiming(patch) {
    if (!this.world) return;
    this.ctl.setTiming(patch);
    this.buildTiming();
  }

  // ---- the M7 green wave ------------------------------------------------------

  // The offset slider runs the corridor: the east box's plan `offset`
  // seconds behind the west one's, 0 to a cycle less one. Moving it is not
  // a jump: Controller.setOffset cuts or stretches the greens to come.
  setOffset(seconds) {
    if (this.state !== 'playing' || !this.world || this.world.controllers.length < 2) return;
    this.world.setOffset(seconds);
    this.buildWave();
  }

  buildWave() {
    if ($('waveBox').classList.contains('hidden')) return;
    const w = this.world;
    const L = w.controllers[0].cycleLength();
    const o = w.offsetOf();
    const r = $('offsetRange');
    r.max = String(Math.max(1, Math.ceil(L) - 1));
    r.value = String(((Math.round(o) % L) + L) % L);
    $('offsetVal').textContent = `${Math.round(o)} s`;
    const shift = w.controllers[1].shift;
    $('offsetNote').textContent = `The east box runs its plan ${Math.round(o)} s behind the west one (${L} s cycle).` +
      (Math.abs(shift) > 1e-6 ? ` Re-aligning: ${Math.abs(shift).toFixed(0)} s still to ${shift > 0 ? 'cut from' : 'add to'} its greens.` : '');
    this.drawWave();
  }

  drawWave() {
    if (!this.world || $('waveBox').classList.contains('hidden')) return;
    const c = $('wave');
    const ctx = c.getContext('2d');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = Math.max(120, Math.floor(c.getBoundingClientRect().width) || 242), cssH = 200;
    if (c.width !== Math.round(cssW * dpr) || c.height !== Math.round(cssH * dpr)) { c.width = Math.round(cssW * dpr); c.height = Math.round(cssH * dpr); c.style.height = cssH + 'px'; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawWave(ctx, waveModel(this.world), this.wave, this.world.t, cssW, cssH);
  }

  buildTiming() {
    const t = this.ctl.timing;
    $('yellowRange').value = String(t.yellow);
    $('allRedRange').value = String(t.allRed);
    $('yellowVal').textContent = `${t.yellow.toFixed(1)} s`;
    $('allRedVal').textContent = `${t.allRed.toFixed(1)} s`;
  }

  // The rule panel edits a copy of controller.rules and hands the whole list
  // back through setRules on every change, so the controller never sees a
  // half-typed row. Queue rules are shown asleep on a level without sensors
  // and live on one with them (M6).
  buildRules() {
    const box = $('rules');
    const ctl = this.ctl;
    box.innerHTML = '';
    if (!ctl.rules.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = 'No rules: the phases change when you press them.'; box.appendChild(p); return; }
    const thenOptions = sel => {
      const opts = [['next', 'the next phase']].concat(ctl.phases.map((p, i) => [String(i), `${i + 1}: ${p.name}`]));
      for (const [v, label] of opts) { const o = document.createElement('option'); o.value = v; o.textContent = label; sel.appendChild(o); }
    };
    ctl.rules.forEach((r, i) => {
      const row = document.createElement('div');
      row.className = 'rule' + (r.when === 'queue' && !this.world.sensors ? ' sleeping' : '') + (r.when === 'queue' && this.world.sensors ? ' sensed' : '');
      row.dataset.i = i;
      const body = document.createElement('div');
      body.className = 'body';
      const then = document.createElement('select'); then.className = 'then'; thenOptions(then);
      then.value = r.then === undefined || r.then === 'next' ? 'next' : String(r.then);
      if (r.when === 'elapsed') {
        const n = document.createElement('input'); n.type = 'number'; n.className = 'seconds'; n.min = '1'; n.max = '180'; n.step = '1'; n.value = String(r.seconds);
        body.append('after ', n, ' s, go to ', then);
      } else {
        const mv = document.createElement('select'); mv.className = 'movement';
        for (const m of ctl.movements) { const o = document.createElement('option'); o.value = m; o.textContent = m; mv.appendChild(o); }
        mv.value = r.movement || ctl.movements[0];
        const th = document.createElement('input'); th.type = 'number'; th.className = 'threshold'; th.min = '1'; th.max = '30'; th.step = '1'; th.value = String(r.threshold ?? 3);
        const af = document.createElement('input'); af.type = 'number'; af.className = 'after'; af.min = '0'; af.max = '180'; af.step = '1'; af.value = String(r.after ?? ctl.timing.minGreen);
        body.append('when ', mv, ' has ', th, ' queued, after ', af, ' s, go to ', then);
      }
      const ops = document.createElement('div'); ops.className = 'ops';
      for (const [cls, glyph, title] of [['up', '▲', 'earlier'], ['down', '▼', 'later'], ['remove', '✕', 'remove']]) {
        const b = document.createElement('button'); b.className = cls; b.textContent = glyph; b.title = title; b.type = 'button';
        b.addEventListener('click', () => this.editRules(list => {
          if (cls === 'remove') list.splice(i, 1);
          else { const j = cls === 'up' ? i - 1 : i + 1; if (j >= 0 && j < list.length) [list[i], list[j]] = [list[j], list[i]]; }
        }));
        ops.appendChild(b);
      }
      row.append(body, ops);
      if (r.when === 'queue' && !this.world.sensors) { const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = 'needs sensors: this level has none'; row.appendChild(badge); }
      body.addEventListener('change', () => this.editRules(list => { list[i] = this.readRule(row, list[i]); }));
      box.appendChild(row);
    });
  }

  readRule(row, r) {
    const out = { ...r };
    const then = row.querySelector('select.then').value;
    out.then = then === 'next' ? 'next' : Number(then);
    if (r.when === 'elapsed') out.seconds = Math.max(1, Number(row.querySelector('input.seconds').value) || 1);
    else { out.movement = row.querySelector('select.movement').value; out.threshold = Math.max(1, Number(row.querySelector('input.threshold').value) || 1); out.after = Math.max(0, Number(row.querySelector('input.after').value) || 0); }
    return out;
  }

  editRules(fn) {
    if (!this.world) return;
    const ctl = this.ctl;
    const list = ctl.rules.map(r => ({ ...r }));
    fn(list);
    try { ctl.setRules(list); } catch (e) { console.warn(e.message); }
    this.buildRules();
  }

  addRule(when) {
    if (this.state !== 'playing' || !this.world) return;
    const ctl = this.ctl;
    this.editRules(list => {
      if (when === 'elapsed') list.push({ when: 'elapsed', seconds: 20, then: 'next' });
      else {
        const m = ctl.movements.find(x => !ctl.phases[0].movements.includes(x)) || ctl.movements[0];
        list.push({ when: 'queue', movement: m, threshold: 3, after: 12, then: 'next' });
      }
    });
  }

  togglePause() { if (this.state === 'playing') { this.paused = !this.paused; $('pauseBtn').textContent = this.paused ? 'Resume' : 'Pause'; } }
  toggleSpeed() { this.speed = this.speed === 1 ? 2 : 1; $('speedBtn').textContent = `${this.speed}x`; }

  carAt(x, y) {
    if (!this.world) return null;
    let best = null, bd = 3.5;
    for (const c of this.world.cars) {
      if (c.done) continue;
      const p = c.path.at(c.s);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  // An ambulance or a motorcade car (M7): the corridor
  clickCar(car) {
    if ((car.archetype === 'emergency' || car.archetype === 'motorcade') && !car.priority) this.world.requestPriority(car);
  }

  priorityNearest() {
    if (!this.world) return;
    const e = this.world.cars.find(c => !c.done && (c.archetype === 'emergency' || c.archetype === 'motorcade') && !c.priority);
    if (e) this.world.requestPriority(e);
  }

  // ---- HUD ------------------------------------------------------------------

  buildPhaseButtons() {
    const box = $('phases');
    box.innerHTML = '';
    this.ctl.phases.forEach((p, i) => {
      const b = document.createElement('button');
      b.className = 'phase';
      b.dataset.phase = i;
      b.innerHTML = `<span class="key">${i + 1}</span><span class="name">${p.name}</span><span class="mv">${p.movements.filter(m => !m.endsWith('-R')).join(' ')}</span>`;
      b.addEventListener('click', () => this.requestPhase(i));
      box.appendChild(b);
    });
  }

  updateHud(force = false) {
    if (!this.world) return;
    const w = this.world;
    // every fourth frame, whether or not the world moved (a paused game still
    // shows the state the debug hook stepped it to)
    this.frameN = (this.frameN || 0) + 1;
    if (!force && this.frameN % 4 !== 0) return;
    const m = meters(w);
    const ctl = this.ctl;
    $('clock').textContent = fmtTime(m.timeLeft);
    $('cleared').textContent = `${m.cleared} / ${m.target}`;
    $('throughBar').style.width = `${Math.min(100, m.throughput * 100)}%`;
    $('collisions').textContent = String(m.collisions);
    $('collisions').className = m.collisions ? 'bad' : '';
    $('satBar').style.width = `${Math.round(m.satisfaction * 100)}%`;
    $('satBar').style.background = m.satisfaction > 0.6 ? '#2ee06b' : m.satisfaction > 0.3 ? '#ffc21f' : '#ff3b30';
    $('waitNow').textContent = `${m.avgWait.toFixed(0)} s avg · ${m.waiting} waiting · ${m.honks} honks` + (ctl.hasPeds ? ` · ${m.pedLate} walkers kept waiting` : '');
    const flashing = ctl.stage === 'flash';
    const stageOf = c => {
      const fl = c.stage === 'flash';
      const st = c.preemption ? 'PRIORITY' : c.stage === 'green' ? `${c.current.name} green` : c.stage === 'yellow' ? 'yellow' : c.stage === 'allred' ? 'all red'
        : fl ? (c.flash === 'red' ? 'flashing red: four-way stop' : `flashing yellow on ${c.flash.major.join(' and ')}`) : c.stage === 'dark' ? 'dark: four-way stop' : c.stage;
      return st + (c.next !== null ? ` → ${c.phases[c.next].name}` : '') + (c.walk ? ` · ${c.walk.stage === 'walk' ? 'WALK' : 'clearing'} ${c.walk.legs.join(' ')}` : '');
    };
    $('stage').textContent = w.controllers.length > 1 ? w.controllers.map((c, i) => `${i === 0 ? 'W' : 'E'}: ${stageOf(c)}`).join(' · ') : stageOf(ctl);
    // the event line (M7): what is happening, and for how much longer
    const lines = w.active.map(e => {
      const left = e.until === null ? 0 : Math.max(0, Math.ceil(e.until - w.t));
      if (e.kind === 'surge') return `Rush hour: traffic at ${Math.round(e.scale * 100)}% for ${left} s more.`;
      if (e.kind === 'outage') return `Power out: the signals are dark, a four-way stop. Back in ${left} s; nothing you press reaches the box until then.`;
      if (e.kind === 'ambulance') { const c = e.deadline - w.t; return c >= 0 ? `Ambulance from ${e.leg}: ${Math.ceil(c)} s to get it through.` : `Ambulance from ${e.leg} is late by ${Math.floor(-c)} s: give it the corridor.`; }
      if (e.kind === 'motorcade' || e.kind === 'procession') {
        const name = e.kind === 'motorcade' ? 'Motorcade' : 'Funeral procession';
        const left = e.size - e.cars.length, onMap = e.cars.filter(c => !c.done).length;
        if (e.split) return `${name} from ${e.leg} was split by the light: ${onMap} car${onMap === 1 ? '' : 's'} still to get through.`;
        return `${name} from ${e.leg}: ${e.size} cars${left ? `, ${left} still to arrive` : ''}. Hold its green until the last is through` + (e.kind === 'motorcade' ? (e.priority ? '; its corridor is called.' : '; E calls its corridor.') : '; it gets no escort.');
      }
      if (e.kind === 'closure') return `Lane closed on ${e.leg} for ${left} s more: everything there merges into one lane before the cones.`;
      if (e.kind === 'school') return `School zone for ${left} s more: every car at ${Math.round(e.scale * 100)}% speed, and children crossing.`;
      return '';
    }).filter(Boolean);
    const ev = $('eventLine');
    ev.textContent = lines.join(' ');
    ev.classList.toggle('hidden', !lines.length);
    ev.classList.toggle('late', w.active.some(e => (e.kind === 'ambulance' && e.late) || e.split));
    for (const b of $('calls').children) {
      const leg = b.dataset.leg;
      const head = ctl.pedHead(leg);
      const pending = w.pedCalls[this.node][leg];
      b.classList.toggle('waiting', !!pending);
      b.classList.toggle('walk', head === 'walk');
      b.classList.toggle('clear', head === 'clear');
      b.querySelector('.state').textContent = head === 'walk' ? 'WALK' : head === 'clear' ? 'clearing' : pending ? `called ${Math.floor(w.t - pending.since)} s ago` : "don't walk";
    }
    for (const b of $('phases').children) {
      const i = +b.dataset.phase;
      b.classList.toggle('active', i === ctl.phase && !ctl.preemption && !flashing);
      b.classList.toggle('queued', ctl.next === i);
      b.classList.toggle('green', i === ctl.phase && ctl.stage === 'green' && !ctl.preemption);
    }
    $('flashRedBtn').classList.toggle('on', flashing && ctl.flash === 'red');
    $('flashYellowBtn').classList.toggle('on', flashing && ctl.flash !== 'red');
    $('signalsBtn').classList.toggle('on', !flashing && ctl.stage !== 'dark');
    for (const id of ['flashRedBtn', 'flashYellowBtn', 'signalsBtn']) $(id).disabled = w.powerOut;
    for (const b of $('phases').children) b.disabled = w.powerOut;
    const em = w.cars.find(c => !c.done && (c.archetype === 'emergency' || c.archetype === 'motorcade') && !c.priority);
    $('priorityBtn').classList.toggle('show', !!em);
    if (!$('waveBox').classList.contains('hidden')) {
      this.drawWave();
      const shift = w.controllers[1].shift;
      if ((Math.abs(shift) > 1e-6) !== /Re-aligning/.test($('offsetNote').textContent) || Math.abs(shift) > 1e-6) {
        const L = w.controllers[0].cycleLength(), o = w.offsetOf();
        $('offsetNote').textContent = `The east box runs its plan ${Math.round(o)} s behind the west one (${L} s cycle).` +
          (Math.abs(shift) > 1e-6 ? ` Re-aligning: ${Math.abs(shift).toFixed(0)} s still to ${shift > 0 ? 'cut from' : 'add to'} its greens.` : '');
      }
    }
  }

  mountSave() {
    mountSaveBar($('saveBar'), this.slot, {
      getState: () => this.save,
      setState: s => { this.save = s; this.buildLevelSelect(); },
      filename: 'signal-city-save.json',
    });
  }
}

function fmtTime(s) { const m = Math.floor(s / 60), r = Math.floor(s % 60); return `${m}:${r < 10 ? '0' : ''}${r}`; }

const game = new Game();
$('pauseBtn').addEventListener('click', () => game.togglePause());
$('speedBtn').addEventListener('click', () => game.toggleSpeed());
$('priorityBtn').addEventListener('click', () => game.priorityNearest());
$('retryBtn').addEventListener('click', () => game.start(game.level.id));
$('levelsBtn').addEventListener('click', () => { $('endScrim').classList.remove('show'); $('selectScrim').classList.add('show'); game.state = 'select'; });
$('menuBtn').addEventListener('click', () => game.escape());
$('flashRedBtn').addEventListener('click', () => game.setFlash('red'));
$('flashYellowBtn').addEventListener('click', () => game.setFlash('yellow'));
$('signalsBtn').addEventListener('click', () => game.setFlash(null));
$('yellowRange').addEventListener('input', e => game.setTiming({ yellow: Number(e.target.value) }));
$('allRedRange').addEventListener('input', e => game.setTiming({ allRed: Number(e.target.value) }));
$('offsetRange').addEventListener('input', e => game.setOffset(Number(e.target.value)));
$('addElapsedBtn').addEventListener('click', () => game.addRule('elapsed'));
$('addQueueBtn').addEventListener('click', () => game.addRule('queue'));

if (DEBUG) {
  window.__signalCity = {
    game,
    get world() { return game.world; },
    step(n = 1) { for (let i = 0; i < n; i++) { game.world.step(); game.wave.sample(game.world); } game.renderer.takeEvents(game.world); game.updateHud(true); },
    setOffset(s) { game.setOffset(s); },
    callPed(leg) { game.callPed(leg); },
    selectNode(i) { game.selectNode(i); },
    score() { return score(game.world); },
    meters() { return meters(game.world); },
  };
}
