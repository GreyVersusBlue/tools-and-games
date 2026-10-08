// The Checks tab: what the building checks found (spec 4.9), worst first,
// each with a "Show me" that brings the place onto the plan and marks it,
// on whatever floor it is.

import { h } from '../../components/dom.js';
import { count, list } from '../../components/words.js';
import { buildingChecks } from '../../../engine/building-checks.js';
import { keepFocus } from './controls.js';

const ORDER = { problem: 0, warning: 1, note: 2 };
const WORDS = { problem: 'Problem', warning: 'Warning', note: 'Note' };

// The findings of the building as the store has them now.
export function buildingFindings(store) {
  return store.derived.get('building:checks', ['building'], (project) => buildingChecks(project));
}

function summary(findings) {
  if (findings.length === 0) return 'The building checks found nothing wrong.';
  const parts = [];
  for (const severity of ['problem', 'warning', 'note']) {
    const n = findings.filter((finding) => finding.severity === severity).length;
    if (n > 0) parts.push(count(n, severity));
  }
  return 'The building checks found ' + list(parts) + '.';
}

// checksPanel(env) -> { element, update(state) }
export function checksPanel(env) {
  const lead = h('p', { id: 'checks-lead' });
  const rows = h('ul', { class: 'bi-findings', id: 'building-findings', 'aria-label': 'What the building checks found' });
  const element = h('div', { class: 'bld-inspector__panel', id: 'inspector-checks' },
    h('h2', { class: 'bld-inspector__title' }, 'Building checks'),
    lead,
    rows,
    h('p', { class: 'bld-inspector__small' }, 'The checks run again after every change. The number on a floor\'s tab counts the problems on that floor.'),
  );
  let shown = null;

  function update(state) {
    const floors = state.project.building.floors;
    const findings = buildingFindings(env.store).slice().sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
    const key = findings.map((finding) => finding.id + finding.text).join('|');
    if (key === shown) return;
    shown = key;
    lead.textContent = summary(findings);
    rows.hidden = findings.length === 0;
    keepFocus(rows, () => rows.replaceChildren(...findings.map((finding) => {
      const floor = finding.where && floors.find((each) => each.id === finding.where.floorId);
      return h('li', { class: 'bi-finding bi-finding--' + finding.severity, data: { finding: finding.id, kind: finding.kind } },
        h('p', { class: 'bi-finding__text' }, h('strong', { class: 'bi-finding__severity' }, WORDS[finding.severity] + ': '), finding.text),
        floor ? h('button', {
          type: 'button',
          class: 'btn bi-small',
          data: { key: 'show:' + finding.id, action: 'show' },
          'aria-label': 'Show me: ' + finding.text,
          on: { click: () => env.show(finding.where, 'On ' + floor.name + ': ' + finding.text) },
        }, 'Show me') : null);
    })));
  }

  return { element, update };
}
