import { el, esc, itemIcon, fmtNum, fmtTime } from '../util.js';

export function netWorth(game, h) {
  let nw = h.gold ?? 0;
  for (const it of [...(h.inventory ?? []), ...(h.backpack ?? [])]) if (it?.def?.cost) nw += it.def.cost;
  return nw;
}

export function heroRowsHTML(ui, team, { showGold = true, highlight } = {}) {
  const g = ui.game;
  const heroes = g.heroes.filter((h) => h.team === team);
  return heroes.map((h) => {
    const items = (h.inventory ?? []).map((it) => `<div class="sb-it">${it ? itemIcon(g, it.def) : ''}</div>`).join('');
    const me = h === g.player.hero;
    return `<tr class="${me ? 'me' : ''} ${!h.alive ? 'dead' : ''} ${highlight === h ? 'mvp' : ''}">
      <td class="sb-hero">${ui.portraits.html(h.heroId, 'sb-pt')}<div><b>${esc(h.name)}</b><span>${me ? 'You' : 'Bot'}${!h.alive ? ` · <em>${Math.ceil(h.respawnTimer)}s</em>` : ''}</span></div></td>
      <td class="num lvl">${h.level}</td>
      <td class="num kda"><b>${h.kills}</b> / <b class="d">${h.deaths}</b> / <b>${h.assists}</b></td>
      <td class="num">${h.lastHits} / ${h.denies}</td>
      ${showGold ? `<td class="num gold">${fmtNum(h.gold)}</td>` : ''}
      <td class="num nw">${fmtNum(netWorth(g, h))}</td>
      <td class="sb-items">${items}</td>
    </tr>`;
  }).join('');
}

export class Scoreboard {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.open = false;
    this.acc = 0;
    this.node = el('div', 'hud-scoreboard panel-frame');
  }

  render() {
    const g = this.game, ui = this.ui;
    const sc = g.rules?.score ?? { sunward: 0, duskward: 0 };
    const head = `<tr><th>Hero</th><th>Lvl</th><th>K / D / A</th><th>LH / DN</th><th>Gold</th><th>Net Worth</th><th>Items</th></tr>`;
    const nw = (t) => g.heroes.filter((h) => h.team === t).reduce((s, h) => s + netWorth(g, h), 0);
    this.node.innerHTML = `
      <div class="sb-top"><span class="sb-title">Scoreboard</span><span class="sb-time">${fmtTime(g.time)}</span></div>
      ${['sunward', 'duskward'].map((t) => `
        <div class="sb-team ${t}">
          <div class="sb-th"><span class="sb-tn">${t === 'sunward' ? 'Sunward' : 'Duskward'}</span><span class="sb-ts">${sc[t] ?? 0} Kills</span><span class="sb-tnw">Net Worth <b>${fmtNum(nw(t))}</b></span></div>
          <table>${head}${heroRowsHTML(ui, t)}</table>
        </div>`).join('')}`;
  }

  toggle(force) {
    const open = force ?? !this.open;
    this.open = open;
    this.node.classList.toggle('show', open);
    if (open) this.render();
  }

  update(dt) {
    if (!this.open) return;
    this.acc += dt;
    if (this.acc > 0.5) { this.acc = 0; this.render(); }
  }
}
