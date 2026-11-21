// The one rule for "same as". A day type whose `own` is false has no bells
// and no group days of its own: everything that asks about it is answered
// from the own day type it is the same as, `sameAs`, or from the base day
// type, dayTypes[0], when `sameAs` is null, absent, or names anything but
// another own day type (one hop only; ARCHITECTURE 17.2). Every screen,
// check, print and published file asks through here.

import { emptyDay, SHORT_MOST } from './schema.js';

export function baseDayType(project) {
  return project.dayTypes[0];
}

export function findDayType(project, dayTypeId) {
  return project.dayTypes.find((dayType) => dayType.id === dayTypeId) || null;
}

// Is day type D its own copy? The base day type always is.
export function isOwnCopy(project, dayTypeId) {
  const index = project.dayTypes.findIndex((dayType) => dayType.id === dayTypeId);
  if (index === -1) return false;
  return index === 0 || project.dayTypes[index].own === true;
}

// The day type whose data answers for D: D itself when it is its own copy,
// otherwise the own day type its `sameAs` names, otherwise the base. Null
// when D is not a day type of this project.
export function effectiveDayType(project, dayTypeId) {
  const dayType = findDayType(project, dayTypeId);
  if (!dayType) return null;
  if (isOwnCopy(project, dayTypeId)) return dayType;
  const sameAs = typeof dayType.sameAs === 'string' && dayType.sameAs !== dayType.id ? dayType.sameAs : null;
  if (sameAs !== null && isOwnCopy(project, sameAs)) return findDayType(project, sameAs);
  return baseDayType(project);
}

export function ownDayTypes(project) {
  return project.dayTypes.filter((dayType, index) => index === 0 || dayType.own === true);
}

// The day types that are the same as own day type D, in display order.
export function followersOf(project, dayTypeId) {
  return project.dayTypes.filter((dayType) => dayType.id !== dayTypeId && !isOwnCopy(project, dayType.id) && effectiveDayType(project, dayType.id).id === dayTypeId);
}

// What does day type D mean for group G? One slot per period. Null when the
// group or the day type does not exist.
export function effectiveSchedule(project, groupId, dayTypeId) {
  const group = project.groups.find((candidate) => candidate.id === groupId);
  const dayType = effectiveDayType(project, dayTypeId);
  if (!group || !dayType) return null;
  const day = group.days ? group.days[dayType.id] : undefined;
  return Array.isArray(day) ? day : emptyDay(project.settings.periods);
}

// For the line on screen: { name, own, sameAs, follows } where sameAs and
// follows are both the name of the day type D is the same as ("B Day: same
// as A Day"), or null when D is its own copy. `sameAs` is the older name of
// the two and stays for its callers.
export function describeDayType(project, dayTypeId) {
  const dayType = findDayType(project, dayTypeId);
  if (!dayType) return null;
  const own = isOwnCopy(project, dayTypeId);
  const follows = own ? null : effectiveDayType(project, dayTypeId).name;
  return { name: dayType.name, own, sameAs: follows, follows };
}

// ---------------------------------------------------------------- short names

const shortCache = new WeakMap();

function letters(text) {
  return Array.from(text);
}

// The short names a name can have, in the order they are tried: the name
// less a trailing " Day" when that leaves 1 to 3 characters ("A Day" gives
// "A"), the initials of up to three words ("Early Release" gives "ER"), those
// initials with more letters of the last word ("ERe", "ERel"), then a digit
// on the first of them ("ER2", "ER3"…). Nothing is longer than SHORT_MOST.
function shortCandidates(name, index) {
  const candidates = [];
  const trimmed = String(name).trim();
  const words = trimmed.split(/\s+/u).filter((word) => word !== '');
  const dayless = trimmed.replace(/\s+day$/iu, '');
  if (dayless !== trimmed && letters(dayless).length >= 1 && letters(dayless).length <= 3) candidates.push(dayless);
  if (words.length > 0) {
    const initials = words.slice(0, 3).map((word) => letters(word)[0]).join('');
    candidates.push(initials);
    const last = letters(words[Math.min(words.length, 3) - 1]);
    let grown = initials;
    for (let i = 1; i < last.length && letters(grown).length < SHORT_MOST; i += 1) {
      grown += last[i];
      candidates.push(grown);
    }
  }
  const stem = candidates.length > 0 ? letters(candidates[0]).slice(0, SHORT_MOST - 1).join('') : '';
  for (let n = stem === '' ? index + 1 : 2; ; n += 1) {
    const digits = String(n);
    candidates.push(letters(stem).slice(0, Math.max(0, SHORT_MOST - digits.length)).join('') + digits);
    if (candidates.length > 200) break;
  }
  return candidates;
}

// Every item's short name in one list, unique ignoring case: a typed `short`
// as it is (validate refuses two typed ones alike), then each other item in
// list order takes the first of its candidates nobody has.
function shortNames(all) {
  const cached = shortCache.get(all);
  if (cached) return cached;
  const result = new Map();
  const taken = new Set();
  const typed = (item) => (item && typeof item.short === 'string' && item.short !== '' ? item.short : null);
  for (const item of all) {
    const short = typed(item);
    if (short !== null) {
      result.set(item, short);
      taken.add(short.toLowerCase());
    }
  }
  all.forEach((item, index) => {
    if (result.has(item)) return;
    const name = item && typeof item.name === 'string' ? item.name : '';
    const short = shortCandidates(name, index).find((candidate) => !taken.has(candidate.toLowerCase()));
    taken.add(short.toLowerCase());
    result.set(item, short);
  });
  shortCache.set(all, result);
  return result;
}

// D's short name for the calendar's squares ("A", "C"), unique among `all`,
// the project's day types.
export function dayShort(dayType, all) {
  const list = Array.isArray(all) && all.includes(dayType) ? all : [dayType];
  return shortNames(list).get(dayType);
}

// A bell schedule's short name ("ER"), unique among `all`, the project's bell
// schedules. The same rule as a day type's.
export function bellsShort(schedule, all) {
  return dayShort(schedule, all);
}
