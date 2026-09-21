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
    const size = Math.max(280, Math.min(r.width, window.innerHeight - 40));
    this.renderer.resize(Math.floor(r.width), Math.floor(size), Math.min(2, window.devicePixelRatio || 1));
    if (this.world) this.renderer.fit(this.world);
  }

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
    this.renderer.reset();
    this.renderer.fit(this.world);
    this.state = 'playing';
    this.paused = false;
    this.result = null;
    this.acc = 0;
    $('selectScrim').classList.remove('show');
    $('endScrim').classList.remove('show');
    $('levelName').textContent = lvl.name;
    $('hint').textContent = lvl.hint || '';
    this.buildPhaseButtons();
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

  requestPhase(i) {
    if (this.state !== 'playing' || !this.world) return;
    if (i >= this.world.controller.phases.length) return;
    this.world.requestPhase(i);
    this.updateHud(true);
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

  clickCar(car) {
    if (car.archetype === 'emergency' && !car.priority) this.world.requestPriority(car);
  }

  priorityNearest() {
    if (!this.world) return;
    const e = this.world.cars.find(c => !c.done && c.archetype === 'emergency' && !c.priority);
    if (e) this.world.requestPriority(e);
  }

  // ---- HUD ------------------------------------------------------------------

  buildPhaseButtons() {
    const box = $('phases');
    box.innerHTML = '';
    this.world.controller.phases.forEach((p, i) => {
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
    const ctl = w.controller;
    $('clock').textContent = fmtTime(m.timeLeft);
    $('cleared').textContent = `${m.cleared} / ${m.target}`;
    $('throughBar').style.width = `${Math.min(100, m.throughput * 100)}%`;
    $('collisions').textContent = String(m.collisions);
    $('collisions').className = m.collisions ? 'bad' : '';
    $('satBar').style.width = `${Math.round(m.satisfaction * 100)}%`;
    $('satBar').style.background = m.satisfaction > 0.6 ? '#2ee06b' : m.satisfaction > 0.3 ? '#ffc21f' : '#ff3b30';
    $('waitNow').textContent = `${m.avgWait.toFixed(0)} s avg · ${m.waiting} waiting · ${m.honks} honks`;
    const stage = ctl.preemption ? 'PRIORITY' : ctl.stage === 'green' ? `${ctl.current.name} green` : ctl.stage === 'yellow' ? 'yellow' : ctl.stage === 'allred' ? 'all red' : ctl.stage;
    $('stage').textContent = stage + (ctl.next !== null ? ` → ${ctl.phases[ctl.next].name}` : '');
    for (const b of $('phases').children) {
      const i = +b.dataset.phase;
      b.classList.toggle('active', i === ctl.phase && !ctl.preemption);
      b.classList.toggle('queued', ctl.next === i);
      b.classList.toggle('green', i === ctl.phase && ctl.stage === 'green' && !ctl.preemption);
    }
    const em = w.cars.find(c => !c.done && c.archetype === 'emergency' && !c.priority);
    $('priorityBtn').classList.toggle('show', !!em);
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

if (DEBUG) {
  window.__signalCity = {
    game,
    get world() { return game.world; },
    step(n = 1) { for (let i = 0; i < n; i++) game.world.step(); game.renderer.takeEvents(game.world); },
    score() { return score(game.world); },
    meters() { return meters(game.world); },
  };
}
