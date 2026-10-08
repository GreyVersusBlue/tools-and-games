// The staff browser's frame: what is on screen for each thing a piece of data
// can be (a schedule, a locked schedule, a newer format, a damaged file,
// nothing at all), and around an open schedule the school's name, the notices,
// the page for the address, and the bar.
//
//   const shell = mountShell(root, { win, doc });
//   shell.show(data);     a published model or a locked one; call again when
//                         the planner's preview sends a newer one
//   shell.waiting(text);  before any data has come
//   shell.nothing();      no data anywhere
//
// A reader's device keeps the key the passcode made, per school, so the
// passcode is asked once. A kept key that does not open the file in hand (the
// passcode was changed) is thrown away and the passcode is asked again.

import { h, typed, icon } from './dom.js';
import { parseHash, makeHash } from './router.js';
import { openStorage, NOT_KEPT_SENTENCE } from './storage.js';
import { dayText, momentText, isStale, isOlderThanSeen } from './dates.js';
import { readPublished, DAMAGED_SENTENCE } from './source.js';
import { openSchool } from './model.js';
import { pageOf, leftOutPage } from './page.js';
import { unlockScreen } from './passcode.js';
import { viewFor } from './views.js';
import { unlockPublished, unlockWithKey, toBase64, fromBase64 } from '../engine/publish-crypto.js';

const BAR = [
  { id: 'search', label: 'Search', hash: () => '#/search', shown: () => true },
  { id: 'map', label: 'Map', hash: () => '#/map', shown: (school) => school.has('map') },
  { id: 'now', label: 'Now', hash: (school) => (school.has('now') ? '#/now' : '#/free'), shown: (school) => school.has('now') || school.has('free') },
  { id: 'me', label: 'Me', hash: () => '#/me', shown: (school) => school.has('teacher') },
];

const TYPING = 'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]), textarea, select';

export function mountShell(root, env) {
  const win = env.win;
  const doc = env.doc;
  const now = env.now || (() => new Date());
  const backend = env.storage || (() => win.localStorage);

  let turn = 0; // each show() is a turn; an answer from an earlier turn is dropped
  let open = null; // { data, school, store, main, bar, bands, top, foot, notKept }
  let gate = null; // the unlock screen in hand: { schoolId, envelope }
  let firstOpen = true;

  const setTitle = (text) => {
    doc.title = text;
  };

  // ---- the screens that are not a schedule

  function card(state, title, ...body) {
    open = null;
    gate = null;
    root.dataset.state = state;
    root.replaceChildren(h('div', { class: 'gate' }, h('main', { class: 'gate__card' }, h('h1', { class: 'gate__title', tabindex: '-1' }, title), body)));
    setTitle(title);
  }

  function waiting(text) {
    card('waiting', 'Staff schedule', h('p', { class: 'lede', role: 'status' }, text || 'Opening the schedule…'));
  }

  function nothing() {
    card('none', 'Staff browser', h('p', { class: 'lede' }, 'There is no schedule in this page. A school publishes one from the planner, as a file that opens here.'));
  }

  function refuse(state, title, message) {
    card(state, title, h('p', { class: 'lede', role: 'alert' }, message));
  }

  // ---- an open schedule

  function ctxFor(current) {
    return {
      school: current.school,
      store: current.store,
      now,
      go(hash) {
        win.location.hash = hash;
      },
      replace(hash) {
        try {
          win.history.replaceState(null, '', hash);
        } catch (error) {
          // an address that cannot be rewritten here is left as it is
        }
      },
      redraw() {
        draw(false);
      },
    };
  }

  function draw(moveFocus) {
    if (!open) return;
    const current = open;
    const route = parseHash(win.location.hash);
    const view = viewFor(route.view);
    const ctx = ctxFor(current);
    const left = view.flag !== null && !current.school.has(view.flag);
    let title = 'Staff schedule';
    let page;
    try {
      title = view.title(ctx, route);
      page = left ? leftOutPage(title) : view.render(ctx, route);
    } catch (error) {
      // one page failing is said on that page; the rest of the file still works
      page = pageOf('This page could not be shown', 'Something in this copy of the schedule could not be read for this page. The other pages still work.',
        h('p', { class: 'muted' }, String(error && error.message ? error.message : error)));
    }
    current.main.replaceChildren(page);
    current.main.dataset.view = view.id;
    setTitle(title + ' · ' + current.school.name);
    for (const item of current.bar.querySelectorAll('a[data-item]')) {
      if (item.dataset.item === view.nav) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    }
    if (moveFocus) {
      win.scrollTo(0, 0);
      const heading = current.main.querySelector('h1');
      if (heading) heading.focus({ preventScroll: true });
    }
  }

  function band(kind, text, dismiss) {
    const element = h('p', { class: 'band band--' + kind, dataset: { band: kind } }, h('span', { class: 'band__text' }, text));
    if (dismiss) {
      element.appendChild(h('button', { class: 'band__close', type: 'button', onclick: () => element.remove() }, 'Dismiss'));
    }
    return element;
  }

  function drawBands() {
    if (!open) return;
    const { data, store, bands } = open;
    const list = [];
    const own = dayText(data.publishedAt, now());
    if (isStale(data, now())) list.push(band('stale', 'This copy is from ' + own + ' and may be out of date. Ask the office for a newer one.'));
    const seen = store.get('seen');
    if (isOlderThanSeen(data, seen)) {
      list.push(band('note', 'A newer copy of this schedule has been opened on this device, published ' + dayText(seen, now()) + '. This one is from ' + own + '.'));
    }
    bands.replaceChildren(...list);
    if (open.notKept) bands.appendChild(open.notKept);
  }

  function proceed(data, store, focus) {
    const school = openSchool(data);
    const sameFrame = open !== null && open.data.id === data.id;
    if (sameFrame) {
      // a newer copy of the school already on screen: the preview following the planner
      open.data = data;
      open.school = school;
      open.store = store;
    } else {
      const main = h('main', { class: 'page', id: 'page' });
      const bands = h('div', { class: 'bands', role: 'region', 'aria-label': 'Notices' });
      const bar = h('nav', { class: 'bar', 'aria-label': 'Sections' });
      const top = h('a', { class: 'top__school', href: '#/search' });
      const foot = h('p', null);
      open = { data, school, store, main, bar, bands, top, foot, notKept: open && open.notKept ? open.notKept : null };
      root.dataset.state = 'open';
      root.replaceChildren(h('header', { class: 'top' }, top), bands, main, h('footer', { class: 'foot' }, foot), bar);
    }
    gate = null;
    open.top.replaceChildren(typed(school.name));
    open.foot.replaceChildren(typed(school.name), ' · published ' + momentText(data.publishedAt) + '.');
    open.bar.replaceChildren(...BAR.filter((item) => item.shown(school)).map((item) => h('a', { class: 'bar__item', href: item.hash(school), dataset: { item: item.id } }, icon(item.id), h('span', { class: 'bar__label' }, item.label))));

    drawBands();
    const seen = store.get('seen');
    if (!isOlderThanSeen(data, seen) && seen !== data.publishedAt) store.set('seen', data.publishedAt);

    // A reader who chose themselves opens on their own page. The address is
    // replaced, not added, so Back leaves the file instead of looping.
    if (firstOpen) {
      firstOpen = false;
      const hash = win.location.hash;
      const me = store.get('me');
      if ((hash === '' || hash === '#' || hash === '#/') && me && school.teacher(me) && school.has('teacher')) {
        ctxFor(open).replace(makeHash('teacher', me));
      }
    }
    draw(focus);
  }

  // One guard per school for as long as the page is open, so what could only
  // be kept in memory is still there when the preview sends the next copy.
  const stores = new Map();
  let pendingNote = null;

  function storeFor(schoolId) {
    if (!stores.has(schoolId)) {
      stores.set(schoolId, openStorage(schoolId, backend, () => {
        const note = band('note', NOT_KEPT_SENTENCE, true);
        if (open) {
          open.notKept = note;
          open.bands.appendChild(note);
        } else {
          pendingNote = note;
        }
      }));
    }
    return stores.get(schoolId);
  }

  function opened(model, envelope, store, mine, focus) {
    if (mine !== turn) return false;
    const inner = readPublished(model);
    if (inner.kind !== 'open' || inner.model.id !== envelope.schoolId || inner.model.publishedAt !== envelope.publishedAt) {
      refuse('damaged', 'This file cannot be opened', DAMAGED_SENTENCE);
      return false;
    }
    proceed(inner.model, store, focus);
    if (pendingNote && open) {
      open.notKept = pendingNote;
      open.bands.appendChild(pendingNote);
      pendingNote = null;
    }
    return true;
  }

  async function show(value) {
    turn += 1;
    const mine = turn;
    const read = readPublished(value);
    if (read.kind === 'newer') return refuse('newer', 'This schedule needs a newer copy', read.message);
    if (read.kind === 'damaged') return refuse('damaged', 'This file cannot be opened', read.message);
    if (read.kind === 'open') return proceed(read.model, storeFor(read.model.id), false);

    const envelope = read.envelope;
    const store = storeFor(envelope.schoolId);
    const kept = store.get('key');
    if (kept) {
      let model = null;
      try {
        model = await unlockWithKey(envelope, fromBase64(kept));
      } catch (error) {
        model = null;
      }
      if (mine !== turn) return undefined;
      if (model !== null) return opened(model, envelope, store, mine, false);
      store.remove('key');
    }
    if (gate && gate.schoolId === envelope.schoolId && root.dataset.state === 'locked') {
      // the unlock screen is already up for this school: keep what was typed
      gate.envelope = envelope;
      return undefined;
    }
    open = null;
    gate = { schoolId: envelope.schoolId, envelope };
    const screen = unlockScreen({
      publishedAt: envelope.publishedAt,
      now: now(),
      unlock: async (passcode) => {
        const target = gate.envelope;
        const result = await unlockPublished(target, passcode);
        if (result === null) return false;
        store.set('key', toBase64(result.key));
        if (gate && gate.envelope !== target) {
          // the preview sent a newer copy while the key was being made
          await show(gate.envelope);
          return true;
        }
        opened(result.model, target, store, turn, true);
        return true;
      },
    });
    root.dataset.state = 'locked';
    root.replaceChildren(screen.element);
    setTitle('Staff schedule');
    screen.focus();
    return undefined;
  }

  win.addEventListener('hashchange', () => draw(true));
  doc.addEventListener('visibilitychange', () => {
    if (!doc.hidden) drawBands();
  });
  // The bar leaves the screen while a field has focus, so the keyboard does
  // not push it over what is being typed.
  root.addEventListener('focusin', (event) => {
    if (event.target instanceof win.Element && event.target.matches(TYPING)) root.dataset.typing = 'true';
  });
  root.addEventListener('focusout', () => {
    delete root.dataset.typing;
  });

  return {
    show,
    waiting,
    nothing,
    damaged() {
      turn += 1;
      refuse('damaged', 'This file cannot be opened', DAMAGED_SENTENCE);
    },
  };
}
