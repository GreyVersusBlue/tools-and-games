import { el, esc } from '../util.js';
import { KEYBIND_DEFS, FIXED_KEYS } from '../../input/Keybinds.js';

const KEY = 'throneshard-settings';
const DEFAULTS = {
  quality: 'high',
  volume: 0.8,
  music: 0.5,
  damageNumbers: true,
  allDamageNumbers: false,
  hpText: true,
  edgePan: true,
  hudScale: 1,
  sfx: 0.9,
  voice: 0.9,
  tutorial: true,
};

export class Settings {
  constructor(game) {
    this.game = game;
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { saved = {}; }
    this.v = { ...DEFAULTS, ...saved };
  }
  get(k) { return this.v[k]; }
  set(k, val) {
    this.v[k] = val;
    try { localStorage.setItem(KEY, JSON.stringify(this.v)); } catch { /* ignore */ }
    this.apply(k);
  }
  apply(only) {
    const g = this.game, v = this.v;
    const all = !only;
    try {
      if (all || only === 'quality') g.world?.setQuality?.(v.quality);
      if (all || only === 'volume') g.audio?.setVolume?.(v.volume);
      if (all || only === 'music') g.audio?.setMusicVolume?.(v.music);
      if (all || only === 'sfx') g.audio?.setBusVolume?.('sfx', v.sfx);
      if (all || only === 'voice') g.audio?.setBusVolume?.('voice', v.voice);
      if (all || only === 'edgePan') g.cameraCtl?.setEdgePan?.(v.edgePan);
      if (all || only === 'hudScale') g.ui?.applyScale?.();
    } catch (e) { console.warn('[ui] settings apply', e); }
  }
}

export class Modal {
  constructor(ui, title, bodyHTML, { wide = false, cls = '' } = {}) {
    this.ui = ui;
    this.node = el('div', 'ui-modal-wrap', `
      <div class="ui-modal panel-frame ${wide ? 'wide' : ''} ${cls}">
        <div class="md-head"><span>${title}</span><button class="md-x" title="Close">✕</button></div>
        <div class="md-body">${bodyHTML}</div>
      </div>`);
    this.node.querySelector('.md-x').onclick = () => this.close();
    this.node.addEventListener('mousedown', (e) => { if (e.target === this.node) this.close(); });
    ui.root.appendChild(this.node);
    ui.modal = this;
    requestAnimationFrame(() => this.node.classList.add('show'));
  }
  $(s) { return this.node.querySelector(s); }
  close() {
    this.node.classList.remove('show');
    setTimeout(() => this.node.remove(), 200);
    if (this.ui.modal === this) this.ui.modal = null;
    this.onClose?.();
  }
}

export function openControls(ui) {
  return openSettings(ui, { tab: 'controls' });
}

const CAST_MODES = [
  ['normal', 'Normal', 'Press the hotkey, then left-click a target. Right-click cancels.'],
  ['quick', 'Quick Cast', 'Casts instantly at the cursor when the hotkey is pressed. Hold the key to see its range.'],
  ['release', 'On Release', 'Hold the hotkey to aim (range + area shown), release to cast at the cursor.'],
];

function controlsTab(ui) {
  const kb = ui.game.input?.keybinds;
  const mode = ui.game.input?.castMode ?? 'normal';
  let binds = '<div class="kb-none">Key bindings are unavailable (input module not loaded).</div>';
  if (kb) {
    const groups = new Map();
    for (const [action, , label, group] of KEYBIND_DEFS) {
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(`<div class="kb-row"><span>${label}</span><button class="kb-key" data-action="${action}" title="Click, then press a key">${esc(kb.label(action))}</button></div>`);
    }
    binds = `<div class="kb-grid">${[...groups].map(([g, rows]) => `<div class="kb-group"><div class="kb-gh">${g}</div>${rows.join('')}</div>`).join('')}</div>`;
  }
  const fixed = FIXED_KEYS.map(([k, d]) => `<div class="ctl-row"><span class="kbd">${k.split(' / ').map((x) => `<kbd>${esc(x)}</kbd>`).join(' ')}</span><span>${d}</span></div>`).join('');
  return `
    <div class="set-sec">Casting</div>
    <div class="set-row"><label>Cast mode</label>
      <div class="seg" data-k="castMode">${CAST_MODES.map(([v, n]) => `<button data-v="${v}" class="${v === mode ? 'on' : ''}">${n}</button>`).join('')}</div></div>
    <div class="set-note cast-desc">${CAST_MODES.find((m) => m[0] === mode)?.[2] ?? ''}</div>
    <div class="set-note">Tip: press an ally-targeted spell's key twice to self-cast. Hold right mouse to keep moving toward the cursor; Shift queues orders.</div>
    <div class="set-sec">Hotkeys <span class="kb-msg"></span></div>
    ${binds}
    <div class="set-actions kb-actions"><button class="btn-game dim" data-act="kb-reset">Reset hotkeys to default</button></div>
    <div class="set-sec">Fixed keys</div>
    <div class="ctl-grid">${fixed}</div>`;
}

function generalTab(ui) {
  const s = ui.settings;
  const q = s.get('quality');
  const slider = (k, label) => `<div class="set-row"><label>${label}</label><input type="range" min="0" max="1" step="0.01" data-k="${k}" value="${s.get(k)}"><output>${Math.round(s.get(k) * 100)}%</output></div>`;
  return `<div class="set-cols"><div>
    <div class="set-sec">Video</div>
    <div class="set-row"><label>Graphics Quality</label>
      <div class="seg" data-k="quality">${['low', 'medium', 'high', 'ultra'].map((x) => `<button data-v="${x}" class="${x === q ? 'on' : ''}">${x}</button>`).join('')}</div></div>
    <div class="set-row"><label>HUD Scale</label><input type="range" min="0.75" max="1.3" step="0.05" data-k="hudScale" value="${s.get('hudScale')}"><output>${Math.round(s.get('hudScale') * 100)}%</output></div>
    <div class="set-sec">Audio</div>
    ${slider('volume', 'Master Volume')}
    ${slider('sfx', 'Effects Volume')}
    ${slider('voice', 'Voices &amp; Announcer')}
    ${slider('music', 'Music Volume')}
    </div><div>
    <div class="set-sec">Interface</div>
    ${toggle('damageNumbers', 'Floating combat text', s)}
    ${toggle('allDamageNumbers', 'Show all damage numbers', s)}
    ${toggle('hpText', 'Health values on hero bars', s)}
    ${toggle('edgePan', 'Camera edge panning', s)}
    ${toggle('tutorial', 'Show tutorial tips', s)}
    <div class="set-row"><label>Tutorial progress</label><button class="btn-game dim small" data-act="tips-reset">Show all tips again</button></div>
    </div></div>`;
}

export function openSettings(ui, { inGame = false, tab = 'general' } = {}) {
  const s = ui.settings;
  const body = `
    <div class="set-tabs"><button data-tab="general">General</button><button data-tab="controls">Controls &amp; Hotkeys</button></div>
    <div class="set-pane" data-pane="general">${generalTab(ui)}</div>
    <div class="set-pane" data-pane="controls">${controlsTab(ui)}</div>
    ${inGame ? `<div class="set-actions"><button class="btn-game" data-act="resume">Resume</button><button class="btn-game red" data-act="quit">Leave Game</button></div>` : ''}`;
  const m = new Modal(ui, inGame ? 'Game Menu' : 'Settings', body, { wide: true, cls: 'settings' });
  const input = ui.game.input;
  const setTab = (t) => {
    m.node.querySelectorAll('.set-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    m.node.querySelectorAll('.set-pane').forEach((p) => { p.style.display = p.dataset.pane === t ? '' : 'none'; });
    try { localStorage.setItem('throneshard-settings-tab', t); } catch { /* ignore */ }
  };
  m.node.querySelectorAll('.set-tabs button').forEach((b) => b.onclick = () => { setTab(b.dataset.tab); ui.sfx('click'); });
  setTab(tab);
  m.node.querySelectorAll('.seg button').forEach((b) => b.onclick = () => {
    const seg = b.parentElement;
    seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    if (seg.dataset.k === 'castMode') {
      input?.setCastMode?.(b.dataset.v);
      const d = m.$('.cast-desc');
      if (d) d.textContent = CAST_MODES.find((x) => x[0] === b.dataset.v)?.[2] ?? '';
    } else s.set(seg.dataset.k, b.dataset.v);
    ui.sfx('click');
  });
  m.node.querySelectorAll('input[type=range]').forEach((r) => r.oninput = () => {
    s.set(r.dataset.k, +r.value);
    r.nextElementSibling.textContent = Math.round(r.value * 100) + '%';
  });
  m.node.querySelectorAll('input[type=checkbox]').forEach((c) => c.onchange = () => s.set(c.dataset.k, c.checked));
  m.$('[data-act=tips-reset]')?.addEventListener('click', () => {
    ui.tutorial?.reset?.();
    s.set('tutorial', true);
    const c = m.$('input[data-k=tutorial]'); if (c) c.checked = true;
    ui.message?.('Tutorial tips will show again', '#9dff7a', 2);
  });

  // ---- hotkey rebinding: click a key button, then press the new key (Esc cancels) ----
  const kb = input?.keybinds;
  const msg = m.$('.kb-msg');
  const say = (t, bad) => { if (msg) { msg.textContent = t; msg.classList.toggle('bad', !!bad); } };
  let capturing = null;
  const refresh = () => m.node.querySelectorAll('.kb-key').forEach((b) => { b.textContent = kb.label(b.dataset.action); b.classList.remove('wait'); });
  const stop = () => { capturing = null; if (input) input._capture = false; refresh(); };
  const onKey = (e) => {
    if (!capturing) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    if (['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'].includes(e.code)) return;
    if (e.code === 'Escape') { stop(); say(''); return; }
    const action = capturing;
    const r = kb.set(action, e.code);
    stop();
    if (!r.ok) say(r.reason ?? 'Cannot bind that key', true);
    else if (r.swapped) say(`Swapped with "${KEYBIND_DEFS.find((d) => d[0] === r.swapped)?.[2] ?? r.swapped}"`);
    else say('Saved');
    ui.sfx('click');
  };
  if (kb) {
    addEventListener('keydown', onKey, true);
    m.node.querySelectorAll('.kb-key').forEach((b) => b.onclick = () => {
      refresh();
      capturing = b.dataset.action;
      if (input) input._capture = true;
      b.textContent = 'Press a key…';
      b.classList.add('wait');
      say('');
    });
    m.$('[data-act=kb-reset]')?.addEventListener('click', () => { kb.reset(); stop(); say('Hotkeys reset'); });
  }
  const prevClose = m.onClose;
  m.onClose = () => { removeEventListener('keydown', onKey, true); if (input) input._capture = false; prevClose?.(); };

  m.$('[data-act=resume]')?.addEventListener('click', () => m.close());
  m.$('[data-act=quit]')?.addEventListener('click', () => location.reload());
  return m;
}

function toggle(k, label, s) {
  return `<div class="set-row"><label>${label}</label><label class="switch"><input type="checkbox" data-k="${k}" ${s.get(k) ? 'checked' : ''}><span></span></label></div>`;
}
