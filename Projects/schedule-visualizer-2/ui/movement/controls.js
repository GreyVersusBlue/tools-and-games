// The top of the movement view (DESIGN 5.3): the screen's first line, a
// sentence, and under it who is shown, on which day type, in which
// transition, the two drawing options and Clear. Every change applies at
// once; nothing here is staged.
//
//   controls({ change(patch), add(groupId), remove(groupId), clear(), showMe(tab), tryAgain(), folded, fold(folded) })
//     -> { element, update(project, picture, sentence, crowd), folded, setFolded(folded) }
//
// `crowd` is where the crowd-aware answer stands: { state: 'off' | 'working' | 'ready' | 'failed', message }
// (DESIGN 17.4, 17.7 items 6, 8, 9). Under the first line a band says it is being worked out, or that it
// could not be, with Try again; and when Routes is folded behind Change and some place has waiting, the
// first line ends "· Try crowd-aware routes", a link that chooses it.
//
// The pieces are built once and filled in on update, so a control keeps the
// focus while the picture behind it changes.
//
// The map comes first: the sentence is always on screen and ends in
// "Change", which shows the controls or folds them away. Folded, the
// sentence alone says what is drawn. `folded` is how the view opens;
// `fold(folded)` is told when the reader presses Change, and `setFolded` is
// for the view (a window that became narrow).

import { h, uid } from '../components/dom.js';
import { choice as segmented } from '../components/choice.js';
import { picker } from '../components/picker.js';
import { icon } from '../components/icons.js';
import { formatDuration } from '../../engine/findings.js';
import { describeDayType } from '../../engine/day-types.js';
import { bellSchedulesOf, findById, findRoom, nameOfRoom } from '../../engine/schema.js';
import { COMPARE_LIMIT, COMPARE_REASON, compareFull, gradesOf, teacherColourOf } from './model.js';
import { hasWaiting } from './crowd-view.js';

// What Routes says under its two choices, and the words of the band under the first line.
export const ROUTES_HINT = 'Crowd-aware: groups that wait in a jam try a slightly longer way (at most 30 s or a quarter more walking). A what-if: checks use the usual routes.';
export const CROWD_WORKING = 'Working out crowd-aware routes\u2026';
export const CROWD_FAILED = 'Crowd-aware routes could not be worked out. The map shows the usual routes';
export const CROWD_NOTE = 'Groups are not routed from here: this shows where the building has spare corridor room. Hotspots shows the jams it eases.';

// "Room 204" in the order the building's numbers sort ("2" before "10", "1A" with the ones)
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

// Subject select values: the three ways a subject filter is not a subject's id
const ANY_SUBJECT = '-any';
const NO_SUBJECT = '-none';

function label(text, id) {
  return h('span', { class: 'mov-ctl__label', id }, text);
}

export function controls(options) {
  let project = null;
  let picture = null;

  // ---- the sentence
  const words = h('span', { class: 'mov-line__words' });
  let showTab = 'summary';
  const showMe = h('button', { type: 'button', class: 'mov-link', hidden: true, data: { action: 'show-me' }, on: { click: () => options.showMe(showTab) } }, 'Show me');
  // a filter that matches nothing: the one way out, beside the sentence that says so
  const clearFilter = h('button', { type: 'button', class: 'mov-link', hidden: true, data: { action: 'clear-filter' }, on: { click: () => options.change({ toRoomId: null, subjectId: null }) } }, 'Clear the filter');
  // the way to Crowd-aware where Routes is folded away and some place has waiting (DESIGN 17.7 item 9)
  const tryCrowd = h('button', { type: 'button', class: 'mov-link', data: { action: 'try-crowd' }, on: { click: () => {
    // the link goes with the choice: the focus stays on the line, at Change
    options.change({ routes: 'crowd' });
    changeButton.focus();
  } } }, 'Try crowd-aware routes');
  const tryBox = h('span', { class: 'mov-line__try', hidden: true }, '\u00b7 ', tryCrowd);
  const boxId = uid('mov-controls');
  let folded = options.folded === true;
  const changeButton = h('button', { type: 'button', class: 'mov-link mov-change', 'aria-expanded': String(!folded), 'aria-controls': boxId, data: { action: 'change' } }, 'Change');
  changeButton.addEventListener('click', () => {
    setFolded(!folded);
    if (options.fold) options.fold(folded);
  });
  // ---- which routes (DESIGN 17.4): the usual, quickest ones on every visit, or crowd-aware, a what-if. It is one of the
  // controls, under Day type, and the line that says what it is for stands under the choice as text, always: a line seen
  // only while the choice was hovered covered the band, the failure and Try again beneath it (SV2-154's review). The block
  // is in the controls' own flow, so choosing never moves the map: the line was there before the choice.
  const routesId = uid('mov-routes');
  const routesHint = uid('mov-routes-hint');
  const routes = segmented({
    name: 'movement-routes',
    labelledBy: routesId,
    value: 'usual',
    onChange: (value) => options.change({ routes: value }),
    options: [{ value: 'usual', label: 'Usual (quickest)' }, { value: 'crowd', label: 'Crowd-aware' }],
  });
  routes.element.setAttribute('aria-describedby', routesHint);
  const routesBox = h('div', { class: 'mov-ctl mov-ctl--routes', hidden: true, data: { control: 'routes' } },
    label('Routes', routesId), routes.element,
    h('p', { class: 'mov-ctl__hint mov-routes__hint', id: routesHint, data: { part: 'routes-line' } }, ROUTES_HINT));

  const line = h('p', { class: 'mov-line intro__first', id: 'movement-line' }, words, ' ', showMe, ' ', clearFilter, ' ', changeButton);

  // ---- under the first line: crowd-aware routes being worked out, or not worked out, and what they are for
  // only "working" is a live region of its own: the failure is said once, by the page's announcer (index.js), so a reader
  // does not hear it twice
  const crowdStatus = h('span', { class: 'mov-crowd__words', role: 'status', data: { part: 'crowd-status' } });
  const crowdFailed = h('span', { class: 'mov-crowd__words mov-crowd__failed', hidden: true, data: { part: 'crowd-failed' } });
  const tryAgain = h('button', { type: 'button', class: 'mov-link', hidden: true, data: { action: 'try-again' }, on: { click: () => {
    // the button goes with the failure: the focus goes to the choice it answers, or to Change where that is folded away
    options.tryAgain();
    const checked = folded || routesBox.hidden ? null : routesBox.querySelector('input[name="movement-routes"]:checked');
    (checked || changeButton).focus();
  } } }, 'Try again');
  const crowdNote = h('p', { class: 'mov-crowd__note', hidden: true, data: { part: 'crowd-note' } }, CROWD_NOTE);
  const crowdBand = h('div', { class: 'mov-crowd', hidden: true, data: { part: 'crowd', state: 'off' } }, h('p', { class: 'mov-crowd__line' }, crowdStatus, crowdFailed, ' ', tryAgain), crowdNote);

  // ---- who
  const whoId = uid('mov-who');
  const who = segmented({
    name: 'movement-who',
    labelledBy: whoId,
    value: 'all',
    onChange: (value) => options.change({ who: value }),
    options: [{ value: 'all', label: 'Every group' }, { value: 'grade', label: 'A grade' }, { value: 'groups', label: 'Chosen groups' }, { value: 'teacher', label: 'A teacher' }],
  });
  const gradeSelect = h('select', { class: 'field__input mov-ctl__select', 'aria-label': 'Grade', data: { control: 'grade' }, on: { change: () => options.change({ grade: gradeSelect.value }) } });
  const gradeBox = h('div', { class: 'mov-ctl__more', hidden: true }, gradeSelect);
  const chips = h('ul', { class: 'chips mov-chips', 'aria-label': 'Groups shown' });
  const reasonId = uid('mov-reason');
  const reason = h('p', { class: 'mov-ctl__reason', id: reasonId, hidden: true, data: { reason: 'limit' } }, COMPARE_REASON);
  const pick = picker({
    listLabel: 'Groups',
    placeholder: 'Add a group',
    describedBy: reasonId,
    emptyText: 'No group to add.',
    // at the limit there is nothing to pick
    options: () => (project && picture.choice.groupIds.length < COMPARE_LIMIT ? project.groups.filter((group) => !picture.choice.groupIds.includes(group.id)).map((group) => ({ id: group.id, label: group.name, detail: group.grade === '' ? '' : 'Grade ' + group.grade })) : []),
    onPick: (option) => options.add(option.id),
  });
  pick.input.setAttribute('aria-label', 'Add a group to compare');
  pick.input.dataset.control = 'add-group';
  const groupsBox = h('div', { class: 'mov-ctl__more mov-ctl__more--groups', hidden: true }, chips, pick.element, reason);

  // ---- a teacher: the general picker, the one chosen above it ("Ms. Okafor · Mathematics · 204")
  const teacherChip = h('ul', { class: 'chips mov-chips', 'aria-label': 'Teacher shown', hidden: true, data: { control: 'teacher-chip' } });
  const teacherPick = picker({
    listLabel: 'Teachers',
    placeholder: 'Choose a teacher',
    emptyText: 'No teacher to choose.',
    options: () => (project ? project.teachers.map((teacher) => ({ id: teacher.id, label: teacher.name, detail: teacherDetail(teacher) })) : []),
    onPick: (option) => options.change({ who: 'teacher', teacherId: option.id }),
  });
  teacherPick.input.setAttribute('aria-label', 'Choose a teacher');
  teacherPick.input.dataset.control = 'teacher';
  const teacherBox = h('div', { class: 'mov-ctl__more mov-ctl__more--teacher', hidden: true }, teacherChip, teacherPick.element);
  const whoBox = h('div', { class: 'mov-ctl', data: { control: 'who' } }, label('Who', whoId), who.element, gradeBox, groupsBox, teacherBox);

  function teacherDetail(teacher) {
    const subject = typeof teacher.subjectId === 'string' ? findById(Array.isArray(project.subjects) ? project.subjects : [], teacher.subjectId) : null;
    const rooms = (Array.isArray(teacher.roomIds) ? teacher.roomIds : []).map((id) => findRoom(project, id)).filter(Boolean).map((room) => (typeof room.number === 'string' && room.number.trim() !== '' ? room.number : nameOfRoom(room, false)));
    return [subject ? subject.name : null, rooms.length > 0 ? rooms.join(', ') : null].filter((part) => part !== null).join(' \u00b7 ');
  }

  // ---- Going to and Rooms of subject (DESIGN 17.3, 17.7 item 15): the walks into a room, or into rooms of a subject
  const roomChip = h('ul', { class: 'chips mov-chips', 'aria-label': 'Room walked into', hidden: true, data: { control: 'room-chip' } });
  const roomPick = picker({
    listLabel: 'Rooms',
    placeholder: 'Any room',
    emptyText: 'No room matches.',
    options: () => {
      if (!project) return [];
      const rooms = project.building.floors.flatMap((floor) => floor.spaces.filter((space) => space.kind === 'room').map((room) => ({ room, floor })));
      rooms.sort((a, b) => collator.compare(a.room.number, b.room.number));
      return [{ id: '', label: 'Any room' }, ...rooms.map(({ room, floor }) => ({ id: room.id, label: nameOfRoom(room, false), detail: floor.name }))];
    },
    onPick: (option) => options.change({ toRoomId: option.id === '' ? null : option.id }),
  });
  roomPick.input.setAttribute('aria-label', 'Going to: choose a room');
  roomPick.input.dataset.control = 'going-to';
  const subjectId = uid('mov-subject');
  const subjectHint = uid('mov-subject-hint');
  const subjectSelect = h('select', { class: 'field__input mov-ctl__select', id: subjectId, 'aria-describedby': subjectHint, data: { control: 'subject' }, on: { change: () => options.change({ subjectId: subjectSelect.value === ANY_SUBJECT ? null : subjectSelect.value === NO_SUBJECT ? '' : subjectSelect.value }) } });
  // two blocks side by side and the hint in a line of its own under both, so the row of controls is as tall as a control and one
  // line of hint, not a control and a hint wrapped to the width of one
  const filtersBox = h('div', { class: 'mov-ctl mov-ctl--filters', data: { control: 'filters' } },
    h('div', { class: 'mov-ctl' },
      h('span', { class: 'mov-ctl__label', id: uid('mov-going') }, 'Going to'),
      h('div', { class: 'mov-ctl__more mov-ctl__more--room' }, roomChip, roomPick.element)),
    h('div', { class: 'mov-ctl' },
      h('label', { class: 'mov-ctl__label', for: subjectId }, 'Rooms of subject'),
      subjectSelect),
    h('p', { class: 'mov-ctl__hint mov-ctl__hint--filters', id: subjectHint }, 'By the room\u2019s subject, not the class\u2019s.'));

  // ---- which day type
  const dayId = uid('mov-day');
  const daySelect = h('select', { class: 'field__input mov-ctl__select', id: dayId, data: { control: 'day' }, on: { change: () => options.change({ dayTypeId: daySelect.value }) } });
  const dayBox = h('div', { class: 'mov-ctl' }, h('label', { class: 'mov-ctl__label', for: dayId }, 'Day type'), daySelect);

  // ---- which bells: shown only when there is a bell schedule besides the regular ones
  const bellsId = uid('mov-bells');
  const bellsSelect = h('select', { class: 'field__input mov-ctl__select', id: bellsId, data: { control: 'bells' }, on: { change: () => options.change({ bellsId: bellsSelect.value === '' ? null : bellsSelect.value }) } });
  const bellsBox = h('div', { class: 'mov-ctl', hidden: true, data: { control: 'bells-box' } }, h('label', { class: 'mov-ctl__label', for: bellsId }, 'Bells'), bellsSelect);

  // ---- which transition
  const stripId = uid('mov-strip');
  // One Tab stop (DESIGN 5.3): a radio group, as the floors and the
  // arrangement are. The arrow keys move the choice, Home and End go to its
  // ends, and Tab passes through it once however many periods the day has.
  const strip = h('div', { class: 'mov-strip', role: 'radiogroup', 'aria-labelledby': stripId, data: { control: 'transition' } });
  strip.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const items = Array.from(strip.children);
    const at = items.indexOf(document.activeElement);
    if (at === -1) return;
    const to = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? (at + 1) % items.length
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? (at - 1 + items.length) % items.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : -1;
    if (to === -1) return;
    event.preventDefault();
    // as with any radio group, moving is choosing; the item keeps the focus while the map changes
    if (to !== at) items[to].click();
    items[to].focus();
  });
  // the periods that do not meet under the bells chosen, said where the strip leaves them out
  const stripNote = h('p', { class: 'mov-strip__note', hidden: true, data: { note: 'off' } });
  const stripBox = h('div', { class: 'mov-ctl mov-ctl--strip' }, label('Transition', stripId), strip, stripNote);
  let stripKey = '';

  // ---- the two options, and Clear
  const check = (name, text, key) => {
    const input = h('input', { type: 'checkbox', name, data: { control: name }, on: { change: () => options.change({ [key]: input.checked }) } });
    return { input, element: h('label', { class: 'mov-check' }, input, h('span', null, text)) };
  };
  const labels = check('labels', 'Period labels', 'labels');
  const constant = check('constant-width', 'Keep line width when zoomed', 'constantWidth');
  const clear = h('button', { type: 'button', class: 'btn mov-clear', data: { action: 'clear' }, on: { click: () => options.clear() } }, 'Clear');
  const optionsBox = h('div', { class: 'mov-ctl mov-ctl--options' }, label('Show', null), h('div', { class: 'mov-ctl__checks' }, labels.element, constant.element), clear);

  const box = h('div', { class: 'mov-controls', id: boxId, hidden: folded }, whoBox, filtersBox, dayBox, bellsBox, routesBox, stripBox, optionsBox);
  const element = h('div', { class: 'mov-top', data: { folded: String(folded) } }, line, crowdBand, box);

  // Routes is one of the controls (folded away with them) and never offered for a teacher, who is not rerouted
  function drawRoutes() {
    routesBox.hidden = !picture || picture.choice.who === 'teacher';
  }

  // the offer is made wherever Routes is folded behind Change (DESIGN 17.7 item 9: a phone, and a window under 900 px where the
  // controls fold), only where the usual routes have a place with waiting. No window-width test of its own, so there is no
  // listener to take off when the view goes.
  function drawTry() {
    tryBox.hidden = !(folded && picture && hasWaiting(picture) && picture.choice.who !== 'teacher');
    // it is part of the sentence only while it is offered (a hidden link's words would still be read as the sentence's)
    if (tryBox.hidden) tryBox.remove();
    else if (tryBox.parentNode !== words) words.append(' ', tryBox);
  }

  function drawCrowd(crowd) {
    const state = crowd && picture.choice.who !== 'teacher' ? crowd.state : 'off';
    const lens = state === 'ready' && picture.routesMode === 'crowd';
    crowdBand.dataset.state = state;
    crowdBand.hidden = state === 'off' || (state === 'ready' && !lens);
    crowdStatus.textContent = state === 'working' ? CROWD_WORKING : '';
    crowdFailed.textContent = state === 'failed' ? CROWD_FAILED + ' \u00b7' : '';
    crowdFailed.hidden = state !== 'failed';
    tryAgain.hidden = state !== 'failed';
    crowdNote.hidden = !lens;
  }

  function setFolded(next) {
    if (next === folded) return;
    // a control that is put away gives the focus to what brings it back
    const held = next && box.contains(document.activeElement);
    folded = next;
    box.hidden = folded;
    element.dataset.folded = String(folded);
    changeButton.setAttribute('aria-expanded', String(!folded));
    drawTry();
    drawRoutes();
    if (held) changeButton.focus();
  }

  function fill(select, entries, value) {
    const key = JSON.stringify(entries);
    if (select.dataset.filled !== key) {
      select.dataset.filled = key;
      select.replaceChildren(...entries.map(([id, text]) => h('option', { value: id }, text)));
    }
    select.value = value;
  }

  function drawChips() {
    const ids = picture.choice.groupIds;
    const shown = project.groups.filter((group) => ids.includes(group.id));
    const focused = chips.contains(document.activeElement);
    chips.replaceChildren(...shown.map((group) => h('li', { class: 'chip', data: { group: group.id } },
      h('span', { class: 'mov-swatch', style: 'background:' + group.colour }),
      h('bdi', null, group.name),
      h('button', {
        type: 'button',
        class: 'chip__remove',
        'aria-label': 'Take ' + group.name + ' off the map',
        title: 'Take ' + group.name + ' off the map',
        on: { click: () => options.remove(group.id) },
      }, icon('close', 14)))));
    chips.hidden = shown.length === 0;
    const full = ids.length >= COMPARE_LIMIT;
    reason.hidden = !full;
    // at the limit the field says why and takes nothing; it keeps the focus
    pick.input.readOnly = full;
    pick.input.setAttribute('aria-disabled', String(full));
    pick.input.placeholder = full ? compareFull(COMPARE_LIMIT) : shown.length === 0 ? 'Choose a group' : 'Add a group';
    if (full) pick.close();
    // a chip that was taken off took the focus with it
    if (focused && !chips.contains(document.activeElement)) pick.input.focus();
  }

  function drawTeacher() {
    const choice = picture.choice;
    teacherBox.hidden = choice.who !== 'teacher';
    filtersBox.hidden = choice.who === 'teacher';
    const teacher = choice.teacherId === null ? null : findById(project.teachers, choice.teacherId);
    teacherChip.hidden = !teacher;
    teacherChip.replaceChildren(...(teacher ? [h('li', { class: 'chip', data: { teacher: teacher.id } },
      h('span', { class: 'mov-swatch', style: 'background:' + (teacherColourOf(project, teacher) || 'var(--ink)') }),
      h('bdi', null, teacher.name))] : []));
    teacherPick.input.placeholder = teacher ? 'Change teacher' : project.teachers.length === 0 ? 'No teachers yet' : 'Choose a teacher';
  }

  function drawFilters() {
    const choice = picture.choice;
    const room = choice.toRoomId === null ? null : findRoom(project, choice.toRoomId);
    const focused = roomChip.contains(document.activeElement);
    roomChip.hidden = !room;
    roomChip.replaceChildren(...(room ? [h('li', { class: 'chip', data: { room: room.id } },
      h('bdi', null, nameOfRoom(room, false)),
      h('button', {
        type: 'button',
        class: 'chip__remove',
        'aria-label': 'Stop showing only walks into ' + nameOfRoom(room, false),
        title: 'Any room',
        on: { click: () => options.change({ toRoomId: null }) },
      }, icon('close', 14)))] : []));
    // a chip that was taken off took the focus with it
    if (focused && !roomChip.contains(document.activeElement)) roomPick.input.focus();
    const subjects = Array.isArray(project.subjects) ? project.subjects : [];
    fill(subjectSelect, [[ANY_SUBJECT, 'Any subject'], ...subjects.map((subject) => [subject.id, subject.name]), [NO_SUBJECT, 'No subject']], choice.subjectId === null ? ANY_SUBJECT : choice.subjectId === '' ? NO_SUBJECT : choice.subjectId);
  }

  function drawStrip() {
    const key = JSON.stringify(picture.transitions.map((each) => [each.short, each.times, each.name, each.seconds]));
    if (key !== stripKey) {
      stripKey = key;
      const button = (value, top, under, name) => h('button', {
        type: 'button',
        class: 'mov-strip__item',
        role: 'radio',
        'aria-checked': 'false',
        tabindex: '-1',
        title: name,
        data: { transition: value },
        on: { click: () => options.change({ transition: value === 'all' ? null : Number(value) }) },
      }, h('span', { class: 'mov-strip__name' }, top), under ? h('span', { class: 'mov-strip__time' }, under) : null, h('span', { class: 'vh' }, name === top ? '' : ', ' + name));
      strip.replaceChildren(
        button('all', 'All', picture.transitions.length === 0 ? '' : 'day', 'All transitions of the day'),
        ...picture.transitions.map((each) => button(String(each.period), each.short, formatDuration(each.seconds), each.name + ', ' + (each.times ? each.times + ', ' : '') + formatDuration(each.seconds) + ' of passing time')),
      );
    }
    const now = picture.choice.transition === null ? 'all' : String(picture.choice.transition);
    for (const item of strip.children) {
      const chosen = item.dataset.transition === now;
      item.setAttribute('aria-checked', String(chosen));
      // the one chosen is the group's Tab stop
      item.tabIndex = chosen ? 0 : -1;
    }
  }

  return {
    element,
    get folded() {
      return folded;
    },
    setFolded,
    update(nextProject, nextPicture, sentence, crowd) {
      project = nextProject;
      picture = nextPicture;
      const choice = picture.choice;
      routes.set(choice.routes);
      drawRoutes();
      drawCrowd(crowd);
      words.replaceChildren(...sentence.parts.map((part) => (part.name ? h('bdi', null, part.text) : part.text)));
      // the offer ends the sentence, in its own flow, so a phone's first line stays at three lines before Change
      drawTry();
      showMe.hidden = !sentence.showMe;
      showTab = sentence.showTab || 'summary';
      clearFilter.hidden = sentence.clearFilter !== true;
      who.set(choice.who);
      const grades = gradesOf(project);
      gradeBox.hidden = choice.who !== 'grade';
      fill(gradeSelect, grades.map((grade) => [grade, grade === '' ? 'No grade' : 'Grade ' + grade]), choice.grade);
      groupsBox.hidden = choice.who !== 'groups';
      drawChips();
      drawTeacher();
      drawFilters();
      // a day type that is the same as another says so: "C Day (same as A Day)"
      fill(daySelect, project.dayTypes.map((dayType) => {
        const follows = describeDayType(project, dayType.id).follows;
        return [dayType.id, follows ? dayType.name + ' (same as ' + follows + ')' : dayType.name];
      }), choice.dayTypeId);
      const schedules = bellSchedulesOf(project);
      bellsBox.hidden = schedules.length === 0;
      fill(bellsSelect, [['', 'Regular']].concat(schedules.map((schedule) => [schedule.id, schedule.name])), choice.bellsId === null ? '' : choice.bellsId);
      stripNote.hidden = picture.offWords === '';
      stripNote.textContent = picture.offWords;
      drawStrip();
      labels.input.checked = choice.labels;
      constant.input.checked = choice.constantWidth;
    },
  };
}
