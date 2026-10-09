// The keyboard cursor of a drawing surface (DESIGN 6). It feeds the same
// callbacks the pointer does, so every tool works by keyboard with no second
// implementation:
//
//   arrows            move the cursor one cell
//   Enter             act as a click would: down and up on the cursor's cell
//   Shift + arrows    a drag: down on the cell the cursor was on, a move for
//                     each step, and up when Shift is let go
//   Space + arrows    move the map. Space does nothing else
//   Escape            call off the drag; with none going, host.escape()
//
//   attachCursor(canvas, host) -> { cell, x, y, showing, dragging, moveTo(x, y), reset(), detach() }
//
// host is input.js's host, and also:
//   moved(ev)         the cursor is on another cell (announce it, draw it)
//   escape()          Escape with no drag going
//   shown(showing)    the cursor appeared or went (a pointer took over)
//
// ev = { x, y, index, inside: true, sx, sy, shift, pointerType: 'keyboard', source: 'keyboard' }

const STEPS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

export function attachCursor(canvas, host) {
  const view = host.view;
  const at = { x: 0, y: 0 };
  let showing = false;
  let dragging = false;
  let space = false;

  function clamp() {
    const floor = host.floor();
    at.x = Math.min(floor.width - 1, Math.max(0, at.x));
    at.y = Math.min(floor.height - 1, Math.max(0, at.y));
  }

  function make(shift) {
    clamp();
    const floor = host.floor();
    const corner = view.toScreen(at.x, at.y);
    return { x: at.x, y: at.y, index: at.y * floor.width + at.x, inside: true, sx: corner.x + view.size / 2, sy: corner.y + view.size / 2, shift, pointerType: 'keyboard', source: 'keyboard' };
  }

  function show(now) {
    if (showing === now) return;
    showing = now;
    host.shown(now);
  }

  function endDrag(complete) {
    if (!dragging) return;
    dragging = false;
    if (complete) host.up(make(true));
    else host.cancel();
  }

  function onKeyDown(event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const step = STEPS[event.key];
    if (step) {
      event.preventDefault();
      show(true);
      if (space) {
        // the map moves under the cursor; the cursor keeps its cell
        view.panBy(-step[0] * view.size, -step[1] * view.size);
        host.viewChanged();
        return;
      }
      if (event.shiftKey && !dragging) {
        const answer = host.down(make(true));
        dragging = answer !== false && answer !== 'pan';
      }
      if (!event.shiftKey && dragging) endDrag(true);
      const before = at.x + ':' + at.y;
      at.x += step[0];
      at.y += step[1];
      clamp();
      if (at.x + ':' + at.y === before) return;
      view.reveal(at.x, at.y);
      const ev = make(event.shiftKey);
      if (dragging) host.move(ev);
      host.moved(ev);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.repeat || dragging) return;
      show(true);
      const ev = make(false);
      const answer = host.down(ev);
      if (answer !== false && answer !== 'pan') host.up(ev);
      return;
    }
    if (event.key === ' ') {
      // Space only pans: it never acts, and never scrolls the page
      event.preventDefault();
      space = true;
      return;
    }
    if (event.key === 'Escape') {
      if (dragging) {
        event.preventDefault();
        endDrag(false);
      } else if (host.escape()) {
        event.preventDefault();
      }
    }
  }

  function onKeyUp(event) {
    if (event.key === ' ') space = false;
    // letting go of Shift completes the drag
    if (event.key === 'Shift') endDrag(true);
  }

  function onBlur() {
    space = false;
    endDrag(false);
  }

  canvas.addEventListener('keydown', onKeyDown);
  canvas.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('blur', onBlur);

  return {
    get x() {
      return at.x;
    },
    get y() {
      return at.y;
    },
    get cell() {
      clamp();
      return at.y * host.floor().width + at.x;
    },
    get showing() {
      return showing;
    },
    get dragging() {
      return dragging;
    },
    // Is Space down with the surface in focus?
    get spaceHeld() {
      return space;
    },
    event: () => make(false),
    // A pointer acted here: the cursor goes with it, and hides until a key is used.
    moveTo(x, y, visible) {
      at.x = x;
      at.y = y;
      clamp();
      if (visible !== undefined) show(visible);
    },
    reset() {
      dragging = false;
      space = false;
      clamp();
    },
    detach() {
      canvas.removeEventListener('keydown', onKeyDown);
      canvas.removeEventListener('keyup', onKeyUp);
      canvas.removeEventListener('blur', onBlur);
    },
  };
}
