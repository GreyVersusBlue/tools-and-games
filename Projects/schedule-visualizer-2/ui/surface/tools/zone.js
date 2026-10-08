// Leave out (Z): drag a rectangle over a place that is busy by design (the
// cafeteria doors), and its cells are left out of the congestion colour scale
// and the hotspot table (spec 7.5). Routes through it are still drawn and
// still counted for travel time. The new area's label takes the focus in the
// Floor tab, unless a finger drew it.

import { addZone } from '../../../engine/actions.js';

function box(gesture, ev) {
  const x = Math.min(gesture.x, ev.x);
  const y = Math.min(gesture.y, ev.y);
  return { x, y, w: Math.abs(ev.x - gesture.x) + 1, h: Math.abs(ev.y - gesture.y) + 1 };
}

function show(ed, ev) {
  if (!ed.gesture) return;
  const rect = box(ed.gesture, ev);
  ed.setPreview({ kind: 'rect', rect, as: 'box' });
  ed.pending('Leave out: ' + rect.w + ' by ' + rect.h);
}

export const tool = {
  id: 'zone',
  key: 'z',
  label: 'Leave out',
  name: 'Leave out',
  group: 'more',
  icon: 'M3 4h14v12H3z M3 12l8-8 M7 16l10-10 M13 16l4-4',
  hint: 'Leave out: drag a rectangle over a place that is busy by design. It is left out of the colour scale; walks through it still count.',
  cursor: 'crosshair',
  onDown(ed, ev) {
    ed.gesture = { x: ev.x, y: ev.y };
    show(ed, ev);
  },
  onMove: show,
  onUp(ed, ev) {
    if (!ed.gesture) return;
    const rect = box(ed.gesture, ev);
    ed.endGesture();
    const outcome = ed.commit(addZone, { floorId: ed.floor.id, x: rect.x, y: rect.y, w: rect.w, h: rect.h }, {
      done: () => 'Left ' + rect.w + ' by ' + rect.h + ' squares out of the colour scale. Type a label for the area.',
    });
    if (outcome) ed.placedZone(outcome.zoneId, ev);
  },
  onCancel(ed) {
    ed.endGesture();
  },
};
