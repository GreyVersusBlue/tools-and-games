// The Checks tab and the findings panel beside every tab. Both show what
// engine/checks.js found; neither decides anything. Show jumps to the slot or
// the teacher and marks it; Accept asks for a one-line reason and moves the
// finding to the Accepted list, out of the counts. The Accepted list also
// holds the records that no longer stand as they were: one whose finding has
// changed since (it counts again), one whose check is switched off, and one
// whose finding is gone.

import { h, uid } from '../components/dom.js';
import { count, periodWords } from '../components/words.js';
import { checkLabel } from '../project/settings.js';
import { acceptFinding, unacceptFinding } from '../../engine/actions.js';
import { SEVERITIES } from '../../engine/findings.js';
import { floorOfRoom } from '../../engine/schema.js';
import { fill, apply, button, keyed, notYet, emptyState, severityMark, SEVERITY_WORDS } from './common.js';
import { choosingGroup } from './groups.js';
import { groupHash, slotHash } from './address.js';
import { printButtons } from '../prints/index.js';
import { printButton } from '../components/print-preview.js';

const WHAT = 'Checks look through the schedule for problems, warnings and notes: two groups in one room, a teacher in two places, a walk too long for the passing time.';
const FIX_REASON = 'Suggestions are not built yet';
const PANEL_LIMIT = 12;
// Under this width the inspector is a sheet under the section, not a panel
// beside it (the shell's own width). The section draws the inspector again
// when it is crossed (index.js), since the panel says where the list is.
export const SHEET = '(max-width: 900px)';

// Where Show takes a finding: a group's slot, a teacher's row, or the floor
// the room is on.
export function showFinding(env, finding) {
  const { ctx, view } = env;
  const where = finding.where;
  if (where.groupIds.length > 0) {
    const groupId = where.groupIds.includes(view.groupId) ? view.groupId : where.groupIds[0];
    // the slot's address: it chooses the group, takes off a filter that
    // hides it, and on a phone leaves the list a Back away
    ctx.navigate(where.dayTypeId && Number.isInteger(where.period) ? slotHash(groupId, where.dayTypeId, where.period) : groupHash(groupId));
  } else if (where.teacherId !== null) {
    view.shown = { teacherId: where.teacherId, fresh: true };
    ctx.navigate('#schedule/teachers');
  } else if (where.roomId !== null) {
    const floor = floorOfRoom(ctx.store.project, where.roomId);
    if (floor) ctx.navigate('#building/' + floor.id);
  }
  ctx.announce('Showing: ' + finding.text);
}

// Accept: the tool's dialog, with the finding's sentence and one line for why.
export function acceptWithReason(env, finding, opener) {
  const { ctx } = env;
  const id = uid('reason');
  const input = h('input', { class: 'field__input', id, type: 'text', name: 'acceptReason', autocomplete: 'off', maxlength: '200' });
  const refusal = h('p', { class: 'field__refusal', id: id + '-refusal', hidden: true }, 'Say why in a few words, so the next person knows.');
  const dialog = ctx.openDialog({
    id: 'accept-dialog',
    title: 'Accept this ' + finding.severity + '?',
    opener,
    body: [
      h('p', null, finding.text),
      h('p', null, 'An accepted finding leaves the counts and waits in the Accepted list, where it can be brought back.'),
      h('div', { class: 'field' }, h('label', { class: 'field__label', for: id }, 'Why it is all right, in one line'), input, refusal),
    ],
    buttons: [
      { label: 'Accept this ' + finding.severity, value: 'accept', kind: 'primary' },
      { label: 'Leave it in the list', value: null },
    ],
  });
  const acceptButton = dialog.element.querySelector('.dialog__buttons .btn--primary');
  function ready() {
    if (input.value.trim() !== '') return true;
    refusal.hidden = false;
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', id + '-refusal');
    input.focus();
    return false;
  }
  // before the button's own listener, so an empty reason keeps the dialog open
  dialog.element.addEventListener('click', (event) => {
    if (event.target === acceptButton && !ready()) event.stopImmediatePropagation();
  }, true);
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (ready()) dialog.close('accept');
  });
  input.focus();
  return dialog.closed.then((value) => {
    if (value !== 'accept') return false;
    if (!apply(env, acceptFinding, { findingId: finding.id, reason: input.value.trim(), about: finding.about })) return false;
    ctx.toast({ text: 'Accepted. It is in the Accepted list on the Checks tab.', action: { label: 'Undo', run: ctx.undo } });
    return true;
  });
}

function severityWord(severity) {
  return h('span', { class: 'sch-mark sch-mark--' + severity }, h('span', { 'aria-hidden': 'true' }, SEVERITY_WORDS[severity].glyph + ' '), severity.charAt(0).toUpperCase() + severity.slice(1));
}

function actions(env, finding, where) {
  const key = where + ':' + finding.id + ':';
  return h('div', { class: 'sch-finding__actions' },
    button('Show', () => showFinding(env, finding), { small: true, key: key + 'show', action: 'show', more: ': ' + finding.text }),
    // not built yet: the reason is the button's title, which a finger and a
    // keyboard never see, so a press says it
    notYet('Fix…', FIX_REASON, 'fix', () => env.ctx.toast({ text: FIX_REASON + '.' })),
    button('Accept', (opener) => acceptWithReason(env, finding, opener), { small: true, key: key + 'accept', action: 'accept', more: ': ' + finding.text }));
}

export function countsLine(model) {
  return h('p', { class: 'sch-counts', data: { problem: String(model.counts.problem), warning: String(model.counts.warning), note: String(model.counts.note) } },
    SEVERITIES.map((severity) => severityMark(severity, model.counts[severity])));
}

// ---------------------------------------------------------------- the panel

// The inspector: the counts always, and the findings for whatever is
// selected (the group being edited), or for the whole schedule. Beside the
// Checks tab, whose table is that list already, it is the counts and the one
// finding selected there: the same four findings twice on one screen helped
// nobody. On a phone whose Groups tab is showing its list alone, it says to
// choose a group.
export function findingsPanel(env) {
  const element = h('div', { class: 'sch-panel' });
  function finding(each) {
    return h('li', { class: 'sch-finding sch-finding--' + each.severity, data: { finding: each.id } },
      h('p', { class: 'sch-finding__text' }, severityWord(each.severity), ' ', each.text),
      actions(env, each, 'panel'));
  }
  function drawForChecks(model) {
    const selected = model.findings.find((each) => each.id === env.view.findingId) || null;
    // the list is beside the panel on a wide screen, and above its sheet on a narrow one
    const where = window.matchMedia(SHEET).matches ? 'above' : 'on the left';
    element.dataset.where = where;
    fill(element,
      h('h2', { class: 'sch-panel__title' }, 'Findings'),
      countsLine(model),
      h('h3', { class: 'sch-panel__scope' }, selected ? 'The finding selected' : 'No finding selected'),
      selected ? h('ul', { class: 'sch-panel__list' }, finding(selected)) : null,
      h('p', { class: 'sch-panel__more', data: { note: 'list' } }, model.findings.length === 0 ? 'Nothing found.' : 'Every finding is in the list ' + where + '.' + (selected ? '' : ' Select one there to see it here.')));
  }
  function draw(project) {
    const model = env.model();
    element.dataset.for = env.tab();
    if (env.tab() === 'checks') {
      drawForChecks(model);
      return;
    }
    if (env.tab() === 'groups' && project.groups.length > 0 && choosingGroup(env.view)) {
      fill(element,
        h('h2', { class: 'sch-panel__title' }, 'Findings'),
        countsLine(model),
        h('h3', { class: 'sch-panel__scope' }, 'Choose a group'),
        h('p', { class: 'sch-panel__none' }, 'Choose a group in the list, and what was found about it shows here.'),
        h('p', { class: 'sch-panel__more' }, h('a', { href: '#schedule/checks' }, 'See every finding in Checks')));
      return;
    }
    const group = env.tab() === 'groups' ? project.groups.find((candidate) => candidate.id === env.view.groupId) : null;
    const scope = group ? model.byGroup.get(group.id) || [] : model.findings;
    const shown = scope.slice(0, PANEL_LIMIT);
    fill(element, 
      h('h2', { class: 'sch-panel__title' }, 'Findings'),
      countsLine(model),
      h('h3', { class: 'sch-panel__scope' }, group ? 'About ' + group.name : 'In the whole schedule'),
      scope.length === 0
        ? h('p', { class: 'sch-panel__none' }, group ? 'Nothing found about ' + group.name + '.' : project.groups.length === 0 ? 'Nothing to check yet. Add a group and the checks start.' : 'Nothing found.')
        : h('ul', { class: 'sch-panel__list' }, shown.map(finding)),
      scope.length > shown.length ? h('p', { class: 'sch-panel__more' }, 'And ' + (scope.length - shown.length) + ' more. ') : null,
      h('p', { class: 'sch-panel__more' }, h('a', { href: '#schedule/checks' }, 'See every finding in Checks')));
  }

  draw(env.ctx.store.project);
  return { element, update: draw };
}

// ---------------------------------------------------------------- the tab

function when(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function mount(env) {
  const { ctx } = env;
  const element = h('div', { class: 'sch-checks' });
  // A finding is selected by a click or a tap on its row, or by the focus
  // coming to one of its buttons. The inspector shows the one selected.
  function selectRow(row) {
    if (!row || env.view.findingId === row.dataset.finding) return;
    env.view.findingId = row.dataset.finding;
    for (const each of row.parentNode.children) mark(each, each === row);
    env.inspect();
  }
  // The selected row says so to the eye (schedule.css reads data-selected)
  // and to a screen reader (aria-current).
  function mark(row, selected) {
    if (selected) {
      row.dataset.selected = 'true';
      row.setAttribute('aria-current', 'true');
    } else {
      delete row.dataset.selected;
      row.removeAttribute('aria-current');
    }
  }
  const rowOf = (event) => (event.target.closest ? event.target.closest('.sch-findings:not(.sch-findings--accepted) tbody tr[data-finding]') : null);
  element.addEventListener('click', (event) => selectRow(rowOf(event)));
  element.addEventListener('focusin', (event) => selectRow(rowOf(event)));

  function stop(findingId) {
    if (apply(env, unacceptFinding, { findingId })) ctx.toast({ text: 'It counts again.', action: { label: 'Undo', run: ctx.undo } });
  }

  function acceptedTable(model, project) {
    const words = periodWords(project.settings);
    if (model.accepted.length + model.changed.length + model.off.length + model.gone.length === 0) return h('p', { class: 'sch-hint' }, 'Nothing has been accepted. Accept a finding and it waits here with its reason.');
    return h('div', { class: 'sch-scroll' }, h('table', { class: 'table sch-findings sch-findings--accepted' },
      h('caption', { class: 'vh' }, 'Accepted findings'),
      h('thead', null, h('tr', null, ['What was noticed', 'Why it is all right', 'Accepted'].map((label) => h('th', { scope: 'col' }, label)), h('th', { scope: 'col' }, h('span', { class: 'vh' }, 'Bring back')))),
      h('tbody', null,
        model.accepted.map((finding) => h('tr', { data: { finding: finding.id } },
          h('td', null, severityWord(finding.severity), ' ', finding.text),
          h('td', null, finding.accepted.reason),
          h('td', null, when(finding.accepted.at)),
          h('td', null, button('Count it again', () => stop(finding.id), { small: true, key: 'accepted:' + finding.id, action: 'unaccept', more: ': ' + finding.text })))),
        // back in the findings above and counting: the record is kept so its
        // reason is not lost, and "Count it again" takes the record away
        model.changed.map(({ record, finding }) => h('tr', { class: 'sch-findings__changed', data: { finding: record.findingId, state: 'changed' } },
          h('td', null, h('strong', null, 'Changed since accepted.'), ' It no longer names who it named then, so it is in the findings again.', finding ? [' ', severityWord(finding.severity), ' ', finding.text] : null),
          h('td', null, record.reason),
          h('td', null, when(record.at)),
          h('td', null, button('Count it again', () => stop(record.findingId), { small: true, key: 'accepted:' + record.findingId, action: 'unaccept', more: finding ? ': ' + finding.text : ': the changed finding with the reason: ' + record.reason })))),
        model.off.map(({ record, kind }) => h('tr', { class: 'sch-findings__off', data: { finding: record.findingId, state: 'off' } },
          h('td', null, 'Its check is switched off: ' + checkLabel(kind, words) + '. The reason is kept in case the check is switched on again.'),
          h('td', null, record.reason),
          h('td', null, when(record.at)),
          h('td', null, button('Remove', () => stop(record.findingId), { small: true, key: 'accepted:' + record.findingId, action: 'unaccept', more: ' the accepted finding with the reason: ' + record.reason })))),
        model.gone.map((record) => h('tr', { class: 'sch-findings__gone', data: { finding: record.findingId, state: 'gone' } },
          h('td', null, 'No longer found. What this was about has been put right.'),
          h('td', null, record.reason),
          h('td', null, when(record.at)),
          h('td', null, button('Remove', () => stop(record.findingId), { small: true, key: 'accepted:' + record.findingId, action: 'unaccept', more: ' the accepted finding with the reason: ' + record.reason })))))));
  }

  function draw(project) {
    const model = env.model();
    if (!model.findings.some((finding) => finding.id === env.view.findingId)) env.view.findingId = null;
    const nothing = model.findings.length + model.accepted.length + model.changed.length + model.off.length + model.gone.length === 0;
    if (nothing && project.groups.length === 0) {
      fill(element, emptyState('Nothing to check yet. ' + WHAT, h('a', { class: 'btn btn--primary', href: '#schedule/groups', data: { action: 'go-groups' } }, 'Add a group')));
      return;
    }
    fill(element, 
      h('p', { class: 'sch-lead' }, WHAT + ' Each finding says what was noticed and offers to show it.'),
      h('div', { class: 'sch-toolbar' },
        countsLine(model),
        keyed(printButton(ctx, printButtons.find((entry) => entry.output === 'checks')), 'checks-print')),
      model.walksKnown ? null : h('p', { class: 'sch-hint', data: { note: 'walks' } }, 'Walking times are worked out by the movement view. Until it has run, the two checks on walks that do not fit the passing time find nothing.'),
      model.findings.length === 0
        ? h('p', { class: 'sch-checks__none' }, 'Nothing found. ' + count(project.groups.length, 'group') + ' checked on every day type.')
        : h('div', { class: 'sch-scroll' }, h('table', { class: 'table sch-findings' },
          h('caption', { class: 'vh' }, 'Findings'),
          h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Severity'), h('th', { scope: 'col' }, 'What was noticed', h('span', { class: 'vh' }, ', with Show, Fix and Accept')))),
          // the buttons are in the sentence's cell: beside it while there is
          // room, under it when there is not (a phone)
          h('tbody', null, model.findings.map((finding) => {
            const row = h('tr', { data: { finding: finding.id, severity: finding.severity } },
              h('td', null, severityWord(finding.severity)),
              h('td', null, h('div', { class: 'sch-finding__cell' }, h('p', { class: 'sch-finding__what' }, finding.text), actions(env, finding, 'tab'))));
            mark(row, finding.id === env.view.findingId);
            return row;
          })))),
      h('h2', { class: 'sch-checks__heading' }, 'Accepted'),
      acceptedTable(model, project));
  }

  draw(ctx.store.project);
  return { element, update: draw };
}
