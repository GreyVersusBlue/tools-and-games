import { el, esc, levelValue, fmtBonus, getItemDef, itemIcon, abilityIcon } from './util.js';

// Single floating tooltip. attach(el, providerFn) — providerFn returns HTML (or null to suppress).
export class Tooltip {
  constructor(root) {
    this.node = el('div', 'ui-tooltip');
    root.appendChild(this.node);
    this.target = null;
    this.provider = null;
  }

  attach(e, provider, placement = 'top') {
    e.addEventListener('mouseenter', () => this.show(e, provider, placement));
    e.addEventListener('mouseleave', () => { if (this.target === e) this.hide(); });
    e.addEventListener('mousedown', () => { if (this.target === e) this.hide(); });
  }

  show(target, provider, placement = 'top') {
    let html;
    try { html = provider(); } catch (err) { html = null; }
    if (!html) return this.hide();
    this.target = target;
    this.provider = provider;
    this.placement = placement;
    this.node.innerHTML = html;
    this.node.classList.add('show');
    this.position();
  }

  // Refresh content if still hovering (e.g. level changes)
  refresh() {
    if (!this.target || !this.target.isConnected) return this.hide();
    let html;
    try { html = this.provider(); } catch { html = null; }
    if (html && html !== this.node._last) { this.node.innerHTML = html; this.node._last = html; this.position(); }
  }

  position() {
    const r = this.target.getBoundingClientRect();
    const t = this.node.getBoundingClientRect();
    const pad = 10;
    let x, y;
    if (this.placement === 'right') { x = r.right + pad; y = r.top; }
    else if (this.placement === 'left') { x = r.left - t.width - pad; y = r.top; }
    else if (this.placement === 'bottom') { x = r.left + r.width / 2 - t.width / 2; y = r.bottom + pad; }
    else { x = r.left + r.width / 2 - t.width / 2; y = r.top - t.height - pad; }
    if (y < 6) y = r.bottom + pad;
    x = Math.max(6, Math.min(innerWidth - t.width - 6, x));
    y = Math.max(6, Math.min(innerHeight - t.height - 6, y));
    this.node.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  hide() {
    this.target = null;
    this.node.classList.remove('show');
  }
}

// ---- Tooltip content builders ----

// ---- ability value formatting ----
const VALUE_LABELS = {
  damage: 'Damage', dps: 'Damage per Second', stun: 'Stun Duration', duration: 'Duration', slow: 'Movement Slow',
  attackSlow: 'Attack Speed Slow', slowDuration: 'Slow Duration', distance: 'Distance', knockback: 'Knockback',
  chance: 'Chance', crit: 'Critical Damage', cleave: 'Cleave Damage', armor: 'Bonus Armor', attackSpeed: 'Bonus Attack Speed',
  moveSpeed: 'Bonus Movement Speed', evasion: 'Evasion', silence: 'Silence Duration', delay: 'Delay', interval: 'Interval',
  range: 'Bonus Attack Range', breakRange: 'Break Range', disableRange: 'Disable Range', explosionRadius: 'Explosion Radius',
  explosionDamage: 'Explosion Damage', targetDamage: 'Primary Target Damage', aoeDamage: 'Area Damage', totalDamage: 'Total Damage',
  pulseDamage: 'Pulse Damage', bonusDamage: 'Bonus Damage', baseDamage: 'Base Damage', attackFactor: 'Attack Damage Dealt',
  damagePct: 'Damage', healPct: 'Heal per Second (max HP)', regen: 'Bonus HP Regen', magicResist: 'Magic Resistance per Stack',
  strPerStack: 'Strength per Stack', reduction: 'Damage Reduction', manaDrainPct: 'Mana Drained', walkSpeed: 'Walk Speed',
  threshold: 'Kill Threshold', jumps: 'Bounces', bounces: 'Bounces', targets: 'Max Targets', waves: 'Waves', arrows: 'Arrows',
  slashes: 'Slashes', attacks: 'Attacks', maxStacks: 'Max Stacks', drain: 'Health Drain per Second', creepDuration: 'Creep Duration',
  speedDuration: 'Speed Duration', agiPct: 'Agility Bonus', speedPerTarget: 'Speed per Target', selfMult: 'Self Multiplier',
};
const SKIP_VALUES = new Set(['angle', 'jumpDelay', 'bounceDelay', 'jumpTime', 'tick', 'airTime', 'cooldown', 'rangeMult', 'strMult', 'pull']);
const TIME_KEYS = /^(duration|stun|delay|interval|silence|slowDuration|creepDuration|speedDuration)$/;
const DIST_KEYS = /(range|Range|distance|knockback|Radius|radius)$/;
const PCT_KEYS = /(slow|Slow|chance|evasion|Pct|pct|reduction|magicResist|cleave|moveSpeed|walkSpeed|agiPct|speedPerTarget|attackFactor)$/;
const valueLabel = (k) => VALUE_LABELS[k] ?? k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
function fmtValue(k, v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const num = (x) => (Number.isInteger(x) ? String(x) : String(+x.toFixed(2)));
  if (k === 'attackSlow') return num(v);
  if (k === 'crit') return Math.round(v * 100) + '%';
  if (k === 'speed') return v > 5 ? String(Math.round(v * 40)) : Math.round(v * 100) + '%';
  if (DIST_KEYS.test(k)) return String(Math.round(v * 40));
  if (PCT_KEYS.test(k) && Math.abs(v) <= 3) return Math.round(v * 100) + '%';
  if (TIME_KEYS.test(k)) return num(v) + 's';
  return num(v);
}
function valueRows(def, lvl) {
  const rows = [];
  for (const [k, raw] of Object.entries(def.values ?? {})) {
    if (SKIP_VALUES.has(k)) continue;
    const arrV = Array.isArray(raw) ? raw : [raw];
    if (arrV.some((x) => typeof x !== 'number')) continue;
    const label = k === 'speed' ? (arrV[0] > 5 ? 'Projectile Speed' : 'Bonus Speed') : valueLabel(k);
    const cells = arrV.length > 1 && !arrV.every((x) => x === arrV[0])
      ? arrV.map((v, i) => `<span class="${i === lvl - 1 ? 'cur' : ''}">${fmtValue(k, v)}</span>`).join(' / ')
      : `<span class="cur">${fmtValue(k, arrV[0])}</span>`;
    rows.push(`<div class="tt-kv"><span>${esc(label)}:</span><b>${cells}</b></div>`);
  }
  return rows;
}

export function abilityTooltip(game, ab, def) {
  def = def ?? ab?.def;
  if (!def) return null;
  const lvl = ab?.level ?? 0;
  const maxL = def.maxLevel ?? (def.ultimate ? 3 : 4);
  let tt = { none: 'No Target', unit: 'Unit Target', point: 'Point Target', passive: 'Passive', toggle: 'Toggle', aoe: 'AOE' }[def.targetType] ?? '';
  if (def.radius && (def.targetType === 'point' || def.targetType === 'none')) tt += ' · AOE';
  if (def.channel || def.channelTime) tt += ' · Channeled';
  const rows = [];
  if (tt) rows.push(`<div class="tt-kv"><span>Ability:</span><b>${tt}</b></div>`);
  if (def.targetTeam && def.targetType !== 'none' && def.targetType !== 'passive') rows.push(`<div class="tt-kv"><span>Affects:</span><b>${def.targetTeam === 'enemy' ? 'Enemies' : def.targetTeam === 'ally' ? 'Allies' : 'Units'}</b></div>`);
  if (def.damageType) rows.push(`<div class="tt-kv"><span>Damage Type:</span><b class="dmg-${def.damageType}">${def.damageType[0].toUpperCase() + def.damageType.slice(1)}</b></div>`);
  const pierce = def.pierceImmunity ?? def.piercesImmunity;
  if (pierce != null && def.targetType !== 'passive') rows.push(`<div class="tt-kv"><span>Pierces Spell Immunity:</span><b class="${pierce ? 'yes' : 'no'}">${pierce ? 'Yes' : 'No'}</b></div>`);
  const arr = (a, fmt = (v) => v) => Array.isArray(a) && a.length > 1 && !a.every((x) => x === a[0])
    ? a.map((v, i) => `<span class="${i === lvl - 1 ? 'cur' : ''}">${fmt(v)}</span>`).join(' / ')
    : `<span class="cur">${fmt(Array.isArray(a) ? a[0] : a)}</span>`;
  const extra = [];
  if (def.castRange && (Array.isArray(def.castRange) ? def.castRange.some((v) => v > 0) : def.castRange > 0))
    extra.push(`<div class="tt-kv"><span>Cast Range:</span><b>${arr(def.castRange, (v) => Math.round(v * 40))}</b></div>`);
  if (def.radius) extra.push(`<div class="tt-kv"><span>Radius:</span><b>${arr(def.radius, (v) => Math.round(v * 40))}</b></div>`);
  if (def.duration) extra.push(`<div class="tt-kv"><span>Duration:</span><b>${arr(def.duration, (v) => v + 's')}</b></div>`);
  if (def.damage) extra.push(`<div class="tt-kv"><span>Damage:</span><b>${arr(def.damage)}</b></div>`);
  extra.push(...valueRows(def, lvl));
  if (def.castPoint > 0 && def.targetType !== 'passive') extra.push(`<div class="tt-kv tt-small"><span>Cast Point:</span><b>${def.castPoint}s</b></div>`);
  const cd = def.cooldown != null && (Array.isArray(def.cooldown) ? def.cooldown.some((v) => v > 0) : def.cooldown > 0) ? arr(def.cooldown) : null;
  const mc = def.manaCost != null && (Array.isArray(def.manaCost) ? def.manaCost.some((v) => v > 0) : def.manaCost > 0) ? arr(def.manaCost) : null;
  const pips = Array.from({ length: maxL }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('');
  const scepter = def.scepter?.description ? `<div class="tt-scepter"><b>Ascendant Scepter:</b> ${esc(def.scepter.description)}</div>` : '';
  const hint = ab && !lvl && ab.hero === game.player?.hero ? `<div class="tt-hint">Learn with Ctrl/Alt + ${esc(game.input?.keyLabel?.(`ability${(ab.hero.abilities?.indexOf(ab) ?? 0) + 1}`) ?? 'key')} or the + button</div>` : '';
  return `<div class="tt tt-ability">
    <div class="tt-head">
      <div class="tt-icon">${abilityIcon(def, def.id)}</div>
      <div><div class="tt-title">${esc(def.name ?? def.id)}</div>
      <div class="tt-sub">${def.ultimate ? 'Ultimate · ' : ''}Level ${lvl}/${maxL} <span class="tt-pips">${pips}</span></div></div>
    </div>
    <div class="tt-body">
      ${rows.join('')}
      <p class="tt-desc">${esc(def.description ?? '')}</p>
      ${extra.length ? `<div class="tt-vals">${extra.join('')}</div>` : ''}
      ${scepter}
      ${def.lore ? `<p class="tt-lore">${esc(def.lore)}</p>` : ''}
      ${hint}
    </div>
    ${cd || mc ? `<div class="tt-foot">${cd ? `<span class="tt-cd"><i class="i-cd"></i>${cd}</span>` : ''}${mc ? `<span class="tt-mana"><i class="i-mana"></i>${mc}</span>` : ''}</div>` : ''}
  </div>`;
}

export function itemTooltip(game, defOrItem, opts = {}) {
  const item = defOrItem?.def ? defOrItem : null;
  const def = item ? item.def : defOrItem;
  if (!def) return null;
  const bonuses = Object.entries(def.bonus ?? {}).filter(([, v]) => v).map(([k, v]) => `<div class="tt-bonus">${esc(fmtBonus(k, v))}</div>`).join('');
  const act = def.active;
  const comps = (def.components ?? []).map((c) => getItemDef(game, c)).filter(Boolean);
  let build = '';
  if (comps.length) {
    build = `<div class="tt-build"><div class="tt-label">Requires</div><div class="tt-comp">${comps.map((c) =>
      `<span class="tt-ci">${itemIcon(game, c)}<em>${c.cost ?? ''}</em></span>`).join('')}${def.recipeCost ? `<span class="tt-ci recipe"><span class="ic-glyph">📜</span><em>${def.recipeCost}</em></span>` : ''}</div></div>`;
  }
  const into = opts.buildsInto?.length ? `<div class="tt-build"><div class="tt-label">Builds into</div><div class="tt-comp">${opts.buildsInto.slice(0, 6).map((c) => `<span class="tt-ci">${itemIcon(game, c)}</span>`).join('')}</div></div>` : '';
  const cd = act?.cooldown ? levelValue(act.cooldown, 1) : null;
  const mc = act?.manaCost ? levelValue(act.manaCost, 1) : null;
  const charges = item?.charges != null && item.charges > 0 ? `<div class="tt-kv"><span>Charges:</span><b>${item.charges}</b></div>` : '';
  const sellHint = opts.sellHint ? `<div class="tt-hint">${opts.sellHint}</div>` : '';
  return `<div class="tt tt-item">
    <div class="tt-head">
      <div class="tt-icon item">${itemIcon(game, def)}</div>
      <div><div class="tt-title">${esc(def.name ?? def.id)}</div>
      <div class="tt-sub gold"><i class="i-gold"></i>${def.cost ?? '—'}${def.shop === 'secret' ? ' <span class="tt-secret">Hidden Bazaar</span>' : ''}</div></div>
    </div>
    <div class="tt-body">
      ${bonuses ? `<div class="tt-bonuses">${bonuses}</div>` : ''}
      ${act ? `<div class="tt-active"><b>Active${act.name ? ': ' + esc(act.name) : ''}</b>${act.targetType && act.targetType !== 'none' ? ` <em>${act.targetType === 'unit' ? 'Unit Target' : 'Point Target'}</em>` : ''}</div>` : ''}
      ${act && levelValue(act.castRange, 1) > 0 ? `<div class="tt-kv"><span>Cast Range:</span><b>${Math.round(levelValue(act.castRange, 1) * 40)}</b></div>` : ''}
      ${act?.channel ? `<div class="tt-kv"><span>Channel Time:</span><b>${act.channel}s</b></div>` : ''}
      ${act?.radius ? `<div class="tt-kv"><span>Radius:</span><b>${Math.round(levelValue(act.radius, 1) * 40)}</b></div>` : ''}
      ${act?.duration ? `<div class="tt-kv"><span>Duration:</span><b>${levelValue(act.duration, 1)}s</b></div>` : ''}
      ${act?.damageType ? `<div class="tt-kv"><span>Damage Type:</span><b class="dmg-${act.damageType}">${act.damageType[0].toUpperCase() + act.damageType.slice(1)}</b></div>` : ''}
      ${def.description ? `<p class="tt-desc">${esc(def.description)}</p>` : ''}
      ${charges}${build}${into}
      ${def.lore ? `<p class="tt-lore">${esc(def.lore)}</p>` : ''}
      ${sellHint}
    </div>
    ${cd || mc ? `<div class="tt-foot">${cd ? `<span class="tt-cd"><i class="i-cd"></i>${cd}</span>` : ''}${mc ? `<span class="tt-mana"><i class="i-mana"></i>${mc}</span>` : ''}</div>` : ''}
  </div>`;
}

export function simpleTooltip(title, body) {
  return `<div class="tt tt-simple"><div class="tt-title">${esc(title)}</div>${body ? `<div class="tt-body"><p class="tt-desc">${body}</p></div>` : ''}</div>`;
}
