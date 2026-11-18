// New game (DESIGN 4.2): two choices on one paper, then Begin.
//   How long?  Three acts (default) or every year. The second is shown, disabled, "Coming later".
//   Which house?  Each house from houses.json, with its seal mark, name, blurb and a difficulty word.
import { h } from '../dom.js';

const DIFFICULTY = { 1: 'Easier', 2: 'Middle', 3: 'Harder' };

/** The body of the panel. onBegin({ length, house }) and onCancel() are called by the buttons. */
export function newGameBody({ content, onBegin, onCancel }) {
  const houses = content.houses ?? [];
  let length = 'acts', house = houses[0]?.id;
  const radio = (name, value, checked, disabled, ...kids) => {
    const id = `${name}-${value}`;
    const input = h('input', { type: 'radio', name, id, value, checked, disabled,
      onchange: () => { if (name === 'length') length = value; else house = value; } });
    return h('div', { class: `option ${disabled ? 'is-disabled' : ''}` }, input, h('label', { for: id }, ...kids));
  };
  const fullYears = content.calendar?.lengths?.full;
  return [
    h('fieldset', { class: 'how-long' },
      h('legend', null, 'How long?'),
      radio('length', 'acts', true, false, h('strong', null, 'Three acts'), ' (about 30 minutes)'),
      radio('length', 'full', false, true, h('strong', null, 'Every year, 1324 to 1347'), ' (several sittings)',
        h('span', { class: 'soon' }, fullYears ? 'Coming later' : 'Coming later'))),
    h('fieldset', { class: 'which-house' },
      h('legend', null, 'Which house?'),
      houses.map((x, i) => radio('house', x.id, i === 0, false,
        h('span', { class: 'seal seal-plain', 'aria-hidden': 'true' }),
        h('span', { class: 'house-text' },
          h('strong', null, x.name), ' ', h('span', { class: 'difficulty' }, DIFFICULTY[x.difficulty] ?? ''),
          h('span', { class: 'blurb' }, x.blurb))))),
    h('div', { class: 'panel-actions' },
      h('button', { class: 'button', type: 'button', id: 'newgame-cancel', onclick: onCancel }, 'Cancel'),
      h('button', { class: 'button primary', type: 'button', id: 'newgame-begin', onclick: () => onBegin({ length, house }) }, 'Begin')),
  ];
}
