// Recovery points: complete copies of the project, kept in their own database
// (sv2-recovery) so that losing the main save does not lose them too. Each
// point stands on its own: it carries the project and the bytes of every
// traced image the project names.
//
// One is taken every 3 minutes when the project has changed since the last
// one, when the page is left, and before anything that replaces the whole
// project. The newest 8 are kept (db.js, RECOVERY_KEEP).
//
// No DOM here. The session (session.js) owns the timer and the page events.

import { summarise } from '../engine/project-file.js';
import { imageIdsOf } from './db.js';

export const RECOVERY_INTERVAL_MS = 3 * 60 * 1000;
export const RECOVERY_REASONS = ['timer', 'leave', 'replace', 'import', 'restore'];

// The four figures a point is listed by.
export function pointSummary(project) {
  const all = summarise(project);
  return { floors: all.floors, rooms: all.rooms, groups: all.groups, teachers: all.teachers };
}

// How much a project weighs when stored: its JSON as UTF-8, plus its images.
export function projectBytes(project, images) {
  let bytes = new Blob([JSON.stringify(project)]).size;
  for (const blob of Object.values(images || {})) bytes += blob && Number.isFinite(blob.size) ? blob.size : 0;
  return bytes;
}

// buildPoint(project, reason, takenAt, blobs) -> the record to store.
//   blobs   anything with get(imageId) -> Blob, for the images on this device
export function buildPoint(project, reason, takenAt, blobs) {
  if (!RECOVERY_REASONS.includes(reason)) throw new TypeError('A recovery point is taken for one of: ' + RECOVERY_REASONS.join(', ') + '.');
  const images = {};
  for (const id of imageIdsOf(project)) {
    const blob = blobs ? blobs.get(id) : null;
    if (blob) images[id] = blob;
  }
  return { takenAt, reason, summary: pointSummary(project), bytes: projectBytes(project, images), project, images };
}

// Is this what a point looks like? A record that fails is listed as
// unreadable rather than hidden.
export function isPoint(value) {
  return value !== null && typeof value === 'object'
    && typeof value.takenAt === 'string'
    && value.project !== null && typeof value.project === 'object' && !Array.isArray(value.project);
}
