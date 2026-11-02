// The top of the movement view (DESIGN 5.3): the screen's first line, a
// sentence, and under it who is shown, on which day type, in which
// transition, the two drawing options and Clear. Every change applies at
// once; nothing here is staged.
//
//   controls({ change(patch), add(groupId), remove(groupId), clear(), showMe(), folded, fold(folded) })
//     -> { element, update(project, picture, sentence), folded, setFolded(folded) }
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
import { bellSchedulesOf } from '../../engine/schema.js';
import { COMPARE_LIMIT, COMPARE_REASON, compareFull, gradesOf } from './model.js';

function label(text, id) {
  return h('span', { class: 'mov-ctl__label', id }, text);
}

export function controls(options) {
  let project = null;
  let picture = null;

  // ---- the sentence
  const words = h('span', { class: 'mov-line__words' });
  const showMe = h('button', { type: 'button', class: 'mov-link', hidden: true, data: { action: 'show-me' }, on: { click: () => options.showMe() } }, 'Show me');
  const boxId = uid('mov-controls');
  let folded = options.folded === true;
  const changeButton = h('button', { type: 'button', class: 'mov-link mov-change', 'aria-expanded': String(!folded), 'aria-controls': boxId, data: { action: 'change' } }, 'Change');
  changeButton.addEventListener('click', () => {
    setFolded(!folded);
    if (options.fold) options.fold(folded);
  });
  const line = h('p', { class: 'mov-line intro__first', id: 'movement-line' }, words, ' ', showMe, ' ', changeButton);

  // ---- who
  const whoId = uid('mov-who');
  const who = segmented({
    name: 'movement-who',
    labelledBy: whoId,
    value: 'all',
    onChange: (value) => options.change({ who: value }),
    options: [{ value: 'all', label: 'Every group' }, { value: 'grade', label: 'A grade' }, { value: 'groups', label: 'Chosen groups' }],
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
  const whoBox = h('div', { class: 'mov-ctl', data: { control: 'who' } }, label('Who', whoId), who.element, gradeBox, groupsBox);

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

  const box = h('div', { class: 'mov-controls', id: boxId, hidden: folded }, whoBox, dayBox, bellsBox, stripBox, optionsBox);
  const element = h('div', { class: 'mov-top', data: { folded: String(folded) } }, line, box);

  function setFolded(next) {
    if (next === folded) return;
    // a control that is put away gives the focus to what brings it back
    const held = next && box.contains(document.activeElement);
    folded = next;
    box.hidden = folded;
    element.dataset.folded = String(folded);
    changeButton.setAttribute('aria-expanded', String(!folded));
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
    update(nextProject, nextPicture, sentence) {
      project = nextProject;
      picture = nextPicture;
      const choice = picture.choice;
      words.replaceChildren(...sentence.parts.map((part) => (part.name ? h('bdi', null, part.text) : part.text)));
      showMe.hidden = !sentence.showMe;
      who.set(choice.who);
      const grades = gradesOf(project);
      gradeBox.hidden = choice.who !== 'grade';
      fill(gradeSelect, grades.map((grade) => [grade, grade === '' ? 'No grade' : 'Grade ' + grade]), choice.grade);
      groupsBox.hidden = choice.who !== 'groups';
      drawChips();
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
