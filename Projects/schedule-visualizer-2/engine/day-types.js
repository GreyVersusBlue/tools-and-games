// The one rule for "same as A Day". A day type whose `own` is false has no
// bells and no group days of its own: everything that asks about it is
// answered from the base day type, dayTypes[0]. Every screen, check, print and
// published file asks through here.

import { emptyDay } from './schema.js';

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
// otherwise the base. Null when D is not a day type of this project.
export function effectiveDayType(project, dayTypeId) {
  const dayType = findDayType(project, dayTypeId);
  if (!dayType) return null;
  return isOwnCopy(project, dayTypeId) ? dayType : baseDayType(project);
}

export function ownDayTypes(project) {
  return project.dayTypes.filter((dayType, index) => index === 0 || dayType.own === true);
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

// For the line on screen: { name, own, sameAs } where sameAs is the base day
// type's name when D follows it, else null.
export function describeDayType(project, dayTypeId) {
  const dayType = findDayType(project, dayTypeId);
  if (!dayType) return null;
  const own = isOwnCopy(project, dayTypeId);
  return { name: dayType.name, own, sameAs: own ? null : baseDayType(project).name };
}
