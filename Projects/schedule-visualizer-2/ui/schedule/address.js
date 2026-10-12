// The addresses of the Groups tab, written and read. No page is needed for
// either, so a plain Node test can ask (test/ui/room-picker.test.mjs).
//
//   #schedule/groups                                  the list of groups
//   #schedule/groups/<groupId>                        a group, its editor open
//   #schedule/groups/<groupId>/<dayTypeId>/<period>   one slot of it
//
// with the period counted from 0, as the model counts it. On a phone the list
// and a group's editor take turns, and these are the two places: Back from an
// editor is the list (DECISIONS 2026-10-12 14:47).

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
