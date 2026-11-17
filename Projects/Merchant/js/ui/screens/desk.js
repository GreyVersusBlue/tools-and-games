// The desk (DESIGN 4.1): the still, the top bar, the paper stack and End the season.
// The engine owns every rule. This file asks it (view, canEndSeason, paperChoices, choose,
// endSeason) and draws the answer. What lives here is only what a reload may forget: which
// paper is raised, which back is being read, whether a flip is under way.
import { h, qs } from '../dom.js';
import * as engine from '../../engine/index.js';
import { front, back, record, edge, paperTitle, happened, num, dinars, sourceOf } from './paper.js';

const WORDS = ['one', 'two', 'three', 'four'];
const COUNT = ['No', 'One', 'Two', 'Three', 'Four', 'Five'];
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

const REASONS = {
  map: 'The map table opens in the next part of the game.',
  ledger: 'The ledger opens in a later part of the game.',
  notebook: 'The notebook opens in a later part of the game.',
};

const ICONS = {
  coin: '<svg viewBox="0 0 24 24" width="20" height="20"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="currentColor"/></svg>',
  speakerOn: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M3 9v6h4l5 4V5L7 9z" fill="currentColor"/><path d="M15 8c2 2 2 6 0 8M18 5c4 4 4 10 0 14" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  speakerOff: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M3 9v6h4l5 4V5L7 9z" fill="currentColor"/><path d="M16 9l5 6M21 9l-5 6" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
};
const icon = svg => { const s = h('span', { class: 'icon', 'aria-hidden': 'true' }); s.innerHTML = svg; return s; };

/** A small whole number from a string, so a paper's tilt is the same after a reload. */
const tiltOf = (seed, id) => {
  let n = seed | 0;
  for (const ch of String(id)) n = (Math.imul(n, 31) + ch.charCodeAt(0)) | 0;
  return ((Math.abs(n) % 5) - 2) * 0.7;
};

const cssMs = name => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v.endsWith('ms') ? parseFloat(v) : v.endsWith('s') ? parseFloat(v) * 1000 : 0;
};

/** app: { content, art, settings, state, view(), act(fn), say(text), openMenu(opener), toTitle() } */
export function createDesk(app) {
  const { content } = app;
  let raised = null;       // id of the paper the player raised
  let backOf = null;       // { paper, now, fresh, outfit } while a card's back is being read
  let stub = null;         // the first-expedition paper, until MER-44 makes the map table
  let busy = false;        // a flip is under way
  let seasonKey = null;
  let wasLive = false;
  let stillId = null;
  const shown = new Set(); // "id:face" already on screen, so an arrival does not replay

  const still = h('div', { class: 'desk-stills' });
  const note = h('p', { class: 'bar-note', id: 'bar-note' });
  const bar = h('header', { class: 'topbar' });
  const counter = h('p', { class: 'stack-count' });
  const sheetBox = h('div', { class: 'sheet-box' });
  const edges = h('div', { class: 'edges' });
  const endReason = h('p', { class: 'end-reason', id: 'end-reason' });
  const endBtn = h('button', { class: 'end-season', type: 'button', id: 'btn-end', 'aria-describedby': 'end-reason', onclick: () => endSeason() }, 'End the season');
  const stack = h('section', { class: 'stack', 'aria-label': 'Your desk' },
    counter, h('div', { class: 'stack-papers' }, sheetBox, edges),
    h('div', { class: 'end-row' }, endReason, endBtn));
  const el = h('main', { class: 'desk-screen', id: 'screen-desk' }, still, bar, note, stack);

  // ---- the still and the safe box
  function stillFor(v) {
    const st = content.city.stills ?? {};
    const lastAct = content.calendar.lengths?.acts?.acts?.length ?? 3;
    return (v.act >= lastAct ? st.lastAct : st[v.season]) ?? st.spring;
  }
  function setStill(id) {
    const asset = app.art.get(id);
    if (!asset || id === stillId) return;
    const first = stillId === null;
    stillId = id;
    const img = h('img', { class: 'desk-still', src: `assets/art/${asset.file}`, alt: asset.alt ?? '', decoding: 'async', fetchpriority: 'high' });
    const old = [...still.children];
    still.append(img);
    const drop = () => old.forEach(o => o.remove());
    if (first || !cssMs('--season-fade-time')) { drop(); return; }
    img.classList.add('fading');
    img.addEventListener('animationend', drop, { once: true });
  }
  function layout() {
    const asset = app.art.get(stillId);
    if (!asset) return;
    const [sx, sy, sw, sh] = asset.safe ?? [0.22, 0.19, 0.56, 0.62];
    const w = innerWidth, hgt = innerHeight, sc = Math.max(w / asset.w, hgt / asset.h);
    const ox = (w - asset.w * sc) / 2, oy = (hgt - asset.h * sc) / 2;
    el.style.setProperty('--safe-x', `${Math.round(ox + sx * asset.w * sc)}px`);
    el.style.setProperty('--safe-y', `${Math.round(oy + sy * asset.h * sc)}px`);
    el.style.setProperty('--safe-w', `${Math.round(sw * asset.w * sc)}px`);
    el.style.setProperty('--safe-h', `${Math.round(sh * asset.h * sc)}px`);
  }
  addEventListener('resize', layout);

  // ---- the top bar
  function barNote(text) { note.textContent = text; app.say(text); }
  const soft = (key, label, extra) => h('button', {
    class: 'bar-btn', type: 'button', id: `btn-${key}`, 'aria-disabled': 'true', 'aria-describedby': `reason-${key}`,
    onclick: () => barNote(REASONS[key]),
  }, label, extra, h('span', { class: 'visually-hidden', id: `reason-${key}` }, ` ${REASONS[key]}`));

  function drawBar(v) {
    const total = (content.calendar.lengths?.[app.state.length]?.acts ?? []).reduce((n, a) => n + a.to - a.from + 1, 0);
    const held = Object.values(app.state.stock).reduce((n, x) => n + x, 0);
    const sound = app.settings.sound;
    bar.replaceChildren(
      h('div', { class: 'bar-date' },
        h('p', { class: 'date', id: 'bar-date' }, `${cap(v.season)} ${v.year}`),
        h('p', { class: 'count', id: 'bar-count' }, `Season ${app.state.t + 1} of ${total} · Act ${WORDS[v.act - 1] ?? v.act}`)),
      h('div', { class: 'bar-money' },
        h('p', { class: 'money', id: 'bar-money' }, icon(ICONS.coin), h('span', null, dinars(v.money))),
        h('button', { class: 'bar-btn loads', type: 'button', id: 'btn-warehouse', 'aria-disabled': 'true', 'aria-describedby': 'reason-ledger',
          onclick: () => barNote(REASONS.ledger) }, `${num(held)} ${held === 1 ? 'load' : 'loads'} in the warehouse`)),
      h('div', { class: 'bar-tools' },
        soft('map', 'Map'), soft('ledger', 'Ledger'),
        soft('notebook', 'Notebook', h('span', { class: 'bar-badge' }, ` ${app.state.notebook.length}`)),
        h('button', { class: 'bar-btn speaker', type: 'button', id: 'btn-sound', 'aria-pressed': sound ? 'true' : 'false', 'aria-label': 'Sound',
          onclick: () => { app.setSetting('sound', !app.settings.sound); drawBar(app.view()); } }, icon(sound ? ICONS.speakerOn : ICONS.speakerOff)),
        h('button', { class: 'bar-btn menu', type: 'button', id: 'btn-menu', 'aria-haspopup': 'dialog',
          onclick: e => app.openMenu(e.currentTarget) }, 'Menu')));
  }

  // ---- what is on the desk
  const openPapers = () => app.state.desk.filter(p => p.state === 'open');
  function listed() {
    const list = app.state.desk.filter(p => p.state === 'open' || p.id === backOf?.paper.id);
    if (stub) list.push({ id: 'stub', kind: 'outfit', state: 'open' });
    return list;
  }
  function currentId(list) {
    if (backOf) return backOf.paper.id;
    if (raised && list.some(p => p.id === raised)) return raised;
    return list[0]?.id ?? null;
  }

  function stubPaper() {
    const stop = (content.stops ?? []).find(s => s.id === (content.city.firstStop ?? 'damascus'));
    let plan = null, problem = null;
    if (typeof engine.suggestPlan === 'function') {
      try { plan = engine.suggestPlan(app.state, content, stop?.id); } catch (e) { problem = e.message; }
      if (plan && plan.ok === false) { problem = plan.reason ?? 'The plan cannot be made.'; plan = null; }
      if (plan?.plan) plan = plan.plan;
    }
    const agent = plan && (content.agents ?? []).find(a => a.id === plan.agent);
    const title = plan && agent && stop ? `Send ${agent.name} to ${stop.name}` : 'Your first expedition';
    const body = plan ? `Everything is packed and filled in. ${agent?.name ?? 'Your agent'} is ready to take the house's goods to ${stop?.name ?? 'the first stop'}.`
      : problem ?? 'The map table is not open yet, so nobody can set out this season. Your agent waits.';
    const titleId = 'paper-stub-title';
    const buttons = plan
      ? h('button', { class: 'button next', type: 'button', id: 'btn-send', onclick: () => sendStub(plan) }, `Send ${agent?.name ?? 'them'} to ${stop?.name ?? 'the first stop'}`)
      : h('button', { class: 'button next', type: 'button', id: 'btn-stub-dismiss', onclick: () => closeStub() }, 'Leave it for now');
    return h('article', { class: 'paper sheet front kind-outfit', dataset: { paper: 'stub', kind: 'outfit', face: 'front' }, 'aria-labelledby': titleId },
      h('div', { class: 'sheet-head' }, h('span', { class: 'seal seal-plain', 'aria-hidden': 'true' }), h('p', { class: 'sender' }, h('strong', null, 'The house'), h('span', null, ' Cairo'))),
      h('h2', { class: 'sheet-title', id: titleId, tabindex: '-1' }, title),
      h('p', { class: 'sheet-body', id: 'stub-body' }, body), buttons);
  }
  function sendStub(plan) {
    try { app.act(s => engine.outfit(s, content, plan)); } catch (e) { qs('#stub-body', el).textContent = e.message; return; }
    closeStub();
  }
  function closeStub() { stub = null; draw({ focus: 'next' }); }

  function drawStack(opts) {
    const list = listed();
    const cur = currentId(list);
    const phase = app.state.phase;
    sheetBox.replaceChildren(); edges.replaceChildren();
    if (phase !== 'desk') { sheetBox.append(phasePage(phase)); counter.textContent = ''; return; }
    const left = openPapers().length + (stub ? 1 : 0);
    counter.textContent = left ? `${left} ${left === 1 ? 'paper' : 'papers'} left` : 'No papers left';

    let node = null;
    const paper = list.find(p => p.id === cur);
    if (paper) {
      if (backOf) {
        node = back(app, paper, { now: backOf.now, fresh: backOf.fresh, onNext: next });
        node.dataset.face = 'back';
      } else if (paper.id === 'stub') node = stubPaper();
      else if (paper.kind === 'return' || paper.kind === 'accounts') node = record(app, paper, { onDone: () => answer(paper, { id: 'ok', now: [] }) });
      else node = front(app, paper, { onChoose: (c) => answer(paper, c), locked: () => busy });
      const key = `${paper.id}:${backOf ? 'back' : 'front'}`;
      if (shown.has(key) && !opts.flipped) node.classList.add('still');
      shown.add(key);
      sheetBox.append(node);
    }
    for (const p of list) {
      if (p.id === cur) continue;
      edges.append(edge(app, p.id === 'stub' ? { ...p, ref: null, title: 'Your first expedition' } : p, {
        tilt: tiltOf(app.state.seed, p.id), onRaise: () => { if (busy || backOf) return; raised = p.id; draw({ focus: 'raise' }); },
      }));
    }
  }

  function phasePage(phase) {
    const v = app.view();
    const wrap = (title, ...rest) => h('article', { class: 'paper sheet front kind-phase', dataset: { phase, face: 'front' }, 'aria-labelledby': 'phase-title' },
      h('h2', { class: 'sheet-title', id: 'phase-title', tabindex: '-1' }, title), ...rest);
    if (phase === 'interlude') {
      const gap = (content.text?.interludes ?? [])[v.act - 2];
      return wrap(gap?.title ?? 'Years pass', h('p', { class: 'sheet-body' }, gap?.body ?? 'Years go by.'),
        h('button', { class: 'button next', type: 'button', id: 'btn-open-house', onclick: () => { app.act(s => engine.openSeason(s, content)); seasonKey = null; draw({ focus: 'season' }); } },
          `Open the house in ${cap(v.season)} ${v.year}`));
    }
    return wrap('The last season is over', h('p', { class: 'sheet-body' }, 'The ending of the game is still being built. Your house is saved as it stands.'),
      h('button', { class: 'button next', type: 'button', id: 'btn-to-title', onclick: () => app.toTitle() }, 'Back to the title'));
  }

  // ---- answering
  function flip(node, then) {
    const half = cssMs('--flip-time') / 2;
    if (!half || !node.animate) { then(); return; }
    node.animate([{ transform: 'rotateY(0)' }, { transform: 'rotateY(90deg)' }], { duration: half, easing: 'ease-in' }).finished.then(then, then);
  }

  function answer(paper, choice) {
    if (busy) return;
    busy = true;
    const node = qs(`[data-paper="${paper.id}"]`, sheetBox);
    node?.setAttribute('inert', '');
    const before = new Set(app.state.notebook);
    try { app.act(s => engine.choose(s, content, paper.id, choice.id)); } catch (e) { busy = false; node?.removeAttribute('inert'); app.say(e.message); return; }
    if (paper.kind === 'return' || paper.kind === 'accounts') { busy = false; raised = null; draw({ focus: 'next' }); return; }
    const fresh = app.state.notebook.filter(id => !before.has(id)).map(id => (content.notebook ?? []).find(n => n.id === id)?.title ?? id);
    const answered = app.state.desk.find(p => p.id === paper.id);
    const now = paper.kind === 'notice' ? 'Noted.' : happened(content, choice.now);
    const done = () => {
      backOf = { paper: answered, now, fresh, outfit: choice.ui === 'outfit-first' };
      busy = false;
      draw({ focus: 'back', flipped: true });
      if (node) { const b = qs('.sheet', sheetBox); b?.animate?.([{ transform: 'rotateY(90deg)' }, { transform: 'rotateY(0)' }], { duration: cssMs('--flip-time') / 2, easing: 'ease-out' }); }
    };
    flip(node ?? document.createElement('div'), done);
  }

  function next() {
    if (busy || !backOf) return;
    const outfit = backOf.outfit;
    backOf = null; raised = null;
    if (outfit) { stub = {}; raised = 'stub'; } // the paper that sends him comes next
    draw({ focus: 'next' });
  }

  function endState() {
    const can = engine.canEndSeason(app.state);
    if (app.state.phase !== 'desk') return { ok: false, reason: '' };
    if (backOf && can.ok) return { ok: false, reason: 'Press Next first.' };
    if (stub) {
      // The expedition paper is the page's, not the engine's: it is counted with the rest.
      const left = openPapers().length + 1;
      return { ok: false, reason: left === 1 ? 'The expedition paper is still on your desk.' : `${left} papers still need an answer.` };
    }
    return can;
  }

  function endSeason() {
    if (busy) return;
    const can = endState();
    if (!can.ok) { app.say(can.reason); return; }
    app.act(s => engine.endSeason(s, content));
    raised = null; backOf = null; stub = null;
    draw({ focus: 'season' });
  }

  // ---- drawing everything
  function draw(opts = {}) {
    const v = app.view();
    setStill(stillFor(v));
    layout();
    drawBar(v);
    note.textContent = '';
    const key = `${app.state.t}:${app.state.phase}`;
    const newSeason = key !== seasonKey;
    drawStack(opts);
    const can = endState();
    endBtn.setAttribute('aria-disabled', can.ok ? 'false' : 'true');
    endBtn.hidden = app.state.phase !== 'desk';
    endReason.textContent = can.ok ? '' : can.reason;
    endReason.hidden = can.ok;
    // DESIGN 7: one brass pulse, the first time the button goes live in the first season.
    endBtn.classList.toggle('pulse', can.ok && !wasLive && app.state.t === 0);
    wasLive = can.ok;
    document.documentElement.dataset.season = v.season;
    if (newSeason) {
      seasonKey = key;
      if (app.state.phase === 'desk') {
        const n = openPapers().length;
        app.say(`${cap(v.season)} ${v.year}. ${COUNT[Math.min(n, 5)]} ${n === 1 ? 'paper' : 'papers'} on your desk.`);
      }
      if (opts.focus !== 'season' && opts.focus !== 'raise' && opts.focus !== 'back' && opts.focus !== 'next') opts = { ...opts, focus: 'season' };
    }
    const f = opts.focus;
    if (f === 'season' || f === 'raise' || f === 'back' || f === 'next') {
      const title = qs('.sheet-title', sheetBox);
      const left = openPapers().length + (stub ? 1 : 0);
      if (f === 'next' && !left && !backOf && app.state.phase === 'desk') endBtn.focus();
      else (title ?? endBtn).focus();
    }
  }

  // ---- the keyboard (DESIGN 6)
  function key(e) {
    if (e.repeat || e.altKey || e.ctrlKey || e.metaKey) return false;
    const t = e.target;
    if (t.closest?.('input, textarea, select, [role="listbox"], [role="spinbutton"], [contenteditable]')) return false;
    if (document.querySelector('dialog[open]')) return false;
    if (e.key === 'Enter' && backOf && !t.closest?.('button')) { e.preventDefault(); next(); return true; }
    if (!app.settings.shortcuts) return false;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (/^[1-9]$/.test(k)) {
      if (busy || backOf || app.state.phase !== 'desk') return false;
      const cur = currentId(listed());
      const paper = app.state.desk.find(p => p.id === cur && p.state === 'open');
      const btn = paper && qs(`.choices .choice:nth-of-type(${k})`, sheetBox);
      if (!btn) return false;
      e.preventDefault();
      btn.click();
      return true;
    }
    if (k === 'e') { e.preventDefault(); endSeason(); return true; }
    if (k === 'm' || k === 'l' || k === 'n') {
      e.preventDefault();
      barNote(REASONS[{ m: 'map', l: 'ledger', n: 'notebook' }[k]]);
      return true;
    }
    return false;
  }

  return { el, key, draw, destroy() { removeEventListener('resize', layout); } };
}
