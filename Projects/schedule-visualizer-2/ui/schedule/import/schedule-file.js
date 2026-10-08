// The schedule from a schedule file: the JSON file "Schedule file" under
// Export writes, with the subjects, teachers, groups, day types and bell
// times of a project and none of its building. The file is read and checked
// in full (engine/project-file.js readScheduleFile) before anything is
// offered; groups whose names are already here are answered for as they are
// for a CSV.

import { h } from '../../components/dom.js';
import { count, list, periodWords } from '../../components/words.js';
import { readScheduleFile } from '../../../engine/project-file.js';
import { summaryText } from '../../../engine/import-groups.js';
import { nameKey } from '../../../engine/schema.js';
import { importSchedule } from '../../../engine/actions.js';
import { button, keyed, quote } from '../common.js';
import { panel, fileButton, clashChooser, newPolicy, runImport, doneLine, refusal } from './parts.js';

// What an import of a schedule file did, beyond its groups.
function alsoText(outcome, words) {
  const parts = [];
  if (outcome.subjectsAdded.length > 0) parts.push(count(outcome.subjectsAdded.length, 'subject') + ' added');
  if (outcome.teachersAdded.length > 0) parts.push(count(outcome.teachersAdded.length, 'teacher') + ' added');
  if (outcome.dayTypesAdded.length > 0) parts.push(count(outcome.dayTypesAdded.length, 'day type') + ' added');
  if (outcome.periodsRaised) parts.push('the day made ' + outcome.periodsRaised.to + ' ' + words.many + ' long');
  if (outcome.unknownRooms.length > 0) parts.push(count(outcome.unknownRooms.length, 'room number') + ' kept as text because ' + (outcome.unknownRooms.length === 1 ? 'it is' : 'they are') + ' not in the building');
  return parts.length === 0 ? '' : ' Also: ' + list(parts) + '.';
}

export function schedulePanel(env, state) {
  const { ctx } = env;

  function take(fileName, text) {
    state.done.schedule = null;
    try {
      const read = readScheduleFile(text);
      state.refused.schedule = null;
      state.schedule = { fileName, file: read.file, summary: read.summary, policy: newPolicy(), takeSettings: false };
      ctx.announce('Read ' + fileName + '. Nothing changes until you import.');
    } catch (error) {
      state.schedule = null;
      state.refused.schedule = quote(fileName) + ' was not imported, and nothing has changed. ' + (error && error.message ? error.message : '');
      ctx.announce(state.refused.schedule);
    }
    env.render('imp-schedule-choose');
  }

  function refuse(fileName, error) {
    state.schedule = null;
    state.refused.schedule = quote(fileName) + ' could not be read. ' + (error && error.message ? error.message : '');
    ctx.announce(state.refused.schedule);
    env.render('imp-schedule-choose');
  }

  function putAway() {
    state.schedule = null;
    env.render('imp-schedule-choose');
  }

  async function run(opener) {
    const loaded = state.schedule;
    opener.disabled = true;
    const result = await runImport(ctx, importSchedule, { file: loaded.file, policy: loaded.policy, takeSettings: loaded.takeSettings });
    if (!result) {
      opener.disabled = false;
      return;
    }
    const words = periodWords(ctx.store.project.settings);
    const said = result.changed ? summaryText(result.outcome) + '.' + alsoText(result.outcome, words) : 'nothing changed.';
    state.done.schedule = { text: 'Imported ' + quote(loaded.fileName) + ': ' + said + (result.changed ? ' Undo takes the whole import back in one step.' : ''), link: { href: '#schedule/groups', label: 'See the groups' } };
    state.schedule = null;
    ctx.toast({ text: 'Imported the schedule file: ' + (result.changed ? summaryText(result.outcome) : 'nothing changed') + '.', action: result.changed ? { label: 'Undo', run: ctx.undo } : null });
    env.render('imp-schedule-choose');
  }

  function draw(project) {
    const loaded = state.schedule;
    const choose = (label) => fileButton({ label, accept: '.json,application/json', key: 'imp-schedule-choose', kind: 'schedule', onText: take, onError: refuse });
    if (!loaded) {
      return panel('schedule', 'The schedule from a schedule file',
        h('p', { class: 'sch-lead' }, 'A schedule file is the schedule of a project without its building: subjects, teachers, groups, day types and bell times. It comes from "Schedule file" under Export, below, here or on a colleague\'s device.'),
        h('div', { class: 'sch-toolbar' }, choose('Choose a schedule file…')),
        refusal('schedule', state.refused.schedule),
        doneLine('schedule', state.done.schedule));
    }
    const words = periodWords(project.settings);
    const s = loaded.summary;
    const here = new Set(project.groups.map((group) => nameKey(group.name)));
    const clashes = loaded.file.groups.filter((group) => here.has(nameKey(group.name))).map((group) => ({ key: nameKey(group.name), name: group.name }));
    const settings = keyed(h('input', { type: 'checkbox' }), 'imp-schedule-settings');
    settings.checked = loaded.takeSettings;
    settings.addEventListener('change', () => {
      loaded.takeSettings = settings.checked;
    });
    return panel('schedule', 'The schedule from a schedule file',
      h('p', { class: 'sch-lead', data: { file: 'schedule' } }, quote(loaded.fileName) + ' holds ' + list([count(s.groups, 'group'), count(s.teachers, 'teacher'), count(s.subjects, 'subject'), count(s.dayTypes, 'day type')])
        + ', for a day of ' + s.periods + ' ' + (s.periods === 1 ? words.one : words.many) + '. Nothing changes until you import.'),
      h('p', { class: 'sch-hint' }, 'A subject, teacher or day type already here is left as it is, and one that is not is added. Rooms are matched to this building by number. A bell time already entered here is never changed.'
        + (s.periods > project.settings.periods ? ' The day here has ' + project.settings.periods + ' ' + words.many + '; it would be made ' + s.periods + ' long.' : '')),
      clashes.length > 0 ? clashChooser('imp-schedule', clashes, loaded.policy, (key) => env.render(key)) : null,
      h('label', { class: 'imp-check' }, settings, h('span', null, 'Also take the ' + words.one + ' word, the default passing time and the default head count from the file')),
      h('div', { class: 'sch-toolbar imp-go' },
        button('Import the schedule', run, { primary: true, key: 'imp-schedule-run', action: 'import-schedule' }),
        choose('Choose another file…'),
        button('Put the file away', putAway, { key: 'imp-schedule-away', action: 'put-away' })));
  }

  return { draw };
}
