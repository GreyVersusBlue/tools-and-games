// The Scenarios section: the scenario lab (spec 9; DESIGN 5.4). Trial
// changes to the schedule, held apart from it, compared figure by figure
// with the real schedule, then applied as one step of undo or discarded.
//
//   top       the screen's first line, a sentence: what is being tried, how
//             many changes, that nothing is applied yet
//   the map   the plan map (ui/surface/plan-map.js), plain for now; the
//             difference overlay (SV2-69) mounts on it below, at the line
//             marked "SV2-69"
//   the panel (./changes.js, ./forms.js, ./file.js) beside the map on a
//             wide window and under it on a narrow one: the scenario's name,
//             its changes as chips with ×, the changes that no longer apply
//             with "Remove them", "Add a change" with the three kinds of
//             change, "Compare with another project file", and the
//             congestion report, which prints the scenario's effect
//   the bar   sticky at the section's foot: "Not applied yet: 3 changes",
//             Apply… (a summary, then one step of undo) and Discard… (asks)
//   inspector the comparison (./compare.js): Before / After / Difference,
//             travel by group, places busier and quieter, findings new,
//             resolved and unchanged, all from store.derived.scenario()
//
// Every write goes through the scenario actions (engine/actions.js, SV2-61),
// whose refusals are shown as they are. Nothing the lab chooses (the form's
// fields, the comparison's day type and transition) is stored: it is kept in
// memory for the open project while the page is open.
//
// The view on screen is at document.querySelector('.scn').scenarios, for
// the tests and for the console.

import { h } from '../components/dom.js';
import { intro } from '../components/card.js';
import { count, figures } from '../components/words.js';
import { openPrintPreview } from '../components/print-preview.js';
import { createPlanMap } from '../surface/plan-map.js';
import { slotAt } from '../surface/plan-layout.js';
import { buildGraph } from '../../engine/graph.js';
import { ActionError, addScenarioChange, applyScenario, discardScenario } from '../../engine/actions.js';
import { changeWords } from '../../engine/scenario.js';
import { nameOfRoom } from '../../engine/schema.js';
import { snapshotAfter } from '../../storage/snapshots.js';
import { scenarioView, firstLine, barWords, cancelled, cancelledSentence, applySummary } from './model.js';
import { changesPanel } from './changes.js';
import { formsPanel, freshForm } from './forms.js';
import { filePanel } from './file.js';
import { comparePanel } from './compare.js';
import { mountDifference } from './difference.js';

const HEADLINE = 'This is the scenario lab.';
// Apply's button when nothing in the scenario applies: it closes the scenario.
const APPLY_NOTHING = 'Close the scenario: no change of it applies';
const KEYS = 'Arrow keys move the cursor one cell and say what is under it. Hold Space and press the arrows to move the map. = and - zoom in and out, 0 fits the map to the window. The comparison is in the inspector.';

// What is chosen here, kept for the open project while the page is open
// (in memory: no storage key, and nothing new in project.scenario).
const memory = { projectId: null, form: freshForm(), dayTypeId: null, transition: null, floors: 'auto', file: null };

function adopt(project) {
  if (memory.projectId === project.id) return;
  memory.projectId = project.id;
  memory.form = freshForm();
  memory.dayTypeId = null;
  memory.transition = null;
  memory.floors = 'auto';
  memory.file = null;
}

function words(parts) {
  return parts.map((part) => (part.name ? h('bdi', null, part.text) : part.text));
}

function quote(text) {
  return '“' + text + '”';
}

function first(project) {
  const f = figures(project);
  if (f.rooms === 0) return 'Try a change to the schedule here, see what it does to the corridors, then apply it or discard it. A scenario needs a building with rooms first.';
  return 'Try a change to the schedule here, see what it does to the corridors, then apply it or discard it. A scenario changes a schedule: add groups first.';
}

function facts(project) {
  const f = figures(project);
  return 'There ' + (f.groups === 1 ? 'is ' : 'are ') + count(f.groups, 'group') + ' and ' + count(f.rooms, 'room') + '.';
}

export const section = {
  id: 'scenarios',
  label: 'Scenarios',
  name: 'Scenarios',
  key: '4',
  icon: 'scenarios',
  mount(ctx) {
    const store = ctx.store;
    adopt(store.project);
    let gone = false;
    let view = null;
    // the comparison: the last answer, and whether a newer one is being worked
    // out; `key` is what the last asking was for (the scenario object, the
    // store's counters, the lab's options), so a drawing that changes none of
    // them (the floors row, the theme, a store change elsewhere) asks nothing
    const lane = { compare: null, answer: null, pending: false, failed: null, asked: 0, key: null };

    const graphNow = () => store.derived.get('graph', ['building'], (project) => buildGraph(project));

    // ---- the first line
    const lineWords = h('span', { class: 'mov-line__words', data: { part: 'words' } });
    const line = h('p', { class: 'mov-line intro__first', id: 'scenario-line' }, lineWords);
    const top = h('div', { class: 'mov-top scn-top' }, line);
    const headline = h('h1', { class: 'vh' }, HEADLINE);

    // ---- the bar at the section's foot
    const barText = h('p', { class: 'scn-bar__text', data: { part: 'bar-text' } });
    const applyButton = h('button', { type: 'button', class: 'btn btn--primary', data: { action: 'apply' }, on: { click: () => applyNow() } }, 'Apply…');
    const discardButton = h('button', { type: 'button', class: 'btn', data: { action: 'discard' }, on: { click: () => discardNow() } }, 'Discard…');
    // With no scenario open the bar is closed to no height, never display:
    // none: the plan map measures its foot by its box (the zoom buttons and
    // the messages stand above it), and a foot with no box reads as one at
    // the top of the window.
    const barButtons = h('div', { class: 'scn-bar__buttons' }, applyButton, discardButton);
    const bar = h('div', { class: 'mov-bar scn-bar', data: { bar: 'scenario', open: 'false' } }, barText, barButtons);
    function openBar(open) {
      bar.dataset.open = String(open);
      barButtons.hidden = !open;
      if (open) {
        bar.setAttribute('role', 'group');
        bar.setAttribute('aria-label', 'The scenario');
      } else {
        bar.removeAttribute('role');
        bar.removeAttribute('aria-label');
      }
    }

    // ---- the panel
    const env = {
      ctx,
      memory,
      project: () => store.project,
      apply: run,
      add,
      // where the focus goes when what held it is gone: the panel's first control
      home: () => changes.focusName(),
      ask,
      // false once the section has been taken off the page
      mounted: () => !gone,
    };
    const changes = changesPanel(env);
    const forms = formsPanel(env);
    const file = filePanel(env);
    const congestion = h('button', { type: 'button', class: 'btn', data: { action: 'congestion' }, on: { click: (event) => openPrintPreview(ctx, 'congestion', { opener: event.currentTarget }) } }, 'Print the congestion report…');
    const report = h('section', { class: 'scn-report', 'aria-labelledby': 'scenario-report-title' },
      h('h2', { class: 'scn-panel__title', id: 'scenario-report-title' }, 'Congestion report'),
      h('p', { class: 'scn-report__lead' }, 'The movement view’s report on paper, with what the open scenario does to it.'),
      congestion);
    const panel = h('section', { class: 'scn-panel', 'aria-label': 'The scenario and its changes', data: { part: 'panel' } }, changes.element, forms.element, file.element, report);

    const plan = createPlanMap({
      ctx,
      name: 'scenarios',
      label: 'The scenario map',
      keys: KEYS,
      // a phone on its side keeps 160 px of map, the first line and the
      // docked line scrolled away instead, as Safety does (W5, SV2-72d2)
      least: 160,
      floorsRow: {
        value: () => memory.floors,
        change(value) {
          memory.floors = value;
          refresh();
        },
      },
      frame: () => ({ before: [headline, top], after: [panel, bar], head: top, line, foot: bar }),
    });
    const element = plan.root;
    element.classList.add('scn');
    const map = plan.element;
    const empty = h('div', { class: 'mov-empty stub scn-empty', hidden: true });
    element.append(empty);

    // SV2-69: the difference overlay mounts here, one line, from ./difference.js,
    // reading the lane's last answer (lane.answer) and memory.transition.
    const difference = mountDifference({ ctx, store, plan, memory, lane, inspector: () => inspectorBox });

    // ---- the map's cursor says what is under it: one sentence a move, the
    // difference card's when the cursor is on a cell that has one (it names
    // the floor and corridor or stairs too), else the lab's own line
    plan.onCell((ev) => {
      if (ev.kind !== 'keyboard') return false;
      const card = difference.cursorWords();
      if (card) {
        ctx.announce(card);
        return false;
      }
      if (!plan.world || !plan.project) return false;
      const found = slotAt(plan.world, ev.x, ev.y);
      if (!found) {
        ctx.announce('Between floors.');
        return false;
      }
      const floor = found.slot.floor;
      const space = floor.spaces.find((each) => each.cells.includes(found.cell));
      const cell = floor.cells[found.cell];
      const what = space ? (space.kind === 'room' ? nameOfRoom(space) : space.label || 'another space') : cell === '#' ? 'corridor' : cell === 'S' ? 'stairs' : 'nothing here';
      ctx.announce(floor.name + ': ' + what + '.');
      return false;
    });

    // ---- where the shell's messages start (SV2-72d): from 1200 px the panel
    // is a column on the left of the map, and a message lying over its forms
    // for six seconds hid what was being typed. --toast-left on the surface
    // is how far the panel reaches in from the surface's left edge while it
    // stands beside the map; ui/app.css starts the messages right of it.
    let toastHost = null;
    function toastLeft() {
      if (gone) return;
      const surface = toastHost || element.closest('.surface');
      if (!surface) return;
      toastHost = surface;
      const stage = plan.stage;
      const beside = !panel.hidden && panel.getClientRects().length > 0 && stage.getClientRects().length > 0 && panel.getBoundingClientRect().right <= stage.getBoundingClientRect().left + 1;
      const value = beside ? Math.max(0, Math.round(panel.getBoundingClientRect().right - surface.getBoundingClientRect().left - surface.clientLeft)) + 'px' : '';
      if (surface.style.getPropertyValue('--toast-left') === value) return;
      if (value === '') surface.style.removeProperty('--toast-left');
      else surface.style.setProperty('--toast-left', value);
    }
    const toastWatch = new ResizeObserver(() => toastLeft());
    toastWatch.observe(panel);
    toastWatch.observe(element);

    // ---- the inspector
    const compare = comparePanel(env);
    const inspectorBox = h('div', { class: 'scn-inspector' }, compare.element);
    let inspectorShown = false;

    // ---- writes, through the scenario actions; a refusal is said as it is
    function run(action, payload, onRefuse) {
      const before = store.project;
      try {
        store.apply(action, payload);
      } catch (error) {
        if (!(error instanceof ActionError)) throw error;
        if (onRefuse) onRefuse(error.message);
        else {
          changes.said(error.message);
          ctx.toast({ kind: 'problem', text: error.message });
        }
        return false;
      }
      return store.project !== before;
    }

    // a change from the forms; one that puts the schedule back as it is says so
    function add(change) {
      const project = store.project;
      const said = changeWords(project, change).text;
      let refused = false;
      const made = run(addScenarioChange, { change }, (message) => {
        refused = true;
        changes.said(message);
        ctx.toast({ kind: 'problem', text: message });
      });
      if (refused) return false;
      // no entry at all: the change puts back the schedule and nothing was
      // there to take out, or the scenario already holds exactly this
      const undone = made ? cancelled(project.scenario, store.project.scenario, change) : cancelled(project.scenario, project.scenario, change);
      const text = undone ? cancelledSentence(said, undone.taken) : made ? 'Added: ' + said + '.' : 'The scenario already has this: ' + said + '.';
      changes.said(text);
      ctx.announce(text);
      return true;
    }

    // ---- the comparison, asked of the scenario lane
    function laneKey() {
      return { scenario: store.project.scenario, counters: store.geometryVersion + ':' + store.buildingVersion + ':' + store.scheduleVersion, dayTypeId: memory.dayTypeId, transition: memory.transition };
    }

    function sameKey(a, b) {
      return Boolean(a) && Boolean(b) && a.scenario === b.scenario && a.counters === b.counters && a.dayTypeId === b.dayTypeId && a.transition === b.transition;
    }

    // asks again only when what the answer is for has changed
    function askIfChanged() {
      if (sameKey(lane.key, laneKey())) drawCompare();
      else ask();
    }

    function ask() {
      if (!view || gone) return;
      if (!store.derived || typeof store.derived.scenario !== 'function') {
        lane.failed = 'the engine is not running on this page.';
        drawCompare();
        return;
      }
      lane.asked += 1;
      const token = lane.asked;
      lane.pending = true;
      lane.failed = null;
      drawCompare();
      // drawn first: the options settle to the project (a day type gone is none)
      lane.key = laneKey();
      store.derived.scenario({ dayTypeId: memory.dayTypeId, transition: memory.transition }).then((answer) => {
        if (gone || token !== lane.asked) return;
        lane.pending = false;
        lane.answer = answer;
        lane.compare = answer ? answer.compare : null;
        drawCompare();
      }, (error) => {
        if (gone || token !== lane.asked) return;
        lane.pending = false;
        lane.failed = error && error.message ? error.message : String(error);
        drawCompare();
      });
    }

    function drawCompare() {
      compare.update({ project: store.project, scenario: Boolean(view), compare: view ? lane.compare : null, pending: lane.pending, old: Boolean(lane.compare) && (lane.pending || Boolean(lane.failed)), failed: lane.failed });
      element.dataset.compare = !view ? 'none' : lane.pending ? 'pending' : lane.failed ? 'failed' : lane.compare ? 'ready' : 'none';
      difference.update();
    }

    // ---- Apply…: what will change and what is skipped, then one step of undo
    async function applyNow() {
      const project = store.project;
      const current = scenarioView(project);
      if (!current) return;
      const summary = applySummary(project, current);
      const n = summary.changes.length;
      const skipped = summary.skipped.length;
      const body = [
        h('p', null, n === 0 ? 'Nothing in this scenario applies to the schedule as it is now. Applying it closes it and changes no slot.' : (n === 1 ? 'This change goes' : 'These ' + n + ' changes go') + ' into the real schedule:'),
        n > 0 ? h('ul', { class: 'scn-summary__list', data: { part: 'applies' } }, summary.changes.map((said) => h('li', { dir: 'auto' }, words(said.parts)))) : null,
        summary.changes.some((said) => said.teachers.length > 0) ? h('p', null, 'Teachers follow rooms: where a group moves to another room, who teaches it changes as the list says.') : null,
        skipped > 0 ? h('p', null, 'Skipped, because the schedule has changed under ' + (skipped === 1 ? 'it' : 'them') + ':') : null,
        skipped > 0 ? h('ul', { class: 'scn-summary__list', data: { part: 'skipped' } }, summary.skipped.map((text) => h('li', { dir: 'auto' }, text))) : null,
        summary.added.length > 0 || summary.removed.length > 0 ? h('p', { data: { part: 'groups' } }, 'Groups only in one of the two files are not added or removed: a scenario changes rooms, not the list of groups.') : null,
        h('p', null, 'It is one step: Undo brings back the schedule and the scenario together.'),
        summary.snapshot ? h('p', { data: { part: 'snapshot' } }, 'It changes ' + count(summary.slots, (project.settings.periodWord || 'Period').toLowerCase()) + ' of the groups\' days, so a snapshot of the project as it is now is kept as well, and can be restored from Snapshots in the Project section.') : null,
      ];
      const dialog = ctx.openDialog({
        title: 'Apply the scenario ' + quote(current.name) + '?',
        body,
        id: 'scenario-apply',
        // the lab's own name for it, so scenarios.css keeps its question and
        // buttons in view (SV2-72f), on it before it is shown and focused
        class: 'scn-apply',
        opener: applyButton,
        // with nothing that applies the button says what it does: it closes the scenario
        buttons: [{ label: n === 0 ? APPLY_NOTHING : n === 1 ? 'Apply 1 change' : 'Apply ' + n + ' changes', value: 'apply', kind: 'primary' }, { label: 'Keep it as a scenario', value: null }],
      });
      const answer = await dialog.closed;
      if (answer !== 'apply' || gone) return;
      // what is applied is reconciled again now: the question may have stood open
      const before = store.project;
      const now = scenarioView(before);
      const big = now ? applySummary(before, now).snapshot : false;
      if (!run(applyScenario, {})) return;
      // the dialog gave the focus back to Apply, which the drawing has just
      // hidden: it goes on to the start field now, never by way of the page
      changes.focusName();
      let text = n === 0 ? 'Closed ' + quote(current.name) + ': no change of it applied, and the schedule is as it was.' : 'Applied ' + quote(current.name) + ': ' + count(n, 'change') + ' made to the schedule.';
      // a big apply keeps a snapshot of the project from before it, after
      // the change is made, so storage cannot hold it up; data-snapshot says
      // where that stands, for tests ('taking', 'taken', 'not-taken')
      if (big) {
        element.dataset.snapshot = 'taking';
        const kept = await snapshotAfter('scenario', 'Before applying the scenario ' + quote(current.name), before);
        element.dataset.snapshot = kept.taken ? 'taken' : 'not-taken';
        text += ' ' + kept.said;
      }
      // Undo from the message brings the scenario back, and the focus to its
      // name field, its first control (the message and its button are gone)
      ctx.toast({ text, action: { label: 'Undo', run: () => {
        ctx.undo();
        if (!gone) changes.focusName();
      } } });
      ctx.announce(text);
    }

    // ---- Discard…: asks first
    async function discardNow() {
      const current = scenarioView(store.project);
      if (!current) return;
      const ok = await ctx.confirm({
        title: 'Discard the scenario ' + quote(current.name) + '?',
        body: [h('p', null, 'Its ' + count(current.changes.length, 'change') + (current.changes.length === 1 ? ' goes' : ' go') + ', and the real schedule stays as it is. Undo brings the scenario back while this tab stays open.')],
        action: 'Discard the scenario',
        keep: 'Keep the scenario',
        danger: true,
        opener: discardButton,
      });
      if (!ok || gone) return;
      if (!run(discardScenario, {})) return;
      changes.focusName();
      ctx.announce('Discarded the scenario.');
    }

    function refresh() {
      const project = store.project;
      adopt(project);
      const f = figures(project);
      const nothing = f.rooms === 0 || f.groups === 0;
      map.hidden = nothing;
      empty.hidden = !nothing;
      headline.hidden = nothing;
      plan.showFloors(!nothing);
      if (nothing) {
        empty.replaceChildren(intro({
          headline: HEADLINE,
          first: first(project),
          facts: facts(project),
          actions: [h('button', { type: 'button', class: 'btn btn--primary', data: { action: f.rooms === 0 ? 'to-building' : 'to-schedule' }, on: { click: () => ctx.navigate(f.rooms === 0 ? '#building' : '#schedule/groups') } }, f.rooms === 0 ? 'Go to the building' : 'Go to the schedule')],
        }));
        if (inspectorShown) ctx.setInspector(null);
        inspectorShown = false;
        element.dataset.mode = 'empty';
        view = null;
        openBar(false);
        return;
      }
      if (!inspectorShown) {
        ctx.setInspector(inspectorBox, { title: 'Comparison' });
        inspectorShown = true;
      }
      if (empty.firstChild) empty.replaceChildren();
      // a control of the panel that this drawing hides or takes away (a
      // scenario opened, closed, applied or undone) hands the focus to the
      // panel's first control, rather than letting it fall to the page
      const held = panel.contains(document.activeElement) ? document.activeElement : null;
      view = scenarioView(project);
      element.dataset.mode = view ? 'open' : 'none';
      lineWords.replaceChildren(...words(firstLine(project, view)));
      openBar(Boolean(view));
      barText.textContent = barWords(view);
      changes.update(view);
      forms.element.hidden = !view;
      if (view) forms.update(project);
      file.update(view);
      if (view) askIfChanged();
      else {
        // nothing open: the last answer goes, and an asking still out is let go
        lane.asked += 1;
        lane.key = null;
        lane.compare = null;
        lane.answer = null;
        lane.pending = false;
        lane.failed = null;
        drawCompare();
      }
      plan.setProject(project, graphNow());
      if (held && (!held.isConnected || held.closest('[hidden]'))) changes.focusName();
    }

    refresh();

    element.scenarios = {
      plan,
      get view() { return view; },
      get compare() { return lane.compare; },
      get answer() { return lane.answer; },
      get pending() { return lane.pending; },
      memory,
      ask,
    };

    return {
      element,
      focus: () => plan.focus(),
      update() {
        if (!gone) refresh();
      },
      unmount() {
        gone = true;
        toastWatch.disconnect();
        if (toastHost) toastHost.style.removeProperty('--toast-left');
        plan.unmount();
      },
    };
  },
};
