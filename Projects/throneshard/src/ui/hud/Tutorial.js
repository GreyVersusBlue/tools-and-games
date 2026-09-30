import { el, esc } from '../util.js';

// Contextual first-match tutorial tips. Non-intrusive card on the left edge; one tip at a time, each shown once,
// dismissible (✕ or "Hide tips"), remembered in localStorage 'throneshard.tutorial' ({seen: [...ids], off: bool}).
// Disabled via Settings → Interface → "Show tutorial tips"; Settings → "Show all tips again" calls reset().
const STORE = 'throneshard.tutorial';
const GAP = 7; // seconds between tips
const SHOW = 14; // auto-dismiss after

export class Tutorial {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.state = { seen: [], off: false };
    try { Object.assign(this.state, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch { /* ignore */ }
    this.seen = new Set(this.state.seen);
    this.node = el('div', 'hud-tutorial');
    this.cur = null;
    this.cool = 3; // first tip a few seconds after the match starts
    this.t = 0;
    this.flags = {};
    const bus = this.game.bus;
    bus.on('hero:killed', ({ victim } = {}) => { if (victim && victim === this.game.player.hero) this.flags.died = true; });
    bus.on('ability:learned', ({ hero } = {}) => { if (hero === this.game.player.hero) this.flags.learned = true; });
    bus.on('input:command', ({ type } = {}) => { if (type === 'move') this.flags.moved = (this.flags.moved ?? 0) + 1; if (type === 'cast') this.flags.cast = true; });
    bus.on('ui:toggleShop', () => { this.flags.shop = true; });
  }

  key(action, fallback) { return esc(this.game.input?.keyLabel?.(action) ?? fallback); }

  // id -> { when(): bool, done?(): bool (hide early once the player did it), title, html() }
  tips() {
    const g = this.game, h = g.player.hero;
    const k = (a, f) => `<kbd>${this.key(a, f)}</kbd>`;
    return [
      { id: 'move', when: () => true, done: () => (this.flags.moved ?? 0) >= 3, title: 'Moving',
        html: () => `<b>Right-click</b> the ground to move, or an enemy to attack. <b>Hold</b> right mouse to keep walking toward the cursor. <kbd>Shift</kbd> queues orders.` },
      { id: 'learn', when: () => (h?.abilityPoints ?? 0) > 0, done: () => this.flags.learned, title: 'Learn an ability',
        html: () => `You have an ability point. Click the <b>+</b> above an ability, or press <kbd>Ctrl</kbd>/<kbd>Alt</kbd> + its hotkey.` },
      { id: 'cast', when: () => h?.abilities?.some((a) => a?.level > 0 && a.def?.targetType !== 'passive'), done: () => this.flags.cast, title: 'Casting',
        html: () => `Press ${k('ability1', 'Q')} ${k('ability2', 'W')} ${k('ability3', 'E')} ${k('ability4', 'R')} then left-click a target. Prefer instant casts? Pick <b>Quick Cast</b> in Settings → Controls.` },
      { id: 'shop', when: () => g.time > -60 && (h?.gold ?? 0) >= 150, done: () => this.flags.shop, title: 'Shopping',
        html: () => `Press <kbd>F4</kbd> to open the shop. Items from the base shop are bought near your fountain; the gold shown bottom-right is what you can spend.` },
      { id: 'lasthit', when: () => g.time > 20, title: 'Last hits',
        html: () => `Land the <b>killing blow</b> on enemy creeps for gold. Right-click a low-health <b>allied</b> creep to deny it.` },
      { id: 'camera', when: () => g.time > 50, title: 'Camera',
        html: () => `${k('cameraCenter', 'Space')} centers on your hero, ${k('cameraLock', 'Y')} locks the camera. Click or drag the minimap to look around.` },
      { id: 'tower', when: () => h?.alive && this.nearEnemyTower(h), title: 'Towers',
        html: () => `Towers deal heavy damage. Let your creeps walk in first so the tower targets them, then attack.` },
      { id: 'death', when: () => this.flags.died, title: 'Respawning',
        html: () => `You will respawn at your fountain. Use the time to buy items (<kbd>F4</kbd>) — gold is only lost when you die, so spend it.` },
      { id: 'ult', when: () => (h?.level ?? 0) >= 6, title: 'Ultimate ready',
        html: () => `Level 6: you can learn your <b>ultimate</b> (${k('ability4', 'R')}). It is your most powerful ability.` },
      { id: 'score', when: () => g.time > 180, title: 'Scoreboard',
        html: () => `Hold <kbd>Tab</kbd> for the scoreboard. <kbd>Alt</kbd> + click the map or minimap to ping your allies.` },
    ];
  }

  nearEnemyTower(h) {
    for (const u of this.game.units) {
      if (u.kind !== 'tower' || !u.alive || u.team === h.team) continue;
      const dx = u.position.x - h.position.x, dz = u.position.z - h.position.z;
      if (dx * dx + dz * dz < 22 * 22) return true;
    }
    return false;
  }

  enabled() { return !this.state.off && this.ui.settings?.get?.('tutorial') !== false; }

  save() {
    this.state.seen = [...this.seen];
    try { localStorage.setItem(STORE, JSON.stringify(this.state)); } catch { /* ignore */ }
  }

  reset() {
    this.seen.clear();
    this.state.off = false;
    this.save();
  }

  show(tip) {
    this.cur = { tip, t: 0 };
    this.seen.add(tip.id);
    this.save();
    this.node.innerHTML = `<div class="tut-card">
      <div class="tut-h"><span class="tut-ic">?</span><b>${esc(tip.title)}</b><button class="tut-x" title="Dismiss" data-sfx="close">✕</button></div>
      <div class="tut-b">${tip.html()}</div>
      <div class="tut-f"><button class="tut-off" data-sfx="close">Hide all tips</button><span class="tut-bar"><i></i></span></div></div>`;
    this.node.querySelector('.tut-x').onclick = (e) => { e.stopPropagation(); this.hide(); };
    this.node.querySelector('.tut-off').onclick = (e) => { e.stopPropagation(); this.state.off = true; this.save(); this.hide(); };
    this.bar = this.node.querySelector('.tut-bar i');
    this.node.classList.add('show');
  }

  hide() {
    this.cur = null;
    this.cool = GAP;
    this.node.classList.remove('show');
  }

  update(dt) {
    const g = this.game;
    if (!g.running || g.matchOver) { if (this.cur) this.hide(); return; }
    if (!this.enabled()) { if (this.cur) this.hide(); return; }
    if (this.cur) {
      this.cur.t += dt;
      if (this.bar) this.bar.style.transform = `scaleX(${Math.max(0, 1 - this.cur.t / SHOW)})`;
      if (this.cur.t > SHOW || (this.cur.t > 3 && this.cur.tip.done?.())) this.hide();
      return;
    }
    this.cool -= dt;
    if (this.cool > 0) return;
    this.cool = 1; // re-check once per second
    for (const tip of this.tips()) {
      if (this.seen.has(tip.id)) continue;
      let ok = false;
      try { ok = tip.when() && !tip.done?.(); } catch { ok = false; }
      if (ok) { this.show(tip); return; }
    }
  }
}
