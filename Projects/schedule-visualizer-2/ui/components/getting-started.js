// The Getting started card (DESIGN 5.0): the five steps of a new project as a
// checklist, each a link to its screen and ticked when the project has what
// the step needs. "Dismiss" hides it for this project, "Don't show this again"
// says never, and Help brings it back.
//
// Under 1000 px the card lies above the section, and is folded to its title
// and tally so the section keeps the window: "Show the steps" unfolds it
// (ui/app.css; at full width the steps always show and the button is away).

import { h, uid } from './dom.js';
import { icon } from './icons.js';
import { progress, showGettingStarted } from '../help/progress.js';
import { setOnboarding } from '../../engine/actions.js';
import { SAMPLE_PROJECT_ID } from '../../data/sample-school.js';

export function gettingStarted(ctx) {
  const titleId = uid('getting-started');
  const list = h('ol', { class: 'steps' });
  const tally = h('p', { class: 'getting-started__tally' });
  const sampleLine = h('p', { class: 'getting-started__sample' });
  const sampleButton = h('button', { type: 'button', class: 'btn', data: { action: 'load-sample' }, on: { click: () => ctx.loadSample(sampleButton) } }, 'Load the sample school');

  const bodyId = uid('getting-started-steps');
  const toggle = h('button', { type: 'button', class: 'btn btn--quiet getting-started__toggle', 'aria-expanded': 'false', 'aria-controls': bodyId, data: { action: 'steps' }, on: { click: () => unfold(!open) } }, 'Show the steps');
  let open = false;

  const element = h('section', { class: 'getting-started', 'aria-labelledby': titleId, id: 'getting-started' },
    h('div', { class: 'getting-started__head' },
      h('div', { class: 'getting-started__words' },
        h('p', { class: 'eyebrow' }, 'A new project in five steps'),
        h('h2', { class: 'card__title', id: titleId }, 'Getting started'),
        tally),
      toggle),
    h('div', { class: 'getting-started__body', id: bodyId },
      list,
      h('div', { class: 'getting-started__sample-row' }, sampleLine, sampleButton),
      h('div', { class: 'getting-started__buttons' },
        h('button', { type: 'button', class: 'btn btn--quiet', data: { action: 'dismiss' }, on: { click: () => hide({ dismissed: true }) } }, 'Dismiss'),
        h('button', { type: 'button', class: 'btn btn--quiet', data: { action: 'never' }, on: { click: () => hide({ neverShow: true }) } }, 'Don’t show this again'),
      )),
  );

  // A step that is chosen is where the work is now: the steps fold away
  // again, so on a narrow window the section they lead to is not under them.
  list.addEventListener('click', (event) => {
    if (event.target.closest && event.target.closest('a')) unfold(false);
  });

  // Folded or not only matters where the stylesheet folds it (under 1000 px).
  function unfold(next) {
    open = next;
    element.classList.toggle('getting-started--open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.textContent = open ? 'Hide the steps' : 'Show the steps';
  }

  function hide(payload) {
    ctx.store.apply(setOnboarding, payload);
    ctx.toast({ text: 'Getting started is hidden. Help brings it back.' });
    ctx.focusSurface();
  }

  function update(project) {
    element.hidden = !showGettingStarted(project);
    if (element.hidden) return;
    const steps = progress(project);
    const done = steps.filter((step) => step.done).length;
    tally.textContent = done === steps.length ? 'All five are done.' : done + ' of ' + steps.length + ' done.';
    list.replaceChildren(...steps.map((step) => h('li', { class: 'steps__step' + (step.done ? ' steps__step--done' : ''), data: { step: step.id, done: String(step.done) } },
      h('span', { class: 'steps__box', 'aria-hidden': 'true' }, step.done ? icon('check', 14) : null),
      h('span', { class: 'steps__text' },
        h('a', { href: step.hash }, step.label),
        h('span', { class: 'steps__where' }, step.where),
        h('span', { class: 'vh' }, step.done ? ', done' : ', not done yet'),
      ),
    )));
    const isSample = project.id === SAMPLE_PROJECT_ID;
    sampleLine.textContent = isSample ? 'This is the sample school, so most of it is already done. Look around.' : 'Or load the sample school to look around.';
    sampleButton.hidden = isSample;
  }

  return { element, update, unfold };
}
