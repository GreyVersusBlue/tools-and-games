// The addresses of the Groups tab, written and read. No page is needed for
// either, so a plain Node test can ask (test/ui/room-picker.test.mjs and
// test/ui/schedule-address.test.mjs).
//
//   #schedule/groups                                  the list of groups
//   #schedule/groups/<groupId>                        a group, its editor open
//   #schedule/groups/<groupId>/<dayTypeId>/<period>   one slot of it
//
// with the period counted from 0, as the model counts it. On a phone the list
// and a group's editor take turns, and these are the two places: Back from an
// editor is the list (DECISIONS 2026-10-12 14:47). `#schedule` alone is the
// Groups tab too, and so the list.

import { findDayType, effectiveDayType } from '../../engine/day-types.js';

export const GROUPS_HASH = '#schedule/groups';

export function groupHash(groupId) {
  return GROUPS_HASH + '/' + encodeURIComponent(String(groupId));
}

export function slotHash(groupId, dayTypeId, period) {
  return GROUPS_HASH + '/' + [groupId, dayTypeId, period].map((part) => encodeURIComponent(String(part))).join('/');
}

function decoded(part) {
  try {
    return decodeURIComponent(part);
  } catch (error) {
    return part;
  }
}

// What an address of the Groups tab names in this project. `rest` is what
// follows "#schedule/".
//
//   { group, slot }
//
// `group` is the group named, or null when none is named or the one named is
// not in the project (deleted since the address was written, or never there).
// `slot` is { dayTypeId, period } when the address goes on to name a slot the
// project has, and null otherwise: a day type that is gone, a period past the
// school's last, or a period that is no whole number name no slot, and the
// group is still opened. A day type that is the same as another gives the
// day it copies, since that is the one with rows.
export function readAddress(project, rest) {
  const parts = String(rest || '').split('/').map(decoded);
  const group = parts[1] ? project.groups.find((each) => each.id === parts[1]) || null : null;
  if (!group) return { group: null, slot: null };
  const dayType = parts[2] ? findDayType(project, parts[2]) : null;
  const period = /^\d+$/.test(parts[3] || '') ? Number(parts[3]) : -1;
  const slot = dayType && period >= 0 && period < project.settings.periods
    ? { dayTypeId: effectiveDayType(project, dayType.id).id, period }
    : null;
  return { group, slot };
}

// The part of a whole address after "#schedule/", or null for an address of
// another section.
export function scheduleRest(hash) {
  const match = /^#\/?schedule(?:\/(.*))?$/.exec(String(hash));
  return match ? match[1] || '' : null;
}

// Is this address the list of groups as written: the Groups tab with no
// group in it at all? (An address naming a group the project no longer has
// shows the list too, but it is still that group's place in the history.)
export function writtenAsList(hash) {
  const rest = scheduleRest(hash);
  return rest !== null && /^(groups\/?)?$/.test(rest);
}

// Does this address show the list in this project: the Groups tab with no
// group in it that the project has?
export function showsList(project, hash) {
  const rest = scheduleRest(hash);
  if (rest === null) return false;
  const tab = rest.split('/')[0];
  return (tab === '' || tab === 'groups') && readAddress(project, rest).group === null;
}

// The group an address of the Groups tab names in this project, or null.
export function groupOf(project, hash) {
  const rest = scheduleRest(hash);
  return rest !== null && rest.split('/')[0] === 'groups' ? readAddress(project, rest).group : null;
}

// Does this address name a group the project does not have (deleted since
// the address was written, an Add undone, or never there)? It shows the
// list (`showsList`) but is not written as it, so it is a place in the
// history that is no group's any more.
export function namesGoneGroup(project, hash) {
  const rest = scheduleRest(hash);
  return rest !== null && rest.split('/')[0] === 'groups' && !writtenAsList(hash) && readAddress(project, rest).group === null;
}

// Where an undo entry's `focus` is, as an address, for the message's Show
// (ui/app.js, `hashForFocus`, hands it the shell's section ids). A change
// to a group's slot is the slot's own address, and one to the group alone
// the group's: `#schedule/groups` alone is the list, and on a phone the
// list is not where the change was. Null for a focus of no section.
export function focusHash(focus, sectionIds) {
  if (!focus || !sectionIds.includes(focus.section)) return null;
  if (focus.section === 'building' && focus.floorId) return '#building/' + focus.floorId;
  if (focus.section === 'schedule' && focus.tab === 'groups' && focus.groupId) {
    return focus.dayTypeId && Number.isInteger(focus.period) ? slotHash(focus.groupId, focus.dayTypeId, focus.period) : groupHash(focus.groupId);
  }
  if (focus.section === 'schedule' && focus.tab) return '#schedule/' + focus.tab;
  return '#' + focus.section;
}
