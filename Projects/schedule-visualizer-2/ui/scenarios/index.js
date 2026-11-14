// The Scenarios section: the scenario lab (spec 9; DESIGN 5.4). Trial
// changes to the schedule, held apart from it, compared figure by figure
// with the real schedule, then applied as one step of undo or discarded.
//
//   top       the screen's first line, a sentence: what is being tried, how
//             many changes, that nothing is applied yet
//   the map   the plan map (ui/surface/plan-map.js), plain for now; the
//             difference overlay (SV2-69) mounts on it below, at the line
//             marked "SV2-69"
//   the panel (./others.js, ./changes.js, ./forms.js, ./file.js) beside the map on a
//             wide window and under it on a narrow one: Other scenarios (the
//             kept ones, with Switch to, Duplicate, Rename… and Delete…), the scenario's name,
//             its changes as chips with ×, the changes that no longer apply
//             with "Remove them", "Add a change" with the three kinds of
//             change, "Compare with another project file", and the
//             congestion report, which prints the scenario's effect
//   the bar   sticky at the section's foot: "Not applied yet: 3 changes",
//             Apply… (a summary, then one step of undo) and Discard… (asks)
//   inspector the comparison (./compare.js): Before / After / Difference,
//             travel by group, places busier and quieter, findings new,
//             resolved and unchanged, all from store.derived.scenario(); with
//             "Compare with" the Before side is the real schedule or a kept
//             scenario (store.derived.kept(), compared here with
//             compareResults, DESIGN 15.9 item 8)
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
import { closedOverlay, closedMarks } from '../surface/overlays/closed.js';
import { slotAt } from '../surface/plan-layout.js';
import { buildGraph } from '../../engine/graph.js';
import { ActionError, addScenarioChange, addScenarioLever, applyScenario, discardScenario, removeScenarioLever } from '../../engine/actions.js';
import { keptScenarios, reconcile, compareResults } from '../../engine/scenario.js';
import { places, placeAt } from '../../engine/places.js';
import { changeWords } from '../../engine/scenario.js';
import { nameOfRoom, isLiftCell } from '../../engine/schema.js';
import { snapshotAfter, snapshotRoom, undoForStep } from '../../storage/snapshots.js';
import { scenarioView, scenarioName, comparedSentence, keptLine, SWITCHED_TO_COMPARED, COMPARED_GONE, firstLine, barWords, cancelled, cancelledSentence, leverCancelled, leverCancelledSentence, applySummary, applyButtonWords, snapshotWords, pickedPlace, pickedName, pickWords, closedAt } from './model.js';
import { changesPanel } from './changes.js';
import { formsPanel, freshForm } from './forms.js';
import { filePanel } from './file.js';
import { buildingsPanel } from './buildings.js';
import { othersPanel } from './others.js';
import { comparePanel } from './compare.js';
import { mountDifference } from './difference.js';

const HEADLINE = 'This is the scenario lab.';
// Apply's button when nothing in the scenario applies: it closes the scenario.
const KEYS = 'Arrow keys move the cursor one cell and say what is under it. Hold Space and press the arrows to move the map. = and - zoom in and out, 0 fits the map to the window. The comparison is in the inspector.';

// The keys of the lab's map. The map answers them itself, so they are listed
// for Help only (spec 3.15; SV2-32b: until then Help had none of them).
export const SCENARIO_KEYS = [
  { id: 'scenarios-arrows', does: 'Move the cursor one cell, and say what is under it', shown: 'Arrows' },
  { id: 'scenarios-pan', does: 'Move the map', shown: 'Space+Arrows' },
  { id: 'scenarios-zoom-in', does: 'Zoom in', shown: '=' },
  { id: 'scenarios-zoom-out', does: 'Zoom out', shown: '-' },
  { id: 'scenarios-fit', does: 'Fit the map to the window', shown: '0' },
];

// What is chosen here, kept for the open project while the page is open
// (in memory: no storage key, and nothing new in project.scenario).
// compareWith: the id of the kept scenario the comparison's Before side is, or
// null for the real schedule (DESIGN 15.9 item 8)
const memory = { projectId: null, form: freshForm(), dayTypeId: null, bellsId: null, transition: null, floors: 'auto', file: null, compareWith: null };

function adopt(project) {
  if (memory.projectId === project.id) return;
  memory.projectId = project.id;
  memory.form = freshForm();
  memory.dayTypeId = null;
  memory.bellsId = null;
  memory.transition = null;
  memory.floors = 'auto';
  memory.file = null;
  memory.compareWith = null;
}

function words(parts) {
  return parts.map((part) => (part.name ? h('bdi', null, part.text) : part.text));
}

function quote(text) {
  return '“' + text + '”';
}

// Why no snapshot would be kept now, as the end of a sentence, or null when
// one would (SV2-28d): asked before the Apply question, so that it never
// promises a snapshot the device will refuse. A tab whose saves are failing,
// or that stopped saving after another tab's save, cannot save first, and
// the snapshot is refused for that ('not-saved', SV2-28e).
async function noSnapshotBecause(ctx) {
  if (ctx.storage && ctx.storage.state.readOnly) return 'this tab is read-only while the project is open in another tab.';
  const save = ctx.storage ? ctx.storage.state.save : null;
  if (save === 'conflict') return 'another tab saved this project after this tab read it, so this tab has stopped saving, and a snapshot is kept only of a saved project.';
  if (save === 'failed') return 'the project could not be saved on this device just now, and a snapshot is kept only of a saved project.';
  const room = await snapshotRoom();
  if (room.error) return room.error.charAt(0).toLowerCase() + room.error.slice(1);
  if (room.full) return 'this device already keeps ' + room.limit + ' snapshots, the most it keeps, and none is replaced to make room.';
  return null;
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
  // Once, before anything is mounted: the map's keys go on the shell's list.
  start(ctx) {
    for (const key of SCENARIO_KEYS) ctx.shortcuts.add({ id: key.id, group: 'Scenario lab', does: key.does, shown: key.shown });
  },
  mount(ctx) {
    const store = ctx.store;
    adopt(store.project);
    let gone = false;
    let view = null;
    // the comparison: the last answer, and whether a newer one is being worked
    // out; `key` is what the last asking was for (the scenario object, the
    // store's counters, the lab's options), so a drawing that changes none of
    // them (the floors row, the theme, a store change elsewhere) asks nothing
    // beforeOf is { result, versions, changes, name, scenario } while the Before side
    // is a kept scenario's; working is set from the moment that side changes
    // until its answer is in; noted is the sentence the answer came to
    const lane = { compare: null, answer: null, pending: false, failed: null, asked: 0, key: null, beforeOf: null, working: false, noted: null, sayReal: false };

    // A row of the Other scenarios strip that changes the project places the
    // focus itself (the open scenario's name, the next row's button), and says
    // its own sentence. While it runs, the drawing it causes neither parks the
    // focus on the name field on its way (a focus event there is heard by a
    // screen reader) nor says the compare-reset sentence on its own: the
    // strip's one sentence has it (15.9 items 8 and 11).
    let placing = 0;
    function placeFocus(work) {
      placing += 1;
      try {
        return work();
      } finally {
        placing -= 1;
      }
    }

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
      placeFocus,
      add,
      addLever,
      // the Kind of change fieldset: where the focus goes when the last chip is taken out
      focusKinds: () => forms.focusKinds(),
      // where the focus goes when what held it is gone: the panel's first control
      home: () => changes.focusName(),
      // the lab's map picking a corridor (Stairs and corridors, "Pick on the map")
      pickStart: () => startPicking(),
      pickStop: (refocus) => stopPicking(refocus, ''),
      picking: () => pick.on,
      ask,
      // false once the section has been taken off the page
      mounted: () => !gone,
      // the strip: the open scenario's name is a heading while others are kept
      showOpenTitle: () => keptScenarios(store.project).length > 0,
      focusOpened: () => changes.focusOpened(),
      // Compare with: the choice after it has settled, and back to the real schedule
      chooseCompare,
      resetCompare,
      // Comparing two buildings (./buildings.js): the plan map once it is made, the open
      // project's graph, the lab drawn again, where the focus goes after Stop comparing
      plan: () => plan,
      graph: graphNow,
      redraw: () => refresh(),
      focusFile: () => file.focusHeading(),
      buildings: () => buildings,
    };
    const others = othersPanel(env);
    const changes = changesPanel(env);
    const forms = formsPanel(env);
    const buildings = buildingsPanel(env);
    const file = filePanel(env);
    const congestion = h('button', { type: 'button', class: 'btn', data: { action: 'congestion' }, on: { click: (event) => openPrintPreview(ctx, 'congestion', { opener: event.currentTarget }) } }, 'Print the congestion report…');
    const report = h('section', { class: 'scn-report', 'aria-labelledby': 'scenario-report-title' },
      h('h2', { class: 'scn-panel__title', id: 'scenario-report-title' }, 'Congestion report'),
      h('p', { class: 'scn-report__lead' }, 'The movement view’s report on paper, with what the open scenario does to it.'),
      congestion);
    // The building comparison's band goes above the panel's first section; while one is
    // held it hides the chips and the forms and says "Stop comparing to edit the scenario."
    // (index.js `refresh()` marks it below).
    const panel = h('section', { class: 'scn-panel', 'aria-label': 'The scenario and its changes', data: { part: 'panel' } }, buildings.band, others.element, changes.element, forms.element, file.element, report);

    // ---- picking a corridor on the map (DESIGN 12.4): a banner on the stage with
    // Cancel; a tap or click, or Enter (or Space let go alone) at the keyboard's
    // cursor, picks the place; Escape cancels and does nothing else
    const pick = { on: false, preview: null, spaceDown: false, spaceMoved: false };
    const pickText = h('span', { class: 'scn-pick__text' });
    const pickCancel = h('button', { type: 'button', class: 'btn scn-pick__cancel', data: { action: 'pick-cancel' }, on: { click: () => stopPicking(true, 'Picking cancelled.') } }, 'Cancel');
    const pickBanner = h('div', { class: 'scn-pick', role: 'status', hidden: true, data: { part: 'pick-banner' } }, pickText, pickCancel);

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
      frame: () => ({ before: [headline, top], inside: [pickBanner], after: [panel, bar], head: top, line, foot: bar }),
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
      if (pick.on) return pickEvent(ev);
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
      const what = space ? (space.kind === 'room' ? nameOfRoom(space) : space.label || 'another space') : cell === '#' ? 'corridor' : cell === 'S' ? (isLiftCell(plan.project.building, floor.id, found.cell) ? 'elevator' : 'stairs') : 'nothing here';
      ctx.announce(floor.name + ': ' + what + '.');
      return false;
    });

    // ---- picking: what is under the pointer or the cursor, and the pick
    const placesNow = () => store.derived.get('lab-places', ['building'], (project) => places(project, graphNow()));

    // the floor, cell and place at a cell of the map ({ x, y } in the map's cells), or null between floors
    function targetAt(x, y) {
      if (!plan.world || !plan.project || !Number.isFinite(x) || !Number.isFinite(y)) return null;
      const found = slotAt(plan.world, x, y);
      if (!found) return null;
      const floor = found.slot.floor;
      const cut = placesNow();
      const place = placeAt(cut, graphNow(), floor.id, found.cell);
      return { floor, cell: found.cell, picked: pickedPlace(store.project, floor, found.cell, place) };
    }

    function startPicking() {
      if (!view || gone || pick.on) return;
      pick.on = true;
      pick.preview = null;
      element.dataset.picking = 'true';
      pickText.textContent = '';
      pickBanner.hidden = false;
      pickText.textContent = 'Tap or click a corridor to close it.';
      forms.picked(true);
      ctx.announce('Pick a corridor to close. Tap or click it, or move the cursor with the arrow keys and press Enter. Escape cancels.');
      plan.focus();
      plan.paint();
    }

    // refocus: the focus goes back to "Pick on the map"; `said` is announced
    function stopPicking(refocus, said) {
      if (!pick.on) return;
      pick.on = false;
      pick.preview = null;
      pick.spaceDown = false;
      delete element.dataset.picking;
      pickBanner.hidden = true;
      pickText.textContent = '';
      plan.paint();
      if (refocus && !forms.focusPick()) changes.focusName();
      else forms.picked(false);
      if (said) ctx.announce(said);
    }

    function previewOf(target) {
      if (!target || target.picked.why) return null;
      return { floorId: target.picked.lever.floorId, cells: target.picked.lever.cells };
    }

    // the place chosen: closed, or opened again when it is closed already
    function choose(target) {
      if (!target) {
        ctx.announce('Between floors. Tap or click a corridor to close it.');
        return;
      }
      const picked = target.picked;
      if (picked.why) {
        ctx.announce(picked.why + ' Tap or click a corridor to close it.');
        return;
      }
      const shut = closedAt(view, target.floor.id, target.cell);
      const name = pickedName(picked);
      if (shut) {
        if (!run(removeScenarioLever, { index: shut.index })) return;
        const was = pickedName({ ...picked, lever: shut.lever });
        changes.said('Reopened: ' + was + '.');
        stopPicking(true, was + ' is open again.');
        return;
      }
      if (!addLever(picked.lever)) return;
      stopPicking(true, name + ' closed in this trial.');
    }

    function pickEvent(ev) {
      if (ev.kind === 'escape') {
        stopPicking(true, 'Picking cancelled.');
        return true;
      }
      if (ev.kind === 'tap' || ev.kind === 'enter') {
        choose(targetAt(ev.x, ev.y));
        return true;
      }
      if (ev.kind === 'hover' || ev.kind === 'keyboard') {
        const target = ev.kind === 'hover' && ev.inside === false ? null : targetAt(ev.x, ev.y);
        const next = previewOf(target);
        const was = pick.preview;
        const same = JSON.stringify(next) === JSON.stringify(was);
        pick.preview = next;
        if (!same) plan.paint();
        if (ev.kind === 'keyboard') {
          if (!target) ctx.announce('Between floors.');
          else ctx.announce(pickWords(target.picked, Boolean(closedAt(view, target.floor.id, target.cell))));
        }
        return false;
      }
      return false;
    }

    // Space let go with no arrow pressed while it was down picks at the cursor
    // (Space with the arrows moves the map, as ever); Escape anywhere in the
    // section cancels, before anything else hears it
    plan.canvas.addEventListener('keydown', (event) => {
      if (!pick.on) return;
      if (event.key === ' ' && !event.repeat) {
        pick.spaceDown = true;
        pick.spaceMoved = false;
      } else if (pick.spaceDown && event.key.startsWith('Arrow')) {
        pick.spaceMoved = true;
      }
    });
    plan.canvas.addEventListener('keyup', (event) => {
      if (event.key !== ' ') return;
      const picking = pick.on && pick.spaceDown && !pick.spaceMoved;
      pick.spaceDown = false;
      if (picking) choose(targetAt(plan.cursor.x, plan.cursor.y));
    });
    element.addEventListener('keydown', (event) => {
      if (!pick.on || event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      stopPicking(true, 'Picking cancelled.');
    }, true);

    // the closed corridors and stairs, hatched over the plan (ui/surface/overlays/closed.js)
    let marks = null;
    const drawClosed = closedOverlay(() => (view ? { marks, preview: pick.preview } : null));
    const hatched = new Map();
    plan.overlays.push((g, v, floor, theme) => {
      drawClosed(g, v, floor, theme);
      hatched.set(floor.id, drawClosed.drawn);
      element.dataset.closedDrawn = String(Array.from(hatched.values()).reduce((sum, n) => sum + n, 0));
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
    const inspectorBox = h('div', { class: 'scn-inspector' }, compare.element, buildings.inspector);
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

    // a lever from the forms (a bell time, a staggered dismissal, a capacity or
    // a head count); one that puts the schedule back as it is says so
    function addLever(lever) {
      const project = store.project;
      const said = changeWords(project, lever).text;
      let refused = false;
      const made = run(addScenarioLever, { lever }, (message) => {
        refused = true;
        changes.said(message);
        ctx.toast({ kind: 'problem', text: message });
      });
      if (refused) return false;
      const undone = leverCancelled(project.scenario, made ? store.project.scenario : project.scenario, lever);
      const instead = made && !undone ? scenarioView(store.project).levers.find((each) => each.index === store.project.scenario.levers.length - 1) : null;
      const text = undone ? leverCancelledSentence(said, undone.taken, lever.kind === 'way' || lever.kind === 'corridor' ? 'building' : 'schedule') : made ? 'Added: ' + said + (instead && instead.instead ? ', instead of ' + instead.instead : '') + '.' : 'The scenario already has this: ' + said + '.';
      changes.said(text);
      ctx.announce(text);
      return true;
    }

    // ---- the comparison, asked of the scenario lane
    // the kept scenario the Before side is, as the object in the project (the
    // lane keys its answers by the object, so a renamed or edited one is asked
    // again), or null for the real schedule
    function keptTarget() {
      if (memory.compareWith === null) return null;
      return keptScenarios(store.project).find((scenario) => scenario && typeof scenario === 'object' && scenario.id === memory.compareWith) || null;
    }

    function laneKey() {
      return { scenario: store.project.scenario, against: keptTarget(), counters: store.geometryVersion + ':' + store.buildingVersion + ':' + store.scheduleVersion, dayTypeId: memory.dayTypeId, bellsId: memory.bellsId, transition: memory.transition };
    }

    function sameKey(a, b) {
      return Boolean(a) && Boolean(b) && a.scenario === b.scenario && a.against === b.against && a.counters === b.counters && a.dayTypeId === b.dayTypeId && a.bellsId === b.bellsId && a.transition === b.transition;
    }

    // asks again only when what the answer is for has changed
    function askIfChanged() {
      if (sameKey(lane.key, laneKey())) drawCompare();
      else ask();
    }

    // Compare with, after the select settled (400 ms): a kept scenario or null
    function chooseCompare(id, letGo) {
      if (gone) return;
      const next = id === null || keptScenarios(store.project).some((scenario) => scenario && scenario.id === id) ? id : null;
      if (next === memory.compareWith) {
        drawCompare();
        return;
      }
      // back to the real schedule by choice: its status sentence is said too
      lane.sayReal = next === null && letGo !== true;
      memory.compareWith = next;
      askIfChanged();
    }

    // back to the real schedule, with the sentence that says why (the scenario
    // compared with was switched to, or is gone)
    function resetCompare(why) {
      if (memory.compareWith === null) return;
      const open = store.project.scenario;
      const text = why === 'gone' ? COMPARED_GONE : open && open.id === memory.compareWith ? SWITCHED_TO_COMPARED : COMPARED_GONE;
      memory.compareWith = null;
      lane.noted = null;
      lane.sayReal = false;
      ctx.announce(text);
      if (view && !gone) askIfChanged();
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
      const target = keptTarget();
      // the Before side is another one now: the figures on screen are for the
      // last, so the column says it is working until this answer is in
      if ((lane.beforeOf ? lane.beforeOf.scenario : null) !== target) {
        lane.compare = null;
        lane.noted = null;
        lane.working = true;
        // and the difference map and its legend: they are drawn from the last
        // answer and its Before side, which are the old side's until the new
        // answer lands (the map is blank and the legend gone meanwhile)
        lane.answer = null;
        lane.beforeOf = null;
      }
      drawCompare();
      // drawn first: the options settle to the project (a day type gone is none)
      lane.key = laneKey();
      const options = { dayTypeId: memory.dayTypeId, ...(memory.bellsId === null ? {} : { bellsId: memory.bellsId }), transition: memory.transition, runFindings: true };
      const open = store.derived.scenario(options);
      const both = target ? Promise.all([open, store.derived.kept(target)]) : open.then((answer) => [answer, null]);
      both.then(([answer, kept]) => {
        if (gone || token !== lane.asked) return;
        if (target && answer && !kept) throw new Error('the scenario to compare with could not be worked out. It may have been changed or deleted.');
        let compared = answer ? answer.compare : null;
        let beforeOf = null;
        let noted = null;
        if (target && answer) {
          // the same store counters on both sides, or the store moved on: ask again
          const stamp = (versions) => versions.geometry + ':' + versions.building + ':' + versions.schedule;
          if (stamp(answer.versions) !== stamp(kept.versions)) {
            ask();
            return;
          }
          const theirs = reconcile(store.project, target);
          const changes = answer.changes.concat(theirs.changes);
          const levers = (answer.levers || []).concat(theirs.levers || []);
          compared = compareResults(kept.result, answer.result, { ...options, changes, levers });
          // kept.result holds every day type's loads and every bell schedule's
          // run, as the open scenario's does (both are pipeline.run() of a whole
          // project, trimmed; engine/worker.js keptRun, scenarioRun), so
          // compareResults reads the same day type and bells from both
          beforeOf = { result: kept.result, versions: kept.versions, changes: theirs.changes, name: scenarioName(target), scenario: target };
          noted = comparedSentence(beforeOf.name, compared);
        }
        // the real schedule, chosen by hand: it too says what it came to
        if (!target && compared && lane.sayReal) noted = comparedSentence('the real schedule', compared);
        lane.sayReal = false;
        lane.pending = false;
        lane.working = false;
        lane.answer = answer;
        lane.compare = compared;
        lane.beforeOf = beforeOf;
        lane.noted = noted;
        drawCompare();
      }).catch((error) => {
        if (gone || token !== lane.asked) return;
        lane.pending = false;
        lane.working = false;
        lane.failed = error && error.message ? error.message : String(error);
        drawCompare();
      });
    }

    function drawCompare() {
      compare.update({ project: store.project, scenario: Boolean(view), compare: view ? lane.compare : null, pending: lane.pending, old: Boolean(lane.compare) && (lane.pending || Boolean(lane.failed)), failed: lane.failed, beforeName: view && lane.beforeOf ? lane.beforeOf.name : null, working: lane.working && lane.pending, noted: lane.noted });
      element.dataset.compareWith = memory.compareWith === null ? '' : memory.compareWith;
      element.dataset.compare = !view ? 'none' : lane.pending ? 'pending' : lane.failed ? 'failed' : lane.compare ? 'ready' : 'none';
      difference.update();
    }

    // ---- Apply…: what will change and what is skipped, then one step of undo
    async function applyNow() {
      const project = store.project;
      const current = scenarioView(project);
      if (!current) return;
      const summary = applySummary(project, current);
      const n = summary.writes;
      const skipped = summary.skipped.length;
      const none = summary.snapshot ? await noSnapshotBecause(ctx) : null;
      if (gone) return;
      const readOnly = Boolean(ctx.storage && ctx.storage.state.readOnly);
      const snapshotLine = snapshotWords(summary, (project.settings.periodWord || 'Period').toLowerCase(), none, readOnly);
      // with closures alone nothing is written: no Apply, and no line about its undo
      const nothingToWrite = !summary.canApply && summary.total > 0;
      const sentences = summary.changes.concat(summary.levers);
      const body = [
        h('p', null, n === 0 ? (summary.trial ? 'Nothing in this scenario writes to the schedule or the building, so there is nothing to apply. Discard the scenario to close it.' : 'Nothing in this scenario applies to the schedule as it is now. Applying it closes it and changes no slot.') : (n === 1 ? 'This change goes' : 'These ' + n + ' changes go') + ' into the real schedule:'),
        n > 0 ? h('ul', { class: 'scn-summary__list', data: { part: 'applies' } }, sentences.map((said) => h('li', { dir: 'auto' }, words(said.parts)))) : null,
        summary.kinds.length > 0 ? h('ul', { class: 'scn-summary__list scn-summary__kinds', data: { part: 'kinds' } }, summary.kinds.map((text) => h('li', { dir: 'auto' }, text))) : null,
        summary.changes.some((said) => said.teachers.length > 0) ? h('p', null, 'Teachers follow rooms: where a group moves to another room, who teaches it changes as the list says.') : null,
        skipped > 0 ? h('p', null, 'Skipped, because the schedule has changed under ' + (skipped === 1 ? 'it' : 'them') + ':') : null,
        skipped > 0 ? h('ul', { class: 'scn-summary__list', data: { part: 'skipped' } }, summary.skipped.map((text) => h('li', { dir: 'auto' }, text))) : null,
        summary.added.length > 0 || summary.removed.length > 0 ? h('p', { data: { part: 'groups' } }, 'Groups only in one of the two files are not added or removed: a scenario changes rooms, not the list of groups.') : null,
        summary.trial ? h('p', { class: 'scn-summary__trial', role: 'note', data: { part: 'trial' } }, words(summary.trial.parts)) : null,
        nothingToWrite ? null : h('p', null, 'It is one step: Undo brings back the schedule and the scenario together.'),
        keptLine(project) ? h('p', { data: { part: 'kept-stay' } }, keptLine(project)) : null,
        summary.snapshot ? h('p', { data: { part: 'snapshot' } }, snapshotLine) : null,
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
        buttons: nothingToWrite ? [{ label: 'Keep it as a scenario', value: null, kind: 'primary' }] : [{ label: applyButtonWords(summary), value: 'apply', kind: 'primary' }, { label: 'Keep it as a scenario', value: null }],
      });
      const answer = await dialog.closed;
      if (answer !== 'apply' || gone) return;
      // what is applied is reconciled again now: the question may have stood open
      const before = store.project;
      const now = scenarioView(before);
      const big = now ? applySummary(before, now).snapshot : false;
      if (!run(applyScenario, {})) return;
      // the Undo the messages offer takes back this apply or nothing (SV2-28d)
      const step = undoForStep(store, ctx.undo);
      // the dialog gave the focus back to Apply, which the drawing has just
      // hidden: it goes on to the start field now, never by way of the page
      changes.focusName();
      const text = n === 0 ? 'Closed ' + quote(current.name) + ': no change of it applied, and the schedule is as it was.' : 'Applied ' + quote(current.name) + ': ' + count(n, 'change') + ' made to the schedule.' + (summary.trial ? ' ' + summary.trial.text : '');
      // Undo from the message brings the scenario back, and the focus to its
      // name field, its first control (the message and its button are gone)
      const offer = { label: 'Undo', run: () => {
        if (step.run() && !gone) changes.focusName();
      } };
      // said at once, as every change is, whatever the snapshot does after
      ctx.toast({ text, action: offer });
      ctx.announce(text);
      // a big apply keeps a snapshot of the project from before it, after
      // the change is made, so storage cannot hold it up; when it settles the
      // message says whether it is there, with the Undo again only while the
      // apply is still the step Undo takes back. data-snapshot says where
      // that stands, for tests ('taking', 'taken', 'not-taken')
      if (big) {
        element.dataset.snapshot = 'taking';
        const kept = await snapshotAfter('scenario', 'Before applying the scenario ' + quote(current.name), before);
        element.dataset.snapshot = kept.taken ? 'taken' : 'not-taken';
        if (step.current) ctx.toast({ text: text + ' ' + kept.said, action: offer });
        else ctx.toast({ text: kept.alone });
      }
    }

    // ---- Discard…: asks first
    async function discardNow() {
      const current = scenarioView(store.project);
      if (!current) return;
      const ok = await ctx.confirm({
        title: 'Discard the scenario ' + quote(current.name) + '?',
        body: [h('p', null, 'Its ' + count(current.changes.length + (Array.isArray(current.levers) ? current.levers.length + current.droppedLevers.length : 0), 'change') + (current.changes.length + current.levers.length + current.droppedLevers.length === 1 ? ' goes' : ' go') + ', and the real schedule stays as it is. Undo brings the scenario back while this tab stays open.')],
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
      // a comparison for another project ends; a change in this one is compared again
      buildings.update(project);
      // the kept scenario compared with was switched to or deleted: back to the real schedule
      if (memory.compareWith !== null && !keptTarget()) {
        const open = project.scenario;
        const text = open && open.id === memory.compareWith ? SWITCHED_TO_COMPARED : COMPARED_GONE;
        memory.compareWith = null;
        lane.noted = null;
        lane.sayReal = false;
        // the strip's own sentence has it when a row of the strip did this
        if (placing === 0) ctx.announce(text);
      }
      const f = figures(project);
      const nothing = f.rooms === 0 || f.groups === 0;
      map.hidden = nothing;
      empty.hidden = !nothing;
      headline.hidden = nothing;
      plan.showFloors(!nothing);
      if (nothing) {
        empty.dataset.empty = f.rooms === 0 ? 'scenarios-rooms' : 'scenarios-groups';
        empty.replaceChildren(intro({
          headline: HEADLINE,
          first: first(project),
          facts: facts(project),
          actions: [h('button', { type: 'button', class: 'btn btn--primary', data: { action: f.rooms === 0 ? 'to-building' : 'to-schedule' }, on: { click: () => ctx.navigate(f.rooms === 0 ? '#building' : '#schedule/groups') } }, f.rooms === 0 ? 'Go to the building' : 'Go to Groups')],
        }));
        if (inspectorShown) ctx.setInspector(null);
        inspectorShown = false;
        others.update(project);
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
      if (!view) stopPicking(false, '');
      // the closures the plan hatches: the levers reconcile kept
      marks = view ? closedMarks(project, view.levers.map((each) => each.lever)) : null;
      hatched.clear();
      element.dataset.mode = view ? 'open' : 'none';
      lineWords.replaceChildren(...words(firstLine(project, view)));
      openBar(Boolean(view));
      barText.textContent = barWords(view);
      others.update(project);
      changes.update(view);
      forms.element.hidden = !view;
      if (view) forms.update(project);
      file.update(view);
      // a held building comparison hides the chips and the forms (./buildings.js)
      const comparing = buildings.held();
      changes.element.hidden = comparing;
      if (comparing) forms.element.hidden = true;
      compare.element.hidden = comparing;
      if (comparing) stopPicking(false, '');
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
      // a held building comparison paints the map itself
      if (!buildings.paint()) plan.setProject(project, graphNow());
      if (placing === 0 && held && (!held.isConnected || held.closest('[hidden]'))) {
        if (buildings.held()) buildings.editLine.focus();
        else changes.focusName();
      }
    }

    refresh();

    element.scenarios = {
      plan,
      get view() { return view; },
      get compare() { return lane.compare; },
      get answer() { return lane.answer; },
      get pending() { return lane.pending; },
      // how many times the lane was asked, for the tests (a settled choice asks once)
      get asked() { return lane.asked; },
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
        buildings.unmount();
        compare.stop();
        toastWatch.disconnect();
        if (toastHost) toastHost.style.removeProperty('--toast-left');
        plan.unmount();
      },
    };
  },
};
