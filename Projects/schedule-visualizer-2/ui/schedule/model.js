// What the checks say about the schedule, arranged for the screen: the open
// findings in table order, the accepted ones (with the records that no longer
// stand: changed, switched off, gone), and which findings are about each
// group, slot, teacher and room. The rule is engine/checks.js; nothing is
// decided here. It is worked out once per project state and kept until the
// project changes.

import { checkSchedule } from '../../engine/checks.js';
import { sortFindings, countBySeverity } from '../../engine/findings.js';

export function slotKey(groupId, dayTypeId, period) {
  return groupId + '|' + dayTypeId + '|' + period;
}

function push(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

let last = null;

// `walks` is the crowd model's walk results, or null while nothing has
// worked them out (the walk-time checks then find nothing).
export function scheduleModel(project, walks) {
  if (last && last.project === project && last.walks === walks) return last.model;
  const result = checkSchedule(project, walks || null);
  const findings = sortFindings(result.findings, project);
  const model = {
    findings,
    accepted: sortFindings(result.accepted, project),
    // an accepted record whose finding names somebody else now, beside that
    // finding as it stands (null when it has moved to another id: a run of
    // periods that starts somewhere else)
    changed: result.changed.map((record) => ({ record, finding: findings.find((finding) => finding.id === record.findingId) || null })),
    // an accepted record whose check is switched off, and which check that is
    off: result.off.map((record) => ({ record, kind: String(record.findingId).split(':')[0] })),
    gone: result.gone,
    counts: countBySeverity(findings),
    walksKnown: Boolean(walks),
    byGroup: new Map(),
    bySlot: new Map(),
    byDay: new Map(),
    byTeacher: new Map(),
    byRoom: new Map(),
  };
  for (const finding of findings) {
    const where = finding.where;
    for (const groupId of where.groupIds) {
      push(model.byGroup, groupId, finding);
      if (where.dayTypeId !== null && where.period !== null) push(model.bySlot, slotKey(groupId, where.dayTypeId, where.period), finding);
      else if (where.dayTypeId !== null) push(model.byDay, groupId + '|' + where.dayTypeId, finding);
    }
    if (where.teacherId !== null) push(model.byTeacher, where.teacherId, finding);
    if (where.roomId !== null) push(model.byRoom, where.roomId, finding);
  }
  last = { project, walks, model };
  return model;
}
