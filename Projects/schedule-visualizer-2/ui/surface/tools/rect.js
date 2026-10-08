// A tool that places a rectangle: Room and Other space. A click is one cell,
// a drag is the rectangle between where it started and where it ended. One
// action when the drag ends.

// rectTool({ id, key, label, name, group, icon, hint, as, action, done, placed })
//   placed   (ed, outcome, ev) after the action, for what the tool does next
export function rectTool(spec) {
  function box(gesture, ev) {
    const x = Math.min(gesture.x, ev.x);
    const y = Math.min(gesture.y, ev.y);
    return { x, y, w: Math.abs(ev.x - gesture.x) + 1, h: Math.abs(ev.y - gesture.y) + 1 };
  }

  function show(ed, ev) {
    if (!ed.gesture) return;
    const rect = box(ed.gesture, ev);
    ed.setPreview({ kind: 'rect', rect, as: spec.as });
    ed.pending(spec.name + ': ' + rect.w + ' by ' + rect.h);
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
      ed.gesture = { x: ev.x, y: ev.y };
      show(ed, ev);
    },
    onMove: show,
    onUp(ed, ev) {
      if (!ed.gesture) return;
      const rect = box(ed.gesture, ev);
      ed.endGesture();
      const outcome = ed.commit(spec.action, { floorId: ed.floor.id, rect }, { done: (result) => spec.done(result, rect) });
      if (outcome && spec.placed) spec.placed(ed, outcome, ev);
    },
    onCancel(ed) {
      ed.endGesture();
    },
  };
}
