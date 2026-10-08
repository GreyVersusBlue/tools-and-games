// The Schedule section. This is the stub: its six sub-tabs with their
// addresses (#schedule/groups and the rest), each saying what the thing is and
// what the project holds. The editors replace the panels.

import { h } from '../components/dom.js';
import { intro, NOT_BUILT } from '../components/card.js';
import { tabs } from '../components/tabs.js';
import { count, list, periodWords } from '../components/words.js';
import { isOwnCopy } from '../../engine/day-types.js';

export const SCHEDULE_TABS = [
  { id: 'groups', label: 'Groups' },
  { id: 'grid', label: 'Grid' },
  { id: 'teachers', label: 'Teachers' },
  { id: 'subjects', label: 'Subjects' },
  { id: 'day', label: 'Day' },
  { id: 'checks', label: 'Checks' },
];

function sentences(project, id) {
  const words = periodWords(project.settings);
  if (id === 'groups') {
    return ['A group is a set of students who travel together all day. Each has a name, and a room for every ' + words.one + '.',
      project.groups.length === 0 ? 'No groups yet.' : 'This project has ' + count(project.groups.length, 'group') + ': ' + list(project.groups.map((group) => group.name)) + '.'];
  }
  if (id === 'grid') {
    return ['The grid shows every group against every ' + words.one + ', like a spreadsheet. Type room numbers straight in, or paste a block from a spreadsheet.',
      'Changes in the grid are staged: nothing happens to the schedule until you apply them.'];
  }
  if (id === 'teachers') {
    return ['A teacher is a named member of staff, with a subject and one or more rooms.',
      project.teachers.length === 0 ? 'No teachers yet.' : 'This project has ' + count(project.teachers.length, 'teacher') + '.'];
  }
  if (id === 'subjects') {
    return ['A subject is a department. It has a code, a name and a colour, and the colour is how its rooms are drawn.',
      'This project has ' + count(project.subjects.length, 'subject') + (project.subjects.length > 0 ? ': ' + list(project.subjects.map((subject) => subject.name)) + '.' : '.')];
  }
  if (id === 'day') {
    return ['The day is ' + count(project.settings.periods, words.one, words.many) + ' long. A day type is a named pattern of the day, with its own bell times.',
      'Day types: ' + list(project.dayTypes.map((dayType, index) => dayType.name + (index > 0 && !isOwnCopy(project, dayType.id) ? ' (same as ' + project.dayTypes[0].name + ')' : ''))) + '.'];
  }
  return ['Checks look through the schedule for problems, warnings and notes: two groups in one room, a teacher in two places, a walk too long for the passing time.',
    'Each finding says what was noticed and offers to show it.'];
}

export const section = {
  id: 'schedule',
  label: 'Schedule',
  name: 'Schedule',
  key: '2',
  icon: 'schedule',
  mount(ctx, rest) {
    const wanted = SCHEDULE_TABS.some((tab) => tab.id === rest) ? rest : 'groups';
    const strip = tabs({
      label: 'Parts of the schedule',
      selected: wanted,
      onSelect: (id) => ctx.navigate('#schedule/' + id),
      items: SCHEDULE_TABS.map((tab) => ({
        id: tab.id,
        label: tab.label,
        panel: () => h('div', { class: 'stub__panel', data: { tab: tab.id } }, sentences(ctx.store.project, tab.id).map((text) => h('p', null, text))),
      })),
    });
    const element = h('div', { class: 'stub' },
      intro({
        headline: 'This is the schedule.',
        first: 'It says which room each group is in, ' + periodWords(ctx.store.project.settings).one + ' by ' + periodWords(ctx.store.project.settings).one + '. Add teachers, then groups.',
        note: NOT_BUILT,
      }),
      strip.element,
    );
    return {
      element,
      update() {
        strip.refresh();
      },
      // the same section, another tab
      route(next) {
        strip.select(SCHEDULE_TABS.some((tab) => tab.id === next) ? next : 'groups');
        return true;
      },
    };
  },
};
