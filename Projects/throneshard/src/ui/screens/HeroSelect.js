import { el, esc, ATTR, abilityDef, abilityIcon } from '../util.js';
import { abilityTooltip } from '../Tooltip.js';

const GROUPS = ['str', 'agi', 'int', 'uni'];

export class HeroSelect {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.selected = null;
    this.team = 'sunward';
    this.node = el('div', 'ui-screen scr-pick');
    this.build();
  }

  defs() { return Object.values(this.game.heroDefs ?? {}); }

  build() {
    const ui = this.ui;
    const defs = this.defs();
    const groups = GROUPS.map((g) => ({ g, list: defs.filter((d) => (d.primary ?? 'str') === g).sort((a, b) => a.name.localeCompare(b.name)) })).filter((x) => x.list.length);
    const diff = ui.difficulty ?? 'normal';
    this.node.innerHTML = `
      <div class="pk-bg"></div>
      <div class="pk-top">
        <button class="btn-game dim pk-back">‹ Back</button>
        <div class="pk-heading"><span class="pk-h1">Choose Your Hero</span><span class="pk-h2">All Pick · Bots: ${esc(diff[0].toUpperCase() + diff.slice(1))}</span></div>
        <div class="pk-count">${defs.length} Heroes</div>
      </div>
      <div class="pk-main">
        <div class="pk-grid">${groups.map(({ g, list }) => `
          <div class="pk-group">
            <div class="pk-ghead"><i class="orb orb-${g}"></i><span>${ATTR[g].name}</span></div>
            <div class="pk-cards">${list.map((d) => `
              <div class="pk-card" data-id="${esc(d.id)}">
                ${ui.portraits.html(d.id, 'pk-pt')}
                <div class="pk-name">${esc(d.name)}</div>
              </div>`).join('')}</div>
          </div>`).join('')}
        </div>
        <div class="pk-detail panel-frame"></div>
      </div>
      <div class="pk-bottom">
        <div class="pk-team">
          <div class="mn-label">Your Team</div>
          <div class="pk-teams">
            <button class="pk-tb sunward on" data-team="sunward"><i></i><span>Sunward</span></button>
            <button class="pk-tb duskward" data-team="duskward"><i></i><span>Duskward</span></button>
          </div>
        </div>
        <div class="pk-actions">
          <button class="btn-game dim pk-random">🎲 Random</button>
          <button class="btn-lock" disabled><span>Lock In</span></button>
        </div>
      </div>`;
    this.detail = this.node.querySelector('.pk-detail');
    this.lockBtn = this.node.querySelector('.btn-lock');
    this.node.querySelector('.pk-back').onclick = () => { ui.sfx('click'); ui.showMenu(); };
    this.node.querySelectorAll('.pk-card').forEach((c) => {
      c.addEventListener('mouseenter', () => { this.renderDetail(c.dataset.id, true); ui.sfx('hover'); });
      c.addEventListener('mouseleave', () => this.renderDetail(this.selected));
      c.addEventListener('click', () => this.select(c.dataset.id));
      c.addEventListener('dblclick', () => { this.select(c.dataset.id); this.lock(); });
    });
    this.node.querySelectorAll('.pk-tb').forEach((b) => b.onclick = () => {
      this.team = b.dataset.team;
      this.node.querySelectorAll('.pk-tb').forEach((x) => x.classList.toggle('on', x === b));
      ui.sfx('click');
    });
    this.node.querySelector('.pk-random').onclick = () => {
      const all = this.defs();
      if (!all.length) return;
      const d = all[Math.floor(Math.random() * all.length)];
      this.select(d.id);
      this.node.querySelector(`.pk-card[data-id="${CSS.escape(d.id)}"]`)?.scrollIntoView({ block: 'nearest' });
    };
    this.lockBtn.onclick = () => this.lock();
    this.renderDetail(null);
  }

  select(id) {
    this.selected = id;
    this.node.querySelectorAll('.pk-card').forEach((c) => c.classList.toggle('sel', c.dataset.id === id));
    this.lockBtn.disabled = !id;
    this.renderDetail(id);
    this.ui.sfx('select');
  }

  lock() {
    if (!this.selected) return;
    this.ui.sfx('lock');
    this.ui.startMatch({ heroId: this.selected, team: this.team, difficulty: this.ui.difficulty ?? 'normal' });
  }

  renderDetail(id, preview = false) {
    const ui = this.ui, g = this.game;
    const d = id ? g.heroDefs?.[id] : null;
    if (!d) {
      this.detail.innerHTML = `<div class="pk-empty"><div class="pk-empty-ic">✦</div><div>Hover over a hero to learn more.<br>Click to select, then <b>Lock In</b>.</div></div>`;
      return;
    }
    const p = d.primary ?? 'str';
    const primVal = p === 'uni' ? (d.str + d.agi + d.int) * 0.7 : d[p] ?? 0;
    const dmg = [Math.round((d.baseDamage?.[0] ?? 30) + primVal), Math.round((d.baseDamage?.[1] ?? 36) + primVal)];
    const hp = Math.round(120 + d.str * 22), mana = Math.round(75 + d.int * 12);
    const armor = ((d.baseArmor ?? 0) + d.agi * 0.167).toFixed(1);
    const abIds = d.abilities ?? [];
    const abDefs = abIds.map((a) => ({ id: a, def: abilityDef(g, a) }));
    const roles = (d.roles ?? []).map((r) => `<span class="chip">${esc(r)}</span>`).join('');
    const attrRow = (a) => `<div class="pk-attr ${p === a || p === 'uni' ? 'prim' : ''}"><i class="orb orb-${a}"></i><b>${d[a] ?? 0}</b><em>+${(d[a + 'Gain'] ?? 0).toFixed(1)}</em></div>`;
    this.detail.innerHTML = `
      <div class="pd-hero">
        ${ui.portraits.html(d.id, 'pd-pt')}
        <div class="pd-shade"></div>
        <div class="pd-name"><i class="orb orb-${p}"></i><div><div class="pd-n">${esc(d.name)}</div>${d.title ? `<div class="pd-t">${esc(d.title)}</div>` : ''}</div></div>
      </div>
      <div class="pd-meta"><span class="chip atk">${d.attackType === 'ranged' ? '🏹 Ranged' : '⚔ Melee'}</span>${roles}</div>
      <div class="pd-attrs">${attrRow('str')}${attrRow('agi')}${attrRow('int')}</div>
      <div class="pd-stats">
        <div><span>Health</span><b class="c-hp">${hp}</b></div>
        <div><span>Mana</span><b class="c-mana">${mana}</b></div>
        <div><span>Damage</span><b>${dmg[0]}–${dmg[1]}</b></div>
        <div><span>Armor</span><b>${armor}</b></div>
        <div><span>Move Speed</span><b>${d.moveSpeed ?? 300}</b></div>
        <div><span>Attack Range</span><b>${d.attackRange ?? 150}</b></div>
      </div>
      <div class="pd-abil-h">Abilities</div>
      <div class="pd-abils">${abDefs.length ? abDefs.map(({ id: aid, def }, i) => `
        <div class="pd-ab ${def?.ultimate || i === 3 ? 'ult' : ''}" data-i="${i}">
          <div class="pd-ic">${abilityIcon(def, aid)}</div>
          <div class="pd-ab-n">${esc(def?.name ?? prettify(aid))}</div>
        </div>`).join('') : '<div class="pd-none">Ability data unavailable</div>'}
      </div>
      ${d.lore ? `<div class="pd-lore">${esc(d.lore)}</div>` : ''}
      ${preview && id !== this.selected ? '<div class="pd-hint">Click to select</div>' : ''}`;
    this.detail.querySelectorAll('.pd-ab').forEach((e) => {
      const { id: aid, def } = abDefs[+e.dataset.i];
      ui.tooltip.attach(e, () => abilityTooltip(g, null, def ?? { id: aid, name: prettify(aid), description: '' }), 'left');
    });
  }

  show() { this.ui.root.appendChild(this.node); requestAnimationFrame(() => this.node.classList.add('show')); }
  hide() { this.ui.tooltip.hide(); this.node.classList.remove('show'); setTimeout(() => this.node.remove(), 400); }
}

function prettify(id) {
  return String(id ?? '').replace(/^[a-z]+_/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
