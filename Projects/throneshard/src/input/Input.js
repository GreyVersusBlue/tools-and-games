import * as THREE from 'three';
import { TEAM_COLORS } from '../core/constants.js';
import { Keybinds, keyLabel } from './Keybinds.js';

// RTS / MOBA controls. See ARCHITECTURE.md "Input contract".
// Public API: beginCast(ability), beginItemCast(slotOrItem), cancelTargeting(), pickUnit(x,y), pickGround(x,y),
// hoveredUnit, targeting, quickCast, orderMove(point, queue), orderAttackMove(point, queue), orderAttack(unit, queue),
// confirmTargetAt(pointOrUnit) (e.g. minimap click while targeting), select(units), setQuickCast(bool),
// castMode ('normal'|'quick'|'release'), setCastMode(mode), keybinds (Keybinds: codeFor/actionFor/label/set/reset),
// keyLabel(action) -> display string for HUD hotkey hints.

const ABILITY_ACTIONS = { ability1: 0, ability2: 1, ability3: 2, ability4: 3, ability5: 4, ability6: 5 };
const ITEM_ACTIONS = { item1: 0, item2: 1, item3: 2, item4: 3, item5: 4, item6: 5 };
const CAST_MODES = ['normal', 'quick', 'release'];
const HOLD_MOVE_INTERVAL = 0.1; // s between re-issued move orders while right mouse is held (~10 Hz)
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _ndc = new THREE.Vector2();
const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

const isTyping = () => {
  const a = document.activeElement;
  return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable);
};
const lvlVal = (v, level) => (Array.isArray(v) ? v[Math.max(0, Math.min(v.length - 1, (level || 1) - 1))] : v);

// ---------- cursors (drawn on canvas -> data URL) ----------
function makeCursor(draw, hx, hy, fallback) {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const ctx = c.getContext('2d');
    draw(ctx);
    return `url(${c.toDataURL('image/png')}) ${hx} ${hy}, ${fallback}`;
  } catch { return fallback; }
}
function buildCursors() {
  const gauntlet = makeCursor((x) => {
    // armored pointer (gauntlet-ish arrow)
    x.lineJoin = 'round';
    x.beginPath();
    x.moveTo(2, 2); x.lineTo(2, 24); x.lineTo(8, 19); x.lineTo(12, 28); x.lineTo(16, 26); x.lineTo(12, 17); x.lineTo(20, 17);
    x.closePath();
    const g = x.createLinearGradient(0, 0, 20, 28);
    g.addColorStop(0, '#f6e7b0'); g.addColorStop(0.5, '#c9a54a'); g.addColorStop(1, '#7a5a1c');
    x.fillStyle = g; x.fill();
    x.lineWidth = 1.6; x.strokeStyle = '#2a1a06'; x.stroke();
    x.beginPath(); x.moveTo(4, 6); x.lineTo(4, 18); x.strokeStyle = 'rgba(255,255,255,0.6)'; x.lineWidth = 1; x.stroke();
  }, 2, 2, 'default');
  const sword = makeCursor((x) => {
    x.save(); x.translate(3, 3); x.rotate(-Math.PI / 4);
    // blade
    x.beginPath(); x.moveTo(0, 0); x.lineTo(3, 5); x.lineTo(3, 22); x.lineTo(-3, 22); x.lineTo(-3, 5); x.closePath();
    const g = x.createLinearGradient(-3, 0, 3, 0);
    g.addColorStop(0, '#9aa'); g.addColorStop(0.5, '#fff'); g.addColorStop(1, '#788');
    x.fillStyle = g; x.fill(); x.strokeStyle = '#300'; x.lineWidth = 1.2; x.stroke();
    // guard + hilt
    x.fillStyle = '#b22'; x.fillRect(-7, 22, 14, 3); x.strokeRect(-7, 22, 14, 3);
    x.fillStyle = '#5a2e0e'; x.fillRect(-1.5, 25, 3, 6);
    x.restore();
  }, 2, 2, 'crosshair');
  const cross = (color) => makeCursor((x) => {
    x.strokeStyle = '#000'; x.lineWidth = 4;
    x.beginPath(); x.arc(16, 16, 9, 0, Math.PI * 2); x.stroke();
    x.strokeStyle = color; x.lineWidth = 2; x.stroke();
    x.beginPath();
    for (const [a, b, c, d] of [[16, 1, 16, 10], [16, 22, 16, 31], [1, 16, 10, 16], [22, 16, 31, 16]]) { x.moveTo(a, b); x.lineTo(c, d); }
    x.strokeStyle = '#000'; x.lineWidth = 3.5; x.stroke();
    x.strokeStyle = color; x.lineWidth = 1.6; x.stroke();
    x.fillStyle = color; x.fillRect(15, 15, 2, 2);
  }, 16, 16, 'crosshair');
  const ally = makeCursor((x) => {
    x.beginPath(); x.moveTo(2, 2); x.lineTo(2, 22); x.lineTo(7, 17); x.lineTo(11, 26); x.lineTo(14, 24); x.lineTo(10, 16); x.lineTo(17, 16); x.closePath();
    x.fillStyle = '#9fe39f'; x.fill(); x.strokeStyle = '#063'; x.lineWidth = 1.6; x.stroke();
  }, 2, 2, 'pointer');
  return { default: gauntlet, enemy: sword, target: cross('#ffd24a'), targetEnemy: cross('#ff4a3a'), targetAlly: cross('#6cff7a'), ally };
}

export class Input {
  constructor(game) {
    this.game = game;
    this.ray = new THREE.Raycaster();
    this.mouse = new THREE.Vector2(); // NDC
    this.client = { x: innerWidth / 2, y: innerHeight / 2 };
    this.hoveredUnit = null;
    this.targeting = null; // { kind:'ability'|'item'|'attackMove', ability?, slot?, targetType, targetTeam }
    let mode = null;
    try { mode = localStorage.getItem('throneshard.castMode') ?? (localStorage.getItem('throneshard.quickCast') === '1' ? 'quick' : null); } catch { /* ignore */ }
    this.castMode = CAST_MODES.includes(mode) ? mode : 'normal';
    this.keybinds = new Keybinds();
    this._heldCast = null; // {ability, code} while an ability hotkey is physically held (range preview / release cast)
    this.keysDown = new Set();
    this._rmbHeld = false;
    this._rmbTimer = 0;
    this._hoverDirty = true;
    this._box = null;
    this._cursor = '';
    this.enabled = true;
  }

  async init() {
    const g = this.game;
    this.canvas = g.renderer?.domElement;
    this.cursors = buildCursors();
    this.buildIndicators();

    window.addEventListener('contextmenu', (e) => { if (this.isWorldTarget(e.target) || e.target === this.canvas) e.preventDefault(); });
    window.addEventListener('mousemove', (e) => this.onMouseMove(e));
    window.addEventListener('mousedown', (e) => this.onMouseDown(e));
    window.addEventListener('mouseup', (e) => this.onMouseUp(e));
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
    window.addEventListener('blur', () => { this.keysDown.clear(); this._rmbHeld = false; this._heldCast = null; this.endBox(true); });

    g.bus.on('unit:removed', ({ unit }) => this.dropUnit(unit));
    g.bus.on('unit:died', ({ unit }) => { if (unit.kind !== 'hero') this.dropUnit(unit); });
    g.bus.on('hero:killed', ({ victim }) => { if (victim === g.player.hero && this.targeting) this.cancelTargeting(); });
    g.bus.on('match:end', () => this.cancelTargeting());
    g.bus.on('settings:quickCast', (v) => this.setQuickCast(!!(v?.value ?? v)));
    g.bus.on('settings:castMode', (v) => this.setCastMode(v?.mode ?? v?.value ?? v));
    this.setCursor('default');
  }

  onMatchStart() {
    this.select([this.game.player.hero].filter(Boolean), false);
  }

  get quickCast() { return this.castMode === 'quick'; }
  set quickCast(v) { this.castMode = v ? 'quick' : 'normal'; }
  setQuickCast(v) { this.setCastMode(v ? 'quick' : 'normal'); }
  setCastMode(mode) {
    if (!CAST_MODES.includes(mode)) return;
    this.castMode = mode;
    try { localStorage.setItem('throneshard.castMode', mode); localStorage.setItem('throneshard.quickCast', mode === 'quick' ? '1' : '0'); } catch {}
    this.game.bus.emit('input:castMode', { mode });
  }
  keyLabel(action) { return this.keybinds.label(action); }
  codeLabel(code) { return keyLabel(code); }

  // ---------------------------------------------------------------- helpers
  get hero() { return this.game.player.hero; }
  isWorldTarget(el) {
    if (!el) return false;
    if (el === this.canvas) return true;
    return el === document.body || el === document.documentElement || el.id === 'ui-root' || el.id === 'app' || !!el.closest?.('[data-world-click]');
  }
  controllable(u) {
    const h = this.hero;
    return u && u.alive && (u === h || (u.owner && u.owner === h) || (u.controllableBy === 'player')) && u.team === this.game.player.team;
  }
  // Units that receive orders: selected controllable units, else the hero.
  orderUnits() {
    const sel = (this.game.player.selected ?? []).filter((u) => this.controllable(u));
    if (sel.length) return sel;
    return this.hero?.alive ? [this.hero] : [];
  }
  error(message) {
    this.game.bus.emit('ui:error', { unit: this.hero, message });
  }
  dropUnit(unit) {
    if (this.hoveredUnit === unit) this.hoveredUnit = null;
    const sel = this.game.player.selected ?? [];
    if (sel.includes(unit)) {
      const rest = sel.filter((u) => u !== unit && u.alive);
      this.select(rest.length ? rest : [this.hero].filter(Boolean));
    }
  }

  // ---------------------------------------------------------------- picking
  setNdc(cx, cy) {
    this.mouse.set((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
    return this.mouse;
  }

  // Ground point under a screen position. Uses the world heightfield if exposed, otherwise the terrain mesh, else y=0.
  pickGround(cx = this.client.x, cy = this.client.y, precise = false) {
    const g = this.game;
    if (!g.camera) return null;
    _ndc.set((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
    this.ray.setFromCamera(_ndc, g.camera);
    const out = new THREE.Vector3();
    const w = g.world;
    const mesh = w?.terrainMesh ?? w?.ground;
    if (precise && mesh?.isObject3D && !w?.getHeight) {
      try {
        const hit = this.ray.intersectObject(mesh, true)[0];
        if (hit) return out.copy(hit.point);
      } catch {}
    }
    _plane.constant = 0;
    if (!this.ray.ray.intersectPlane(_plane, out)) {
      // looking at the sky: project far along the ray
      out.copy(this.ray.ray.direction).setY(0).normalize().multiplyScalar(80).add(g.camera.position).setY(0);
      return out;
    }
    if (w?.getHeight) {
      // refine against heightfield (fixed-point iteration on the ray)
      for (let i = 0; i < 4; i++) {
        const h = w.getHeight(out.x, out.z);
        if (!Number.isFinite(h)) break;
        _plane.constant = -h;
        if (!this.ray.ray.intersectPlane(_plane, _v)) break;
        out.copy(_v);
      }
      const h = w.getHeight(out.x, out.z);
      if (Number.isFinite(h)) out.y = h;
    } else if (mesh?.isObject3D && precise) {
      // handled above
    }
    return out;
  }

  pickable(u) {
    const g = this.game;
    if (!u || !u.alive || u.object?.visible === false) return false;
    if (u.data?.unselectable || u.unselectable) return false;
    return u.team === g.player.team || g.canSee(g.player.team, u);
  }

  // Unit under a screen position: raycast against unit hierarchies (precise), then screen-space capsule fallback.
  pickUnit(cx = this.client.x, cy = this.client.y, { precise = true, filter } = {}) {
    const g = this.game;
    if (!g.camera) return null;
    const ok = (u) => this.pickable(u) && (!filter || filter(u));
    if (precise) {
      _ndc.set((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
      this.ray.setFromCamera(_ndc, g.camera);
      this.ray.camera = g.camera;
      const objs = [];
      for (const u of g.units) if (ok(u) && u.object) objs.push(u.object);
      try {
        const hits = this.ray.intersectObjects(objs, true);
        for (const h of hits) {
          if (h.object.userData?.noPick || h.object.isSprite) continue;
          let o = h.object;
          while (o && !o.userData?.unit) o = o.parent;
          const u = o?.userData?.unit;
          if (u && ok(u)) return u;
        }
      } catch {}
    }
    return this.screenPick(cx, cy, ok);
  }

  // Screen-space picking: each unit is a capsule from its feet to its head; generous radius so small units are easy to click.
  screenPick(cx, cy, ok) {
    const g = this.game;
    const cam = g.camera;
    const w = innerWidth, h = innerHeight;
    let best = null, bestScore = Infinity;
    const camDist = g.cameraCtl?.getDistance?.() ?? 31;
    const pxPerUnit = h / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * camDist);
    for (const u of g.units) {
      if (!ok(u)) continue;
      _v.copy(u.position).project(cam);
      if (_v.z > 1 || _v.x < -1.2 || _v.x > 1.2 || _v.y < -1.2 || _v.y > 1.2) continue;
      const fx = (_v.x * 0.5 + 0.5) * w, fy = (-_v.y * 0.5 + 0.5) * h;
      const height = u.model?.height ?? (u.isStructure ? 8 : u.kind === 'hero' ? 2.2 : 1.6);
      _v2.copy(u.position); _v2.y += height; _v2.project(cam);
      const tx = (_v2.x * 0.5 + 0.5) * w, ty = (-_v2.y * 0.5 + 0.5) * h;
      // distance from cursor to segment feet->head
      const sx = tx - fx, sy = ty - fy;
      const len2 = sx * sx + sy * sy || 1;
      const t = Math.max(0, Math.min(1, ((cx - fx) * sx + (cy - fy) * sy) / len2));
      const d = Math.hypot(cx - (fx + sx * t), cy - (fy + sy * t));
      const r = Math.max(u.kind === 'hero' ? 20 : 16, (u.radius ?? 0.8) * pxPerUnit * (u.isStructure ? 0.9 : 1.3));
      if (d > r) continue;
      // prefer heroes slightly, then nearest to cursor, relative to size
      const score = d / r - (u.kind === 'hero' ? 0.25 : 0) + (u.isStructure ? 0.2 : 0);
      if (score < bestScore) { bestScore = score; best = u; }
    }
    return best;
  }

  // ---------------------------------------------------------------- mouse
  onMouseMove(e) {
    this.client.x = e.clientX; this.client.y = e.clientY;
    this.setNdc(e.clientX, e.clientY);
    this._hoverDirty = true;
    this._overWorld = this.isWorldTarget(e.target);
    if (this._box) this.updateBox(e.clientX, e.clientY);
  }

  onMouseDown(e) {
    if (!this.enabled || !this.game.running) return;
    this.client.x = e.clientX; this.client.y = e.clientY;
    if (!this.isWorldTarget(e.target)) return;
    this.game.audio?.unlock?.();
    const shift = e.shiftKey;
    if (e.button === 0) {
      if (e.altKey) { this.ping(this.pickGround(e.clientX, e.clientY)); return; }
      if (this.targeting) { this.confirmTargeting(e.clientX, e.clientY, shift); return; }
      this._box = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, el: null, shift };
    } else if (e.button === 2) {
      e.preventDefault();
      if (this.targeting) { this.cancelTargeting(); return; }
      this._rmbHeld = true; // rightClick() clears it again for attack / follow / deny orders
      this._rmbQueued = shift;
      this._rmbNext = performance.now() / 1000 + 0.2; // first repeat after a short delay (a click never repeats)
      this.rightClick(e.clientX, e.clientY, shift);
    }
  }

  onMouseUp(e) {
    if (e.button === 2) this._rmbHeld = false;
    if (e.button === 0 && this._box) this.endBox(false, e.shiftKey);
  }

  rightClick(cx, cy, queue, fromHold = false) {
    const units = this.orderUnits();
    if (!units.length) return;
    const target = fromHold ? null : this.pickUnit(cx, cy);
    const team = this.game.player.team;
    if (target && target.team !== team && !units.includes(target)) {
      if (target.isInvulnerable && !target.alive) return;
      this.orderAttack(target, queue);
      this._rmbHeld = false;
      return;
    }
    // Deny: right-clicking a low-HP allied creep/tower attacks it (the genre uses A-click; this is a convenience)
    if (target && target.team === team && !units.includes(target) && units.some((u) => u.canDeny?.(target))) {
      for (const u of units) if (u.canDeny?.(target)) u.issueOrder({ type: 'attack', target }, queue);
      this.game.vfx?.spawn?.('attack_marker', { position: target.position.clone() });
      this.game.bus.emit('input:command', { type: 'attack', target });
      this._rmbHeld = false;
      return;
    }
    if (target && target.team === team && !units.includes(target) && !target.isStructure) {
      for (const u of units) u.issueOrder({ type: 'follow', target }, queue);
      this.game.vfx?.spawn?.('move_marker', { position: target.position.clone(), color: 0x66ff88 });
      this.game.bus.emit('input:command', { type: 'follow', target });
      this._rmbHeld = false;
      return;
    }
    const p = this.pickGround(cx, cy, !fromHold);
    if (p) this.orderMove(p, queue, !fromHold);
  }

  orderMove(point, queue = false, marker = true) {
    const units = this.orderUnits();
    if (!units.length || !point) return;
    const p = new THREE.Vector3(point.x, point.y ?? 0, point.z);
    this.clampPoint(p);
    units.forEach((u, i) => {
      const off = units.length > 1 ? new THREE.Vector3(Math.cos(i * 2.4) * 1.2 * Math.sqrt(i), 0, Math.sin(i * 2.4) * 1.2 * Math.sqrt(i)) : null;
      u.issueOrder({ type: 'move', point: off ? p.clone().add(off) : p.clone() }, queue);
    });
    if (marker) {
      // queued (shift) waypoints get an amber marker so the queue is readable
      this.game.vfx?.spawn?.('move_marker', queue ? { position: p.clone(), color: 0xffc24a } : { position: p.clone() });
      this.game.bus.emit('input:command', { type: 'move', point: p, queue });
    }
  }
  orderAttack(target, queue = false) {
    const units = this.orderUnits();
    if (!units.length || !target) return;
    for (const u of units) u.issueOrder({ type: 'attack', target }, queue);
    this.game.vfx?.spawn?.('attack_marker', { position: target.position.clone(), unit: target, target });
    this.game.bus.emit('input:command', { type: 'attack', target });
  }
  orderAttackMove(point, queue = false) {
    const units = this.orderUnits();
    if (!units.length || !point) return;
    const p = this.clampPoint(new THREE.Vector3(point.x, point.y ?? 0, point.z));
    for (const u of units) u.issueOrder({ type: 'attackMove', point: p.clone() }, queue);
    this.game.vfx?.spawn?.('attack_marker', { position: p.clone() });
    this.game.bus.emit('input:command', { type: 'attackMove', point: p });
  }
  clampPoint(p) {
    p.x = Math.max(-99, Math.min(99, p.x));
    p.z = Math.max(-99, Math.min(99, p.z));
    return p;
  }

  ping(p) {
    if (!p) return;
    this.game.vfx?.spawn?.('ping', { position: p.clone(), color: 0xffe066 });
    this.game.bus.emit('minimap:ping', { position: p.clone(), team: this.game.player.team, hero: this.hero });
    this.game.bus.emit('ui:ping', { position: p.clone(), team: this.game.player.team });
  }

  // ---------------------------------------------------------------- selection
  select(units, emit = true) {
    const g = this.game;
    g.player.selected = units;
    if (emit) g.bus.emit('selection:changed', { units });
  }
  updateBox(x, y) {
    const b = this._box;
    b.x1 = x; b.y1 = y;
    if (!b.el && Math.hypot(b.x1 - b.x0, b.y1 - b.y0) > 8) {
      b.el = document.createElement('div');
      b.el.style.cssText = 'position:fixed;border:1px solid #7cff8a;background:rgba(80,255,120,0.08);pointer-events:none;z-index:50;';
      document.body.appendChild(b.el);
    }
    if (b.el) {
      Object.assign(b.el.style, {
        left: Math.min(b.x0, b.x1) + 'px', top: Math.min(b.y0, b.y1) + 'px',
        width: Math.abs(b.x1 - b.x0) + 'px', height: Math.abs(b.y1 - b.y0) + 'px',
      });
    }
  }
  endBox(cancel, shift) {
    const b = this._box;
    this._box = null;
    if (!b) return;
    b.el?.remove();
    if (cancel) return;
    if (!b.el) {
      // simple click select
      const u = this.pickUnit(b.x0, b.y0);
      if (!u) return; // clicking ground keeps selection (genre convention)
      if (shift && this.controllable(u)) {
        const cur = (this.game.player.selected ?? []).filter((s) => this.controllable(s));
        this.select(cur.includes(u) ? cur.filter((s) => s !== u) : [...cur, u]);
      } else this.select([u]);
      this.game.bus.emit('ui:sound', { name: 'select' });
      return;
    }
    // box select own controllable units
    const x0 = Math.min(b.x0, b.x1), x1 = Math.max(b.x0, b.x1), y0 = Math.min(b.y0, b.y1), y1 = Math.max(b.y0, b.y1);
    const inBox = [];
    for (const u of this.game.units) {
      if (!this.controllable(u)) continue;
      _v.copy(u.position).project(this.game.camera);
      const sx = (_v.x * 0.5 + 0.5) * innerWidth, sy = (-_v.y * 0.5 + 0.5) * innerHeight;
      if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) inBox.push(u);
    }
    if (inBox.length) this.select(inBox);
  }

  // ---------------------------------------------------------------- keyboard
  onKeyDown(e) {
    if (isTyping()) return;
    const g = this.game;
    const code = e.code;
    const first = !this.keysDown.has(code);
    this.keysDown.add(code);
    if (code === 'Tab') {
      e.preventDefault();
      if (first) g.bus.emit('ui:toggleScoreboard', { show: true });
      return;
    }
    if (/^F\d+$/.test(code)) e.preventDefault();
    if (this._capture) return; // settings screen is capturing a key for rebinding
    if (!g.running) return;
    g.audio?.unlock?.();
    const hero = this.hero;
    const action = this.keybinds.actionFor(code);

    if (code === 'Escape') { if (this.targeting) this.cancelTargeting(); else g.bus.emit('ui:escape', {}); return; }
    if (code === 'F4') { if (first) g.bus.emit('ui:toggleShop', {}); return; }
    if (code === 'F9') {
      if (!first) return;
      g.paused = !g.paused;
      g.bus.emit('game:paused', { paused: g.paused });
      g.bus.emit('ui:message', { text: g.paused ? 'Game paused (F9)' : 'Game resumed', color: '#ffd24a' });
      return;
    }
    if (action === 'selectHero') { if (hero) this.select([hero]); return; }
    if (action === 'selectAll') { this.select(g.units.filter((u) => this.controllable(u))); return; }
    if (!first || e.repeat) return;
    if (g.paused) return;

    // Level up: Ctrl/Alt + ability key (browser may reserve Ctrl+W; Alt works too)
    if ((e.ctrlKey || e.altKey) && action in ABILITY_ACTIONS) {
      e.preventDefault();
      const i = ABILITY_ACTIONS[action];
      if (hero?.levelAbility?.(i)) g.bus.emit('ui:sound', { name: 'learn' });
      else if (hero?.abilities?.[i]) this.error(hero.abilityPoints > 0 ? 'Cannot level this ability yet' : 'No ability points');
      return;
    }
    if (e.ctrlKey || e.metaKey) return;

    if (action in ABILITY_ACTIONS) {
      const ab = hero?.abilities?.[ABILITY_ACTIONS[action]];
      if (!ab) return; // 5th/6th slot only when such an ability exists
      this.beginCast(ab, { shift: e.shiftKey, key: code });
      return;
    }
    if (action in ITEM_ACTIONS) { this.beginItemCast(ITEM_ACTIONS[action], { shift: e.shiftKey, key: code }); return; }
    if (action === 'tp') { this.beginItemCast(this.findTpSlot(), { shift: e.shiftKey, key: code }); return; }
    if (action === 'attack') {
      this.cancelTargeting(true);
      this.setTargeting({ kind: 'attackMove', targetType: 'point', targetTeam: 'enemy', key: code });
      if (this.castMode === 'quick') this.confirmTargeting(this.client.x, this.client.y, e.shiftKey);
      else if (this.castMode === 'release') this._heldCast = { code, attackMove: true };
      return;
    }
    if (action === 'stop') { this.cancelTargeting(); for (const u of this.orderUnits()) u.issueOrder({ type: 'stop' }); g.bus.emit('input:command', { type: 'stop' }); return; }
    if (action === 'hold') { this.cancelTargeting(); for (const u of this.orderUnits()) u.issueOrder({ type: 'hold' }); g.bus.emit('input:command', { type: 'hold' }); return; }
  }

  onKeyUp(e) {
    this.keysDown.delete(e.code);
    if (e.code === 'Tab') { e.preventDefault(); this.game.bus.emit('ui:toggleScoreboard', { show: false }); }
    const h = this._heldCast;
    if (h && h.code === e.code) {
      this._heldCast = null;
      // "Quick cast on key release": fire at the cursor when the hotkey is released (targeting stays active if the
      // release point is not a valid target, so the player can still click).
      const t = this.targeting;
      if (this.castMode === 'release' && t && (t.key === e.code) && (h.attackMove ? t.kind === 'attackMove' : t.ability === h.ability)) {
        this.confirmTargeting(this.client.x, this.client.y, e.shiftKey || !!t.shift, true);
      }
    }
  }

  findTpSlot() {
    const h = this.hero;
    if (!h) return -1;
    if (h.homeScroll) return 'tp';
    const inv = h.inventory ?? [];
    const idx = inv.findIndex((it) => it && /(^|_)(tp|teleport|town_portal)/i.test(it.def?.id ?? ''));
    return idx;
  }

  // ---------------------------------------------------------------- casting
  targetTypeOf(ab) {
    const d = ab?.def ?? {};
    if (ab?.isItem) return d.active?.targetType ?? d.targetType ?? 'none';
    return d.targetType ?? 'none';
  }
  targetTeamOf(ab) {
    const d = ab?.def ?? {};
    return (ab?.isItem ? d.active?.targetTeam : null) ?? d.targetTeam ?? 'enemy';
  }

  // Pre-checks that don't depend on the target (cooldown, mana, level, silence...)
  precheck(ab, isItem) {
    const hero = this.hero;
    if (!hero?.alive) return 'You are dead';
    if (hero.isStunned) return 'Stunned';
    if (!isItem && (ab.level ?? 1) <= 0) return 'Ability not learned';
    if (!isItem && hero.isSilenced) return 'Silenced';
    if (isItem && hero.hasState?.('muted')) return 'Muted';
    if ((ab.cooldownRemaining ?? 0) > 0) return (isItem ? 'Item' : 'Ability') + ' on cooldown';
    const mana = ab.getManaCost?.() ?? 0;
    if (mana > 0 && hero.mana < mana) return 'Not enough mana';
    return null;
  }

  beginCast(ability, opts = {}) {
    if (!ability || !this.game.running) return false;
    const hero = this.hero;
    const tt = this.targetTypeOf(ability);
    if (tt === 'passive') { this.error('Ability is passive'); return false; }
    // double tap on the same key: self-cast for ally-targetable unit spells
    if (this.targeting?.ability === ability && opts.key) {
      if (tt === 'unit' && this.targetTeamOf(ability) !== 'enemy') { this.executeCast(hero, opts.shift); return true; }
      if (tt === 'point') { this.executeCast(hero.position.clone(), opts.shift); return true; }
    }
    const err = this.precheck(ability, !!ability.isItem);
    if (err) { this.error(err); return false; }
    this.cancelTargeting(true);
    const t = { kind: ability.isItem ? 'item' : 'ability', ability, slot: opts.slot, targetType: tt, targetTeam: this.targetTeamOf(ability), key: opts.key, shift: !!opts.shift };
    if (tt === 'none' || tt === 'toggle') {
      this.targeting = t;
      this.executeCast(null, opts.shift);
      if (opts.key) this._heldCast = { code: opts.key, ability, preview: true };
      return true;
    }
    this.setTargeting(t);
    if (opts.key) this._heldCast = { code: opts.key, ability };
    // Quick cast fires immediately at the cursor. Hotkey-only: clicking the HUD button always uses normal targeting
    // (the cursor is over the HUD then). "Quick cast on key release" fires in onKeyUp.
    if ((this.castMode === 'quick' && opts.key) || opts.quickCast) this.confirmTargeting(this.client.x, this.client.y, opts.shift, true);
    return true;
  }

  beginItemCast(slot, opts = {}) {
    const hero = this.hero;
    if (!hero || slot == null || slot === -1) return false;
    const item = typeof slot === 'object' ? slot : slot === 'tp' ? hero.homeScroll : hero.inventory?.[slot];
    if (!item) return false;
    const idx = typeof slot === 'number' ? slot : hero.inventory?.indexOf(item);
    const tt = this.targetTypeOf(item);
    if (!item.def?.active && !item.cast && tt === 'none') { this.error('Item has no active ability'); return false; }
    const can = typeof idx === 'number' && idx >= 0 ? this.game.items?.canUse?.(hero, idx) : undefined;
    if (can === false || (can && can.ok === false)) { this.error(can?.reason ?? 'Cannot use item'); return false; }
    if (!item.isItem) item.isItem = true;
    return this.beginCast(item, { ...opts, slot: idx });
  }

  setTargeting(t) {
    this.targeting = t;
    this._hoverDirty = true;
    this.game.bus.emit('input:targeting', { targeting: t });
  }

  cancelTargeting(silent = false) {
    if (!this.targeting) return;
    this.targeting = null;
    this.hideIndicators();
    if (!silent) this.game.bus.emit('input:targeting', { targeting: null });
    else this.game.bus.emit('input:targeting', { targeting: null });
  }

  // Minimap / UI can call this while targeting with a world point or unit.
  confirmTargetAt(pointOrUnit, queue = false) {
    const t = this.targeting;
    if (!t || !pointOrUnit) return false;
    if (t.kind === 'attackMove') {
      if (pointOrUnit.alive !== undefined && pointOrUnit.position) this.orderAttack(pointOrUnit, queue);
      else this.orderAttackMove(pointOrUnit, queue);
      this.cancelTargeting();
      return true;
    }
    return this.executeCast(pointOrUnit, queue);
  }

  validTarget(u, t) {
    if (!u) return false;
    const team = this.game.player.team;
    const hero = this.hero;
    if (t.targetTeam === 'enemy') return u.team !== team;
    if (t.targetTeam === 'ally') return u.team === team;
    if (t.targetTeam === 'self') return u === hero;
    return true;
  }

  confirmTargeting(cx, cy, queue = false, fromQuickCast = false) {
    const t = this.targeting;
    if (!t) return;
    if (t.kind === 'attackMove') {
      const u = this.pickUnit(cx, cy);
      if (u && u.team !== this.game.player.team) this.orderAttack(u, queue);
      else { const p = this.pickGround(cx, cy, true); if (p) this.orderAttackMove(p, queue); }
      this.cancelTargeting();
      return;
    }
    if (t.targetType === 'unit') {
      const u = this.pickUnit(cx, cy, { filter: (x) => this.validTarget(x, t) });
      if (!u) {
        if (fromQuickCast) return; // stay in targeting mode
        this.error(t.targetTeam === 'ally' ? 'Must target an ally' : t.targetTeam === 'enemy' ? 'Must target an enemy unit' : 'Must target a unit');
        return; // Targeting stays active on invalid clicks
      }
      this.executeCast(u, queue);
      return;
    }
    // point (or unit-or-point)
    const p = this.pickGround(cx, cy, true);
    if (p) this.executeCast(p, queue);
  }

  // target: Unit | Vector3 | null
  executeCast(target, queue = false) {
    const t = this.targeting;
    const hero = this.hero;
    if (!t || !hero) return false;
    const ab = t.ability;
    const isUnit = target && target.position && target.alive !== undefined;
    const order = { type: 'cast', ability: ab };
    if (isUnit) order.target = target;
    else if (target) order.point = this.clampPoint(new THREE.Vector3(target.x, target.y ?? 0, target.z));

    const tt = t.targetType;
    const items = this.game.items;
    if (ab.isItem && !ab.cast && items?.use) {
      // item system handles everything itself
      const r = items.use(hero, t.slot, isUnit ? target : order.point ?? null);
      if (r && r.ok === false) this.error(r.reason ?? 'Cannot use item');
    } else if (tt === 'toggle' && ab.toggle) {
      ab.toggle();
    } else {
      const chk = ab.canCast?.(isUnit ? target : order.point ?? null);
      if (chk && chk.ok === false && !/range/i.test(chk.reason ?? '')) {
        this.error(chk.reason ?? 'Cannot cast');
        if (tt !== 'none' && tt !== 'toggle') return false; // keep targeting mode
      } else if ((tt === 'none' || tt === 'toggle') && ab.isItem && (ab.def?.active?.castPoint ?? ab.def?.castPoint ?? 0) <= 0 && items?.use && typeof t.slot === 'number') {
        // instant items don't interrupt the hero (genre convention)
        const r = items.use(hero, t.slot, null);
        if (r && r.ok === false) this.error(r.reason ?? 'Cannot use item');
      } else {
        hero.issueOrder(order, queue);
      }
    }
    if (isUnit && target.team !== hero.team) this.game.vfx?.spawn?.('attack_marker', { position: target.position.clone(), unit: target });
    this.game.bus.emit('input:command', { type: 'cast', ability: ab, target: isUnit ? target : null, point: order.point ?? null });
    this.targeting = null;
    this.hideIndicators();
    this.game.bus.emit('input:targeting', { targeting: null });
    return true;
  }

  // ---------------------------------------------------------------- indicators / decals
  buildIndicators() {
    const g = this.game;
    const mkRing = (inner, outer, color, opacity, seg = 64) => {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(inner, outer, seg).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, side: THREE.DoubleSide }),
      );
      m.renderOrder = 5;
      m.visible = false;
      m.frustumCulled = false;
      m.userData.noPick = true;
      g.scene?.add(m);
      return m;
    };
    this.rangeRing = mkRing(0.97, 1.0, 0x9fd8ff, 0.55, 96);
    this.aoeRing = mkRing(0.94, 1.0, 0x7cff9c, 0.9, 64);
    this.aoeFill = new THREE.Mesh(
      new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x5cff8c, transparent: true, opacity: 0.18, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }),
    );
    Object.assign(this.aoeFill, { visible: false, renderOrder: 4, frustumCulled: false });
    g.scene?.add(this.aoeFill);
    // line skillshot (unit plane along +Z, scaled)
    const lg = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5);
    this.line = new THREE.Mesh(lg, new THREE.MeshBasicMaterial({ color: 0x7cd0ff, transparent: true, opacity: 0.28, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, side: THREE.DoubleSide }));
    Object.assign(this.line, { visible: false, renderOrder: 4, frustumCulled: false });
    g.scene?.add(this.line);
    const arrow = new THREE.Shape();
    arrow.moveTo(-1, 0); arrow.lineTo(0, 1.2); arrow.lineTo(1, 0); arrow.lineTo(0.45, 0.2); arrow.lineTo(-0.45, 0.2);
    this.lineHead = new THREE.Mesh(new THREE.ShapeGeometry(arrow).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }));
    Object.assign(this.lineHead, { visible: false, renderOrder: 5, frustumCulled: false });
    g.scene?.add(this.lineHead);

    // selection + hover rings (pool)
    this.selRings = [];
    this.hoverRing = mkRing(0.86, 1.0, 0xffffff, 0.45, 48);
  }

  hideIndicators() {
    for (const m of [this.rangeRing, this.aoeRing, this.aoeFill, this.line, this.lineHead]) if (m) m.visible = false;
  }

  groundY(x, z) {
    const h = this.game.world?.getHeight?.(x, z);
    return Number.isFinite(h) ? h : 0;
  }

  ringColorFor(u) {
    const team = this.game.player.team;
    if (this.controllable(u)) return 0x3cff6a;
    if (u.team === team) return 0x4fb4ff;
    if (u.team === 'neutral' || !u.team) return TEAM_COLORS.neutral ?? 0xc8a040;
    return 0xff3b30;
  }

  unitRingRadius(u) {
    const r = u.radius ?? 0.8;
    return u.isStructure ? Math.max(2.2, r * 1.15) : Math.max(0.75, r * 1.35);
  }

  updateSelectionRings(t) {
    const sel = (this.game.player.selected ?? []).filter((u) => u?.alive && u.object?.visible !== false);
    while (this.selRings.length < sel.length) {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(0.82, 1.0, 48).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0x3cff6a, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, side: THREE.DoubleSide }),
      );
      m.renderOrder = 5; m.frustumCulled = false; m.userData.noPick = true;
      // inner soft glow
      const glow = new THREE.Mesh(new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0x3cff6a, transparent: true, opacity: 0.12, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }));
      glow.renderOrder = 4; glow.userData.noPick = true;
      m.add(glow); m.userData.glow = glow;
      this.game.scene?.add(m);
      this.selRings.push(m);
    }
    this.selRings.forEach((m, i) => {
      const u = sel[i];
      m.visible = !!u;
      if (!u) return;
      const r = this.unitRingRadius(u) * (1 + Math.sin(t * 4) * 0.025);
      m.scale.setScalar(r);
      m.position.set(u.position.x, (u.position.y || this.groundY(u.position.x, u.position.z)) + 0.06, u.position.z);
      const c = this.ringColorFor(u);
      m.material.color.setHex(c);
      m.userData.glow.material.color.setHex(c);
      m.rotation.y = t * 0.3;
    });
    const hu = this.hoveredUnit;
    const hr = this.hoverRing;
    if (hr) {
      hr.visible = !!hu && hu.alive && !sel.includes(hu);
      if (hr.visible) {
        hr.scale.setScalar(this.unitRingRadius(hu) * (1.05 + Math.sin(t * 7) * 0.04));
        hr.position.set(hu.position.x, (hu.position.y || this.groundY(hu.position.x, hu.position.z)) + 0.07, hu.position.z);
        hr.material.color.setHex(this.ringColorFor(hu));
        hr.material.opacity = 0.5 + Math.sin(t * 7) * 0.12;
      }
    }
  }

  updateIndicators(t) {
    const tg = this.targeting;
    const hero = this.hero;
    if (!tg && hero && this._heldCast?.ability && this.keysDown.has(this._heldCast.code)) { this.previewHeld(t, hero); return; }
    if (!tg || !hero || tg.kind === 'attackMove') { this.hideIndicators(); return; }
    const ab = tg.ability;
    const d = ab.def ?? {};
    const act = ab.isItem ? (d.active ?? {}) : d;
    const level = ab.level ?? 1;
    const hp = hero.position;
    const hy = this.groundY(hp.x, hp.z) + 0.08;
    const range = ab.getCastRange?.() ?? lvlVal(act.castRange, level) ?? 0;
    const cursor = this.pickGround(this.client.x, this.client.y);

    // range ring
    const showRange = range > 0 && range < 150;
    this.rangeRing.visible = showRange && tg.targetType !== 'none';
    if (this.rangeRing.visible) {
      const rr = range + (tg.targetType === 'unit' ? hero.radius ?? 0.7 : 0);
      this.rangeRing.scale.setScalar(rr);
      this.rangeRing.position.set(hp.x, hy, hp.z);
      this.rangeRing.material.opacity = 0.45 + Math.sin(t * 3) * 0.1;
    }
    if (!cursor) { this.aoeRing.visible = this.aoeFill.visible = this.line.visible = this.lineHead.visible = false; return; }
    const inRange = !showRange || Math.hypot(cursor.x - hp.x, cursor.z - hp.z) <= range + 0.5;

    // line skillshot
    const width = lvlVal(act.width ?? act.lineWidth, level);
    const isLine = !!width && tg.targetType === 'point';
    this.line.visible = this.lineHead.visible = isLine;
    if (isLine) {
      const len = lvlVal(act.length ?? act.distance ?? act.travelDistance, level) ?? (range || 12);
      const yaw = Math.atan2(cursor.x - hp.x, cursor.z - hp.z);
      this.line.position.set(hp.x, hy, hp.z);
      this.line.rotation.y = yaw;
      this.line.scale.set(width, 1, len);
      this.lineHead.position.set(hp.x + Math.sin(yaw) * len, hy + 0.01, hp.z + Math.cos(yaw) * len);
      this.lineHead.rotation.y = yaw;
      this.lineHead.scale.setScalar(Math.max(0.8, width * 0.7));
    }
    // AOE circle following the cursor (or around hero for no-target AOE handled by UI hover)
    const radius = lvlVal(act.radius ?? act.aoe, level);
    const showAoe = !!radius && !isLine && tg.targetType !== 'none';
    this.aoeRing.visible = this.aoeFill.visible = showAoe;
    if (showAoe) {
      let c = cursor;
      if (tg.targetType === 'unit' && this.hoveredUnit && this.validTarget(this.hoveredUnit, tg)) c = this.hoveredUnit.position;
      const y = this.groundY(c.x, c.z) + 0.09;
      this.aoeRing.position.set(c.x, y, c.z);
      this.aoeFill.position.set(c.x, y - 0.005, c.z);
      this.aoeRing.scale.setScalar(radius);
      this.aoeFill.scale.setScalar(radius);
      const col = inRange ? 0x7cff9c : 0xffc24a;
      this.aoeRing.material.color.setHex(col);
      this.aoeFill.material.color.setHex(col);
      this.aoeFill.material.opacity = 0.14 + Math.sin(t * 5) * 0.04;
    }
  }

  // While an ability hotkey is held after a quick cast / no-target cast: show its cast range (and AOE around the hero
  // for no-target area spells) so the player keeps spatial feedback.
  previewHeld(t, hero) {
    const ab = this._heldCast.ability;
    const d = ab.def ?? {};
    const act = ab.isItem ? (d.active ?? {}) : d;
    const level = ab.level ?? 1;
    const hp = hero.position;
    const hy = this.groundY(hp.x, hp.z) + 0.08;
    const range = ab.getCastRange?.() ?? lvlVal(act.castRange, level) ?? 0;
    this.line.visible = this.lineHead.visible = false;
    this.rangeRing.visible = range > 0 && range < 150;
    if (this.rangeRing.visible) {
      this.rangeRing.scale.setScalar(range);
      this.rangeRing.position.set(hp.x, hy, hp.z);
      this.rangeRing.material.opacity = 0.4;
    }
    const radius = this.targetTypeOf(ab) === 'none' ? lvlVal(act.radius ?? act.aoe, level) : 0;
    this.aoeRing.visible = this.aoeFill.visible = !!radius;
    if (radius) {
      this.aoeRing.position.set(hp.x, hy + 0.01, hp.z);
      this.aoeFill.position.set(hp.x, hy, hp.z);
      this.aoeRing.scale.setScalar(radius);
      this.aoeFill.scale.setScalar(radius);
      this.aoeRing.material.color.setHex(0x7cff9c);
      this.aoeFill.material.color.setHex(0x7cff9c);
      this.aoeFill.material.opacity = 0.12 + Math.sin(t * 5) * 0.03;
    }
  }

  // ---------------------------------------------------------------- cursor
  setCursor(kind) {
    if (this._cursor === kind) return;
    this._cursor = kind;
    const css = this.cursors?.[kind] ?? 'default';
    if (this.canvas) this.canvas.style.cursor = css;
    document.body.style.cursor = css;
    document.documentElement.style.setProperty('--game-cursor', css);
  }

  // ---------------------------------------------------------------- per frame
  update(dt) {
    const g = this.game;
    const t = g.realTime ?? performance.now() / 1000;
    if (!g.running) return;

    // hover (screen-space only; cheap)
    if (this._hoverDirty || g.frame % 6 === 0) {
      this._hoverDirty = false;
      this.hoveredUnit = this._overWorld === false ? null : this.pickUnit(this.client.x, this.client.y, { precise: false });
    }
    // cursor
    const hu = this.hoveredUnit;
    const tg = this.targeting;
    if (tg) {
      if (hu && tg.targetType === 'unit' && this.validTarget(hu, tg)) this.setCursor(hu.team === g.player.team ? 'targetAlly' : 'targetEnemy');
      else if (tg.kind === 'attackMove' && hu && hu.team !== g.player.team) this.setCursor('targetEnemy');
      else this.setCursor('target');
    } else if (hu && hu.team !== g.player.team) this.setCursor('enemy');
    else if (hu && hu !== this.hero && !this.controllable(hu) && !hu.isStructure) this.setCursor('ally');
    else this.setCursor('default');

    // Holding right mouse keeps moving toward the cursor (genre convention), re-issued at ~10 Hz on real time so it
    // works the same at any game speed. Not while paused, targeting, or when the press was a shift-queue.
    if (this._rmbHeld && !tg && !g.paused && !this._rmbQueued && this._overWorld !== false) {
      const now = performance.now() / 1000;
      if (now >= this._rmbNext) {
        // keep a steady ~10 Hz cadence even when frames are slower than the interval
        this._rmbNext = now - this._rmbNext < HOLD_MOVE_INTERVAL ? this._rmbNext + HOLD_MOVE_INTERVAL : now + HOLD_MOVE_INTERVAL;
        this.rightClick(this.client.x, this.client.y, false, true);
      }
    }
    // validate targeting still sensible
    if (tg && (!this.hero?.alive)) this.cancelTargeting();

    try { this.updateSelectionRings(t); } catch {}
    try { this.updateIndicators(t); } catch {}
  }
}
