import { el } from './util.js';
import { Portraits } from './Portraits.js';
import { Tooltip } from './Tooltip.js';
import { LoadingScreen } from './screens/Loading.js';
import { MainMenu } from './screens/Menu.js';
import { HeroSelect } from './screens/HeroSelect.js';
import { Settings, openSettings } from './screens/Settings.js';
import { WorldOverlay } from './hud/WorldOverlay.js';
import { Minimap } from './hud/Minimap.js';
import { TopBar } from './hud/TopBar.js';
import { BottomPanel } from './hud/BottomPanel.js';
import { Shop } from './hud/Shop.js';
import { Scoreboard } from './hud/Scoreboard.js';
import { Notifications } from './hud/Notifications.js';
import { BottomRight, DeathOverlay, PauseOverlay, EndScreen } from './hud/Overlays.js';
import { Tutorial } from './hud/Tutorial.js';
import { TalentPanel } from './hud/TalentPanel.js';
import { MinimapMarkers } from './hud/MinimapMarkers.js';

const DAY_LENGTH = 300; // seconds per day / night phase (fallback if world doesn't expose its cycle)

// MOBA-style DOM/CSS + canvas overlay UI. Public API:
//   init(), setLoadingProgress(p, stage), onLoaded(), onMatchStart(), update(dt)
//   error(msg), message(text, color, dur), announce(title, sub), toggleShop(force), toggleScoreboard(force)
export class UI {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('ui-root') ?? document.body.appendChild(el('div', '', ''));
    this.root.id = 'ui-root';
    this.root.classList.add('ui-root');
    this.settings = new Settings(game);
    this.portraits = new Portraits(game);
    this.tooltip = new Tooltip(this.root);
    this.loading = new LoadingScreen(this);
    this.root.appendChild(this.loading.node);
    this.difficulty = 'normal';
    this.hudBuilt = false;
    this.panelAcc = 0;
    this.tipAcc = 0;
    this.modal = null;
    this._menuT = 0;
  }

  async init(onProgress) {
    // Warm up fonts so canvas text uses them.
    try {
      await Promise.race([
        Promise.all(['700 16px Cinzel', '600 16px Rajdhani', '700 16px Rajdhani', '500 16px Rajdhani'].map((f) => document.fonts.load(f))),
        new Promise((r) => setTimeout(r, 1500)),
      ]);
    } catch { /* ignore */ }
    onProgress?.(1);
    this.bindKeys();
    this.bindEvents();
    addEventListener('resize', () => this.applyScale());
  }

  setLoadingProgress(p, stage) { this.loading?.set(p, stage); }

  onLoaded() {
    this.settings.apply();
    this.applyScale();
    this.portraits.refresh();
    this.loading.hide();
    this.showMenu();
  }

  // ---------------- screens ----------------
  showMenu() {
    this.heroSelect?.hide();
    this.heroSelect = null;
    this.menu = this.menu ?? new MainMenu(this);
    this.menu.show();
  }

  showHeroSelect() {
    this.menu?.hide();
    this.heroSelect = new HeroSelect(this);
    this.heroSelect.show();
  }

  startMatch(opts) {
    this.heroSelect?.hide();
    this.menu?.hide();
    try { this.game.startMatch(opts); } catch (e) {
      console.error('[ui] startMatch failed', e);
      this.buildHud();
      this.error('Failed to start the match — see console');
    }
  }

  // Called by Game.startMatch on every subsystem
  onMatchStart() {
    this.heroSelect?.hide();
    this.heroSelect = null;
    this.menu?.hide();
    this.buildHud();
    const g = this.game;
    this.topBar.build();
    this.notify.announce('The Battle Begins', g.time < 0 ? 'Prepare for battle' : 'Defend your Throneshard', 'gold big', 3);
    this.hornShown = g.time >= 0;
  }

  buildHud() {
    if (this.hudBuilt) return;
    this.hudBuilt = true;
    const hud = (this.hud = el('div', 'ui-hud'));
    this.world = new WorldOverlay(this);
    this.root.insertBefore(this.world.canvas, this.root.firstChild);
    this.notify = new Notifications(this);
    this.topBar = new TopBar(this);
    this.minimap = new Minimap(this);
    this.bottom = new BottomPanel(this);
    this.shop = new Shop(this);
    this.scoreboard = new Scoreboard(this);
    this.bottomRight = new BottomRight(this);
    this.death = new DeathOverlay(this);
    this.pause = new PauseOverlay(this);
    this.end = new EndScreen(this);
    this.tutorial = new Tutorial(this);
    hud.append(this.death.node, this.topBar.node, this.bottomRight.tl);
    this.notify.mount(hud);
    hud.append(this.minimap.node, this.bottom.node, this.bottomRight.node, this.shop.node, this.scoreboard.node, this.pause.node, this.tutorial.node);
    this.root.appendChild(hud);
    // WS5: talent tree button/popup (left of the ability bar) + rune markers over the minimap
    try { this.talentPanel = new TalentPanel(this); this.minimapMarkers = new MinimapMarkers(this); } catch (e) { console.error('[ui] talents/markers', e); }
    this.applyScale();
    requestAnimationFrame(() => hud.classList.add('show'));
  }

  applyScale() {
    // menus / modals / tooltips scale with viewport height too (--uz), clamped so 720p stays readable
    this.root.style.setProperty('--uz', Math.max(0.85, Math.min(1.45, innerHeight / 900)).toFixed(3));
    if (!this.hud) return;
    const z = Math.max(0.7, Math.min(1.5, innerHeight / 900)) * (this.settings.get('hudScale') ?? 1);
    this.hud.style.setProperty('--z', z.toFixed(3));
  }

  closeTop() {
    if (this.modal) this.modal.close();
    else if (this.shop?.open) this.shop.toggle(false);
    else if (this.scoreboard?.open) this.scoreboard.toggle(false);
  }

  openGameMenu() {
    if (this.modal) { this.modal.close(); return; }
    openSettings(this, { inGame: true });
  }

  // ---------------- helpers used by components ----------------
  isNight() {
    const w = this.game.world;
    if (typeof w?.isNight === 'function') return !!w.isNight();
    if (typeof w?.isDay === 'function') return !w.isDay();
    const t = this.game.time;
    return t >= 0 && Math.floor(t / DAY_LENGTH) % 2 === 1;
  }
  dayLength() { return this.game.world?.dayLength ?? DAY_LENGTH; }
  dayNightRemaining() {
    const L = this.dayLength();
    const t = Math.max(0, this.game.time);
    return L - (t % L);
  }

  sfx(name) {
    const a = this.game.audio;
    try {
      if (a?.playUI) a.playUI(name);
      else a?.play?.('ui_' + name, { volume: 0.6, ui: true });
    } catch { /* ignore */ }
  }

  error(msg) { this.notify?.error(msg); }
  message(text, color, dur) { this.notify?.message(text, color, dur); }
  announce(title, sub, cls, dur) { this.notify?.announce(title, sub, cls, dur); }
  toggleShop(force) { if (this.game.running) this.shop?.toggle(force); }
  toggleScoreboard(force) { if (this.game.running) this.scoreboard?.toggle(force); }

  // ---------------- input ----------------
  bindKeys() {
    this._lastShopKey = 0;
    this._lastTabKey = 0;
    addEventListener('keydown', (e) => {
      if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA') return;
      const g = this.game;
      if (e.code === 'Tab') {
        e.preventDefault();
        if (!e.repeat && g.running) { this._lastTabKey = performance.now(); this.toggleScoreboard(true); }
      } else if (e.code === 'F4') {
        e.preventDefault();
        if (!e.repeat) { this._lastShopKey = performance.now(); this.toggleShop(); }
      } else if (e.code === 'F10') {
        e.preventDefault();
        if (g.running) this.openGameMenu();
      } else if (e.code === 'Escape' && !g.input?.beginCast) {
        this.closeTop();
      }
    }, true);
    addEventListener('keyup', (e) => {
      if (e.code === 'Tab') { e.preventDefault(); this._lastTabKey = performance.now(); this.toggleScoreboard(false); }
    }, true);
    addEventListener('blur', () => this.scoreboard?.toggle(false));
  }

  bindEvents() {
    const bus = this.game.bus;
    bus.on('ui:toggleShop', (e) => {
      if (performance.now() - this._lastShopKey < 250) return; // our own F4 handler already toggled
      this.toggleShop(e?.open ?? e?.show);
    });
    bus.on('ui:escape', () => this.closeTop());
    bus.on('ui:toggleScoreboard', (e) => {
      if (performance.now() - this._lastTabKey < 250) return;
      this.toggleScoreboard(e?.open ?? e?.show);
    });
    bus.on('ui:error', ({ unit, message } = {}) => {
      const g = this.game;
      if (unit && unit !== g.player.hero && !unit.isPlayerControlled && unit.owner !== g.player.hero) return;
      this.error(message);
    });
    bus.on('ui:message', ({ text, color, duration } = {}) => this.message(text, color, duration));
    bus.on('ui:announce', ({ title, text, sub, cls } = {}) => this.announce(title ?? text, sub, cls));
    bus.on('hero:killed', (e) => this.notify?.onHeroKilled(e));
    bus.on('building:destroyed', (e) => { if (e?.unit?.subtype !== 'fountain') this.notify?.onBuilding(e); });
    bus.on('grimmaw:killed', (e) => {
      const k = e?.killerHero ?? e?.killer;
      this.announce('Grimmaw Has Fallen', k ? `Slain by <b class="t-${k.team}">${k.name}</b>` : '', 'gold');
    });
    bus.on('lantern:consumed', (e) => {
      const h = e?.hero ?? e?.holder ?? e?.unit;
      this.announce('Lantern Spent', h ? `<b class="t-${h.team}">${h.name}</b> has been reincarnated` : '', 'gold', 2.4);
    });
    bus.on('unit:damaged', (e) => this.world?.onDamaged(e));
    bus.on('unit:healed', (e) => this.world?.onHealed(e));
    bus.on('gold:popup', (e) => this.world?.onGold(e));
    bus.on('hero:levelUp', ({ hero, level }) => {
      if (hero === this.game.player.hero) { this.message(`Level ${level}!`, '#ffe08a', 1.8); this.sfx('levelup'); }
    });
    bus.on('item:bought', ({ hero, item } = {}) => { if (hero === this.game.player.hero) this.shop?.refreshAffordable(); });
    bus.on('match:end', (e) => {
      this.shop?.toggle(false);
      this.scoreboard?.toggle(false);
      this.modal?.close();
      this.tooltip.hide();
      setTimeout(() => {
        this.hud?.classList.add('ended');
        this.end?.show(e ?? { winner: this.game.winner });
      }, 2500);
    });
    bus.on('minimap:ping', (e) => { if (e && e.team === this.game.player.team && e.source !== 'ui') this.minimap?.ping(e.x, e.z, false); });
    bus.on('hero:respawn', ({ hero } = {}) => { if (hero === this.game.player.hero) this.message('You have respawned', '#9dff7a', 2); });
  }

  // ---------------- per-frame ----------------
  update(dt) {
    const g = this.game;
    dt = Math.min(dt || 0.016, 0.1);
    if (!g.running) {
      this.menuCamera(dt);
      return;
    }
    if (!this.hudBuilt) this.onMatchStart();
    // every frame: world-space bars and floating text, minimap (self-throttled)
    try { this.world.update(g.paused ? 0 : dt); } catch (e) { this.logOnce('world', e); }
    try { this.minimap.update(dt); } catch (e) { this.logOnce('minimap', e); }
    try { this.notify.update(dt); } catch (e) { this.logOnce('notify', e); }
    // horn
    if (!this.hornShown && g.time >= 0) { this.hornShown = true; this.announce('The Horn Sounds', 'Creeps are marching to the lanes', 'gold', 2.5); }
    // panels at ~20Hz
    this.panelAcc += dt;
    if (this.panelAcc >= 0.05) {
      const pdt = this.panelAcc;
      this.panelAcc = 0;
      for (const [k, c] of [['top', this.topBar], ['bottom', this.bottom], ['br', this.bottomRight], ['shop', this.shop], ['death', this.death], ['pause', this.pause], ['tutorial', this.tutorial], ['talents', this.talentPanel], ['mmMarkers', this.minimapMarkers]]) {
        try { c?.update?.(pdt); } catch (e) { this.logOnce(k, e); }
      }
      try { this.scoreboard.update(pdt); } catch (e) { this.logOnce('score', e); }
    }
    this.tipAcc += dt;
    if (this.tipAcc > 0.25) { this.tipAcc = 0; if (this.tooltip.target) this.tooltip.refresh(); }
  }

  // Slow cinematic drift of the camera behind the menus.
  menuCamera(dt) {
    const cam = this.game.camera;
    if (!cam || this.game.running) return;
    this._menuT += dt;
    const t = this._menuT * 0.04;
    const cx = -30 + Math.sin(t) * 22, cz = 30 + Math.cos(t * 0.8) * 18;
    cam.position.set(cx - 10, 70, cz + 55);
    cam.lookAt(cx, 0, cz);
  }

  logOnce(k, e) {
    this._logged = this._logged ?? new Set();
    if (this._logged.has(k)) return;
    this._logged.add(k);
    console.error('[ui]', k, e);
  }
}
