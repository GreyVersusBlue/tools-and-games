// The checks report on paper (spec 5.7): the summary in a sentence, a table of
// findings per severity, the accepted findings with their reasons, then a
// teacher-by-period grid for each day type that is its own copy, with the
// cells a finding is about marked.
//
// Every finding has a reference: P1, P2 … for problems, W1 … for warnings,
// N1 … for notes, in the order of the tables. A marked cell of the grid
// carries the references of its findings, so a mark is read by its letter and
// number and never by its colour alone.
//
// The findings are the checks' own (engine/checks.js), never worked out here.
// A caller that has them passes them as `derived.findings`
// ({ findings, accepted, gone }); one that has only the walk figures passes
// `derived.walks`; with neither, the checks run without walk figures and the
// report says the two walking checks are not in it.
//
// render(project, derived, options) → { title, html }; options as document.js

import { checkSchedule } from '../../engine/checks.js';
import { sortFindings, countBySeverity, SEVERITIES } from '../../engine/findings.js';
import { teacherDays, entryRoomIds } from '../../engine/teacher-day.js';
import { ownDayTypes, findDayType } from '../../engine/day-types.js';
import { bellsFor, periodName, formatTime } from '../../engine/bells.js';
import { findRoom } from '../../engine/schema.js';
import { count, list } from '../components/words.js';
import { esc, frame, printDate } from './document.js';

export const id = 'checks';
export const name = 'Checks report';

const LETTER = { problem: 'P', warning: 'W', note: 'N' };
const HEADING = { problem: 'Problems', warning: 'Warnings', note: 'Notes' };
const MEANING = {
  problem: 'The schedule cannot run as written.',
  warning: 'The schedule runs and somebody pays.',
  note: 'Facts worth knowing.',
};

// The checks' answer for this report, and whether walk figures were in it.
export function findingsFor(project, derived) {
  if (derived && derived.findings && Array.isArray(derived.findings.findings)) {
    return { result: derived.findings, walks: derived.walks !== null && derived.walks !== undefined };
  }
  const walks = derived && derived.walks ? derived.walks : null;
  return { result: checkSchedule(project, walks), walks: walks !== null };
}

// The open findings in the tables' order, each with its reference.
export function numbered(project, findings) {
  const next = { problem: 0, warning: 0, note: 0 };
  return sortFindings(findings, project).map((finding) => {
    next[finding.severity] += 1;
    return { finding, ref: LETTER[finding.severity] + next[finding.severity] };
  });
}

// Where the grid marks a finding. A finding of one period marks the cell of
// each teacher it is about: the teacher it names, or the teachers who have
// one of its groups, or are in its room, in that period. A finding of a whole
// day that names a teacher marks the teacher's name on that day's grid.
// Anything else (a room nobody uses, a room with no subject) is about no
// cell and is in the tables only.
//   gridMarks(project, dayTypeId, days, list) → { cells: Map("teacherId:period" → [ref entries]), rows: Map(teacherId → [ref entries]) }
export function gridMarks(project, dayTypeId, days, entries) {
  const cells = new Map();
  const rows = new Map();
  const put = (map, key, entry) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(entry);
  };
  for (const entry of entries) {
    const where = entry.finding.where;
    if (where.dayTypeId !== dayTypeId) continue;
    if (where.period === null) {
      if (where.teacherId !== null && days.has(where.teacherId)) put(rows, where.teacherId, entry);
      continue;
    }
    for (const [teacherId, day] of days) {
      const slot = day[where.period];
      if (!slot) continue;
      const about = where.teacherId !== null
        ? where.teacherId === teacherId
        : slot.groups.some((taught) => where.groupIds.includes(taught.groupId)) || (where.roomId !== null && where.groupIds.length === 0 && entryRoomIds(slot).includes(where.roomId));
      if (about) put(cells, teacherId + ':' + where.period, entry);
    }
  }
  return { cells, rows };
}

function marks(entries) {
  if (!entries || entries.length === 0) return '';
  return '<span class="marks">' + entries.map((entry) => '<span class="mark mark--' + entry.finding.severity + '">' + esc(entry.ref) + '</span>').join('') + '</span>';
}

function whenOf(project, finding) {
  const where = finding.where;
  const dayType = where.dayTypeId === null ? null : findDayType(project, where.dayTypeId);
  const parts = [];
  if (dayType) parts.push(dayType.name);
  if (where.period !== null) parts.push(periodName(project.settings, where.period));
  return parts.join(', ');
}

function findingsTable(project, severity, entries) {
  const rows = entries.filter((entry) => entry.finding.severity === severity);
  const out = ['<section class="doc-section">', '<h2>' + HEADING[severity] + ' <span class="doc-count">' + rows.length + '</span></h2>'];
  if (rows.length === 0) {
    out.push('<p class="doc-none">' + (severity === 'problem' ? 'No problems.' : severity === 'warning' ? 'No warnings.' : 'No notes.') + '</p>');
  } else {
    out.push('<p class="doc-meaning">' + MEANING[severity] + '</p>');
    out.push('<table class="doc-table doc-table--findings">');
    out.push('<thead><tr><th scope="col">No.</th><th scope="col">Finding</th><th scope="col">When</th></tr></thead><tbody>');
    for (const entry of rows) {
      out.push('<tr><th scope="row"><span class="mark mark--' + severity + '">' + esc(entry.ref) + '</span></th><td>' + esc(entry.finding.text) + '</td><td class="doc-when">' + esc(whenOf(project, entry.finding)) + '</td></tr>');
    }
    out.push('</tbody></table>');
  }
  out.push('</section>');
  return out.join('\n');
}

function acceptedTable(project, accepted) {
  if (accepted.length === 0) return '';
  const out = ['<section class="doc-section">', '<h2>Accepted <span class="doc-count">' + accepted.length + '</span></h2>',
    '<p class="doc-meaning">Findings the school has looked at and accepted. They are not in the counts above.</p>',
    '<table class="doc-table doc-table--findings">',
    '<thead><tr><th scope="col">Finding</th><th scope="col">Reason</th><th scope="col">Accepted</th></tr></thead><tbody>'];
  for (const finding of sortFindings(accepted, project)) {
    const record = finding.accepted || {};
    out.push('<tr><td>' + esc(finding.text) + '</td><td>' + esc(record.reason) + '</td><td class="doc-when">' + esc(printDate(record.at)) + '</td></tr>');
  }
  out.push('</tbody></table>', '</section>');
  return out.join('\n');
}

function roomText(project, roomId) {
  const room = roomId === null ? null : findRoom(project, roomId);
  return room && typeof room.number === 'string' && room.number.trim() !== '' ? room.number : '';
}

function teacherGrid(project, dayType, entries) {
  const settings = project.settings;
  const days = teacherDays(project, dayType.id);
  const bells = bellsFor(project, dayType.id);
  const { cells, rows } = gridMarks(project, dayType.id, days, entries);
  const out = ['<section class="doc-section doc-section--grid new-sheet">', '<h2>' + esc('Teachers by ' + String(settings.periodWord).toLowerCase() + ': ' + dayType.name) + '</h2>'];
  if (project.teachers.length === 0) {
    out.push('<p class="doc-none">There are no teachers yet.</p>', '</section>');
    return out.join('\n');
  }
  out.push('<table class="doc-table doc-grid">');
  out.push('<thead><tr><th scope="col">Teacher</th>');
  for (let period = 0; period < settings.periods; period += 1) {
    const bell = bells[period];
    const times = bell && bell.start && bell.end ? formatTime(bell.start, settings.timeFormat, { suffix: false }) + '–' + formatTime(bell.end, settings.timeFormat, { suffix: false }) : '';
    out.push('<th scope="col">' + esc(periodName(settings, period)) + (times === '' ? '' : '<span class="doc-grid__time">' + esc(times) + '</span>') + '</th>');
  }
  out.push('</tr></thead><tbody>');
  for (const teacher of project.teachers) {
    const day = days.get(teacher.id);
    const rowMarks = rows.get(teacher.id);
    out.push('<tr><th scope="row"' + (rowMarks ? ' class="is-marked"' : '') + '>' + esc(teacher.name) + marks(rowMarks) + '</th>');
    for (const slot of day) {
      const cellMarks = cells.get(teacher.id + ':' + slot.period);
      const classes = [slot.kind === 'planning' ? 'is-planning' : 'is-teaching'].concat(cellMarks ? ['is-marked'] : []);
      let inside;
      if (slot.kind === 'planning') {
        inside = '<span class="doc-grid__planning">Planning</span>';
      } else {
        inside = slot.groups.map((taught) => {
          const group = project.groups.find((candidate) => candidate.id === taught.groupId);
          const room = roomText(project, taught.roomId);
          return '<span class="doc-grid__group">' + esc(group ? group.name : '') + (room === '' ? '' : '<span class="doc-grid__room">' + esc(room) + '</span>') + '</span>';
        }).join('');
      }
      out.push('<td class="' + classes.join(' ') + '">' + inside + marks(cellMarks) + '</td>');
    }
    out.push('</tr>');
  }
  out.push('</tbody></table>', '</section>');
  return out.join('\n');
}

function summary(project, counts, accepted, walks, entries) {
  const total = counts.problem + counts.warning + counts.note;
  const lines = [];
  if (total === 0) {
    lines.push('The checks found nothing in this schedule.');
  } else {
    lines.push('The checks found ' + list([count(counts.problem, 'problem'), count(counts.warning, 'warning'), count(counts.note, 'note')]) + ' in this schedule.');
  }
  if (accepted > 0) lines.push((accepted === 1 ? '1 more finding has' : accepted + ' more findings have') + ' been accepted and ' + (accepted === 1 ? 'is' : 'are') + ' listed apart.');
  if (!walks) lines.push('Walking times had not been worked out when this was printed, so the two checks on walks that do not fit the passing time are not in it.');
  const off = project.settings.checks && Array.isArray(project.settings.checks.off) ? project.settings.checks.off.length : 0;
  if (off > 0) lines.push(count(off, 'check') + (off === 1 ? ' is' : ' are') + ' switched off in Settings.');
  const figures = SEVERITIES.map((severity) => '<li class="doc-figure doc-figure--' + severity + '"><span class="doc-figure__n">' + counts[severity] + '</span> ' + HEADING[severity].toLowerCase() + '</li>').join('');
  return '<section class="doc-section doc-summary">\n<p class="doc-lead">' + esc(lines.join(' ')) + '</p>\n<ul class="doc-figures">' + figures + '</ul>\n'
    + (entries.length > 0 ? '<p class="doc-meaning">Each finding has a number (P for a problem, W for a warning, N for a note). The same number marks the cell it is about in the grids at the end.</p>\n' : '')
    + '</section>';
}

export function render(project, derived, options) {
  const opts = options || {};
  const { result, walks } = findingsFor(project, derived);
  const entries = numbered(project, result.findings);
  const counts = countBySeverity(result.findings);
  const accepted = Array.isArray(result.accepted) ? result.accepted : [];

  const body = [summary(project, counts, accepted.length, walks, entries)];
  for (const severity of SEVERITIES) body.push(findingsTable(project, severity, entries));
  body.push(acceptedTable(project, accepted));
  const own = ownDayTypes(project);
  for (const dayType of own) body.push(teacherGrid(project, dayType, entries));
  const followers = project.dayTypes.filter((dayType) => !own.includes(dayType));
  if (followers.length > 0) {
    const base = project.dayTypes[0].name;
    body.push('<p class="doc-meaning">' + esc(list(followers.map((dayType) => dayType.name)) + (followers.length === 1 ? ' is' : ' are') + ' the same as ' + base + ' and ' + (followers.length === 1 ? 'has' : 'have') + ' no grid of ' + (followers.length === 1 ? 'its' : 'their') + ' own.') + '</p>');
  }
  return frame(project, { output: id, what: name, pages: [{ body: body.filter((part) => part !== '').join('\n') }], options: opts });
}
