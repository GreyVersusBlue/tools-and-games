// Fix…: small changes that would clear one finding (spec 5.8; DESIGN 5.2 and
// 5.4). The Checks tab and the findings panel show the button on a finding
// the suggestion engine can work on (`finding.fixable`, engine/findings.js,
// which is the list of kinds engine/suggest.js takes); a finding it cannot
// help has no button.
//
//   openFix(env, finding, opener)
//
// The dialog asks store.derived.suggest(finding.id, { otherTeachersRooms,
// limit: 5 }) (ui/engine-client.js, the suggestion lane) and says it is
// working until the answer comes. Then up to five sentences in the engine's
// own words, each the change and, after it, what else it changes; the words
// never say which is better, the reader chooses. "No small change clears
// this.", a failed answer and an answer for a schedule that has changed
// since each say so in a sentence.
//
// The switch "Also try other teachers' free rooms in the same subject" is
// off by default and asks again with otherTeachersRooms; the engine's
// sentence for such a move says whose room it is. The switch is kept in
// memory for the open project while the page is open: no storage key.
//
// Try it never changes the schedule. It adds the suggestion's change to the
// open scenario (addScenarioChange), or starts one named for the finding
// (newScenario) and adds it there, closes the dialog and opens Scenarios
// with the focus on the new change's chip. A change the scenario refuses
// (the schedule has moved under the list) is said in the action's own words
// in the dialog, and nothing is started.
//
// Focus: the dialog takes it on open; Escape and Close give it back to the
// Fix… button that opened it, or to the same button drawn again since, or,
// when that finding is gone, to the first control of the list it was in.
//
// The dialog's state is on its element, for the tests and for the eye:
// data-state working, answered, none, failed or stale; data-others true or
// false.

import { h, uid, focusables } from '../components/dom.js';
import { periodWords } from '../components/words.js';
import { checkLabel } from '../project/settings.js';
import { newScenario, addScenarioChange } from '../../engine/actions.js';
import { SUGGESTION_LIMIT } from '../../engine/suggest.js';
import { periodName } from '../../engine/bells.js';

export const FIX_TITLE = 'Small changes that would clear this';
export const OTHERS_LABEL = 'Also try other teachers’ free rooms in the same subject';
export const WORKING = 'Working out small changes that would clear this…';
export const FAILED = 'The changes could not be worked out';
export const STALE = 'The schedule has changed since this list was worked out, so it may no longer clear this. Ask again to work it out for the schedule as it is.';
const TRY_SAYS = 'Try it puts the change in a scenario, where it can be compared and applied. The schedule itself does not change.';

// The switch, per project id, for the page's life.
const memory = { projectId: null, others: false };

function othersFor(project) {
  if (memory.projectId !== project.id) {
    memory.projectId = project.id;
    memory.others = false;
  }
  return memory.others;
}

// A scenario started by Try it is named for the finding: what was found,
// on which day type, in which period.
export function scenarioNameFor(project, finding) {
  const where = finding.where || {};
  const dayType = project.dayTypes.find((each) => each.id === where.dayTypeId);
  const label = checkLabel(finding.kind, periodWords(project.settings));
  return label + (dayType ? ' on ' + dayType.name : '') + (Number.isInteger(where.period) ? ', ' + periodName(project.settings, where.period) : '');
}

// The engine's sentence in two: the change itself, then what else it
// changes. The cut is at the first ": " in the tool's own words; a typed
// name is never cut.
export function splitSentence(parts) {
  const change = [];
  const effects = [];
  let cut = false;
  for (const part of parts) {
    if (cut) {
      effects.push(part);
      continue;
    }
    const at = part.name ? -1 : part.text.indexOf(': ');
    if (at === -1) {
      change.push(part);
      continue;
    }
    change.push({ text: part.text.slice(0, at), name: false });
    effects.push({ text: part.text.slice(at + 2), name: false });
    cut = true;
  }
  return { change, effects };
}

function words(parts) {
  return parts.filter((part) => part.text !== '').map((part) => (part.name ? h('bdi', null, part.text) : part.text));
}

function sameVersions(a, b) {
  return Boolean(a && b) && a.geometry === b.geometry && a.building === b.building && a.schedule === b.schedule;
}

function sameChange(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
}

export function openFix(env, finding, opener) {
  const { ctx } = env;
  const store = ctx.store;
  const versionsNow = () => ({ geometry: store.geometryVersion, building: store.buildingVersion, schedule: store.scheduleVersion });
  // the list the button was in, and the button's name there: a redraw makes
  // new buttons, so the focus goes back to the one of the same name
  const home = opener && opener.closest ? opener.closest('.sch-panel, .sch-checks') : null;
  const openerKey = opener && opener.dataset ? opener.dataset.key : null;

  const switchId = uid('fix-others');
  const others = h('input', { type: 'checkbox', role: 'switch', id: switchId, name: 'otherTeachersRooms', data: { part: 'others' } });
  others.checked = othersFor(store.project);
  const status = h('p', { role: 'status', data: { part: 'status' } });
  const again = h('button', { type: 'button', class: 'btn', hidden: true, data: { action: 'ask-again' }, on: { click: () => ask() } }, 'Ask again');
  const list = h('ol', { class: 'fix-list', data: { part: 'list' }, style: 'display:grid;gap:var(--s-3);margin:0;padding:0;list-style:none' });
  const refusal = h('p', { role: 'alert', hidden: true, data: { part: 'refusal' }, style: 'color:var(--problem)' });

  const dialog = ctx.openDialog({
    id: 'fix-dialog',
    title: FIX_TITLE,
    opener,
    fallbackFocus: backHome,
    body: [
      h('p', { dir: 'auto', data: { part: 'finding' } }, finding.text),
      h('label', { for: switchId, style: 'display:flex;align-items:center;gap:var(--s-2);min-height:44px;cursor:pointer' }, others, h('span', null, OTHERS_LABEL)),
      h('div', { style: 'display:flex;flex-wrap:wrap;align-items:center;gap:var(--s-2)' }, status, again),
      list,
      refusal,
      h('p', { class: 'sch-hint' }, TRY_SAYS),
    ],
    buttons: [{ label: 'Close', value: null }],
  });
  const element = dialog.element;
  element.dataset.finding = finding.id;

  // Escape and Close: to the opener if it is still on the page (the dialog
  // does that); else to the same button drawn again; else to the first
  // control of the list it was in; else the section.
  function backHome() {
    const same = openerKey ? document.querySelector('[data-key="' + CSS.escape(openerKey) + '"]') : null;
    if (same) {
      same.focus();
      return;
    }
    const first = home && home.isConnected ? focusables(home)[0] : null;
    if (first) first.focus();
    else ctx.focusSurface();
  }

  // ---- asking
  let asked = 0;
  let shown = null;

  function setState(state, sentence) {
    element.dataset.state = state;
    status.textContent = sentence;
    again.hidden = state !== 'failed' && state !== 'stale';
    list.setAttribute('aria-busy', String(state === 'working'));
  }

  function ask() {
    asked += 1;
    const mine = asked;
    shown = null;
    refusal.hidden = true;
    list.replaceChildren();
    element.dataset.others = String(others.checked);
    setState('working', WORKING);
    let answer;
    try {
      answer = store.derived.suggest(finding.id, { otherTeachersRooms: others.checked, limit: SUGGESTION_LIMIT });
    } catch (error) {
      answer = Promise.reject(error);
    }
    Promise.resolve(answer).then((result) => {
      if (mine !== asked || !element.isConnected) return;
      if (!result || !sameVersions(result.versions, versionsNow())) {
        setState('stale', STALE);
        return;
      }
      shown = result;
      draw(result);
    }, (error) => {
      // said, never asked again from here (ui/engine-client.js's header):
      // Ask again is a press
      if (mine !== asked || !element.isConnected) return;
      setState('failed', FAILED + (error && error.message ? ': ' + error.message.replace(/\.$/, '') : '') + '. Ask again, or close this and press Fix… later.');
    });
  }

  function draw(result) {
    if (result.suggestions.length === 0) {
      setState('none', result.none + (others.checked ? '' : ' Other teachers’ rooms were not looked at: the switch above looks at them too.'));
      return;
    }
    const n = result.suggestions.length;
    setState('answered', (n === 1 ? 'One change' : n + ' changes') + ' would clear this. Each says what else it changes.');
    list.replaceChildren(...result.suggestions.map((suggestion, index) => {
      const { change, effects } = splitSentence(suggestion.parts);
      return h('li', { class: 'fix-list__item', data: { kind: suggestion.kind, index: String(index) }, style: 'display:flex;flex-wrap:wrap;align-items:flex-start;gap:var(--s-2);padding-bottom:var(--s-3);border-bottom:var(--border)' },
        h('p', { class: 'fix-list__words', dir: 'auto', style: 'flex:1 1 16rem;margin:0' },
          h('strong', { data: { part: 'change' } }, words(change)),
          effects.length > 0 ? [': ', h('span', { data: { part: 'effects' } }, words(effects))] : null),
        h('button', { type: 'button', class: 'btn', data: { action: 'try' }, on: { click: () => tryIt(suggestion) } },
          'Try it', h('span', { class: 'vh' }, ': ' + suggestion.text)));
    }));
  }

  // ---- the schedule moving under the list
  const unsubscribe = store.subscribe(() => {
    if (shown && !sameVersions(shown.versions, versionsNow())) setState('stale', STALE);
  });
  dialog.closed.then(() => unsubscribe());

  others.addEventListener('change', () => {
    othersFor(store.project);
    memory.others = others.checked;
    ask();
  });

  // ---- Try it
  function tryIt(suggestion) {
    const project = store.project;
    const starting = !project.scenario;
    const name = scenarioNameFor(project, finding);
    // tried on a copy first, so a refusal starts nothing
    try {
      addScenarioChange(starting ? newScenario(project, { name }) : project, { change: suggestion.change });
    } catch (error) {
      refuse(error);
      return;
    }
    try {
      if (starting) store.apply(newScenario, { name });
      store.apply(addScenarioChange, { change: suggestion.change });
    } catch (error) {
      refuse(error);
      return;
    }
    const scenario = store.project.scenario;
    dialog.close('try');
    ctx.announce((starting ? 'Started the scenario ' + scenario.name + ' with ' : 'Added to the scenario ' + scenario.name + ': ') + suggestion.chip.text + '. Nothing is applied yet.');
    land(suggestion.change);
  }

  function refuse(error) {
    refusal.textContent = error && error.message ? error.message : 'That change could not be put in a scenario.';
    refusal.hidden = false;
  }

  // Scenarios, with the focus on the new chip, else the lab's first control.
  function land(change) {
    function focusChip() {
      const scenario = store.project.scenario;
      const index = scenario ? scenario.changes.findIndex((each) => sameChange(each, change)) : -1;
      const lab = document.querySelector('.scn');
      if (!lab) return;
      const chip = index === -1 ? null : lab.querySelector('.scn-chip[data-index="' + index + '"] [data-action="remove"]');
      const target = chip || lab.querySelector('#scenario-name') || focusables(lab)[0];
      if (target) target.focus();
    }
    if (location.hash === '#scenarios') {
      ctx.navigate('#scenarios');
      focusChip();
      return;
    }
    // after the shell's own hashchange listener has put the section up
    window.addEventListener('hashchange', focusChip, { once: true });
    ctx.navigate('#scenarios');
  }

  ask();
  return dialog;
}
