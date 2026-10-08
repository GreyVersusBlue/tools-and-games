// A tool that paints cells along the path of a drag: Corridor and Stairs.
// A click is one cell. The cells between two places the pointer reported are
// filled in, so a fast drag leaves no gap. One action when the drag ends.

import { lineCells } from '../../../engine/building.js';

// paintTool({ id, key, label, name, group, icon, hint, as, action, done, same })
//   as        how the renderer tints the cells while the drag goes on
//   action    the store action; its payload is { floorId, cells }
//   done      (outcome) => the sentence for what was painted
//   same      the sentence when every cell already was that
export function paintTool(spec) {
  function extend(ed, ev) {
    const gesture = ed.gesture;
    if (!gesture) return;
    if (ev.index !== gesture.last) {
      for (const cell of lineCells(ed.floor, gesture.last, ev.index)) gesture.cells.add(cell);
      gesture.last = ev.index;
    }
    ed.setPreview({ kind: 'cells', cells: Array.from(gesture.cells), as: spec.as });
    ed.pending(spec.name + ': ' + gesture.cells.size + (gesture.cells.size === 1 ? ' cell' : ' cells'));
  }

  return {
    id: spec.id,
    key: spec.key,
    label: spec.label,
    name: spec.name,
    group: spec.group,
    icon: spec.icon,
    hint: spec.hint,
    cursor: 'crosshair',
    onDown(ed, ev) {
      ed.gesture = { cells: new Set([ev.index]), last: ev.index };
      extend(ed, ev);
    },
    onMove: extend,
    onUp(ed, ev) {
      if (!ed.gesture) return;
      extend(ed, ev);
      const cells = Array.from(ed.gesture.cells);
      ed.endGesture();
      ed.commit(spec.action, { floorId: ed.floor.id, cells }, { done: spec.done, same: spec.same });
    },
    onCancel(ed) {
      ed.endGesture();
    },
  };
}
