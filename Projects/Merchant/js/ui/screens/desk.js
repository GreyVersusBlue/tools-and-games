// The desk (DESIGN 4.1): the still, the top bar, the paper stack and End the season.
// The engine owns every rule. This file asks it (view, canEndSeason, paperChoices, choose,
// endSeason) and draws the answer. What lives here is only what a reload may forget: which
// paper is raised, which back is being read, whether a flip is under way.
import { h, qs } from '../dom.js';
import * as engine from '../../engine/index.js';
import { leftHow } from '../../engine/agents.js';
import { front, back, record, edge, paperTitle, happened, num, dinars, RECORD_KINDS } from './paper.js';

const WORDS = ['one', 'two', 'three', 'four'];
const COUNT = ['No', 'One', 'Two', 'Three', 'Four', 'Five'];
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

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
  /** The ledger and the notebook are dialogs over the desk (DESIGN 4); a raised card's back may stay open under them. */
  function openBook(name, opener, section) {
    if (busy) return;
    app.openBook(name, opener, section);
  }

  /** The map table is its own screen with its own hash (#map). `outfitFor` is a stop to open the
      one-press sheet on once the map has drawn (DESIGN 7); the map reads it from the app and clears it. */
  function toMap(outfitFor = null) {
    if (busy) return;
    if (backOf && !outfitFor) { barNote('Press Next first.'); return; }
    if (app.state.phase !== 'desk') { barNote('The map table is for the seasons, not the years between.'); return; }
    app.outfitFor = outfitFor;
    location.hash = 'map';
  }

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
        h('button', { class: 'bar-btn loads', type: 'button', id: 'btn-warehouse', 'aria-haspopup': 'dialog',
          onclick: e => openBook('ledger', e.currentTarget, 'warehouse') }, `${num(held)} ${held === 1 ? 'load' : 'loads'} in the warehouse`)),
      h('div', { class: 'bar-tools' },
        h('button', { class: 'bar-btn', type: 'button', id: 'btn-map', onclick: () => toMap() }, 'Map'),
        h('button', { class: 'bar-btn', type: 'button', id: 'btn-ledger', 'aria-haspopup': 'dialog',
          onclick: e => openBook('ledger', e.currentTarget) }, 'Ledger'),
        h('button', { class: 'bar-btn', type: 'button', id: 'btn-notebook', 'aria-haspopup': 'dialog',
          onclick: e => openBook('notebook', e.currentTarget) }, 'Notebook', h('span', { class: 'bar-badge' }, String(app.state.notebook.length))),
        h('button', { class: 'bar-btn speaker', type: 'button', id: 'btn-sound', 'aria-pressed': sound ? 'true' : 'false', 'aria-label': 'Sound',
          onclick: () => { app.setSetting('sound', !app.settings.sound); drawBar(app.view()); } }, icon(sound ? ICONS.speakerOn : ICONS.speakerOff)),
        h('button', { class: 'bar-btn menu', type: 'button', id: 'btn-menu', 'aria-haspopup': 'dialog',
          onclick: e => app.openMenu(e.currentTarget) }, 'Menu')));
  }

  // ---- what is on the desk
  // DESIGN 4.6: the account is folded shut on the first return of a game and open after.
  const returnsSeen = () => app.state.log.filter(e => e.kind === 'return').length;
  const openPapers = () => app.state.desk.filter(p => p.state === 'open');
  function listed() {
    return app.state.desk.filter(p => p.state === 'open' || p.id === backOf?.paper.id);
  }
  function currentId(list) {
    if (backOf) return backOf.paper.id;
    if (raised && list.some(p => p.id === raised)) return raised;
    return list[0]?.id ?? null;
  }

  function drawStack(opts) {
    const list = listed();
    const cur = currentId(list);
    const phase = app.state.phase;
    sheetBox.replaceChildren(); edges.replaceChildren();
    if (phase !== 'desk') { sheetBox.append(phasePage(phase)); counter.textContent = ''; return; }
    const left = openPapers().length;
    counter.textContent = left ? `${left} ${left === 1 ? 'paper' : 'papers'} left` : 'No papers left';

    let node = null;
    const paper = list.find(p => p.id === cur);
    if (paper) {
      if (backOf) {
        node = back(app, paper, { now: backOf.now, fresh: backOf.fresh, onNext: next });
        node.dataset.face = 'back';
      } else if (RECORD_KINDS.includes(paper.kind)) node = record(app, paper, { open: returnsSeen() > 1, onDone: () => answer(paper, { id: 'ok', now: [] }) });
      else node = front(app, paper, { onChoose: (c) => answer(paper, c), locked: () => busy });
      const key = `${paper.id}:${backOf ? 'back' : 'front'}`;
      if (shown.has(key) && !opts.flipped) node.classList.add('still');
      shown.add(key);
      sheetBox.append(node);
    }
    for (const p of list) {
      if (p.id === cur) continue;
      edges.append(edge(app, p, {
        tilt: tiltOf(app.state.seed, p.id), onRaise: () => { if (busy || backOf) return; raised = p.id; draw({ focus: 'raise' }); },
      }));
    }
  }

  // what the settled trips came to for the house, from the jump's own lines (`houseNet` of each)
  function tripsLine(settled) {
    const net = settled.reduce((n, x) => n + (x.houseNet ?? 0), 0);
    return net < 0 ? `Your people's trips cost ${dinars(-net)}.` : net === 0 ? `Your people's trips came out even.` : `Your people's trips brought ${dinars(net)}.`;
  }

  function phasePage(phase) {
    const v = app.view();
    const wrap = (title, ...rest) => h('article', { class: 'paper sheet front kind-phase', dataset: { phase, face: 'front' }, 'aria-labelledby': 'phase-title' },
      h('h2', { class: 'sheet-title', id: 'phase-title', tabindex: '-1' }, title), ...rest);
    if (phase === 'interlude') {
      const gap = v.interlude;
      return wrap('Years pass',
        gap ? h('p', { class: 'span', id: 'interlude-span' }, `${gap.from} to ${gap.to}`) : null,
        ...(gap?.settled ?? []).map(x => h('p', { class: 'sheet-body', dataset: { settled: x.expedition, result: x.result } }, x.text)),
        ...(gap?.settled?.length ? [h('p', { class: 'sheet-body', id: 'interlude-trips' }, tripsLine(gap.settled))] : []),
        ...(gap?.agents ?? []).map(g => {
          const name = content.agents.find(a => a.id === g.id)?.name ?? g.id;
          return h('p', { class: 'sheet-body', dataset: { left: leftHow(app.state, g.id) ?? '' } }, `${name} ${leftHow(app.state, g.id) === 'retired' ? 'has retired' : 'has gone to work for another house'}.`);
        }),
        ...(gap?.paragraphs ?? []).map(p => h('p', { class: 'sheet-body' }, p.text)),
        h('p', { class: 'sheet-body' }, `The house carries ${dinars(app.state.money)} into the next years.`),
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
    node.dataset.flip = 'out';
    node.animate([{ transform: 'rotateY(0)' }, { transform: 'rotateY(90deg)' }], { duration: half, easing: 'ease-in' }).finished.then(then, then);
  }

  function answer(paper, choice) {
    if (busy) return;
    busy = true;
    const node = qs(`[data-paper="${paper.id}"]`, sheetBox);
    node?.setAttribute('inert', '');
    const before = new Set(app.state.notebook);
    try { app.act(s => engine.choose(s, content, paper.id, choice.id)); } catch (e) { busy = false; node?.removeAttribute('inert'); app.say(e.message); return; }
    if (RECORD_KINDS.includes(paper.kind)) { busy = false; raised = null; draw({ focus: 'next' }); return; }
    const fresh = app.state.notebook.filter(id => !before.has(id)).map(id => (content.notebook ?? []).find(n => n.id === id)?.title ?? id);
    const answered = app.state.desk.find(p => p.id === paper.id);
    const now = paper.kind === 'notice' ? 'Noted.' : happened(content, choice.now);
    const done = () => {
      backOf = { paper: answered, now, fresh, outfit: choice.ui === 'outfit-first' };
      busy = false;
      draw({ focus: 'back', flipped: true });
      // `data-flip` is on the back from its first frame until it lies flat: a press or a click on
      // Next while the sheet is edge-on lands on nothing, so a caller waits for the attribute to go
      const b = qs('.sheet', sheetBox);
      if (b?.animate && cssMs('--flip-time')) {
        b.dataset.flip = 'in';
        const flat = () => { delete b.dataset.flip; };
        b.animate([{ transform: 'rotateY(90deg)' }, { transform: 'rotateY(0)' }], { duration: cssMs('--flip-time') / 2, easing: 'ease-out' }).finished.then(flat, flat);
      }
    };
    flip(node ?? document.createElement('div'), done);
  }

  function next() {
    if (busy || !backOf) return;
    const outfit = backOf.outfit;
    backOf = null; raised = null;
    // the one-press paper is the outfitting sheet over the map table, filled in for the first stop (DESIGN 7)
    if (outfit) { toMap(content.city.firstStop ?? 'damascus'); return; }
    draw({ focus: 'next' });
  }

  function endState() {
    const can = engine.canEndSeason(app.state);
    if (app.state.phase !== 'desk') return { ok: false, reason: '' };
    if (backOf && can.ok) return { ok: false, reason: 'Press Next first.' };
    return can;
  }

  function endSeason() {
    if (busy) return;
    const can = endState();
    if (!can.ok) { app.say(can.reason); return; }
    app.act(s => engine.endSeason(s, content));
    raised = null; backOf = null;
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
      const left = openPapers().length;
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
    if (k === 'm') { e.preventDefault(); toMap(); return true; }
    if (k === 'l' || k === 'n') {
      e.preventDefault();
      openBook(k === 'l' ? 'ledger' : 'notebook', qs(k === 'l' ? '#btn-ledger' : '#btn-notebook'));
      return true;
    }
    return false;
  }

  return { el, key, draw, destroy() { removeEventListener('resize', layout); } };
}
