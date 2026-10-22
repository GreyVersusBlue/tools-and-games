// The Groups tab: the list of groups on the left, and on the right the group
// editor, with the day types side by side and one row per period.
//
// The list is a listbox and one Tab stop: the arrow keys, Home and End move
// through the groups, Enter or Space chooses the one the focus is on, and so
// does a click. (A button for each group made a school of 40 groups 40 Tab
// stops before the editor.)
//
// On a phone (under 640 px, NARROW) the list and the editor take turns, since
// an editor under a list of every group is a screen and a half away from the
// card that was tapped: `view.folded` false shows the cards and no editor,
// and choosing a group folds the list to that group's card, with "All groups"
// to open it again and the editor straight under it. schedule.css does the
// showing and hiding; on a wider screen `folded` changes nothing. On a phone
// the two are two places with an address each (address.js), so the Back
// button goes from a group's editor to the list. The history holds a group
// once: "All groups", a Delete and an undone Add go back to the list when
// the list is the entry under the editor, and put the list's address in the
// editor's place otherwise, so Back never shows the list twice. The entry a
// Delete or an undone Add steps back from is the gone group's no longer: it
// becomes a spent list (`spentEntry`), and Forward onto it steps back again
// (ui/schedule/index.js), so Forward never lands on a group that is gone nor
// shows the list a second time. A tap on the group whose address the page is
// at (a slot's, from Show) adds nothing.

import { h, uid } from '../components/dom.js';
import { field, wholeNumber } from '../components/field.js';
import { picker } from '../components/picker.js';
import { openMenu } from '../components/menu.js';
import { icon } from '../components/icons.js';
import { count, periodWords } from '../components/words.js';
import { addGroup, editGroup, duplicateGroup, deleteGroup, setSlot, moveSlot, copyDay, makeOwnCopy } from '../../engine/actions.js';
import { effectiveSchedule, isOwnCopy, baseDayType } from '../../engine/day-types.js';
import { bellsFor, periodName, formatTime } from '../../engine/bells.js';
import { allRooms, resolveSlotRoom, GROUP_COLOUR_PRESETS, RANGES } from '../../engine/schema.js';
import { NOT_IN_BUILDING } from '../../engine/exports.js';
import { fill, apply, button, keyed, emptyState, marksFor, freeName, roomLabel, quote, collator, dragRows, grip, SEVERITY_WORDS } from './common.js';
import { slotKey } from './model.js';
import { roomPicker } from './room-picker.js';
import { GROUPS_HASH, groupHash, writtenAsList, groupOf, namesGoneGroup } from './address.js';

const WHAT = 'A group is a set of students who travel together all day.';

// Under this width the list and the editor take turns. schedule.css has the
// same number.
export const NARROW = '(max-width: 640px)';

// Is the Groups tab showing its list alone, waiting for a group to be chosen?
export function choosingGroup(view) {
  return view.folded !== true && window.matchMedia(NARROW).matches;
}

function filled(slot) {
  return slot.room !== null || slot.roomText !== '';
}

function slotIsEmpty(slot) {
  return !filled(slot) && slot.label === '' && slot.teacherIds.length === 0;
}

export function matches(group, filter) {
  const wanted = filter.trim().toLowerCase();
  return wanted === '' || group.name.toLowerCase().includes(wanted) || group.grade.toLowerCase().includes(wanted);
}

// The key of the list's one Tab stop: the chosen group's card, or the first
// card the filter leaves when it hides the chosen one, or the filter box
// when it leaves none. The focus is put here when the list comes back, and
// never on a card that is not drawn.
export function listStop(project, view) {
  const visible = project.groups.filter((group) => matches(group, view.filter));
  const stop = visible.find((group) => group.id === view.groupId) || visible[0];
  return stop ? 'group:' + stop.id : project.groups.length > 0 ? 'group-filter' : 'group-add';
}

// An address of a group or of a slot, opened from wherever the page is: a
// card tapped in the list (below, `toGroup`), a finding's Show (checks.js),
// Movement's "Fix it in the schedule" (ui/movement/index.js). Opened from
// the list, its entry is marked as having the list under it, which is where
// "All groups", a Delete and an undone Add go back to (`toList`). Unmarked,
// they write the list in its place, and with the list under it that was the
// list twice (the review of SV2-56, finding 3: a Show over the list, then a
// Delete). The page already at the address makes no entry and no mark, and
// an address of the group the page is at (a slot of it, Show from its own
// editor) takes that entry's place with its mark: a second entry of one
// group would be the gone group's address over the list after a Delete.
const LIST_UNDER = 'scheduleListUnder';
const SPENT = 'scheduleSpent';
export function openAddress(ctx, hash) {
  const project = ctx.store.project;
  const here = groupOf(project, location.hash);
  const there = groupOf(project, hash);
  if (location.hash !== hash && here && there && here.id === there.id) {
    history.replaceState(history.state, '', hash);
    // the address is the page's now, and the shell shows it again
    ctx.navigate(hash);
    return;
  }
  // the list's own address only: a gone group's shows the list too (left
  // after a Delete while wide), but the entry under it is not the list
  const fromList = location.hash !== hash && writtenAsList(location.hash);
  ctx.navigate(hash);
  // the new entry is made as the address is set; the mark goes on it
  if (fromList && location.hash === hash) history.replaceState({ [LIST_UNDER]: true }, '');
}

// A group's editor put on the history, on a phone. An editor chosen from the
// list is marked as having the list under it (`openAddress`).
export function toGroup(ctx, groupId) {
  const hash = groupHash(groupId);
  if (location.hash === hash) return;
  // the address is already this group's place: a slot of it
  const here = groupOf(ctx.store.project, location.hash);
  if (here && here.id === groupId) return;
  openAddress(ctx, hash);
}

// The list's address, on a phone: back to it when it is the entry under this
// one, and in this one's place otherwise. Neither adds an entry. `gone`: the
// group of this entry has gone (a Delete, an undone Add), so the entry left
// above the list is made a spent one first, never to be landed on again.
export function toList(gone) {
  if (writtenAsList(location.hash)) return;
  if (history.state && history.state[LIST_UNDER] === true) {
    if (gone === true) history.replaceState({ [SPENT]: true }, '', GROUPS_HASH);
    history.back();
  } else {
    history.replaceState(null, '', GROUPS_HASH);
  }
}

// Is the page on an entry a gone group left (above, `toList`)? The list is
// the entry under it, and that is where the page goes.
export function spentEntry() {
  return Boolean(history.state && history.state[SPENT] === true) && writtenAsList(location.hash);
}

// The step back off a spent entry, on `popstate` and when the section is
// mounted onto one (ui/schedule/index.js): Forward onto it, or a page
// loaded onto it, goes to the list under it. True when it stepped.
export function stepOffSpent() {
  if (!spentEntry()) return false;
  history.back();
  return true;
}

// The address made what the view is, on a screen crossing to narrow (a
// phone turned upright): the chosen group's editor above the list, or the
// list. A wide screen writes no address, so the one the page is at can be
// any group's, or a group's that has gone since (a Delete or an undone Add
// while wide): that address is not the view's, and it never stays as a
// second list under the list. Gone, it becomes the chosen group's place
// with the list still under it when it was, or the list's (`toList(true)`).
export function placeView(ctx, view) {
  const project = ctx.store.project;
  const group = groupOf(project, location.hash);
  const gone = namesGoneGroup(project, location.hash);
  if (view.folded === true && view.groupId) {
    if (group && group.id === view.groupId) return;
    // another group's address (chosen while narrow, before a group was
    // chosen wide), or a gone one's, is this group's place now, with the
    // list still under it when it was: a list of its own would be the
    // list twice
    if (group || gone) history.replaceState(history.state, '', groupHash(view.groupId));
    else toGroup(ctx, view.groupId);
  } else if (gone) {
    toList(true);
  } else if (group) {
    toList();
  }
}

// What the turn upright does (ui/schedule/index.js), for the tab on screen:
// on the Groups tab the view is placed, also when the project has no groups
// left, since the last group deleted while wide has left its address above
// the list (SV2-56b: a return for no groups kept it there, and Add a group,
// All groups and Back showed the list twice).
export function placeInHistory(ctx, view, tab) {
  if (tab === 'groups') placeView(ctx, view);
}

export function mount(env) {
  const { ctx, view } = env;
  const element = h('div', { class: 'sch-groups' });
  let reveal = false;

  // Was the focus in the editor when the editor went out of sight? A phone's
  // list coming back (Back, "All groups", a window narrowed across 640 px)
  // hides the editor, and the browser takes the focus from a field that is
  // hidden without a word, or with a blur whose field is hidden by then.
  // Remembered here until the next drawing, which gives the focus to the
  // group's card instead of leaving it on the page.
  let inEditor = false;
  const editorOf = (node) => (node && node.closest ? node.closest('.sch-editor') : null);
  element.addEventListener('focusin', (event) => {
    inEditor = editorOf(event.target) !== null;
  });
  element.addEventListener('focusout', (event) => {
    if (!editorOf(event.target)) return;
    if (choosingGroup(view)) inEditor = true;
    else if (!editorOf(event.relatedTarget)) inEditor = false;
  });

  // Draw what `view` now says. On a phone the address follows it, so the
  // list and each editor are places the Back button knows; the section draws
  // again when the address has changed, to the same thing.
  function show(focusKey, gone) {
    env.render(focusKey);
    if (!window.matchMedia(NARROW).matches) return;
    if (view.folded === true && view.groupId) toGroup(ctx, view.groupId);
    else toList(gone);
  }

  // Choose a group. On a phone its card goes to the top of the screen, so
  // the editor under it starts in sight.
  function select(groupId, focusKey) {
    view.groupId = groupId;
    view.shown = null;
    view.folded = groupId !== null;
    reveal = groupId !== null;
    show(focusKey);
  }

  // The list again, on a phone. (Nothing folds it back: an address and a
  // finding's Show fold the list when they open a slot, and no drawing does.)
  function showAll() {
    view.folded = false;
    show(listStop(ctx.store.project, view));
  }

  function add() {
    const project = ctx.store.project;
    if (!apply(env, addGroup, { name: freeName(project.groups.map((group) => group.name), 'New group') })) return;
    const groups = ctx.store.project.groups;
    view.filter = '';
    select(groups[groups.length - 1].id, 'group-name');
  }

  // ------------------------------------------------------------ the list

  // The option's name for a screen reader is what is in it: the shapes and
  // the short figures are for the eye, and each has its words beside it.
  // `stop`: is this the list's one Tab stop.
  function listItem(project, model, group, selected, stop) {
    const words = periodWords(project.settings);
    const periods = project.settings.periods;
    const base = baseDayType(project);
    const seen = (text) => h('span', { 'aria-hidden': 'true' }, text);
    const said = (text) => h('span', { class: 'vh' }, text);
    const bars = project.dayTypes.map((dayType) => {
      if (!isOwnCopy(project, dayType.id)) {
        return h('span', { class: 'sch-bar sch-bar--same' }, h('span', { class: 'sch-bar__text' }, seen(dayType.name + ' = ' + base.name), said(dayType.name + ': same as ' + base.name + '. ')));
      }
      const done = effectiveSchedule(project, group.id, dayType.id).filter(filled).length;
      return h('span', { class: 'sch-bar', data: { day: dayType.id, done: String(done) } },
        h('span', { class: 'sch-bar__track' }, h('span', { class: 'sch-bar__fill', style: 'width:' + Math.round((100 * done) / periods) + '%' })),
        h('span', { class: 'sch-bar__text' }, seen(dayType.name + ' ' + done + '/' + periods), said(dayType.name + ': ' + done + ' of ' + count(periods, words.one, words.many) + ' have a room. ')));
    });
    const found = model.byGroup.get(group.id) || [];
    return keyed(h('li', {
      class: 'sch-group',
      role: 'option',
      'aria-selected': String(selected),
      tabindex: stop ? '0' : '-1',
      data: { group: group.id },
      on: { click: () => select(group.id, 'group:' + group.id) },
    },
    h('span', { class: 'sch-group__top' },
      h('span', { class: 'sch-dot', style: 'background:' + group.colour }),
      h('span', { class: 'sch-group__name' }, group.name),
      group.grade === '' ? said('. ') : h('span', { class: 'sch-group__grade' }, said(', grade '), group.grade, said('. ')),
      h('span', { class: 'sch-group__marks' }, marksFor(found))),
    h('span', { class: 'sch-group__bars' }, bars)), 'group:' + group.id);
  }

  // The list's keys. The options that count are the ones on screen: a phone
  // with the list folded shows one.
  function listKeys(list) {
    const stops = () => Array.from(list.querySelectorAll('[role="option"]'));
    const moveStop = (to) => {
      for (const each of stops()) each.tabIndex = each === to ? 0 : -1;
    };
    list.addEventListener('focusin', (event) => {
      if (event.target.getAttribute('role') === 'option') moveStop(event.target);
    });
    list.addEventListener('keydown', (event) => {
      const option = event.target;
      if (option.getAttribute('role') !== 'option' || event.ctrlKey || event.metaKey || event.altKey) return;
      const shown = stops().filter((each) => each.getClientRects().length > 0);
      const at = shown.indexOf(option);
      const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: shown.length - 1 }[event.key];
      if (to !== undefined) {
        event.preventDefault();
        const next = shown[Math.min(Math.max(to, 0), shown.length - 1)];
        if (next && next !== option) next.focus();
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        select(option.dataset.group, 'group:' + option.dataset.group);
      }
    });
  }

  // ------------------------------------------------------------ the editor

  function colourControl(group) {
    const labelId = uid('colour');
    const name = uid('swatch');
    const custom = keyed(h('input', { type: 'color', class: 'sch-colour__custom', 'aria-label': 'Another colour for ' + group.name, title: 'Another colour', value: group.colour }), 'group-colour');
    custom.addEventListener('change', () => apply(env, editGroup, { id: group.id, colour: custom.value }));
    // radio buttons: one Tab stop, and the arrow keys move through the presets
    const swatches = GROUP_COLOUR_PRESETS.map((colour, index) => {
      const radio = keyed(h('input', { type: 'radio', class: 'sch-swatch__input', name, value: colour }), 'swatch:' + index);
      radio.checked = colour.toLowerCase() === group.colour.toLowerCase();
      radio.addEventListener('change', () => {
        if (radio.checked) apply(env, editGroup, { id: group.id, colour });
      });
      return h('label', { class: 'sch-swatch', style: 'background:' + colour, title: colour }, radio, h('span', { class: 'vh' }, 'Preset ' + (index + 1) + ', ' + colour));
    });
    return h('div', { class: 'field sch-colour' },
      h('span', { class: 'field__label', id: labelId }, 'Colour'),
      h('div', { class: 'sch-colour__row' }, h('div', { class: 'sch-colour__presets', role: 'radiogroup', 'aria-labelledby': labelId }, swatches), custom));
  }

  function headFields(project, group) {
    const name = field({ label: 'Name', value: group.name, name: 'groupName', commit: (value) => {
      ctx.store.apply(editGroup, { id: group.id, name: value });
    } });
    keyed(name.input, 'group-name');
    const grade = field({ label: 'Grade', value: group.grade, name: 'groupGrade', width: '6rem', commit: (value) => {
      ctx.store.apply(editGroup, { id: group.id, grade: value });
    } });
    keyed(grade.input, 'group-grade');
    const whole = wholeNumber('A head count');
    const head = field({
      label: 'Head count',
      value: group.headCount,
      name: 'groupHeadCount',
      width: '6rem',
      inputMode: 'numeric',
      placeholder: String(project.settings.defaultHeadCount),
      format: (value) => (value === null ? '' : String(value)),
      parse: (text) => (text.trim() === '' ? null : whole(text)),
      commit: (value) => {
        ctx.store.apply(editGroup, { id: group.id, headCount: value });
      },
    });
    keyed(head.input, 'group-head');
    head.input.title = 'From ' + RANGES.headCount[0] + ' to ' + RANGES.headCount[1] + '. Left empty, the group counts as ' + project.settings.defaultHeadCount + ', the school’s usual.';
    return h('div', { class: 'sch-editor__fields' }, name.element, grade.element, head.element, colourControl(group));
  }

  function roomOptions(project, model, slot) {
    const rooms = allRooms(project).slice().sort((a, b) => collator.compare(a.number, b.number));
    const options = rooms.map((room) => {
      const subject = project.subjects.find((candidate) => candidate.id === room.subjectId);
      const found = model.byRoom.get(room.id) || [];
      const detail = [subject ? subject.code || subject.name : null, found.length > 0 ? count(found.length, 'finding') : null].filter(Boolean).join(' · ');
      const teachers = room.teacherIds.map((id) => (project.teachers.find((teacher) => teacher.id === id) || { name: '' }).name).filter((name) => name !== '').join(', ');
      return { id: room.id, number: room.number, label: roomLabel(project, room), teachers, detail };
    });
    return filled(slot) ? [{ id: null, number: '', label: 'No room', teachers: '', detail: '' }].concat(options) : options;
  }

  function slotRow(project, model, group, dayType, period, slot, bell) {
    const settings = project.settings;
    const pName = periodName(settings, period);
    const at = pName + ' on ' + dayType.name;
    const keyBase = 'slot:' + dayType.id + ':' + period + ':';
    const change = (patch) => ctx.store.apply(setSlot, { groupId: group.id, dayTypeId: dayType.id, period, slot: patch });
    const resolved = resolveSlotRoom(project, slot);
    // a room of the building as "204 — Ms. Okafor"; text that is no room, as typed
    const unknown = !resolved.room && resolved.missing && resolved.text !== '';
    const text = resolved.room ? roomLabel(project, resolved.room) : unknown ? resolved.text : '';

    const found = model.bySlot.get(slotKey(group.id, dayType.id, period)) || [];
    const findingsId = found.length > 0 ? uid('slot-findings') : null;
    const room = roomPicker({
      name: 'Room for ' + at,
      key: keyBase + 'room',
      text,
      roomId: resolved.room ? resolved.room.id : null,
      missing: unknown,
      describedBy: findingsId,
      options: () => roomOptions(ctx.store.project, env.model(), slot),
      // a refusal is said, and the field goes back to the slot's room
      onPick: (roomId) => {
        try {
          change({ room: roomId });
          return true;
        } catch (error) {
          ctx.toast({ kind: 'problem', text: error.message });
          return false;
        }
      },
      onKeep: (typed) => {
        try {
          change({ room: null, roomText: typed });
          return true;
        } catch (error) {
          ctx.toast({ kind: 'problem', text: error.message });
          return false;
        }
      },
    });

    const label = field({ value: slot.label, name: 'slotLabel', placeholder: 'Label', commit: (value) => {
      change({ label: value });
    } });
    label.input.setAttribute('aria-label', 'Label for ' + at);
    keyed(label.input, keyBase + 'label');

    const implied = resolved.room ? resolved.room.teacherIds.map((id) => (project.teachers.find((teacher) => teacher.id === id) || { name: '' }).name).filter(Boolean) : [];
    const teacher = picker({
      placeholder: slot.teacherIds.length > 0 ? 'Add another' : implied.length > 0 ? implied.join(', ') : 'Teacher',
      listLabel: 'Teachers',
      emptyText: project.teachers.length === 0 ? 'No teachers yet. Add them in the Teachers tab.' : 'No teacher matches.',
      options: () => ctx.store.project.teachers.filter((candidate) => !slot.teacherIds.includes(candidate.id)).map((candidate) => ({ id: candidate.id, label: candidate.name })),
      onPick: (option) => {
        env.focusAfter(keyBase + 'teacher');
        apply(env, setSlot, { groupId: group.id, dayTypeId: dayType.id, period, slot: { teacherIds: slot.teacherIds.concat([option.id]) } });
      },
    });
    teacher.input.setAttribute('aria-label', 'Teacher for ' + at + (implied.length > 0 && slot.teacherIds.length === 0 ? '. Left empty, it is the room’s: ' + implied.join(', ') : ''));
    keyed(teacher.input, keyBase + 'teacher');
    const chips = slot.teacherIds.map((id) => {
      const name = (project.teachers.find((candidate) => candidate.id === id) || { name: '' }).name;
      return h('span', { class: 'chip' }, h('span', null, name), keyed(h('button', {
        type: 'button',
        class: 'chip__remove',
        'aria-label': 'Take ' + name + ' off ' + at,
        on: { click: () => {
          env.focusAfter(keyBase + 'teacher');
          apply(env, setSlot, { groupId: group.id, dayTypeId: dayType.id, period, slot: { teacherIds: slot.teacherIds.filter((other) => other !== id) } });
        } },
      }, icon('close', 14)), keyBase + 'chip:' + id));
    });

    const move = (to) => {
      if (!apply(env, moveSlot, { groupId: group.id, dayTypeId: dayType.id, from: period, to })) return;
      ctx.announce('Moved ' + pName + '’s assignment to ' + periodName(settings, to) + '. The two traded places.');
      env.render('slot:' + dayType.id + ':' + to + ':menu');
    };
    const menu = keyed(h('button', {
      type: 'button',
      class: 'icon-btn sch-slot__menu',
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      'aria-label': 'Move or clear ' + at,
      title: 'Move or clear ' + at,
      on: { click: () => openMenu({
        label: at,
        anchor: menu,
        items: [
          { label: 'Move up', disabled: period === 0, run: () => move(period - 1) },
          { label: 'Move down', disabled: period === settings.periods - 1, run: () => move(period + 1) },
          'separator',
          { label: 'Clear this ' + periodWords(settings).one, disabled: slotIsEmpty(slot), run: () => apply(env, setSlot, { groupId: group.id, dayTypeId: dayType.id, period, slot: { room: null, label: '', teacherIds: [] } }) },
        ],
      }) },
    }, '⋯'), keyBase + 'menu');

    const shown = view.shown && view.shown.groupId === group.id && view.shown.dayTypeId === dayType.id && view.shown.period === period;
    const time = bell.start && bell.end ? formatTime(bell.start, settings.timeFormat, { suffix: false }) + '–' + formatTime(bell.end, settings.timeFormat) : '';
    return h('tr', { class: 'sch-slot', role: 'row', data: { index: String(period), period: String(period), shown: shown ? 'true' : null } },
      h('th', { scope: 'row', role: 'rowheader', class: 'sch-slot__period' }, grip(), h('span', { class: 'sch-slot__name' }, pName), time === '' ? null : h('span', { class: 'sch-slot__time' }, time)),
      h('td', { class: 'sch-slot__room', role: 'cell' }, room.element,
        h('div', { class: 'sch-slot__extra' }, label.element, h('div', { class: 'sch-slot__teacher' }, chips.length > 0 ? h('div', { class: 'chips' }, chips) : null, teacher.element)),
        found.length > 0 ? h('div', { id: findingsId, class: 'sch-slot__findings' }, found.map((finding) => h('p', { class: 'sch-finding-line sch-finding-line--' + finding.severity, data: { finding: finding.id } },
          h('span', { class: 'sch-finding-line__word' }, SEVERITY_WORDS[finding.severity].glyph + ' ' + finding.severity.charAt(0).toUpperCase() + finding.severity.slice(1) + ': '), finding.text))) : null),
      h('td', { class: 'sch-slot__more', role: 'cell' }, menu));
  }

  function dayColumn(project, model, group, dayType) {
    const base = baseDayType(project);
    const words = periodWords(project.settings);
    const titleId = uid('day');
    const bells = bellsFor(project, dayType.id);
    const day = effectiveSchedule(project, group.id, dayType.id);
    if (!isOwnCopy(project, dayType.id)) {
      return h('section', { class: 'sch-day sch-day--same', 'aria-labelledby': titleId, data: { day: dayType.id } },
        h('h3', { class: 'sch-day__title', id: titleId }, dayType.name + ': same as ' + base.name),
        h('p', { class: 'sch-day__line' }, 'Whatever ' + base.name + ' holds, ' + dayType.name + ' holds too. ',
          button('Make its own copy', () => apply(env, makeOwnCopy, { dayTypeId: dayType.id }), { small: true, key: 'own:' + dayType.id, action: 'make-own', more: ': ' + dayType.name })),
        h('table', { class: 'table sch-slots sch-slots--same' },
          h('caption', { class: 'vh' }, group.name + ' on ' + dayType.name + ', the same as ' + base.name),
          h('thead', null, h('tr', null, h('th', { scope: 'col' }, words.One), h('th', { scope: 'col' }, 'Room'))),
          h('tbody', null, day.map((slot, period) => {
            const resolved = resolveSlotRoom(project, slot);
            return h('tr', null, h('th', { scope: 'row' }, periodName(project.settings, period)),
              h('td', null, resolved.room ? roomLabel(project, resolved.room) : resolved.text !== '' ? resolved.text + ' · ' + NOT_IN_BUILDING : '—'));
          }))));
    }
    const body = h('tbody', { role: 'rowgroup' }, day.map((slot, period) => slotRow(project, model, group, dayType, period, slot, bells[period])));
    dragRows(body, (from, to) => {
      if (apply(env, moveSlot, { groupId: group.id, dayTypeId: dayType.id, from, to })) ctx.announce('Moved ' + periodName(project.settings, from) + '’s assignment to ' + periodName(project.settings, to) + '.');
    });
    const whole = model.byDay.get(group.id + '|' + dayType.id) || [];
    return h('section', { class: 'sch-day', 'aria-labelledby': titleId, data: { day: dayType.id } },
      h('div', { class: 'sch-day__head' },
        h('h3', { class: 'sch-day__title', id: titleId }, dayType.name),
        dayType === base ? null : button('Copy ' + base.name + ' to ' + dayType.name, () => {
          if (apply(env, copyDay, { fromDayTypeId: base.id, toDayTypeId: dayType.id, groupId: group.id })) ctx.toast({ text: 'Copied ' + group.name + '’s ' + base.name + ' to ' + dayType.name + '.', action: { label: 'Undo', run: ctx.undo } });
        }, { small: true, key: 'copy:' + dayType.id, action: 'copy-day' })),
      whole.map((finding) => h('p', { class: 'sch-finding-line sch-finding-line--' + finding.severity }, finding.text)),
      // The roles are written out because on a phone schedule.css makes the
      // table, its body and its rows blocks and grids, and a browser may drop
      // a table's roles with its display (WebKit has). Chromium keeps them
      // without these lines (measured 2026-10-14 by SV2-50, every role taken
      // out); WebKit was not run here.
      h('table', { class: 'table sch-slots', role: 'table' },
        h('caption', { class: 'vh' }, group.name + ' on ' + dayType.name),
        h('thead', { role: 'rowgroup' }, h('tr', { role: 'row' },
          h('th', { scope: 'col', role: 'columnheader', class: 'sch-slots__period' }, words.One), h('th', { scope: 'col', role: 'columnheader' }, 'Room', h('span', { class: 'vh' }, ', then a label and a teacher if needed')), h('th', { scope: 'col', role: 'columnheader', class: 'sch-slots__more' }, h('span', { class: 'vh' }, 'Move')))),
        body));
  }

  function editor(project, model, group) {
    const titleId = uid('editor');
    const index = project.groups.indexOf(group);
    return h('section', { class: 'sch-editor', 'aria-labelledby': titleId, data: { group: group.id } },
      h('div', { class: 'sch-editor__head' },
        h('h2', { class: 'sch-editor__title', id: titleId }, h('span', { class: 'sch-dot', style: 'background:' + group.colour }), group.name),
        h('div', { class: 'sch-editor__actions' },
          button('Duplicate', () => {
            if (!apply(env, duplicateGroup, { id: group.id })) return;
            select(ctx.store.project.groups[index + 1].id, 'group-name');
          }, { small: true, key: 'group-duplicate', action: 'duplicate', more: ' ' + group.name }),
          button('Delete', () => {
            if (!apply(env, deleteGroup, { id: group.id })) return;
            const left = ctx.store.project.groups;
            ctx.toast({ text: 'Deleted group ' + group.name + '.', action: { label: 'Undo', run: ctx.undo } });
            const next = left[Math.min(index, left.length - 1)];
            // on a phone the list comes back: the group that was open is gone
            view.groupId = next ? next.id : null;
            view.shown = null;
            view.folded = false;
            show(listStop(ctx.store.project, view), true);
          }, { small: true, key: 'group-delete', action: 'delete', more: ' ' + group.name }))),
      headFields(project, group),
      h('div', { class: 'sch-days' }, project.dayTypes.map((dayType) => dayColumn(project, model, group, dayType))));
  }

  // ------------------------------------------------------------ drawing

  function draw(project) {
    const model = env.model();
    if (project.groups.length === 0) {
      view.groupId = null;
      view.folded = false;
      fill(element, emptyState('No groups yet. ' + WHAT.slice(0, -1) + ', and this is where each group gets a room for every ' + periodWords(project.settings).one + '. Add the first group to begin.', button('Add a group', add, { primary: true, key: 'group-add', action: 'add-group' }), 'groups'));
      return;
    }
    // The chosen group is gone (an undo took back its adding, an import
    // replaced it): the first one is chosen, and on a phone the list comes
    // back, since the editor that was open was not this group's.
    if (!project.groups.some((group) => group.id === view.groupId)) {
      if (view.groupId !== null) {
        view.folded = false;
        // its editor's place in the history is the list's now
        if (window.matchMedia(NARROW).matches) toList(true);
      }
      view.groupId = project.groups[0].id;
    }
    // The focus was in the editor and the editor is out of sight (the list
    // has come back on a phone): the list's Tab stop takes it.
    const active = document.activeElement;
    const lost = active === document.body || active === null;
    if (choosingGroup(view) && ((editorOf(active) && element.contains(active)) || (lost && inEditor))) env.focusAfter(listStop(project, view));
    inEditor = false;
    const selected = project.groups.find((group) => group.id === view.groupId);
    const visible = project.groups.filter((group) => matches(group, view.filter));
    const filter = keyed(h('input', { type: 'search', class: 'field__input', placeholder: 'Filter by name or grade', 'aria-label': 'Filter groups by name or grade', autocomplete: 'off', spellcheck: 'false' }), 'group-filter');
    filter.value = view.filter;
    filter.addEventListener('input', () => {
      view.filter = filter.value;
      env.render('group-filter');
    });
    const old = element.querySelector('.sch-groups__list');
    const scroll = old ? old.scrollTop : 0;
    // one Tab stop: the chosen group, or the first on the list when the
    // filter hides the chosen one
    const stop = visible.includes(selected) ? selected : visible[0];
    // With a filter that matches nothing there is no list to a screen reader,
    // only the line above saying so: a listbox has options.
    const some = visible.length > 0;
    const list = h('ul', { class: 'sch-groups__list', role: some ? 'listbox' : null, 'aria-label': some ? 'Groups' : null, 'aria-orientation': some ? 'vertical' : null },
      visible.map((group) => listItem(project, model, group, group === selected, group === stop)));
    listKeys(list);
    element.dataset.folded = String(view.folded === true);
    fill(element, 
      h('p', { class: 'sch-lead' }, WHAT + ' Each has a name, and a room for every ' + periodWords(project.settings).one + '.'),
      h('div', { class: 'sch-groups__cols' },
        h('div', { class: 'sch-groups__side' },
          button('Add a group', add, { primary: true, key: 'group-add', action: 'add-group' }),
          h('div', { class: 'sch-groups__find' },
            filter,
            h('p', { class: 'sch-groups__tally', 'aria-live': 'polite' }, view.filter.trim() === '' ? count(project.groups.length, 'group') + '.' : visible.length === 0 ? 'No group matches ' + quote(view.filter.trim()) + '.' : visible.length + ' of ' + count(project.groups.length, 'group') + '.')),
          list,
          // on a phone with the list folded to the chosen group (schedule.css)
          h('div', { class: 'sch-groups__all' }, button('All groups', showAll, { key: 'group-all', action: 'all-groups', more: ': choose another group' }))),
        editor(project, model, selected)));
    list.scrollTop = scroll;
    if (reveal) {
      reveal = false;
      const card = list.querySelector('[aria-selected="true"]');
      if (card && window.matchMedia(NARROW).matches) card.scrollIntoView({ block: 'start' });
    }
  }

  draw(ctx.store.project);
  return { element, update: draw };
}
