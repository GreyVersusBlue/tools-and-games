// Pan (H): a drag moves the map. From the keyboard, hold Space and use the
// arrows, with any tool.

export const tool = {
  id: 'pan',
  key: 'h',
  label: 'Pan',
  name: 'Pan',
  group: 'main',
  icon: 'M10 3v14 M3 10h14 M8 5l2-2 2 2 M8 15l2 2 2-2 M5 8l-2 2 2 2 M15 8l2 2-2 2',
  hint: 'Pan: drag to move the map. From the keyboard, hold Space and press the arrows.',
  cursor: 'grab',
  onDown(ed, ev) {
    return ev.source === 'keyboard' ? false : 'pan';
  },
  onMove() {},
  onUp() {},
  onCancel() {},
};
