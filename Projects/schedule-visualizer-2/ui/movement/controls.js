// The top of the movement view (DESIGN 5.3): the screen's first line, a
// sentence, and under it who is shown, on which day type, in which
// transition, the two drawing options and Clear. Every change applies at
// once; nothing here is staged.
//
//   controls({ change(patch), add(groupId), remove(groupId), clear(), showMe() })
//     -> { element, update(project, picture, sentence) }
//
// The pieces are built once and filled in on update, so a control keeps the
// focus while the picture behind it changes.

import { h, uid } from '../components/dom.js';
import { choice as segmented } from '../components/choice.js';
import { picker } from '../components/picker.js';
import { icon } from '../components/icons.js';
import { formatDuration } from '../../engine/findings.js';
import { COMPARE_LIMIT, COMPARE_REASON, gradesOf } from './model.js';

function label(text, id) {
  return h('span', { class: 'mov-ctl__label', id }, text);
}

export function controls(options) {
  let project = null;
  let picture = null;

  // ---- the sentence
  const words = h('span', { class: 'mov-line__words' });
  const showMe = h('button', { type: 'button', class: 'mov-link', hidden: true, data: { action: 'show-me' }, on: { click: () => options.showMe() } }, 'Show me');
  const line = h('p', { class: 'mov-line intro__first', id: 'movement-line' }, words, ' ', showMe);

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
    emptyText: 'No group matches.',
    options: () => (project ? project.groups.filter((group) => !picture.choice.groupIds.includes(group.id)).map((group) => ({ id: group.id, label: group.name, detail: group.grade === '' ? '' : 'Grade ' + group.grade })) : []),
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

  // ---- which transition
  const stripId = uid('mov-strip');
  const strip = h('div', { class: 'mov-strip', role: 'group', 'aria-labelledby': stripId, data: { control: 'transition' } });
  const stripBox = h('div', { class: 'mov-ctl mov-ctl--strip' }, label('Transition', stripId), strip);
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

  const element = h('div', { class: 'mov-top' }, line, h('div', { class: 'mov-controls' }, whoBox, dayBox, stripBox, optionsBox));

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
    pick.input.placeholder = full ? 'Four groups are shown' : shown.length === 0 ? 'Choose a group' : 'Add a group';
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
        'aria-pressed': 'false',
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
    for (const item of strip.children) item.setAttribute('aria-pressed', String(item.dataset.transition === now));
  }

  return {
    element,
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
      fill(daySelect, project.dayTypes.map((dayType) => [dayType.id, dayType.name]), choice.dayTypeId);
      drawStrip();
      labels.input.checked = choice.labels;
      constant.input.checked = choice.constantWidth;
    },
  };
}
