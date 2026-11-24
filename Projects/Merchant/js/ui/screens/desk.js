// The desk (DESIGN 4.1): the still, the top bar, the paper stack and End the season.
// The engine owns every rule. This file asks it (view, canEndSeason, paperChoices, choose,
// endSeason) and draws the answer. What lives here is only what a reload may forget: which
// paper is raised, which back is being read, whether a flip is under way.
import { h, qs, qsa } from '../dom.js';
import * as engine from '../../engine/index.js';
import { leftHow } from '../../engine/agents.js';
import { front, back, record, edge, paperTitle, happened, num, dinars, returnLead, stuckHeight, RECORD_KINDS } from './paper.js';

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
  const endRow = h('div', { class: 'end-row' }, endReason, endBtn);
  const stack = h('section', { class: 'stack', 'aria-label': 'Your desk' },
    counter, h('div', { class: 'stack-papers' }, sheetBox, edges),
    endRow);
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
    // MER-132 (play c016, c017): a fade that was still under way is finished first, so the band holds the picture in view and the new one
    // and no more. On a phone the band is display:none while a night placeholder is in it (screens.css), a hidden image never runs its
    // animation, and `animationend` never came: each season left one more still behind it, four by season seven, all at opacity 0.
    for (const o of [...still.children].slice(0, -1)) o.remove();
    const img = h('img', { class: `desk-still${asset.final === false ? ' placeholder' : ''}`, src: `assets/art/${asset.file}`, alt: asset.alt ?? '', decoding: 'async', fetchpriority: 'high' });
    const old = [...still.children];
    still.append(img);
    const drop = () => old.forEach(o => o.remove());
    const fade = cssMs('--season-fade-time');
    // a fade is skipped when there is nothing to fade (the first picture, no fade time set) or nothing to see it in (the band is hidden)
    if (first || !fade || still.checkVisibility?.() === false) { drop(); return; }
    img.classList.add('fading');
    img.addEventListener('animationend', drop, { once: true });
    // and a fade always ends: a tab in the background, or an animation the browser drops, leaves no picture waiting behind the new one
    setTimeout(drop, fade + 200);
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
  // MER-124: the heights of the two bars that lie over the page, measured, so the stylesheet never guesses them (the top bar is two rows or
  // three, and a taller Large-text bar is taller still): the papers start `--bar-h` down on a placeholder still, and a control scrolled into
  // view stops `--end-h` above the foot instead of under End the season.
  const root = document.documentElement;
  const sizes = () => {
    root.style.setProperty('--bar-h', `${Math.ceil(bar.getBoundingClientRect().height)}px`);
    root.style.setProperty('--end-h', `${Math.ceil(endRow.checkVisibility?.() === false ? 0 : endRow.getBoundingClientRect().height)}px`);
  };
  const sizeWatch = typeof ResizeObserver === 'function' ? new ResizeObserver(sizes) : null;

  // ---- the top bar
  function barNote(text) { note.textContent = text; app.say(text); }
  /** The ledger and the notebook are dialogs over the desk (DESIGN 4); a raised card's back may stay open under them. */
  function openBook(name, opener, section) {
    if (busy) return;
    app.openBook(name, opener, section);
  }

  /** The map table is its own screen with its own hash (#map). `outfitFor` is a stop to open the
      one-press sheet on once the map has drawn (DESIGN 7); the map reads it from the app and clears it. */
  function toMap(outfitFor = null, outfitWith = null) {
    if (busy) return;
    if (backOf && !outfitFor) { barNote('Press Next first.'); return; }
    if (app.state.phase !== 'desk') { barNote('The map table is for the seasons, not the years between.'); return; }
    app.outfitFor = outfitFor;
    app.outfitWith = outfitFor && outfitWith ? { ...outfitWith, stop: outfitFor } : null;
    location.hash = 'map';
  }

  /** The bar's worth line (MER-113, MER-113b): cash and stock less debts, plus what is out on the road at the house's share. The
      sentence on it says in plain words what the figure holds where the number moves, as a title and as the description a screen reader reads. */
  function worthLine(w) {
    const r = w.onRoad, bits = [];
    if (r.loads) bits.push(`${num(r.loads)} ${r.loads === 1 ? 'load' : 'loads'} of goods${r.unpriced ? ` (${num(r.unpriced)} with no known price, counted for nothing)` : ''}`);
    if (r.money) bits.push(`${dinars(r.money)} sent to buy with`);
    const say = `Worth is the house's cash and the goods in the warehouse at the last prices known at home, less what it owes, plus ${bits.length ? `what is out on the road, the house's share only: ${bits.join(' and ')}` : 'whatever is out on the road, which is nothing now'}.`;
    return h('p', { class: 'worth', id: 'bar-worth', title: say, 'aria-description': say }, `· worth about ${num(w.net + r.total)}`);
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
        worthLine(engine.netWealth(app.state, content)),
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
      } else if (RECORD_KINDS.includes(paper.kind)) node = record(app, paper, { open: returnsSeen() > 1, onDone: () => answer(paper, { id: 'ok', now: [] }), onChoose: c => answer(paper, c), locked: () => busy });
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

  /** DESIGN 5: a raised paper's first choice is in view when it opens. The stack scrolls (screens.css), and edges and
      a long body can push the choices below its foot; the stack is then scrolled until the choice shows (the paper's
      head and its edges scroll up out of sight, and scrolling back brings them). */
  function revealChoice(late = null) {
    const box = qs('.stack-papers', el);
    // a late measure (the arrival animation ended, a font came) only finishes the first one: if the stack has been
    // scrolled since, by a hand or a script, it is left where it is
    if (late !== null && box.scrollTop !== late) return;
    if (late === null) box.scrollTop = 0;
    const sheet = qs('.sheet', sheetBox);
    if (sheet && getComputedStyle(box).overflowY !== 'auto') { if (late === null) revealOnPage(sheet); return; }
    if (!sheet) return;
    const target = qs('.choice, #btn-next', sheet);
    if (!target) return;
    const boxRect = box.getBoundingClientRect();
    // MER-132: the tabs of the other papers stay stuck over the top of the box, so what lies under them is not in view
    const top = boxRect.top + stuckHeight(box);
    let need = target.getBoundingClientRect().bottom + 6 - boxRect.bottom;
    // a return's or loss's paper ends by asking, often two choices: the last one is brought clear of the End the season bar
    // too, as far as the first still stays in view (MER-99)
    if (/\bkind-(return|lost)\b/.test(sheet.className)) {
      const last = qsa('.choice', sheet).at(-1);
      if (last && last !== target) need = Math.max(need, Math.min(last.getBoundingClientRect().bottom + 6 - boxRect.bottom, target.getBoundingClientRect().top - top));
    }
    if (need > 0) box.scrollTop += need;   // the head may scroll off: the choice is the part a player cannot do without
    const at = box.scrollTop;
    // the sheet rises into place for 220 ms, and a font may arrive: measure once more when it lies still
    sheet.addEventListener('animationend', () => revealChoice(at), { once: true });
    if (late === null && document.fonts?.status === 'loading') document.fonts.ready.then(() => { if (sheet.isConnected) revealChoice(at); });
  }

  /** The upright phone's counterpart of the above (MER-142): the page scrolls, not the stack, and End the season is a bar stuck to the foot of
      the screen. A return or a loss that ends by asking has its last choice brought clear of that bar, by scrolling the page, as far as the
      headline can go up and still stay under the top bar (the headline wins where both do not fit, MER-122). A paper that grew by a sentence
      (the unsold goods, a second line of why) had its second choice under End at 360 x 740 with nothing to say so until the player scrolled. */
  function revealOnPage(sheet) {
    // measured only once the sheet lies still: it rises into place for 220 ms, and its boxes sit lower while it does (a first version measured
    // then and scrolled 130 px, the headline under the top bar). A scroll the player makes while it settles is left alone.
    const was = window.scrollY, moving = (sheet.getAnimations?.() ?? []).filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => null));
    Promise.all(moving).then(() => {
      if (!sheet.isConnected || window.scrollY !== was) return;
      const endRow = qs('.end-row', el), bar = qs('.topbar');
      if (!endRow || !bar || getComputedStyle(endRow).position !== 'sticky' || !endRow.checkVisibility()) return;
      if (!/\bkind-(return|lost)\b/.test(sheet.className)) return;
      const last = qsa('.choice', sheet).at(-1), title = qs('.sheet-title', sheet);
      if (!last) return;
      // where the page must be scrolled to, from the page's own top (as the stack's scrollTop is reset first): the last choice's foot clear of
      // End, and no further than leaves the headline a hand under the top bar
      const y = window.scrollY, endTop = window.innerHeight - endRow.offsetHeight;
      const clear = last.getBoundingClientRect().bottom + y + 6 - endTop;
      const most = title ? title.getBoundingClientRect().top + y - (bar.getBoundingClientRect().bottom + 8) : clear;
      window.scrollTo({ top: Math.max(0, Math.min(clear, most)), behavior: 'instant' });
    });
  }

  // what the settled trips came to for the house, from the jump's own lines (`houseNet` of each)
  function tripsLine(settled) {
    const net = settled.reduce((n, x) => n + (x.houseNet ?? 0), 0);
    return net < 0 ? `Your people's trips cost ${dinars(-net)}.` : net === 0 ? `Your people's trips came out even.` : `Your people's trips brought ${dinars(net)}.`;
  }

  /** "It carried 20 loads of silk." for a settled line's cargo, or "" when it has none. */
  const cargoLine = cargo => {
    const parts = Object.entries(cargo ?? {}).filter(([, n]) => n > 0).map(([g, n]) => {
      const good = content.goods.find(x => x.id === g), unit = good?.unit ?? 'load';
      return `${n} ${n === 1 ? unit : `${unit}s`} of ${(good?.name ?? g).toLowerCase()}`;
    });
    return parts.length ? `It carried ${parts.join(', ')}.` : '';
  };

  /** "It was away four seasons and brought back 3 loads of silk and 12 dinars." for a trip that came home: what came back, goods
      and money, and the seasons the return paper's account counts, or "" for a line from before they were written (MER-125). */
  const backLine = x => {
    if (x.result !== 'home' || !x.back) return '';
    const things = Object.entries(x.back.goods ?? {}).filter(([, n]) => n > 0).map(([g, n]) => {
      const good = content.goods.find(y => y.id === g), unit = good?.unit ?? 'load';
      return `${n} ${n === 1 ? unit : `${unit}s`} of ${(good?.name ?? g).toLowerCase()}`;
    });
    if (x.back.money > 0) things.push(dinars(x.back.money));
    const away = x.seasons > 0 ? `It was away ${x.seasons} ${x.seasons === 1 ? 'season' : 'seasons'} and brought back` : 'It brought back';
    return `${away} ${things.length ? things.join(' and ') : 'nothing'}.`;
  };

  function phasePage(phase) {
    const v = app.view();
    const wrap = (title, ...rest) => h('article', { class: 'paper sheet front kind-phase', dataset: { phase, face: 'front' }, 'aria-labelledby': 'phase-title' },
      h('h2', { class: 'sheet-title', id: 'phase-title', tabindex: '-1' }, title), ...rest);
    if (phase === 'interlude') {
      const gap = v.interlude;
      return wrap('Years pass',
        gap ? h('p', { class: 'span', id: 'interlude-span' }, `${gap.from} to ${gap.to}`) : null,
        ...(gap?.settled ?? []).flatMap(x => [
          h('p', { class: 'sheet-body', dataset: { settled: x.expedition, result: x.result } }, x.text),
          ...(cargoLine(x.cargo) ? [h('p', { class: 'sheet-body', id: `cargo-${x.expedition}` }, cargoLine(x.cargo))] : []),
          ...(backLine(x) ? [h('p', { class: 'sheet-body', id: `back-${x.expedition}` }, backLine(x))] : []),
          // what the sheet hoped and the one reason for the gap, as the return paper will say it (MER-119)
          ...(x.why ? [h('p', { class: 'sheet-body', id: `hoped-${x.expedition}` }, returnLead(content, { kind: 'return', data: { hoped: x.hoped, why: x.why } }))] : []),
        ]),
        ...(gap?.settled?.length ? [h('p', { class: 'sheet-body', id: 'interlude-trips' }, tripsLine(gap.settled))] : []),
        ...(gap?.agents ?? []).map(g => {
          const name = content.agents.find(a => a.id === g.id)?.name ?? g.id;
          return h('p', { class: 'sheet-body', dataset: { left: leftHow(app.state, g.id) ?? '' } }, `${name} ${leftHow(app.state, g.id) === 'retired' ? 'has retired' : 'has gone to work for another house'}.`);
        }),
        ...(gap?.paragraphs ?? []).map(p => h('p', { class: 'sheet-body' }, p.text)),
        h('p', { class: 'sheet-body' }, `The house carries ${dinars(gap?.money ?? app.state.money)} into the next years.`),
        h('button', { class: 'button next', type: 'button', id: 'btn-open-house', onclick: () => { app.act(s => engine.openSeason(s, content)); seasonKey = null; draw({ focus: 'season' }); } },
          `Open the house in ${cap(v.season)} ${v.year}`));
    }
    // phase recall or ended: the router sends the player to the ending, so this page shows only for a moment
    return wrap('The last season is over',
      h('button', { class: 'button next', type: 'button', id: 'btn-to-ending', onclick: () => app.toEnding() }, 'Go to the ending'));
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
    const tripTo = app.view().cards?.[paper.id]?.trip?.to ?? null;   // where the card says the agent would go
    try { app.act(s => engine.choose(s, content, paper.id, choice.id)); } catch (e) { busy = false; node?.removeAttribute('inert'); app.say(e.message); return; }
    if (RECORD_KINDS.includes(paper.kind) && choice.id === 'ok') { busy = false; raised = null; draw({ focus: 'next' }); return; }
    const fresh = app.state.notebook.filter(id => !before.has(id)).map(id => (content.notebook ?? []).find(n => n.id === id)?.title ?? id);
    const answered = app.state.desk.find(p => p.id === paper.id);
    const now = paper.kind === 'notice' ? 'Noted.' : happened(content, choice.now, app, { agent: paper.agent, result: choice.result });
    const done = () => {
      backOf = { paper: answered, now, fresh, outfit: outfitOf(choice, tripTo) };
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

  /** What a choice asks of the outfit sheet: the `outfit` effect in its `now` (agent and contract),
      on the stop the card's trip names when it has one, or the plain one-press sheet for ui: outfit-first; null when it opens no sheet. */
  function outfitOf(choice, tripTo) {
    const e = (choice.now ?? []).find(x => x && x.outfit !== undefined);
    if (e) return { agent: e.outfit, contract: e.contract, stop: tripTo };
    return choice.ui === 'outfit-first' ? {} : null;
  }

  function next() {
    if (busy || !backOf) return;
    const outfit = backOf.outfit;
    backOf = null; raised = null;
    // the one-press paper is the outfitting sheet over the map table, filled in for the first stop (DESIGN 7)
    if (outfit) { toMap(outfit.stop ?? content.city.firstStop ?? 'damascus', outfit); return; }
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
    if (!can.ok) {
      app.say(can.reason);
      // MER-124: a pointer or the E key on a button that is not ready says why, and the focus goes to what is still unanswered, the Next
      // button of a back being read or else the raised paper's first choice (focus used to stay on the dead button, eight Tabs from it)
      if (app.state.phase === 'desk') (qs('#btn-next', sheetBox) ?? qs('.choices .choice', sheetBox) ?? qs('button, [href]', sheetBox))?.focus();
      return;
    }
    app.act(s => engine.endSeason(s, content));
    raised = null; backOf = null;
    // the last season was played: the game is the ending now (DESIGN 4.12), and its first page takes the screen
    if (app.state.phase === 'recall') { app.toEnding(); return; }
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
    endBtn.tabIndex = can.ok ? 0 : -1;   // MER-124: out of the tab order while papers are left; the first choice was 8 Tabs past it
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
      else {
        (title ?? endBtn).focus();
        // focus alone leaves a heading under the top bar when the page was scrolled to press an edge: bring it to the
        // heading's scroll-margin (screens.css) when its top is within the bar
        if (title && f === 'raise' && title.getBoundingClientRect().top < bar.getBoundingClientRect().bottom + 8) title.scrollIntoView({ block: 'start' });
      }
    }
    revealChoice();   // after focus, which scrolls the heading into view and would undo it
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

  sizeWatch?.observe(bar); sizeWatch?.observe(endRow);
  return { el, key, draw, destroy() { removeEventListener('resize', layout); sizeWatch?.disconnect(); root.style.removeProperty('--bar-h'); root.style.removeProperty('--end-h'); } };
}
