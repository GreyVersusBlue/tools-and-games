// The Schedule section: who is where, period by period. Sub-tabs across the
// top (Groups, Grid, Teachers, Subjects, Day, Checks, Import), each with its
// own address (#schedule/groups and the rest), and the findings panel in the
// inspector beside all of them.
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
//
// Drawing again replaces the tab's elements, so every control that can hold
// focus carries a `data-key`, and focus goes back to the control with the same
// key. Drawing waits for a pointer that is down to come up, so the button
// under it is still there for its click.

import { h } from '../components/dom.js';
import { intro } from '../components/card.js';
import { tabs } from '../components/tabs.js';
import { periodWords } from '../components/words.js';
import { scheduleModel } from './model.js';
import { findingsPanel } from './checks.js';
import { mount as groups } from './groups.js';
import { mount as grid } from './grid/index.js';
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

// The section's own stylesheet, asked for once. (A line in index.html beside
// ui/app.css would load it before the first draw.)
const SHEET = new URL('./schedule.css', import.meta.url).href;
function loadSheet() {
  if (document.querySelector('link[data-sheet="schedule"]')) return;
  document.head.append(h('link', { rel: 'stylesheet', href: SHEET, data: { sheet: 'schedule' } }));
}

// What is chosen here. It outlives a visit to another section.
const view = { groupId: null, filter: '', shown: null };

// The walk results of the crowd model, when something has worked them out.
function walkResults() {
  return null;
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

export const section = {
  id: 'schedule',
  label: 'Schedule',
  name: 'Schedule',
  key: '2',
  icon: 'schedule',
  mount(ctx, rest) {
    loadSheet();
    watchPointer();
    let panel = null;
    let timer = null;
    let wantFocus = null;

    const env = {
      ctx,
      view,
      model: () => scheduleModel(ctx.store.project, walkResults()),
      tab: () => strip.selected,
      render(key) {
        if (key) wantFocus = key;
        schedule();
      },
      focusAfter(key) {
        wantFocus = key;
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
      // text typed into the field focus is in, since the change that brought
      // this drawing, goes with the focus
      const typing = had && active.tagName === 'INPUT' && ['text', 'search'].includes(active.type);
      const typed = typing ? active.value : null;
      const caret = typing ? [active.selectionStart, active.selectionEnd] : null;
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
        } else if (text && caret) {
          if (target.value !== typed) {
            target.value = typed;
            target.dispatchEvent(new Event('input', { bubbles: true }));
          }
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

    const handle = { run, waiting: false };
    live = handle;

    return {
      element,
      update() {
        schedule();
      },
      // the same section, another tab
      route(next) {
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
