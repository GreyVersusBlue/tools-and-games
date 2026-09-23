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
import { SHOP, shopItem, isOpen, nextLevel, owned, wallet, canBuy, buy, applies, loadout } from './campaign.js';
import { mountSaveBar } from '../../../assets/js/gvb-save.js';
import { waveModel, WaveHistory, drawWave } from './wave.js';
import { legDir } from './network.js';
import { exitLeg, parseMovement } from './signals.js';

const $ = id => document.getElementById(id);
const DEBUG = new URLSearchParams(location.search).has('debug');
const SVG = 'http://www.w3.org/2000/svg';

// The panel shows one section at a time (the UI pass). Each level opens on
// the tab its lesson is about; a tab whose controls the level has not
// unlocked is not offered.
const TABS = ['phases', 'timing', 'rules', 'crossings', 'mode'];
const LESSON_TAB = {
  'first-light': 'phases', stem: 'timing', 'four-ways': 'phases', crossing: 'crossings', 'two-blocks': 'timing',
  'rush-hour': 'phases', 'school-run': 'rules', 'main-street': 'phases', 'free-play': 'phases',
};
const STRIP_SECONDS = 60;
const FRESH = 2.5;          // seconds a change's cause reads as new, and a fired rule's card flashes

class Game {
  constructor() {
    this.canvas = $('board');
    this.renderer = new Renderer(this.canvas, $('ground'));
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
    this.tab = 'phases';
    this.bannerKey = '';
    bindInput({ canvas: this.canvas, renderer: this.renderer, game: this });
    window.addEventListener('resize', () => this.layout());
    this.layout();
    this.buildLevelSelect();
    this.mountSave();
    requestAnimationFrame(t => this.frame(t));
  }

  // ---- screens --------------------------------------------------------------

  // The board fills the height left under the header (the UI pass): sized
  // by the world's aspect, a corridor left an empty band under it, and a
  // single box ran 40 px past a 900 px window. fit() frames the world in
  // whatever rectangle this is, so a corridor shows more of its cross
  // streets instead. On a narrow screen the panel goes under the board and
  // the board stays square.
  layout() {
    const wrap = $('boardWrap');
    const r = wrap.getBoundingClientRect();
    const avail = window.innerHeight - (r.top + window.scrollY) - 16;
    const narrow = window.innerWidth <= 760;
    const h = narrow ? Math.min(r.width, Math.max(280, avail)) : Math.max(280, avail);
    this.renderer.resize(Math.floor(r.width), Math.floor(h), Math.min(2, window.devicePixelRatio || 1));
    if (this.world) this.renderer.fit(this.world);
  }

  // The controller the panel edits.
  get ctl() { return this.world ? this.world.controllers[Math.min(this.node, this.world.controllers.length - 1)] : null; }

  // The campaign (M8): the starred levels in order, each shut until the one
  // before it has a star, and the shop under them. A shut card is a
  // disabled button that says what opens it.
  buildLevelSelect() {
    const list = $('levelList');
    list.innerHTML = '';
    const mine = owned(this.save);
    const next = nextLevel(this.save);
    LEVELS.forEach((lvl, i) => {
      const rec = this.save.levels[lvl.id] || { stars: 0, best: 0, plays: 0 };
      const open = isOpen(this.save, lvl.id);
      const card = document.createElement('button');
      card.className = 'level-card' + (open ? '' : ' locked') + (lvl.id === next ? ' next' : '');
      card.dataset.level = lvl.id;
      card.disabled = !open;
      const takes = applies(lvl, mine).map(id => shopItem(id).name.toLowerCase());
      card.innerHTML = open
        ? `<div class="lv-name">${lvl.name}</div><div class="lv-blurb">${lvl.blurb}</div>` +
          `<div class="lv-stars">${lvl.sandbox ? 'no stars here' : starString(rec.stars)}${rec.best ? ` · best ${rec.best}` : ''}</div>` +
          `<div class="lv-meta">${Math.round(lvl.duration / 60)} min · ${lvl.mode === 'hard' ? 'one collision ends it' : 'collisions cost a star'} · clear ${lvl.target}</div>` +
          (takes.length ? `<div class="lv-bought">+ ${takes.join(', ')}</div>` : '')
        : `<div class="lv-name">${lvl.name}</div><div class="lv-shut">A star on ${LEVELS[i - 1].name} opens it.</div>`;
      if (open) card.addEventListener('click', () => this.start(lvl.id));
      list.appendChild(card);
    });
    $('starTotal').textContent = `${totalStars(this.save)} stars`;
    this.buildShop();
  }

  buildShop() {
    const box = $('shopList');
    box.innerHTML = '';
    $('wallet').textContent = `${wallet(this.save)} to spend`;
    for (const item of SHOP) {
      const c = canBuy(this.save, item.id);
      const row = document.createElement('div');
      row.className = 'shop-item' + (c.why === 'owned' ? ' owned' : '');
      row.dataset.item = item.id;
      const btn = document.createElement('button');
      btn.className = 'small buy';
      btn.disabled = !c.ok;
      btn.textContent = c.why === 'owned' ? 'owned' : `${item.cost} ★`;
      btn.addEventListener('click', () => this.buy(item.id));
      const why = c.why === 'shut' ? `A star on ${levelById(item.after).name} puts it on the shelf.`
        : c.why === 'short' ? `${item.cost - wallet(this.save)} more to go.` : '';
      row.innerHTML = `<div class="shop-text"><b>${item.name}</b><span>${item.blurb}</span>${why ? `<span class="shop-why">${why}</span>` : ''}</div>`;
      row.appendChild(btn);
      box.appendChild(row);
    }
  }

  buy(id) {
    if (!buy(this.save, id).ok) return;
    this.slot.save(this.save);
    this.buildLevelSelect();
  }

  // start() does not check the campaign's locks: the select only offers an
  // open level, and the debug hook and the suite start any.
  start(levelId, seed = null) {
    const base = levelById(levelId);
    if (!base) return;
    const lvl = loadout(base, owned(this.save));
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
    this.selectTab(LESSON_TAB[lvl.id] || 'phases');
    this.updateHud(true);
  }

  // ---- the tabs and the help (the UI pass) ------------------------------------

  tabAvailable(name) { const b = $('tabs').querySelector(`[data-tab="${name}"]`); return !!b && !b.classList.contains('hidden'); }

  selectTab(name) {
    if (!this.tabAvailable(name)) name = TABS.find(t => this.tabAvailable(t)) || 'phases';
    this.tab = name;
    $('panel').dataset.tab = name;
    for (const b of $('tabs').children) b.setAttribute('aria-selected', String(b.dataset.tab === name));
    if (name === 'timing') this.buildWave();   // the diagram sizes itself off a box that was not laid out while hidden
  }

  toggleHelp(open = null) {
    const box = $('helpBox');
    const show = open === null ? box.classList.contains('hidden') : open;
    box.classList.toggle('hidden', !show);
    $('helpBtn').setAttribute('aria-expanded', String(show));
  }

  // A level's unlocks list decides which panel controls show; what the shop
  // sold is already folded into it by loadout (M8).
  showUnlocks() {
    const u = new Set(this.level.unlocks || []);
    $('flashBox').classList.toggle('hidden', !u.has('flash'));
    $('timingBox').classList.toggle('hidden', !u.has('allred'));
    $('rulesBox').classList.toggle('hidden', !u.has('auto'));
    $('leftsNote').classList.toggle('hidden', !u.has('lefts'));
    $('phases').classList.toggle('hidden', !u.has('phases'));
    $('pedsBox').classList.toggle('hidden', !u.has('peds'));
    $('sensorsNote').classList.toggle('hidden', !u.has('sensors'));
    $('boughtNote').classList.toggle('hidden', !this.world.controllers.some(c => c.phases.some(p => p.extra)));
    $('waveBox').classList.toggle('hidden', !(u.has('offset') && this.world.controllers.length > 1 && this.world.controllers[0].plan));
    $('nodes').classList.toggle('hidden', this.world.controllers.length < 2);
    const has = { phases: u.has('phases'), timing: u.has('allred') || !$('waveBox').classList.contains('hidden'), rules: u.has('auto'), crossings: u.has('peds'), mode: u.has('flash') };
    for (const b of $('tabs').children) b.classList.toggle('hidden', !has[b.dataset.tab]);
    $('pedLateStat').classList.toggle('hidden', !this.world.controllers.some(c => c.hasPeds));
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

  // A phase card (the UI pass): its key, a drawn diagram of the box with
  // one arrow per movement the phase carries, and its name. Hovering or
  // focusing a card previews its movements on the board.
  buildPhaseButtons() {
    const box = $('phases');
    box.innerHTML = '';
    this.preview(null);
    const legs = this.world.nodes[this.node].legs;
    this.ctl.phases.forEach((p, i) => {
      const b = document.createElement('button');
      b.className = 'phase' + (p.extra ? ' bought' : '');
      b.dataset.phase = i;
      b.setAttribute('aria-label', `${i + 1}: ${p.name}, ${p.movements.join(' ')}`);
      const key = document.createElement('span'); key.className = 'key'; key.textContent = String(i + 1);
      const name = document.createElement('span'); name.className = 'name'; name.textContent = p.name;
      b.append(key, phaseDiagram(legs, p), name);
      b.addEventListener('click', () => this.requestPhase(i));
      b.addEventListener('mouseenter', () => this.preview(i));
      b.addEventListener('focus', () => this.preview(i));
      b.addEventListener('mouseleave', () => this.preview(null));
      b.addEventListener('blur', () => this.preview(null));
      box.appendChild(b);
    });
  }

  // The board draws the hovered phase's movements as arrows over the
  // asphalt; the wrap carries them as data for the suite.
  preview(i) {
    const p = i === null || !this.world ? null : this.ctl.phases[i];
    this.renderer.preview = p ? { node: this.node, movements: p.movements.slice(), permissive: p.permissive.slice() } : null;
    $('boardWrap').dataset.preview = p ? p.movements.join(',') : '';
    for (const b of $('phases').children) b.classList.toggle('previewing', p !== null && +b.dataset.phase === i);
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
    $('satVal').textContent = `${Math.round(m.satisfaction * 100)}%`;
    $('avgWait').textContent = `${m.avgWait.toFixed(0)} s`;
    $('waitingNow').textContent = String(m.waiting);
    $('honks').textContent = String(m.honks);
    $('pedLate').textContent = String(m.pedLate);
    $('pedLate').className = m.pedLate ? 'bad' : '';
    const flashing = ctl.stage === 'flash';
    const stageOf = c => {
      const fl = c.stage === 'flash';
      const st = c.preemption ? 'PRIORITY' : c.stage === 'green' ? `${c.current.name} green` : c.stage === 'yellow' ? 'yellow' : c.stage === 'allred' ? 'all red'
        : fl ? (c.flash === 'red' ? 'flashing red: four-way stop' : `flashing yellow on ${c.flash.major.join(' and ')}`) : c.stage === 'dark' ? 'dark: four-way stop' : c.stage;
      return st + (c.next !== null ? ` → ${c.phases[c.next].name}` : '') + (c.walk ? ` · ${c.walk.stage === 'walk' ? 'WALK' : 'clearing'} ${c.walk.legs.join(' ')}` : '');
    };
    $('stage').textContent = w.controllers.length > 1 ? w.controllers.map((c, i) => `${i === 0 ? 'W' : 'E'}: ${stageOf(c)}`).join(' · ') : stageOf(ctl);
    // (d) what changed it, the strip of the last minute, and the rule that fired
    const cause = $('cause');
    cause.textContent = (w.controllers.length > 1 ? `${this.node === 0 ? 'W' : 'E'}: ` : '') + causeText(ctl);
    cause.className = `cause by-${ctl.cause.by}` + (w.t - ctl.cause.t < FRESH ? ' fresh' : '');
    cause.dataset.by = ctl.cause.by;
    this.drawStrip();
    const fired = ctl.cause.by === 'rule' && w.t - ctl.cause.t < FRESH ? ctl.cause.rule : -1;
    for (const row of $('rules').children) if (row.dataset.i !== undefined) row.classList.toggle('fired', +row.dataset.i === fired);
    $('tabs').querySelector('[data-tab="rules"]').classList.toggle('fired', fired >= 0 && this.tab !== 'rules');
    this.syncBanners();
    $('boardWrap').dataset.light = this.renderer.lightFor(w);
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

  // The last 60 s of the selected box, read back out of its log: each green
  // a block coloured by what brought it, each clearance a thin band.
  drawStrip() {
    const ctl = this.ctl, T = this.world.t;
    const segs = stripSegments(ctl, T, STRIP_SECONDS);
    const x0 = T - STRIP_SECONDS;
    $('strip').innerHTML = segs.map(g => {
      const left = ((g.from - x0) / STRIP_SECONDS) * 100, width = ((g.to - g.from) / STRIP_SECONDS) * 100;
      const n = g.stage === 'green' ? (g.name === 'priority' ? 'P' : String(ctl.phases.findIndex(p => p.name === g.name) + 1)) : '';
      return `<span class="seg ${g.stage} by-${g.by}" data-by="${g.by}" data-stage="${g.stage}" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%" title="${g.stage === 'green' ? g.name + ' green' : g.stage}, ${Math.round(g.to - g.from)} s, ${BY_LABEL[g.by] || g.by}">${width > 5 ? n : ''}</span>`;
    }).join('');
  }

  // (a) the board's banners are a queue in its top-left corner, in the DOM
  // over the canvas: two events at once used to draw over each other at the
  // box's centre. The renderer keeps the list; this keeps the DOM in step.
  syncBanners() {
    const t = this.world.t;
    const live = this.renderer.banners.filter(b => t - b.t0 < b.ttl);
    const key = live.map(b => b.id).join(',');
    if (key === this.bannerKey) return;
    this.bannerKey = key;
    const box = $('banners');
    box.innerHTML = '';
    for (const b of live) { const d = document.createElement('div'); d.className = `banner ${b.tone}`; d.textContent = b.text; box.appendChild(d); }
  }

  mountSave() {
    mountSaveBar($('saveBar'), this.slot, {
      getState: () => this.save,
      setState: s => { this.save = s; this.buildLevelSelect(); },
      filename: 'signal-city-save.json',
    });
  }
}

// What changed the signal, in words, for the Signal line.
const BY_LABEL = { start: 'the level\'s start', player: 'you', rule: 'a rule', plan: 'the timed plan', offset: 'the offset', corridor: 'the priority corridor', outage: 'the power', flash: 'flash mode' };
function causeText(ctl) {
  const c = ctl.cause;
  switch (c.by) {
    case 'player': return c.hold ? 'Held by you: its rule counts from the press' : 'Changed by you';
    case 'rule': return `Changed by ${c.text}`;
    case 'plan': return 'Changed by the timed plan';
    case 'offset': return Math.abs(ctl.shift) > 1e-6 ? `Changed by the offset: ${Math.abs(ctl.shift).toFixed(0)} s still to ${ctl.shift > 0 ? 'cut' : 'add'}` : 'Changed by the offset, now paid';
    case 'corridor': return c.back ? 'Handed back by the priority corridor' : 'Changed by the priority corridor';
    case 'outage': return c.back ? 'Changed by the power coming back' : 'Dark: the power is out';
    case 'flash': return 'Flash mode, set by you';
    default: return 'The level\'s opening phase';
  }
}

// The runs of the last `span` seconds of one controller, from its log:
// [{ from, to, stage, name, by }]. The state before the window is the
// last entry before it, or the controller's first state.
const STAGE_OF = { green: 'green', yellow: 'yellow', allred: 'allred', resume: 'allred', flash: 'flash', dark: 'dark' };
function stripSegments(ctl, T, span) {
  const x0 = Math.max(0, T - span);
  const log = ctl.log.filter(l => STAGE_OF[l.kind]);
  let cur = { stage: ctl.initial.stage, name: ctl.phases[ctl.initial.phase].name, by: 'start', from: 0 };
  const out = [];
  for (const l of log) {
    const st = STAGE_OF[l.kind];
    const next = { stage: st, name: st === 'green' ? l.detail : cur.name, by: l.by || 'start', from: l.t };
    if (l.t > x0) out.push({ ...cur, from: Math.max(cur.from, x0), to: l.t });
    cur = next;
  }
  out.push({ ...cur, from: Math.max(cur.from, x0), to: T });
  return out.filter(g => g.to > g.from);
}

// The phase diagram: the box and its legs in a 24-unit square, one arrow
// per movement from the entry lane (the driver's right, arriving) to the
// exit lane, curved through the corner for a turn; a permissive left is
// dashed, a walk is a bar across its leg. Built from the phase's own
// movements, so a phase set changed in a level draws itself.
function phaseDiagram(legs, phase) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '-12 -12 24 24');
  svg.setAttribute('class', 'dia');
  svg.setAttribute('aria-hidden', 'true');
  const el = (tag, attrs) => { const e = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); svg.appendChild(e); return e; };
  el('rect', { class: 'road', x: -4, y: -4, width: 8, height: 8 });
  for (const leg of legs) {
    const [dx, dy] = legDir(leg);
    el('rect', { class: 'road', x: dx === 0 ? -4 : Math.min(0, dx * 12), y: dy === 0 ? -4 : Math.min(0, dy * 12), width: dx === 0 ? 8 : 12, height: dy === 0 ? 8 : 12 });
  }
  for (const w of phase.walks) {
    const [dx, dy] = legDir(w.slice(2));
    el('rect', { class: 'walk', x: dx === 0 ? -4 : dx * 6 - 0.7, y: dy === 0 ? -4 : dy * 6 - 0.7, width: dx === 0 ? 8 : 1.4, height: dy === 0 ? 8 : 1.4 });
  }
  const f = n => +n.toFixed(2);
  for (const m of phase.movements) {
    const mv = parseMovement(m);
    if (mv.ped) continue;
    const d = legDir(mv.entry), e = legDir(exitLeg(mv.entry, mv.turn));
    const rr = [d[1], -d[0]];                    // the driver's right, arriving
    const re = [-e[1], e[0]];                    // the driver's right, leaving
    const p0 = [d[0] * 11 + rr[0] * 2, d[1] * 11 + rr[1] * 2];
    const pe = [e[0] * 9 + re[0] * 2, e[1] * 9 + re[1] * 2];
    const c = d[0] === 0 ? [p0[0], pe[1]] : [pe[0], p0[1]];
    const path = mv.turn === 'T' ? `M${f(p0[0])} ${f(p0[1])}L${f(pe[0])} ${f(pe[1])}` : `M${f(p0[0])} ${f(p0[1])}Q${f(c[0])} ${f(c[1])} ${f(pe[0])} ${f(pe[1])}`;
    el('path', { class: 'mv' + (phase.permissive.includes(m) ? ' permissive' : ''), 'data-mv': m, d: path });
    const tip = [pe[0] + e[0] * 2.2, pe[1] + e[1] * 2.2];
    el('path', { class: 'head', d: `M${f(tip[0])} ${f(tip[1])}L${f(pe[0] + re[0] * 1.3)} ${f(pe[1] + re[1] * 1.3)}L${f(pe[0] - re[0] * 1.3)} ${f(pe[1] - re[1] * 1.3)}Z` });
  }
  return svg;
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
$('helpBtn').addEventListener('click', () => game.toggleHelp());
for (const b of $('tabs').children) b.addEventListener('click', () => game.selectTab(b.dataset.tab));

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
    banners() { return [...document.querySelectorAll('#banners .banner')].map(e => { const r = e.getBoundingClientRect(); return { text: e.textContent, left: r.left, top: r.top, right: r.right, bottom: r.bottom }; }); },
    tab(name) { game.selectTab(name); },
    // what the player sees: the ground with the board drawn over it, for the suite's pixel reads
    canvas() { const b = game.canvas, c = document.createElement('canvas'); c.width = b.width; c.height = b.height; const x = c.getContext('2d'); x.drawImage($('ground'), 0, 0); x.drawImage(b, 0, 0); return c; },
  };
}
