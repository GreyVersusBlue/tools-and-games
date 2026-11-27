// Where the sentence of a marked slot is drawn. A marked slot of the Teachers
// or Rooms rows carries its finding's sentence as `data-why`; with the cursor
// on it (the keyboard's, a click's or a tap's: a finger has no title to rest
// on) grid.css draws that sentence beside the slot, and this file works out
// where, by measurement, so that it stays inside the frame the table scrolls
// in (DECISIONS 2026-10-12 10:58).

// Put the sentence of the mark in focus where it can be read, inside the
// frame the table scrolls in: under the slot from its left edge, moved along
// when that would run past the frame's right; over the slot when there is no
// room under it; and when there is room neither way (a table of a row or
// two), against the frame's bottom, over part of the slot. A sentence taller
// than the frame (two findings with long names, in a table of one row) is
// made as wide as the frame lets it be, which makes it shorter; and if it is
// still the taller, the frame is given the height to hold it for as long as
// the mark has the focus. grid.css draws it (a ::after) and reads `--why-x`,
// `--why-y` and `--why-w`, from the slot's own corner.
export function placeWhy(cell, frame) {
  cell.style.removeProperty('--why-x');
  cell.style.removeProperty('--why-y');
  cell.style.removeProperty('--why-w');
  frame.style.removeProperty('min-height');
  const drawn = getComputedStyle(cell, '::after');
  if (drawn.content === 'none') return;
  let height = parseFloat(drawn.height);
  if (height > frame.clientHeight) {
    cell.style.setProperty('--why-w', Math.max(0, frame.clientWidth - 2) + 'px');
    height = parseFloat(drawn.height);
    if (height > frame.clientHeight) frame.style.minHeight = Math.ceil(height + frame.offsetHeight - frame.clientHeight) + 'px';
  }
  const width = parseFloat(drawn.width);
  const at = cell.getBoundingClientRect();
  const around = frame.getBoundingClientRect();
  const left = around.left + frame.clientLeft;
  const top = around.top + frame.clientTop;
  const bottom = top + frame.clientHeight;
  const x = Math.max(left, Math.min(at.left + cell.clientLeft, left + frame.clientWidth - width));
  let y = at.bottom;
  if (y + height > bottom) y = at.top - height >= top ? at.top - height : Math.max(top, bottom - height);
  // a slot that is itself past the frame's foot or head (the window lost
  // height under it, the frame was scrolled away) keeps its sentence at the
  // nearest edge inside
  y = Math.max(top, Math.min(y, bottom - height));
  cell.style.setProperty('--why-x', Math.round(x - at.left - cell.clientLeft) + 'px');
  cell.style.setProperty('--why-y', Math.round(y - at.top - cell.clientTop) + 'px');
}

// The frames on the page that place a sentence when the window changes
// size, and the one window listener that tells them. A table is drawn again
// at every change to the project, and a section is mounted afresh at every
// visit, so a listener of its own each time would be one more at every
// drawing; a frame that has left the page is let go here, at the next
// watching or the next resize, whichever comes first.
const placers = new Map();
let listening = false;
function letGo() {
  for (const [frame, placer] of placers) {
    if (frame.isConnected) continue;
    if (placer.observer) placer.observer.disconnect();
    placers.delete(frame);
  }
}
function placeOnResize(frame, again, observer) {
  letGo();
  placers.set(frame, { again, observer });
  if (listening) return;
  listening = true;
  window.addEventListener('resize', () => {
    letGo();
    for (const placer of placers.values()) placer.again();
  });
}

// Watch a table and the frame it scrolls in: a marked slot that takes the
// focus has its sentence placed, and placed again when what was measured
// moves: the frame scrolled, the frame changed width (the inspector folded),
// or the window changed size. A window that changes height alone moves it
// too: the frame is 70vh at its tallest, and a sentence under the last row
// was placed against the frame's old foot. `data-placed` on the frame is the
// window the last placing was for, and `data-placings` counts them; a test
// waits on them.
export function watchWhy(frame, table) {
  const inFocus = () => {
    const at = document.activeElement;
    return at && at.classList && at.classList.contains('is-marked') && table.contains(at) ? at : null;
  };
  let placings = 0;
  const again = () => {
    const cell = inFocus();
    if (cell) placeWhy(cell, frame);
    placings += 1;
    frame.dataset.placings = String(placings);
    frame.dataset.placed = window.innerWidth + 'x' + window.innerHeight;
  };
  frame.dataset.placings = '0';
  frame.dataset.placed = window.innerWidth + 'x' + window.innerHeight;
  table.addEventListener('focusin', (event) => {
    if (event.target.classList && event.target.classList.contains('is-marked')) placeWhy(event.target, frame);
  });
  table.addEventListener('focusout', () => frame.style.removeProperty('min-height'));
  frame.addEventListener('scroll', again, { passive: true });
  let observer = null;
  if (typeof ResizeObserver === 'function') {
    let width = null;
    observer = new ResizeObserver(() => {
      // its own change of height (made to hold a tall sentence) is not news
      if (frame.clientWidth === width) return;
      width = frame.clientWidth;
      again();
    });
    observer.observe(frame);
  }
  placeOnResize(frame, again, observer);
}
