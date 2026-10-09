// What the grid has staged and not applied. Nothing here touches the page:
// a draft is a list of changes, the schedule as it would be after them is
// worked out by the one action that applies them (applyGridEdits), and the
// summary on the bar is counted from that.
//
// Drafts are kept per project for as long as the page is open, so leaving the
// Grid tab or the Schedule section loses nothing. They are not saved: a draft
// is not part of the project until it is applied.
//
//   draft.slots    Map of "group|dayType|period" to the slot's new fields
//   draft.groups   Map of group id to { name, grade, headCount, colour }, any of them
//   draft.added    [{ id, name, grade, headCount, colour }]
//   draft.removed  Set of group ids

import { applyGridEdits, countGroupChanges, groupChangesText } from '../../../engine/actions.js';
import { isOwnCopy } from '../../../engine/day-types.js';
import { emptySlot, findRoom } from '../../../engine/schema.js';

const drafts = new Map();
const watchers = new Set();

function newDraft() {
  return { slots: new Map(), groups: new Map(), added: [], removed: new Set(), version: 0, seen: null };
}

export function isEmptyDraft(draft) {
  return draft.slots.size === 0 && draft.groups.size === 0 && draft.added.length === 0 && draft.removed.size === 0;
}

// The draft for a project, made when first asked for.
export function draftFor(projectId) {
  if (!drafts.has(projectId)) drafts.set(projectId, newDraft());
  return drafts.get(projectId);
}

// Does this project have grid edits that are not applied?
export function gridEditsPending(projectId) {
  const draft = drafts.get(projectId);
  return Boolean(draft) && !isEmptyDraft(draft);
}

// Does any project?
export function anyGridEditsPending() {
  for (const draft of drafts.values()) if (!isEmptyDraft(draft)) return true;
  return false;
}

// Be told when a project starts or stops having unapplied grid edits:
// fn(projectId, pending). Returns the function that stops the telling.
export function watchGridEdits(fn) {
  watchers.add(fn);
  return () => watchers.delete(fn);
}

function tell(projectId, draft) {
  const pending = !isEmptyDraft(draft);
  if (draft.seen === pending) return;
  draft.seen = pending;
  for (const fn of watchers) fn(projectId, pending);
}

// Say a draft was changed: what was worked out from it is stale.
export function touch(projectId) {
  const draft = draftFor(projectId);
  draft.version += 1;
  tell(projectId, draft);
}

export function discard(projectId) {
  const draft = draftFor(projectId);
  draft.slots.clear();
  draft.groups.clear();
  draft.added = [];
  draft.removed.clear();
  touch(projectId);
}

export function slotKeyOf(groupId, dayTypeId, period) {
  return groupId + '|' + dayTypeId + '|' + period;
}

function sameIds(a, b) {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

// The part of a staged slot that differs from the slot as it stands, or null.
function slotDifference(current, staged) {
  const out = {};
  if (staged.room !== undefined || staged.roomText !== undefined) {
    const room = staged.room === undefined ? current.room : staged.room;
    const roomText = room !== null ? '' : staged.roomText === undefined ? '' : staged.roomText;
    if (room !== current.room || roomText !== current.roomText) {
      out.room = room;
      out.roomText = roomText;
    }
  }
  if (staged.label !== undefined && staged.label !== current.label) out.label = staged.label;
  if (staged.teacherIds !== undefined && !sameIds(staged.teacherIds, current.teacherIds)) out.teacherIds = staged.teacherIds;
  return Object.keys(out).length > 0 ? out : null;
}

// Drop from a draft whatever the project has made pointless since it was
// staged: a change to a group that is gone, to a day type that is no longer
// its own copy, to a period past the end of the day, to a room that has left
// the building; and a change that leaves the thing as it already is.
export function reconcile(project, draft) {
  const groups = new Map(project.groups.map((group) => [group.id, group]));
  for (const id of Array.from(draft.removed)) if (!groups.has(id)) draft.removed.delete(id);
  draft.added = draft.added.filter((group) => !groups.has(group.id));
  const added = new Set(draft.added.map((group) => group.id));
  for (const [id, fields] of Array.from(draft.groups)) {
    const group = groups.get(id);
    if (!group || draft.removed.has(id)) {
      draft.groups.delete(id);
      continue;
    }
    for (const key of Object.keys(fields)) if (fields[key] === group[key]) delete fields[key];
    if (Object.keys(fields).length === 0) draft.groups.delete(id);
  }
  for (const [key, staged] of Array.from(draft.slots)) {
    const [groupId, dayTypeId, periodText] = key.split('|');
    const period = Number(periodText);
    const group = groups.get(groupId);
    const known = (group && !draft.removed.has(groupId)) || added.has(groupId);
    const roomGone = typeof staged.room === 'string' && !findRoom(project, staged.room);
    if (!known || !isOwnCopy(project, dayTypeId) || period >= project.settings.periods || roomGone) {
      draft.slots.delete(key);
      continue;
    }
    const current = group && group.days[dayTypeId] ? group.days[dayTypeId][period] : emptySlot();
    const difference = slotDifference(current, staged);
    if (difference) draft.slots.set(key, difference);
    else draft.slots.delete(key);
  }
}

// A draft as the payload applyGridEdits takes.
export function payloadOf(draft) {
  return {
    removed: Array.from(draft.removed),
    groups: Array.from(draft.groups, ([id, fields]) => ({ id, ...fields })),
    added: draft.added.map((group) => ({ ...group })),
    slots: Array.from(draft.slots, ([key, slot]) => {
      const [groupId, dayTypeId, period] = key.split('|');
      return { groupId, dayTypeId, period: Number(period), slot };
    }),
  };
}

// The schedule as it would be once the draft is applied:
// { project, counts, text, refusal }. `text` is the summary for the bar
// ("3 groups changed, 1 added"). When the draft cannot be applied as it
// stands, `project` is the schedule as it is and `refusal` says why.
export function preview(project, projectId, ctx) {
  const draft = draftFor(projectId);
  if (draft.cache && draft.cache.project === project && draft.cache.version === draft.version) return draft.cache.result;
  reconcile(project, draft);
  tell(projectId, draft);
  let result;
  try {
    const after = applyGridEdits(project, payloadOf(draft), ctx);
    const counts = countGroupChanges(project, after);
    result = { project: after, counts, text: groupChangesText(counts), refusal: null };
  } catch (error) {
    result = { project, counts: { changed: 0, added: 0, removed: 0 }, text: 'changes that cannot be applied as they stand', refusal: error && error.message ? error.message : 'They cannot be applied.' };
  }
  draft.cache = { project, version: draft.version, result };
  return result;
}

// ---------------------------------------------------------------- staging

// One slot. `fields` has any of { room, roomText, label, teacherIds }; a
// room and its text go together.
export function stageSlot(projectId, groupId, dayTypeId, period, fields) {
  const draft = draftFor(projectId);
  const key = slotKeyOf(groupId, dayTypeId, period);
  draft.slots.set(key, { ...(draft.slots.get(key) || {}), ...fields });
}

// One of a group's own fields: name, grade, headCount or colour.
export function stageField(projectId, groupId, field, value) {
  const draft = draftFor(projectId);
  const added = draft.added.find((group) => group.id === groupId);
  if (added) added[field] = value;
  else draft.groups.set(groupId, { ...(draft.groups.get(groupId) || {}), [field]: value });
}

export function stageAdd(projectId, group) {
  draftFor(projectId).added.push(group);
}

// Remove a group. One that was only ever staged goes, with its slots.
export function stageRemove(projectId, groupId) {
  const draft = draftFor(projectId);
  if (draft.added.some((group) => group.id === groupId)) {
    draft.added = draft.added.filter((group) => group.id !== groupId);
    for (const key of Array.from(draft.slots.keys())) if (key.startsWith(groupId + '|')) draft.slots.delete(key);
  } else {
    draft.removed.add(groupId);
  }
}

export function stageKeep(projectId, groupId) {
  draftFor(projectId).removed.delete(groupId);
}

// ---------------------------------------------------------------- taking a step back

const STEPS = 100;

// Keep the draft as it is now, so the next change to it can be taken back.
export function remember(projectId) {
  const draft = draftFor(projectId);
  if (!draft.steps) draft.steps = [];
  draft.steps.push({
    slots: new Map(Array.from(draft.slots, ([key, slot]) => [key, { ...slot }])),
    groups: new Map(Array.from(draft.groups, ([id, fields]) => [id, { ...fields }])),
    added: draft.added.map((group) => ({ ...group })),
    removed: new Set(draft.removed),
  });
  if (draft.steps.length > STEPS) draft.steps.shift();
}

// Put the draft back as it was before the last change. False when there is
// nothing to take back.
export function takeBack(projectId) {
  const draft = draftFor(projectId);
  const step = draft.steps && draft.steps.pop();
  if (!step) return false;
  Object.assign(draft, step);
  touch(projectId);
  return true;
}

export function forgetSteps(projectId) {
  draftFor(projectId).steps = [];
}
