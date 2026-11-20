// Room features in the planner (spec 4.4; DESIGN 16.4 and 16.12 items 8 and
// 10): a room's Features as removable chips and a combobox that adds one, and
// the dialog that edits the school's list. Both change the project only
// through the W7 actions (engine/w7-actions.js).
//
//   featuresField(env, { room(), state(), id }) -> { element, input, sync() }
//     The chips, the combobox and the "Edit the features list…" button of one
//     room. `room()` is the room it is for (null when there is none), `state()`
//     the inspector's state ({ project }). `sync()` draws it again.
//   openFeaturesDialog(env, opener) -> { element, close, closed }
//     The list as rows (a name field, Move up, Move down, Delete…), Add a
//     feature, and Add common ones on an empty list.
//
// A feature's name is data: it is set as text, in a <bdi> where it sits in a
// sentence, and never read as markup.

import { h, uid } from '../components/dom.js';
import { icon } from '../components/icons.js';
import { openDialog, confirm } from '../components/dialog.js';
import { count } from '../components/words.js';
import { action, ActionError, BUILDING } from '../../engine/actions.js';
import { addFeature, renameFeature, deleteFeature, moveFeature, addCommonFeatures, setRoomFeatures, describeFeatureDelete } from '../../engine/w7-actions.js';
import { roomFeatures, nameKey, FEATURES_MOST, FEATURE_NAME_MOST, COMMON_FEATURES } from '../../engine/schema.js';
import { roomName } from '../../engine/findings.js';

const ADD = '@add';
// the count shows from here (DESIGN 16.4)
export const COUNT_FROM = 30;

const listOf = (project) => (Array.isArray(project.building.features) ? project.building.features : []);
const bdi = (text) => h('bdi', null, text);

// ---------------------------------------------------------------- matching

function distance(a, b) {
  const x = Array.from(a);
  const y = Array.from(b);
  let row = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i += 1) {
    const next = [i];
    for (let j = 1; j <= y.length; j += 1) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    row = next;
  }
  return row[y.length];
}

// How well a feature's name fits what was typed: 0 the same name, 1 starts
// with it, 2 holds it, 3 a near miss ("Lab" for "Lap"), null no fit.
export function fit(typed, name) {
  const want = typed.trim().toLowerCase();
  const have = name.trim().toLowerCase();
  if (want === '') return null;
  if (nameKey(typed) === nameKey(name)) return 0;
  if (have.startsWith(want)) return 1;
  if (have.includes(want)) return 2;
  const length = Array.from(want).length;
  const limit = length <= 2 ? 0 : length <= 5 ? 1 : 2;
  return limit > 0 && distance(want, have) <= limit ? 3 : null;
}

// The features a room does not have yet, the best fits first, then the list's order.
export function nearMatches(features, held, typed) {
  return features
    .filter((feature) => !held.has(feature.id))
    .map((feature, index) => ({ feature, index, rank: fit(typed, feature.name) }))
    .filter((entry) => entry.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.feature);
}

// ---------------------------------------------------------------- one step for "add a new one to this room"

// payload: { roomId, name }. The feature is added to the school's list and to
// the room in one undo step.
const addFeatureToRoom = action(
  { label: (before, payload) => 'Add feature ' + String(payload.name).trim() + ' to the room', bumps: [BUILDING], focus: (before, payload) => ({ section: 'building', roomId: payload.roomId }) },
  (project, payload, ctx) => {
    const added = addFeature(project, { name: payload.name }, ctx);
    const made = listOf(added).find((feature) => nameKey(feature.name) === nameKey(payload.name));
    const room = (added.building.floors.flatMap((floor) => floor.spaces).find((space) => space.id === payload.roomId)) || { featureIds: [] };
    return setRoomFeatures(added, { roomId: payload.roomId, featureIds: (room.featureIds || []).concat([made.id]) }, ctx);
  },
);

// ---------------------------------------------------------------- the chips and the combobox

export function featuresField(env, source) {
  const { store, ctx } = env;
  const id = source.id || uid('features');
  const labelId = id + '-label';
  const listId = id + '-list';
  const heading = h('h3', { class: 'bi-heading', id: labelId }, 'Features');
  const chips = h('ul', { class: 'bi-chips', id: id + '-chips', 'aria-labelledby': labelId });
  const none = h('p', { class: 'bld-inspector__small', id: id + '-none' }, 'This room has no features yet.');
  const input = h('input', {
    class: 'field__input picker__input',
    id: id + '-add',
    type: 'text',
    role: 'combobox',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: 'Type a feature, like Lab',
    'aria-autocomplete': 'list',
    'aria-expanded': 'false',
    'aria-controls': listId,
    data: { key: 'feature-add' },
  });
  const list = h('ul', { class: 'picker__list bi-feature-list', role: 'listbox', id: listId, 'aria-label': 'Features to add', hidden: true });
  const edit = h('button', { type: 'button', class: 'btn btn--quiet bi-linkbutton', data: { key: 'feature-edit' }, on: { click: () => openFeaturesDialog(env, edit) } }, 'Edit the features list…');
  const element = h('div', { class: 'bi-features', id, data: { part: 'features' } },
    heading,
    chips,
    none,
    h('div', { class: 'picker' }, h('label', { class: 'field__label', for: id + '-add' }, 'Add a feature'), input, list),
    edit,
  );

  let shown = [];
  let active = -1;
  // true once an arrow key chose the highlighted option, which is what lets Enter take "Add"
  let byArrow = false;
  let open = false;

  const room = () => source.room();
  const project = () => source.state().project;
  const held = () => new Set(((room() || {}).featureIds) || []);

  function options() {
    const now = room();
    if (!now) return [];
    const typed = input.value;
    const found = nearMatches(listOf(project()), held(), typed).map((feature) => ({ id: feature.id, label: feature.name }));
    const trimmed = typed.trim();
    const exists = listOf(project()).some((feature) => nameKey(feature.name) === nameKey(trimmed));
    if (trimmed !== '' && !exists) found.push({ id: ADD, label: 'Add ‘' + trimmed + '’ to the list', name: trimmed });
    return found;
  }

  function mark() {
    Array.from(list.children).forEach((item, index) => item.setAttribute('aria-selected', String(index === active)));
    if (active >= 0 && list.children[active]) {
      input.setAttribute('aria-activedescendant', list.children[active].id);
      list.children[active].scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function draw() {
    shown = options();
    if (shown.length === 0) {
      const typed = input.value.trim();
      const same = typed !== '' && listOf(project()).find((feature) => nameKey(feature.name) === nameKey(typed));
      list.replaceChildren(h('li', { class: 'picker__empty', role: 'presentation' }, same ? same.name + ' is on this room already.' : listOf(project()).length === 0 ? 'The school has no features yet. Type one to add it.' : 'Every feature is on this room. Type a new one to add it.'));
      active = -1;
    } else {
      // with no near match the one option left is "Add", and it is the one Enter takes
      active = shown.length === 1 && shown[0].id === ADD ? 0 : Math.min(active, shown.length - 1);
      list.replaceChildren(...shown.map((option, index) => h('li', {
        class: 'picker__option bi-feature-option',
        role: 'option',
        id: listId + '-' + index,
        'aria-selected': 'false',
        data: { id: option.id },
        on: {
          pointerdown: (event) => event.preventDefault(),
          mousedown: (event) => event.preventDefault(),
          click: (event) => {
            if (event.button === 0) pick(option);
          },
        },
      }, option.id === ADD ? option.label : h('span', null, bdi(option.label)))));
    }
    mark();
  }

  function show() {
    open = true;
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    draw();
  }

  function close() {
    open = false;
    active = -1;
    byArrow = false;
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  function refuse(error) {
    if (!(error instanceof ActionError)) throw error;
    ctx.toast({ kind: 'problem', text: error.message });
    ctx.announce(error.message);
  }

  function pick(option) {
    const now = room();
    if (!now) return;
    try {
      if (option.id === ADD) {
        store.apply(addFeatureToRoom, { roomId: now.id, name: option.name });
      } else {
        store.apply(setRoomFeatures, { roomId: now.id, featureIds: (now.featureIds || []).concat([option.id]) });
      }
    } catch (error) {
      refuse(error);
      return;
    }
    const added = option.id === ADD ? option.name : option.label;
    input.value = '';
    close();
    ctx.announce(added + ' added');
    // the field keeps the focus, ready for the next one
    input.focus();
  }

  input.addEventListener('input', () => {
    byArrow = false;
    active = -1;
    show();
  });
  input.addEventListener('click', () => {
    if (!open) show();
  });
  input.addEventListener('blur', close);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        show();
        return;
      }
      if (shown.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      if (active === -1) active = step === 1 ? 0 : shown.length - 1;
      else active = (active + step + shown.length) % shown.length;
      byArrow = true;
      mark();
    } else if (event.key === 'Enter') {
      const typed = input.value.trim();
      if (typed === '') return;
      event.preventDefault();
      if (!open) show();
      // an arrow chose one
      if (byArrow && active >= 0 && shown[active]) {
        pick(shown[active]);
        return;
      }
      // no near match: "Add" is the only option, and Enter takes it
      if (shown.length === 1) {
        pick(shown[0]);
        return;
      }
      // the same name as a feature on the list: that one
      const same = shown.find((option) => option.id !== ADD && nameKey(option.label) === nameKey(typed));
      if (same) {
        pick(same);
        return;
      }
      if (shown.length === 0) {
        ctx.announce('Nothing to add: ' + (list.textContent || 'no match') + '.');
        return;
      }
      // near matches, and Enter has not been told which: say so, add nothing
      const message = 'Use the arrow keys to choose ' + shown.filter((option) => option.id !== ADD).map((option) => option.label).join(' or ') + ', or Add ‘' + typed + '’ to the list.';
      ctx.announce(message);
    } else if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    } else if (event.key === 'Backspace' && input.value === '') {
      const last = chips.querySelector('li:last-child button');
      if (last) {
        event.preventDefault();
        last.focus();
      }
    }
  });

  // taking a feature off the room: one step, with a toast that undoes it, and the focus to the next chip, else the field
  function remove(feature, button) {
    const now = room();
    if (!now) return;
    const buttons = Array.from(chips.querySelectorAll('button'));
    const at = buttons.indexOf(button);
    const heirs = buttons.slice(at + 1).concat(buttons.slice(0, at).reverse()).map((each) => each.dataset.key);
    const where = roomName(now, true);
    const outcome = env.editor().commit(setRoomFeatures, { roomId: now.id, featureIds: (now.featureIds || []).filter((held) => held !== feature.id) }, {
      done: () => 'Removed ' + feature.name + ' from ' + where + '.',
      toast: () => 'Removed ' + feature.name,
    });
    if (outcome === null) return;
    const next = heirs.map((key) => Array.from(chips.querySelectorAll('button')).find((each) => each.dataset.key === key)).find(Boolean);
    (next || input).focus();
  }

  function sync() {
    const now = room();
    const features = now ? roomFeatures(project().building, now) : [];
    const key = features.map((feature) => feature.id + ':' + feature.name).join('|') + '@' + (now ? roomName(now, true) : '');
    if (chips.dataset.key !== key) {
      chips.dataset.key = key;
      const active = document.activeElement;
      const had = active && chips.contains(active) ? active.dataset.key : null;
      chips.hidden = features.length === 0;
      none.hidden = features.length > 0;
      chips.replaceChildren(...features.map((feature) => h('li', { class: 'bi-chip', data: { feature: feature.id } },
        h('button', {
          type: 'button',
          class: 'btn bi-chip__button',
          data: { key: 'feature:' + feature.id, action: 'remove-feature' },
          'aria-label': 'Remove ' + feature.name + ' from ' + roomName(now, true),
          on: { click: (event) => remove(feature, event.currentTarget) },
        }, h('span', { class: 'bi-chip__name' }, feature.name), icon('close', 14)))));
      if (had) {
        const again = Array.from(chips.querySelectorAll('button')).find((each) => each.dataset.key === had);
        if (again) again.focus();
      }
    }
    if (open) draw();
  }

  return { element, input, sync, close };
}

// ---------------------------------------------------------------- the list dialog

export function openFeaturesDialog(env, opener) {
  const { store, ctx } = env;
  const body = h('div', { class: 'features-dialog__content' });
  const note = h('p', { class: 'features-dialog__note', id: 'features-note' });
  const countLine = h('p', { class: 'features-dialog__count', id: 'features-count', role: 'status' });
  const rows = h('ul', { class: 'features-dialog__rows', id: 'features-rows', 'aria-label': 'The school’s features' });
  const empty = h('div', { class: 'features-dialog__empty', id: 'features-empty' },
    h('p', null, 'The school has no features yet.'),
    h('button', { type: 'button', class: 'btn', data: { key: 'common' }, on: { click: addCommon } }, 'Add common ones'),
    h('p', { class: 'bld-inspector__small' }, 'Add ' + COMMON_FEATURES.length + ' common features; delete any you do not need.'));
  const addInput = h('input', { class: 'field__input', id: 'features-add', type: 'text', autocomplete: 'off', spellcheck: 'false', placeholder: 'Type a feature, like Lab', 'aria-describedby': 'features-add-hint features-add-refusal', data: { key: 'add' } });
  const addRefusal = h('p', { class: 'field__refusal', id: 'features-add-refusal', hidden: true });
  const addButton = h('button', { type: 'button', class: 'btn', data: { key: 'add-button' } }, 'Add');
  const adder = h('div', { class: 'features-dialog__add' },
    h('label', { class: 'field__label', for: 'features-add' }, 'Add a feature'),
    h('div', { class: 'features-dialog__addrow' }, addInput, addButton),
    h('p', { class: 'bld-inspector__small', id: 'features-add-hint' }, 'At most ' + FEATURES_MOST + ' features, each ' + FEATURE_NAME_MOST + ' characters or fewer.'),
    addRefusal);
  // a deleted feature's way back: the toast's Undo is behind the dialog, so the dialog says it too
  const undone = h('p', { class: 'features-dialog__undo', id: 'features-undo', role: 'status', hidden: true });
  body.append(note, countLine, empty, rows, adder, undone);

  const dialog = openDialog({
    title: 'The school’s features',
    body,
    opener,
    id: 'features-dialog',
    class: 'features-dialog',
    fallbackFocus: () => document.getElementById('inspector-title') && document.getElementById('inspector-title').focus(),
    buttons: [{ label: 'Done', value: true, kind: 'primary' }],
  });

  const project = () => store.project;
  // feature id -> a row's renew(feature), which writes a new name into the row in place
  const renewals = new Map();
  // the rows are built again only when the list's order or its rooms change, never for a
  // name alone: a rename kept on blur would otherwise replace the control the focus or a
  // click is going to
  let builtShape = null;
  let builtNames = null;
  let after = null;

  function say(text) {
    ctx.announce(text);
  }

  function refuse(error) {
    if (!(error instanceof ActionError)) throw error;
    ctx.toast({ kind: 'problem', text: error.message });
    say(error.message);
  }

  // one store action, one undo step; a refusal is said and null comes back
  function commit(act, payload, sentence) {
    try {
      store.apply(act, payload);
    } catch (error) {
      refuse(error);
      return null;
    }
    if (sentence) say(sentence);
    return true;
  }

  function focusKey(key) {
    const again = Array.from(dialog.element.querySelectorAll('[data-key]')).find((each) => each.dataset.key === key);
    if (again && !again.disabled) {
      again.focus();
      return true;
    }
    return false;
  }

  const nameOf = (feature) => (listOf(project()).find((each) => each.id === feature.id) || feature).name;

  function rowFor(feature, index, features) {
    const used = describeFeatureDelete(project(), feature.id);
    const made = h('input', { class: 'field__input', type: 'text', autocomplete: 'off', spellcheck: 'false', value: feature.name, 'aria-label': 'Name of ' + feature.name, data: { key: 'name:' + feature.id } });
    const refusal = h('p', { class: 'field__refusal', hidden: true });
    let committed = feature.name;
    const keep = () => {
      if (made.value === committed) {
        refusal.hidden = true;
        made.removeAttribute('aria-invalid');
        return;
      }
      try {
        store.apply(renameFeature, { id: feature.id, name: made.value });
        refusal.hidden = true;
        made.removeAttribute('aria-invalid');
        say('Renamed to ' + made.value.trim() + '. It is changed in every room.');
      } catch (error) {
        if (!(error instanceof ActionError)) throw error;
        refusal.textContent = error.message;
        refusal.hidden = false;
        made.setAttribute('aria-invalid', 'true');
      }
    };
    made.addEventListener('blur', keep);
    made.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        keep();
      } else if (event.key === 'Escape' && (made.value !== committed || !refusal.hidden)) {
        event.preventDefault();
        event.stopPropagation();
        made.value = committed;
        refusal.hidden = true;
        made.removeAttribute('aria-invalid');
      }
    });
    const named = [bdi(feature.name), bdi(feature.name), bdi(feature.name)];
    renewals.set(feature.id, (now) => {
      committed = now.name;
      made.setAttribute('aria-label', 'Name of ' + now.name);
      if (document.activeElement !== made) made.value = now.name;
      named.forEach((each) => {
        each.textContent = now.name;
      });
    });
    return h('li', { class: 'features-row', data: { feature: feature.id } },
      h('div', { class: 'features-row__name' }, made, refusal),
      h('div', { class: 'features-row__buttons' },
        h('button', { type: 'button', class: 'btn', disabled: index === 0, data: { key: 'up:' + feature.id }, on: { click: () => move(feature, index - 1, 'up') } }, 'Move ', named[0], ' up'),
        h('button', { type: 'button', class: 'btn', disabled: index === features.length - 1, data: { key: 'down:' + feature.id }, on: { click: () => move(feature, index + 1, 'down') } }, 'Move ', named[1], ' down'),
        h('button', { type: 'button', class: 'btn btn--danger', data: { key: 'delete:' + feature.id }, on: { click: (event) => remove(feature, event.currentTarget) } }, 'Delete ', named[2], '…'),
      ),
      used && used.rooms > 0 ? h('p', { class: 'features-row__used' }, 'On ' + count(used.rooms, 'room') + '.') : null,
    );
  }

  // the button hides with the empty list, so the focus goes to the first new row's name
  function addCommon() {
    if (commit(addCommonFeatures, undefined, 'Added ' + COMMON_FEATURES.length + ' common features.') === null) return;
    const first = rows.querySelector('[data-key^="name:"]');
    (first || addInput).focus();
  }

  function move(feature, to, way) {
    if (commit(moveFeature, { id: feature.id, toIndex: to }, 'Moved ' + nameOf(feature) + ' ' + way + '.') === null) return;
    // the button just used may be a disabled one now (the top or the bottom): the other one takes the focus
    if (!focusKey(way + ':' + feature.id)) focusKey((way === 'up' ? 'down:' : 'up:') + feature.id);
  }

  async function remove(row, button) {
    const feature = { id: row.id, name: nameOf(row) };
    const info = describeFeatureDelete(project(), feature.id);
    if (!info) return;
    const features = listOf(project());
    const at = features.findIndex((each) => each.id === feature.id);
    const heir = features[at + 1] || features[at - 1] || null;
    const settle = () => {
      if (heir && focusKey('name:' + heir.id)) return;
      addInput.focus();
    };
    if (info.rooms > 0) {
      const sure = await confirm({
        title: 'Delete ' + feature.name + '? It is on ' + count(info.rooms, 'room') + '.',
        body: 'It comes off ' + (info.rooms === 1 ? 'that room' : 'those rooms') + ' and off the list. Undo brings it back.',
        action: 'Delete ' + feature.name,
        keep: 'Keep it',
        danger: true,
        opener: button,
        fallbackFocus: () => focusKey('delete:' + feature.id) || settle(),
      });
      if (!sure) return;
    }
    if (commit(deleteFeature, { id: feature.id }, null) === null) return;
    const words = info.rooms > 0 ? 'Deleted ' + feature.name + ' from ' + count(info.rooms, 'room') : 'Deleted ' + feature.name;
    say(words + '.');
    ctx.toast({ text: words, action: { label: 'Undo', run: ctx.undo } });
    showUndo(words);
    settle();
  }

  // the way back, in the dialog, for as long as nothing newer has been done
  function showUndo(words) {
    const mine = store.version;
    undone.hidden = false;
    undone.replaceChildren(words + ' · ', h('button', { type: 'button', class: 'btn btn--quiet bi-small', data: { key: 'undo' }, on: { click: () => {
      ctx.undo();
      focusKey('add');
    } } }, 'Undo'));
    after = mine;
  }

  function sync() {
    const features = listOf(project());
    const used = features.length;
    note.textContent = 'Renaming changes it in every room.';
    // the count shows from 30
    countLine.textContent = used >= COUNT_FROM ? used + ' of ' + FEATURES_MOST + ' features.' : '';
    countLine.hidden = used < COUNT_FROM;
    empty.hidden = used > 0;
    rows.hidden = used === 0;
    note.hidden = used === 0;
    addButton.disabled = false;
    if (after !== null && store.version !== after) {
      after = null;
      undone.hidden = true;
      undone.replaceChildren();
    }
    const shape = features.map((feature) => feature.id).join('|') + '#' + features.map((feature) => (describeFeatureDelete(project(), feature.id) || { rooms: 0 }).rooms).join(',');
    const names = features.map((feature) => feature.name).join('|');
    if (shape === builtShape) {
      if (names !== builtNames) {
        builtNames = names;
        features.forEach((feature) => renewals.get(feature.id)(feature));
      }
      return;
    }
    builtShape = shape;
    builtNames = names;
    const active = document.activeElement;
    const had = active && rows.contains(active) ? active.dataset.key : null;
    renewals.clear();
    rows.replaceChildren(...features.map((feature, index) => rowFor(feature, index, features)));
    if (had && !focusKey(had)) addInput.focus();
  }

  function add() {
    const typed = addInput.value;
    if (typed.trim() === '') {
      addRefusal.textContent = 'Type a feature first, like Lab or Sink.';
      addRefusal.hidden = false;
      addInput.setAttribute('aria-invalid', 'true');
      addInput.focus();
      return;
    }
    try {
      store.apply(addFeature, { name: typed });
    } catch (error) {
      if (!(error instanceof ActionError)) throw error;
      addRefusal.textContent = error.message;
      addRefusal.hidden = false;
      addInput.setAttribute('aria-invalid', 'true');
      addInput.focus();
      return;
    }
    addRefusal.hidden = true;
    addInput.removeAttribute('aria-invalid');
    addInput.value = '';
    say(typed.trim() + ' added to the list.');
    addInput.focus();
  }

  addButton.addEventListener('click', add);
  addInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      add();
    }
  });
  addInput.addEventListener('input', () => {
    addRefusal.hidden = true;
    addInput.removeAttribute('aria-invalid');
  });

  const stop = store.subscribe(() => {
    if (dialog.element.isConnected) sync();
  });
  dialog.closed.then(stop);
  sync();
  // the first field takes the focus: the first name, or the Add field of an empty list
  const first = dialog.element.querySelector('[data-key^="name:"]');
  (first || (listOf(project()).length === 0 ? dialog.element.querySelector('[data-key="common"]') : addInput)).focus();
  return dialog;
}
