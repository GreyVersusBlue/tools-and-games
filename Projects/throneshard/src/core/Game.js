import * as THREE from 'three';
import { EventBus } from './EventBus.js';
import { Hero } from './Hero.js';
import { Unit } from './Unit.js';
import { Rules } from './Rules.js';
import { Projectiles } from './Projectiles.js';
import { TEAM, FOUNTAIN } from './constants.js';

import { World } from '../world/World.js';
import { ModelFactory } from '../models/ModelFactory.js';
import { VFX } from '../vfx/VFX.js';
import { AbilitySystem } from '../gameplay/abilities/AbilitySystem.js';
import { ItemSystem } from '../gameplay/items/ItemSystem.js';
import { HERO_DEFS } from '../gameplay/heroes/HeroDefs.js';
import { AIDirector } from '../ai/AIDirector.js';
import { GameplayExtras } from '../gameplay/GameplayExtras.js';
import { UI } from '../ui/UI.js';
import { Input } from '../input/Input.js';
import { CameraController } from '../input/CameraController.js';
import { AudioSystem } from '../audio/AudioSystem.js';

// Central game object. Owns the scene/renderer, the unit list and every subsystem.
// Every subsystem is `new X(game)`, may implement `async init(onProgress)`, `update(dt)`, `onMatchStart()`.
export class Game {
  constructor(container) {
    this.container = container;
    this.bus = new EventBus();
    this.time = 0; // match clock in seconds (0 = horn)
    this.realTime = 0;
    this.frame = 0;
    this.timeScale = 1;
    this.paused = false;
    this.running = false; // true once a match has started
    this.matchOver = false;
    this.winner = null;
    this.units = [];
    this.heroes = [];
    this.player = { team: TEAM.SUNWARD, hero: null, selected: [] };
    this.heroDefs = HERO_DEFS;
    this._timers = [];
    this.composer = null; // world/vfx may install an EffectComposer; otherwise renderer.render is used
    this.THREE = THREE;
  }

  async init(onProgress = () => {}) {
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: false, stencil: false, powerPreference: 'high-performance' })); // AA is done by the post chain (SMAA/FXAA): an MSAA backbuffer would only cost bandwidth
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.setSize(window.innerWidth, window.innerHeight);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(r.domElement);
    r.domElement.id = 'game-canvas';

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.5, 600);
    this.camera.position.set(-70, 45, 100);
    this.camera.lookAt(-70, 0, 70);
    this._lastFrame = performance.now();

    // Subsystems (order matters for update)
    this.ui = new UI(this);
    this.audio = new AudioSystem(this);
    this.models = new ModelFactory(this);
    this.world = new World(this);
    this.vfx = new VFX(this);
    this.projectiles = new Projectiles(this);
    this.abilities = new AbilitySystem(this);
    this.items = new ItemSystem(this);
    this.rules = new Rules(this);
    this.ai = new AIDirector(this);
    this.extras = new GameplayExtras(this); // runes, talents, ward rings (sets this.runes / this.talents)
    this.cameraCtl = new CameraController(this);
    this.input = new Input(this);

    const systems = [this.ui, this.audio, this.models, this.world, this.vfx, this.abilities, this.items, this.ai, this.extras, this.cameraCtl, this.input];
    let done = 0;
    for (const s of systems) {
      const name = s.constructor.name;
      try {
        await s.init?.((p) => onProgress((done + Math.min(1, p)) / systems.length, name));
      } catch (e) {
        console.error(`[init] ${name} failed`, e);
      }
      done++;
      onProgress(done / systems.length, name);
    }

    window.addEventListener('resize', () => this.onResize());
    this.renderer.setAnimationLoop(() => this.tick());
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer?.setSize?.(w, h);
    this.bus.emit('resize', { width: w, height: h });
  }

  // Pick the player hero, fill the other 9 slots with bots, spawn structures & start the clock.
  // opts: { heroId, team = 'sunward', allies?: heroId[], enemies?: heroId[], difficulty?: 'easy'|'normal'|'hard' }
  startMatch(opts) {
    if (this.running) return;
    const team = opts.team ?? TEAM.SUNWARD;
    this.player.team = team;
    this.difficulty = opts.difficulty ?? 'normal';
    const pool = Object.keys(HERO_DEFS).filter((id) => id !== opts.heroId);
    const pick = (list) => {
      if (!pool.length) return opts.heroId;
      const i = Math.floor(Math.random() * pool.length);
      return pool.splice(i, 1)[0];
    };
    const lanes = ['mid', 'top', 'bot', 'top', 'bot'];
    const other = team === TEAM.SUNWARD ? TEAM.DUSKWARD : TEAM.SUNWARD;
    const allies = [opts.heroId, ...(opts.allies ?? [])];
    while (allies.length < 5) allies.push(pick());
    const enemies = [...(opts.enemies ?? [])];
    while (enemies.length < 5) enemies.push(pick());

    allies.forEach((id, i) => {
      const h = this.spawnHero(id, team, { isBot: i !== 0, lane: lanes[i] });
      if (i === 0) { this.player.hero = h; h.isPlayerControlled = true; h.isBot = false; }
    });
    enemies.forEach((id, i) => this.spawnHero(id, other, { isBot: true, lane: lanes[i] }));

    this.time = -(opts.preGameTime ?? 0);
    this.running = true;
    this.player.selected = [this.player.hero];
    for (const s of [this.world, this.models, this.vfx, this.abilities, this.items, this.ai, this.extras, this.ui, this.cameraCtl, this.input, this.audio]) {
      try { s.onMatchStart?.(); } catch (e) { console.error('[onMatchStart]', s.constructor.name, e); }
    }
    this.bus.emit('selection:changed', { units: this.player.selected });
    this.bus.emit('match:start', { player: this.player });
  }

  spawnHero(heroId, team, opts = {}) {
    const def = HERO_DEFS[heroId];
    if (!def) throw new Error('Unknown hero ' + heroId);
    const [fx, fz] = FOUNTAIN[team];
    const idx = this.heroes.filter((h) => h.team === team).length;
    const a = (idx / 5) * Math.PI * 2;
    const pos = new THREE.Vector3(fx + Math.cos(a) * 4, 0, fz + Math.sin(a) * 4);
    const hero = new Hero(this, def, { team, position: pos, isBot: opts.isBot, lane: opts.lane });
    hero.facing = team === TEAM.SUNWARD ? Math.PI * 0.75 : -Math.PI * 0.25;
    this.abilities.setupHero?.(hero);
    this.items.setupHero?.(hero);
    this.heroes.push(hero);
    this.addUnit(hero);
    return hero;
  }

  // Generic unit spawn helper. opts are passed to Unit (kind, team, position, stats, modelKind, subtype, lane, ...)
  spawnUnit(opts) {
    const u = new Unit(this, opts);
    this.addUnit(u);
    return u;
  }

  addUnit(u) {
    this.units.push(u);
    this._gridDirty = true;
    this.bus.emit('unit:spawned', { unit: u });
    return u;
  }

  removeUnit(u) {
    if (u.kind === 'hero') return; // heroes persist
    const i = this.units.indexOf(u);
    if (i >= 0) this.units.splice(i, 1);
    this._gridDirty = true;
    u.dispose();
    this.bus.emit('unit:removed', { unit: u });
  }

  // Spatial hash (cell = 8 world units), rebuilt lazily once per frame / after spawns.
  _buildGrid() {
    const CELL = 8, N = 26; // covers [-104, 104]
    if (!this._grid) this._grid = Array.from({ length: N * N }, () => []);
    for (const c of this._grid) c.length = 0;
    for (const u of this.units) {
      if (!u.alive) continue;
      const cx = Math.max(0, Math.min(N - 1, Math.floor((u.position.x + 104) / CELL)));
      const cz = Math.max(0, Math.min(N - 1, Math.floor((u.position.z + 104) / CELL)));
      this._grid[cz * N + cx].push(u);
    }
    this._gridFrame = this.frame;
    this._gridDirty = false;
  }
  unitsInRadius(pos, r, filter) {
    if (this._gridFrame !== this.frame || this._gridDirty) this._buildGrid();
    const CELL = 8, N = 26, out = [], r2 = r * r;
    const pad = r + 2; // units may have moved slightly since the rebuild
    const x0 = Math.max(0, Math.floor((pos.x - pad + 104) / CELL)), x1 = Math.min(N - 1, Math.floor((pos.x + pad + 104) / CELL));
    const z0 = Math.max(0, Math.floor((pos.z - pad + 104) / CELL)), z1 = Math.min(N - 1, Math.floor((pos.z + pad + 104) / CELL));
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        for (const u of this._grid[cz * N + cx]) {
          if (!u.alive) continue;
          const dx = u.position.x - pos.x, dz = u.position.z - pos.z;
          if (dx * dx + dz * dz <= r2 && (!filter || filter(u))) out.push(u);
        }
      }
    }
    return out;
  }
  enemiesInRadius(team, pos, r, filter) {
    return this.unitsInRadius(pos, r, (u) => u.team !== team && !u.isInvulnerable && (!filter || filter(u)));
  }
  alliesInRadius(team, pos, r, filter) {
    return this.unitsInRadius(pos, r, (u) => u.team === team && (!filter || filter(u)));
  }

  // Fog-of-war aware visibility. World provides isVisible(team, x, z).
  canSee(team, unit) {
    if (!unit) return false;
    if (unit.team === team) return true;
    if (unit.isInvisible && !this.world?.hasTrueSight?.(team, unit.position.x, unit.position.z)) return false;
    return this.world?.isVisible ? this.world.isVisible(team, unit.position.x, unit.position.z) : true;
  }

  delay(seconds, fn) {
    this._timers.push({ at: this.time + seconds, fn });
  }

  tick() {
    const now = performance.now();
    const rawDt = this.fixedDt ?? Math.min((now - this._lastFrame) / 1000, 0.05); // fixedDt: deterministic stepping for tests
    this._lastFrame = now;
    this.realTime += rawDt;
    const dt = this.paused || !this.running ? 0 : rawDt * this.timeScale;
    this.frame++;
    this._updateViewFrustum();
    if (dt > 0) {
      this.time += dt;
      // timers
      if (this._timers.length) {
        const due = [];
        this._timers = this._timers.filter((t) => (t.at <= this.time ? (due.push(t), false) : true));
        for (const t of due) { try { t.fn(); } catch (e) { console.error('[timer]', e); } }
      }
      this.safe(this.ai, dt);
      this.safe(this.rules, dt);
      for (const u of [...this.units]) {
        try { u.update(dt); } catch (e) { console.error('[unit update]', u.name, e); }
      }
      // local separation
      for (const u of this.units) if (u.alive && !u.immobile) u.separate(this.unitsInRadius(u.position, 2.5), dt);
      this.safe(this.projectiles, dt);
      this.safe(this.abilities, dt);
      this.safe(this.items, dt);
      this.safe(this.extras, dt, rawDt);
    } else {
      // keep unit visuals animating subtly even when paused-less pregame
      if (!this.running) for (const u of this.units) u.model?.update?.(0);
    }
    this.safe(this.world, dt, rawDt);
    this.safe(this.vfx, dt, rawDt);
    this.safe(this.cameraCtl, rawDt);
    this.safe(this.input, rawDt);
    this.safe(this.audio, rawDt);
    this.safe(this.ui, rawDt);
    if (this.renderEvery && this.frame % this.renderEvery) return; // test hook: throttle rendering in headless runs
    if (this.composer) this.composer.render(rawDt);
    else this.renderer.render(this.scene, this.camera);
  }

  _updateViewFrustum() {
    if (!this._frustum) { this._frustum = new THREE.Frustum(); this._projScreen = new THREE.Matrix4(); this._sphere = new THREE.Sphere(); }
    this.camera.updateMatrixWorld();
    this._projScreen.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._projScreen);
  }
  // True if a sphere around a ground position is inside the camera view (used to skip off-screen animation work)
  isOnScreen(pos, radius = 2) {
    if (!this._frustum) return true;
    this._sphere.center.set(pos.x, pos.y + 1, pos.z);
    this._sphere.radius = radius;
    return this._frustum.intersectsSphere(this._sphere);
  }

  safe(sys, dt, raw) {
    if (!sys?.update) return;
    try { sys.update(dt, raw); } catch (e) {
      if (!sys._errLogged) { console.error(`[update] ${sys.constructor.name}`, e); sys._errLogged = true; }
    }
  }

  // Helpers used by many modules
  get playerHero() { return this.player.hero; }
  getUnitById(id) { return this.units.find((u) => u.id === id); }
}
