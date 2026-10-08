// A choice between a few named things, shown as a row of joined buttons. It is
// a group of radio buttons, so the arrow keys move the choice and Tab passes
// through it once.
//
// choice({ name, labelledBy, describedBy, options: [{ value, label }], value, onChange })
// returns { element, set(value) }

import { h } from './dom.js';

export function choice(options) {
  const inputs = options.options.map((option) => {
    const input = h('input', { type: 'radio', class: 'seg__input', name: options.name, value: option.value });
    input.checked = option.value === options.value;
    input.addEventListener('change', () => {
      if (input.checked) options.onChange(option.value);
    });
    return input;
  });
  const element = h('div', { class: 'seg', role: 'radiogroup', 'aria-labelledby': options.labelledBy, 'aria-describedby': options.describedBy },
    options.options.map((option, index) => h('label', { class: 'seg__option' }, inputs[index], h('span', { class: 'seg__label' }, option.label))));
  return {
    element,
    set(value) {
      inputs.forEach((input) => {
        input.checked = input.value === value;
      });
    },
  };
}
