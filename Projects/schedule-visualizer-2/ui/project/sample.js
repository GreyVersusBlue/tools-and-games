// The Sample school card: one click loads a complete invented school, it is
// labelled as a sample wherever it shows, and one click removes it.

import { h } from '../components/dom.js';
import { card } from '../components/card.js';
import { count, figures, list } from '../components/words.js';
import { SAMPLE_PROJECT_ID } from '../../data/sample-school.js';

export function sampleCard(ctx) {
  const lead = h('p', { class: 'card__lead' });
  const detail = h('p');
  const button = h('button', { type: 'button', class: 'btn', data: { action: 'sample' } });
  button.addEventListener('click', () => {
    if (ctx.store.project.id === SAMPLE_PROJECT_ID) ctx.removeSample(button);
    else ctx.loadSample(button);
  });
  const element = card({ id: 'sample-school', title: 'Sample school' }, lead, detail, h('div', { class: 'card__buttons' }, button));

  function update(project) {
    const isSample = project.id === SAMPLE_PROJECT_ID;
    element.dataset.sample = String(isSample);
    if (isSample) {
      const f = figures(project);
      lead.textContent = 'You are looking at the sample school. It is invented: no real school, teacher or student is in it.';
      detail.textContent = 'It has ' + list([count(f.floors, 'floor'), count(f.rooms, 'room'), count(f.teachers, 'teacher'), count(f.groups, 'group'), count(f.dayTypes, 'day type'), count(f.exits, 'exit')])
        + ', and two deliberate problems for you to find. Change anything you like. Removing it leaves an empty project to start your own school in.';
      button.textContent = 'Remove the sample school';
    } else {
      lead.textContent = 'A complete invented school, so every part of the tool can be explored in the first minute.';
      detail.textContent = 'Three floors, thirteen rooms, twelve teachers, eight groups, an A Day and a B Day with bell times, two exits, and two deliberate problems to find. It replaces what is in this project now.';
      button.textContent = 'Load the sample school';
    }
  }

  update(ctx.store.project);
  return { element, update };
}
