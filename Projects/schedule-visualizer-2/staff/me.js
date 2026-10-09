// #/me  My schedule
//
// Choose yourself once. From then on this is your own page: your day, with
// your notes on it, and the file opens here when it is opened with no address
// (the shell moves an empty address to the chosen teacher's page). Who you
// are is kept on this device only, under sv2staff:<schoolId>:me, so a newer
// file of the same school still knows; staff/notes.js reads and writes it.

import { h, typed } from './dom.js';
import { pageOf } from './page.js';
import { ME_KEY, meOf, chooseMe } from './notes.js';
import { teacherPageOf } from './views/teacher.js';

export const ME_CHOOSE_SENTENCE = 'Choose yourself once, and this file opens on your page from then on.';

export const meView = {
  id: 'me',
  flag: 'teacher',
  nav: 'me',
  title(ctx, route) {
    return 'My schedule';
  },
  render(ctx, route) {
    const school = ctx.school;
    const me = meOf(ctx);
    if (me) return teacherPageOf(ctx, me, 'My schedule');

    const gone = Boolean(ctx.store.get(ME_KEY));
    const says = h('p', { class: 'field__says', id: 'me-says', role: 'alert' });
    const who = h('select', { class: 'field__input', id: 'me-who', 'aria-describedby': 'me-says' },
      h('option', { value: '' }, 'Choose your name…'),
      school.teachers.map((teacher) => h('option', { value: teacher.id }, teacher.name)));
    const choose = h('button', { class: 'btn btn--primary', type: 'button', dataset: { me: 'choose' }, onclick: () => {
      if (!school.teacher(who.value)) {
        says.textContent = 'Choose your name first.';
        who.focus();
        return;
      }
      chooseMe(ctx, who.value);
      ctx.redraw();
      const heading = document.querySelector('.page__title');
      if (heading) heading.focus();
    } }, 'This is me');

    return pageOf('My schedule', ME_CHOOSE_SENTENCE,
      gone ? h('p', { dataset: { me: 'gone' } }, 'The teacher chosen on this device is not in this copy of the schedule. Choose again, or open a newer copy.') : null,
      school.teachers.length === 0
        ? h('p', { class: 'muted' }, 'This schedule has no teachers to choose from.')
        : h('div', { class: 'controls' },
          h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'me-who' }, 'Who are you?'), who, says),
          h('p', { class: 'actions' }, choose)),
      h('p', { class: 'muted' }, 'The choice is kept on this device only. Nothing is sent anywhere.'));
  },
};
