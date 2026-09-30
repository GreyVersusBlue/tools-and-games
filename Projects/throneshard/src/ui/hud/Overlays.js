import { el, esc, fmtNum, fmtTime, setText, toggleClass, TEAM_NAME } from '../util.js';
import { heroRowsHTML, netWorth } from './Scoreboard.js';
import { simpleTooltip } from '../Tooltip.js';

// Gold counter + shop / scoreboard buttons (bottom-right), top-left menu buttons.
export class BottomRight {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.node = el('div', 'hud-br', `
      <button class="br-shop"><i class="i-shop"></i><span>Shop</span><kbd>F4</kbd></button>
      <div class="br-gold"><i class="i-gold big"></i><b>0</b></div>`);
    this.gold = this.node.querySelector('.br-gold b');
    this.shopBtn = this.node.querySelector('.br-shop');
    this.shopBtn.onclick = (e) => { e.stopPropagation(); ui.shop.toggle(); };
    ui.tooltip.attach(this.node.querySelector('.br-gold'), () => {
      const h = this.game.player.hero;
      return h ? simpleTooltip('Gold', `Unreliable + reliable gold: <b>${Math.floor(h.gold)}</b><br>Net worth: ${fmtNum(netWorth(this.game, h))}`) : null;
    }, 'top');
    this.tl = el('div', 'hud-tl', `
      <button class="tl-btn" data-a="menu" title="Menu (F10)">☰</button>
      <button class="tl-btn" data-a="score" title="Scoreboard (Tab)">▤</button>
      <div class="tl-fps"></div>`);
    this.tl.querySelector('[data-a=menu]').onclick = () => ui.openGameMenu();
    this.tl.querySelector('[data-a=score]').onclick = () => ui.scoreboard.toggle();
    this.fps = this.tl.querySelector('.tl-fps');
    this.frames = 0; this.acc = 0;
  }
  setShopOpen(o) { toggleClass(this.shopBtn, 'on', o); }
  update(dt) {
    const h = this.game.player.hero;
    setText(this.gold, String(Math.floor(h?.gold ?? 0)));
    this.frames++; this.acc += dt;
    if (this.acc >= 1) { setText(this.fps, `${Math.round(this.frames / this.acc)} FPS · ${this.game.difficulty ?? ''}`); this.frames = 0; this.acc = 0; }
  }
}

// Greyscale world + respawn countdown + buyback while the player's hero is dead.
export class DeathOverlay {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.dead = false;
    this.node = el('div', 'hud-death', `
      <div class="dt-box">
        <div class="dt-h">You Have Been Slain</div>
        <div class="dt-t">Respawning in <b>0</b></div>
        <button class="btn-buyback"><span>Buyback</span><em><i class="i-gold"></i><b>0</b></em></button>
      </div>`);
    this.t = this.node.querySelector('.dt-t b');
    this.bb = this.node.querySelector('.btn-buyback');
    this.bbCost = this.node.querySelector('.btn-buyback em b');
    this.bb.onclick = () => this.buyback();
  }
  cost(h) { return Math.round(200 + netWorth(this.game, h) / 13); }
  buyback() {
    const g = this.game, h = g.player.hero;
    if (!h || h.alive) return;
    if (typeof g.rules?.buyback === 'function') { const r = g.rules.buyback(h); if (r && r.ok === false) this.ui.error(r.reason); return; }
    const c = this.cost(h);
    if ((h.buybackCooldown ?? 0) > 0) return this.ui.error(`Buyback on cooldown (${Math.ceil(h.buybackCooldown)}s)`);
    if (h.gold < c) return this.ui.error('Not enough gold');
    h.gold -= c;
    h.buybackCooldown = 480;
    h.respawnTimer = 0;
    h.respawn?.();
    this.ui.notify.message('Bought back!', '#ffd24a', 2);
  }
  update() {
    const g = this.game, h = g.player.hero;
    const dead = !!(h && !h.alive && g.running && !g.matchOver);
    if (dead !== this.dead) {
      this.dead = dead;
      toggleClass(this.node, 'show', dead);
      const cv = document.getElementById('game-canvas');
      if (cv) cv.classList.toggle('ui-dead', dead);
    }
    if (!dead) return;
    setText(this.t, String(Math.max(0, Math.ceil(h.respawnTimer))));
    const c = this.cost(h);
    setText(this.bbCost, String(c));
    toggleClass(this.bb, 'disabled', h.gold < c || (h.buybackCooldown ?? 0) > 0);
  }
}

export class PauseOverlay {
  constructor(ui) {
    this.ui = ui;
    this.node = el('div', 'hud-pause', `<div class="ps-box"><div class="ps-h">Paused</div><div class="ps-s">Press <kbd>F9</kbd> to resume</div></div>`);
    this.shown = false;
  }
  update() {
    const p = !!this.ui.game.paused && !this.ui.game.matchOver;
    if (p !== this.shown) { this.shown = p; toggleClass(this.node, 'show', p); }
  }
}

export class EndScreen {
  constructor(ui) { this.ui = ui; this.game = ui.game; }
  show({ winner, playerWon }) {
    const g = this.game, ui = this.ui;
    const won = playerWon ?? winner === g.player.team;
    const heroes = g.heroes;
    const mvp = heroes.filter((h) => h.team === winner).sort((a, b) => (b.kills * 2 + b.assists - b.deaths) - (a.kills * 2 + a.assists - a.deaths))[0];
    const sc = g.rules?.score ?? {};
    const head = `<tr><th>Hero</th><th>Lvl</th><th>K / D / A</th><th>LH / DN</th><th>Net Worth</th><th>Items</th></tr>`;
    const node = el('div', `ui-screen scr-end ${won ? 'win' : 'lose'}`, `
      <div class="end-bg"></div>
      <div class="end-top">
        <div class="end-banner"><div class="end-team t-${esc(winner)}">${esc(TEAM_NAME[winner] ?? winner ?? '')}</div><div class="end-h">${won ? 'Victory' : 'Defeat'}</div></div>
        <div class="end-meta"><span>Match Duration <b>${fmtTime(Math.max(0, g.time))}</b></span><span>Score <b class="t-sunward">${sc.sunward ?? 0}</b> – <b class="t-duskward">${sc.duskward ?? 0}</b></span>${mvp ? `<span>MVP <b>${esc(mvp.name)}</b></span>` : ''}</div>
      </div>
      <div class="end-tables panel-frame">
        ${['sunward', 'duskward'].map((t) => `<div class="sb-team ${t}"><div class="sb-th"><span class="sb-tn">${TEAM_NAME[t]}${t === winner ? ' <em>Winner</em>' : ''}</span><span class="sb-ts">${sc[t] ?? 0} Kills</span></div>
          <table>${head}${heroRowsHTML(ui, t, { showGold: false, highlight: mvp })}</table></div>`).join('')}
      </div>
      <div class="end-actions"><button class="btn-play small" data-a="again"><span>Play Again</span></button></div>`);
    node.querySelector('[data-a=again]').onclick = () => location.reload();
    ui.root.appendChild(node);
    requestAnimationFrame(() => node.classList.add('show'));
    ui.sfx(won ? 'victory' : 'defeat');
  }
}
