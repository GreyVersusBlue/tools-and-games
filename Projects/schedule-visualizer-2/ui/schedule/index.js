// The Schedule section: who is where, period by period. Sub-tabs across the
// top (Groups, Grid, Teachers, Subjects, Day, Checks, Import), each with its
// own address (#schedule/groups and the rest), and the findings panel in the
// inspector beside all of them.
//
// A slot has an address too:
//
//   #schedule/groups/<groupId>/<dayTypeId>/<period>
//
// with the period counted from 0, as the model counts it. It opens the Groups
// tab on that group (taking the filter off when the filter hides it), scrolls
// the period's row into view and puts the focus in its room field. A day type
// that is the same as another opens the row of the day it copies. With the
// group alone, the group is chosen; a group that is not in the project leaves
// the tab as it was. `slotHash` writes one.
//
// A tab is a module exporting
//
//   mount(env) -> { element, update(project) }
//
// `update` runs after every change to the project, and whenever something the
// tab shows is chosen (env.render). `env` is what a tab may use:
//
//   ctx            the shell's (store, toast, confirm, openDialog, navigate, announce, undo…)
//   view           what is chosen in this section, kept while the page is open:
//                  { groupId, filter, shown } and anything a tab adds
//   model()        the findings, arranged (model.js)
//   tab()          the id of the tab on screen
//   render(key)    draw again; `key` names the control to put focus on after
//   focusAfter(key) the same, for the drawing a change to the project brings
//   inspect()      draw the inspector's panel again, and nothing else (what is
//                  selected in a tab changed, and the tab has shown it itself)
//
// Drawing again replaces the tab's elements, so every control that can hold
// focus carries a `data-key`, and focus goes back to the control with the same
// key. Drawing waits for a pointer that is down to come up, so the button
// under it is still there for its click.

import { h } from '../components/dom.js';
import { intro } from '../components/card.js';
import { tabs } from '../components/tabs.js';
import { periodWords } from '../components/words.js';
import { findDayType, effectiveDayType } from '../../engine/day-types.js';
import { scheduleModel } from './model.js';
import { findingsPanel } from './checks.js';
import { mount as groups, matches as groupMatches, NARROW as GROUPS_NARROW } from './groups.js';
import { mount as grid, GRID_KEYS } from './grid/index.js';
import { mount as teachers } from './teachers.js';
import { mount as subjects } from './subjects.js';
import { mount as day } from './day.js';
import { mount as checks } from './checks.js';
import { mount as importTab } from './import/index.js';

export const SCHEDULE_TABS = [
  { id: 'groups', label: 'Groups', mount: groups },
  { id: 'grid', label: 'Grid', mount: grid },
  { id: 'teachers', label: 'Teachers', mount: teachers },
  { id: 'subjects', label: 'Subjects', mount: subjects },
  { id: 'day', label: 'Day', mount: day },
  { id: 'checks', label: 'Checks', mount: checks },
  { id: 'import', label: 'Import', mount: importTab },
];

// The section's own stylesheet. index.html links it (with data-sheet, which
// is how it is found here), so this adds it only on a page that does not.
const SHEET = new URL('./schedule.css', import.meta.url).href;
function loadSheet() {
  if (document.querySelector('link[data-sheet="schedule"]')) return;
  document.head.append(h('link', { rel: 'stylesheet', href: SHEET, data: { sheet: 'schedule' } }));
}

// What is chosen here. It outlives a visit to another section.
const view = { groupId: null, filter: '', shown: null, folded: false, findingId: null };

// The walk results of the crowd model for the store's project: the engine
// client's (ui/engine-client.js, attached at boot), asked for once per state
// of the project. Until the answer for a change comes, the last answer stands,
// so the two walk checks do not blink off at every keystroke; the section is
// drawn again when the new answer differs, and reads as pending
// (`data-pending`) until then. Null where nothing is attached to work them
// out, or it failed: the walk checks then find nothing, and the Checks tab
// says so.
const walked = { project: null, walks: null, text: '', waiting: false };
function markWaiting() {
  const section = document.querySelector('.sch');
  if (section && walked.waiting) section.dataset.pending = 'true';
}
function walkResults(store) {
  if (!store.derived || !store.derived.engine) return null;
  const project = store.project;
  if (walked.project !== project) {
    walked.project = project;
    walked.waiting = true;
    const answer = (walks) => {
      // an answer for a state the project has left is not for the screen
      if (walked.project !== project || store.project !== project) return;
      walked.waiting = false;
      const text = walks ? JSON.stringify(walks) : '';
      const changed = text !== walked.text;
      if (changed) Object.assign(walked, { walks, text });
      const section = document.querySelector('.sch');
      if (live && changed) live.run();
      else if (section && !(live && live.waiting)) delete section.dataset.pending;
    };
    store.derived.results().then((result) => answer(result && result.walks ? result.walks : null), () => answer(null));
  }
  // the section may not be on the page yet when it first asks
  if (walked.waiting) Promise.resolve().then(markWaiting);
  return walked.walks;
}

// One watch on the pointer for the whole page: `live` is the section on screen.
let live = null;
let pointerDown = false;
function settle() {
  pointerDown = false;
  if (live && live.waiting) setTimeout(() => live && live.run(), 0);
}
function watchPointer() {
  if (watchPointer.done) return;
  watchPointer.done = true;
  // the Groups tab's list and editor take turns on a phone, and the
  // inspector says which: both are drawn again when that width is crossed
  window.matchMedia(GROUPS_NARROW).addEventListener('change', () => {
    if (live) live.redraw();
  });
  document.addEventListener('pointerdown', () => {
    pointerDown = true;
  }, true);
  document.addEventListener('pointerup', settle, true);
  document.addEventListener('pointercancel', settle, true);
}

function tabId(rest) {
  const first = String(rest || '').split('/')[0];
  return SCHEDULE_TABS.some((tab) => tab.id === first) ? first : 'groups';
}

// The address of a group's slot (the top of this file).
export function slotHash(groupId, dayTypeId, period) {
  return '#schedule/groups/' + [groupId, dayTypeId, period].map((part) => encodeURIComponent(String(part))).join('/');
}

function decoded(part) {
  try {
    return decodeURIComponent(part);
  } catch (error) {
    return part;
  }
}

// Take what an address says after the tab's name into `view`: the group, and
// the slot to show when it names one. True when it named a group.
function takeAddress(project, rest) {
  const parts = String(rest || '').split('/').map(decoded);
  if (parts[0] !== 'groups' || !parts[1]) return false;
  const group = project.groups.find((each) => each.id === parts[1]);
  if (!group) return false;
  view.groupId = group.id;
  view.folded = true;
  if (!groupMatches(group, view.filter)) view.filter = '';
  const dayType = parts[2] ? findDayType(project, parts[2]) : null;
  const period = /^\d+$/.test(parts[3] || '') ? Number(parts[3]) : -1;
  view.shown = dayType && period >= 0 && period < project.settings.periods
    ? { groupId: group.id, dayTypeId: effectiveDayType(project, dayType.id).id, period, fresh: true }
    : null;
  return true;
}

export const section = {
  id: 'schedule',
  label: 'Schedule',
  name: 'Schedule',
  key: '2',
  icon: 'schedule',
  // Once, before anything is mounted: the grid's keys go on the shell's list,
  // so Help has them whichever section is open.
  start(ctx) {
    for (const key of GRID_KEYS) ctx.shortcuts.add({ id: key.id, group: 'Schedule grid', does: key.does, shown: key.shown });
  },
  mount(ctx, rest) {
    loadSheet();
    watchPointer();
    takeAddress(ctx.store.project, rest);
    let panel = null;
    let timer = null;
    let wantFocus = null;

    const env = {
      ctx,
      view,
      model: () => scheduleModel(ctx.store.project, walkResults(ctx.store)),
      tab: () => strip.selected,
      render(key) {
        if (key) wantFocus = key;
        schedule();
      },
      focusAfter(key) {
        wantFocus = key;
      },
      inspect() {
        inspector.update(ctx.store.project);
      },
    };

    const strip = tabs({
      label: 'Parts of the schedule',
      selected: tabId(rest),
      onSelect: (id) => ctx.navigate('#schedule/' + id),
      items: SCHEDULE_TABS.map((tab) => ({
        id: tab.id,
        label: tab.label,
        panel: () => {
          panel = tab.mount(env);
          panel.element.dataset.tab = tab.id;
          return panel.element;
        },
      })),
    });
    const inspector = findingsPanel(env);
    const words = periodWords(ctx.store.project.settings);
    const element = h('div', { class: 'sch' },
      intro({
        headline: 'This is the schedule.',
        first: 'It says which room each group is in, ' + words.one + ' by ' + words.one + '. Add teachers, then groups.',
      }),
      strip.element);
    ctx.setInspector(inspector.element);

    function keyOf(node) {
      const holder = node && node.closest ? node.closest('[data-key]') : null;
      return holder && (element.contains(holder) || inspector.element.contains(holder)) ? holder.dataset.key : null;
    }

    // What each text field held when the focus came to it. A redraw carries
    // text over to the new field only when it differs from this: when it was
    // typed. Text that is there because the project changed under the field
    // (an undo, a change made elsewhere) is the old drawing, not typing, and
    // carrying it would have the field commit it over the change when left.
    const drawn = new WeakMap();
    const noteDrawn = (event) => {
      const target = event.target;
      if (target && target.tagName === 'INPUT' && ['text', 'search'].includes(target.type)) drawn.set(target, target.value);
    };
    element.addEventListener('focusin', noteDrawn);
    inspector.element.addEventListener('focusin', noteDrawn);

    function find(key) {
      const escaped = CSS.escape(key);
      return element.querySelector('[data-key="' + escaped + '"]') || inspector.element.querySelector('[data-key="' + escaped + '"]');
    }

    function run() {
      timer = null;
      handle.waiting = false;
      if (!element.isConnected) return;
      if (pointerDown) {
        handle.waiting = true;
        return;
      }
      delete element.dataset.pending;
      const active = document.activeElement;
      const inSection = element.contains(active);
      const inInspector = inspector.element.contains(active);
      const had = keyOf(active);
      // Text being typed goes with the focus. (Taking the old field away
      // makes it commit, as leaving it does; text it could not keep, a taken
      // name or half a room number, is put in the new field to be fixed.)
      const field = had && active.tagName === 'INPUT' && ['text', 'search'].includes(active.type);
      const typing = field && (!drawn.has(active) || drawn.get(active) !== active.value);
      const typed = typing ? active.value : null;
      const held = field ? active.value : null;
      const caret = field ? [active.selectionStart, active.selectionEnd] : null;
      const project = ctx.store.project;
      panel.update(project);
      inspector.update(project);

      const fresh = view.shown && view.shown.fresh;
      const marked = fresh ? element.querySelector('[data-shown="true"]') : null;
      if (fresh) view.shown.fresh = false;
      if (marked) {
        marked.scrollIntoView({ block: 'center' });
        const first = marked.querySelector('input, select, button');
        if (first) first.focus({ preventScroll: true });
        wantFocus = null;
        return;
      }
      const asked = wantFocus && wantFocus !== had ? find(wantFocus) : null;
      const target = asked || (had && find(had));
      wantFocus = null;
      if (target) {
        if (document.activeElement !== target) target.focus();
        const text = target.tagName === 'INPUT' && ['text', 'search'].includes(target.type);
        // a control that was asked for has its text selected, ready to be
        // typed over; the one focus was already in keeps its caret
        if (text && asked) {
          target.select();
        } else if (text && typing) {
          if (target.value !== typed) {
            target.value = typed;
            target.dispatchEvent(new Event('input', { bubbles: true }));
          }
          target.setSelectionRange(caret[0], caret[1]);
        } else if (text && caret && target.value === held) {
          // nothing was typed and nothing changed under it: the caret stays
          target.setSelectionRange(caret[0], caret[1]);
        }
      } else if (had && inSection) {
        element.querySelector('[role="tabpanel"]').focus();
      } else if (had && inInspector) {
        document.getElementById('inspector').focus();
      }
    }

    // `data-pending` is on the section from a change until it is drawn.
    function schedule() {
      element.dataset.pending = 'true';
      if (timer === null) timer = setTimeout(run, 0);
    }

    const handle = { run, waiting: false, redraw: schedule };
    live = handle;
    // an address that named a slot: its row is scrolled to once this is on the page
    if (view.shown && view.shown.fresh) schedule();

    return {
      element,
      update() {
        schedule();
      },
      // the same section, another tab
      route(next) {
        takeAddress(ctx.store.project, next);
        const same = strip.selected === tabId(next);
        strip.select(tabId(next));
        // a tab that was just put up has drawn itself; the same tab asked
        // for again, or one with something to show, is drawn (and scrolled)
        if (same || (view.shown && view.shown.fresh)) schedule();
        else inspector.update(ctx.store.project);
        return true;
      },
    };
  },
};
