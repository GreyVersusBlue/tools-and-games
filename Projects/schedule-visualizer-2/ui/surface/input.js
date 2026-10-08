// Pointer input for a drawing surface (DESIGN 6): Pointer Events from a
// mouse, a finger or a pen become one gesture for the active tool (down,
// move, up, or cancel), or a pan, or a two-finger pan and pinch.
//
//   attachInput(canvas, host) -> { detach(), busy }
//
// host = {
//   view                     the viewport
//   floor()                  the floor on screen
//   down(ev)                 a gesture starts. Return 'pan' to make it a pan
//                            instead, false to ignore it
//   move(ev), up(ev)         it goes on; it is complete
//   cancel()                 it is called off: nothing is to be changed
//   tap(ev)                  a pan that never moved (a click on nothing)
//   hover(ev | null)         the pointer is over a cell with nothing pressed
//   hasMenu(ev)              is there a menu to open here?
//   menu(ev)                 open it
//   spaceHeld()              is Space down? Then a drag pans
//   viewChanged()            the viewport moved: draw again
// }
//
// ev = { x, y, index, inside, sx, sy, clientX, clientY, shift, pointerType, source: 'pointer' }
// where (x, y) is the cell, clamped to the floor, and (sx, sy) the place on
// the canvas in CSS pixels.
//
// The rules:
// - Mouse: the left button draws, the middle button pans, the right button
//   opens the menu, the wheel moves the map, Ctrl or Cmd with the wheel zooms
//   about the pointer, and a drag with Space held pans.
// - Touch: one finger draws. The moment a second finger lands the first
//   finger's gesture is cancelled with nothing changed, and the two fingers
//   pan and pinch until every finger is up. A finger held for 500 ms within
//   10 px, on this timer and never the browser's, cancels the gesture and
//   opens the menu.
// - Pen: draws; the barrel button pans; touches are ignored while the pen is
//   down, so a resting palm does nothing.

import { MIN_ZOOM, MAX_ZOOM } from './viewport.js';

export const LONG_PRESS_MS = 500;
export const SLOP = 10;
// How far a pan may move and still count as a click on nothing.
const TAP_SLOP = 4;

export function attachInput(canvas, host) {
  const view = host.view;
  const pointers = new Map();
  let mode = null; // 'tool', 'pan', 'pinch', or 'dead' (wait for every pointer to lift)
  let primary = null;
  let start = null;
  let moved = 0;
  let pinch = null;
  let timer = null;
  let penDown = false;
  let lastType = 'mouse';
  let menuKeyAt = -Infinity;
  let barrel = false;

  function place(event) {
    const box = canvas.getBoundingClientRect();
    return { sx: event.clientX - box.left, sy: event.clientY - box.top };
  }

  function make(event) {
    const at = place(event);
    const cell = view.cellAt(host.floor(), at.sx, at.sy);
    return { ...cell, sx: at.sx, sy: at.sy, clientX: event.clientX, clientY: event.clientY, shift: event.shiftKey === true, pointerType: event.pointerType || 'mouse', source: 'pointer' };
  }

  function stopTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function touches() {
    return Array.from(pointers.values()).filter((pointer) => pointer.type === 'touch');
  }

  function startPinch() {
    const [a, b] = touches();
    pinch = { distance: Math.max(1, Math.hypot(a.sx - b.sx, a.sy - b.sy)), x: (a.sx + b.sx) / 2, y: (a.sy + b.sy) / 2 };
  }

  function cancelTool() {
    stopTimer();
    if (mode === 'tool') host.cancel();
  }

  function onDown(event) {
    const type = event.pointerType || 'mouse';
    lastType = type;
    barrel = false;
    // a palm resting while the pen writes does nothing
    if (type === 'touch' && penDown) return;
    if (type === 'pen') {
      penDown = true;
      if (touches().length > 0) {
        cancelTool();
        for (const [id, pointer] of pointers) if (pointer.type === 'touch') pointers.delete(id);
        mode = null;
      }
    }
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch (error) { /* a synthetic pointer has nothing to capture */ }
    const at = place(event);
    pointers.set(event.pointerId, { type, sx: at.sx, sy: at.sy });
    if (type !== 'touch' || document.activeElement !== canvas) canvas.focus({ preventScroll: true });

    if (type === 'touch' && touches().length >= 2) {
      if (mode !== 'pinch') {
        cancelTool();
        mode = 'pinch';
        startPinch();
      }
      event.preventDefault();
      return;
    }
    if (mode !== null) return;

    primary = event.pointerId;
    start = at;
    moved = 0;
    const ev = make(event);
    let pan = false;
    if (type === 'mouse') {
      if (event.button === 1) pan = true;
      else if (event.button !== 0) {
        mode = 'dead';
        return;
      } else if (host.spaceHeld()) pan = true;
    } else if (type === 'pen') {
      if (event.button === 2 || (event.buttons & 2) === 2) {
        pan = true;
        barrel = true;
      }
      else if (event.button !== 0) {
        mode = 'dead';
        return;
      }
    }
    // a drag that starts off the floor moves the map, whatever the tool
    if (!pan && !ev.inside) pan = true;
    if (event.button === 1) event.preventDefault();
    if (pan) {
      mode = 'pan';
      canvas.dataset.panning = 'true';
      return;
    }
    const answer = host.down(ev);
    if (answer === 'pan') {
      mode = 'pan';
      canvas.dataset.panning = 'true';
      return;
    }
    if (answer === false) {
      mode = 'dead';
      return;
    }
    mode = 'tool';
    if (type === 'touch') {
      timer = setTimeout(() => {
        timer = null;
        if (mode !== 'tool' || !host.hasMenu(ev)) return;
        host.cancel();
        mode = 'dead';
        host.menu(ev);
      }, LONG_PRESS_MS);
    }
  }

  function onMove(event) {
    const pointer = pointers.get(event.pointerId);
    if (!pointer) {
      // nothing pressed: the cell under a mouse or a hovering pen
      if (event.pointerType !== 'touch' && mode === null) host.hover(make(event));
      return;
    }
    const at = place(event);
    const dx = at.sx - pointer.sx;
    const dy = at.sy - pointer.sy;
    pointer.sx = at.sx;
    pointer.sy = at.sy;
    if (mode === 'pinch') {
      const now = touches();
      if (now.length < 2 || !pinch) return;
      const [a, b] = now;
      const distance = Math.max(1, Math.hypot(a.sx - b.sx, a.sy - b.sy));
      const x = (a.sx + b.sx) / 2;
      const y = (a.sy + b.sy) / 2;
      view.panBy(x - pinch.x, y - pinch.y);
      view.zoomAbout(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * (distance / pinch.distance))), x, y);
      pinch = { distance, x, y };
      host.viewChanged();
      return;
    }
    if (event.pointerId !== primary) return;
    moved = Math.max(moved, Math.hypot(at.sx - start.sx, at.sy - start.sy));
    if (mode === 'pan') {
      view.panBy(dx, dy);
      host.viewChanged();
    } else if (mode === 'tool') {
      if (moved > SLOP) stopTimer();
      host.move(make(event));
    }
  }

  function finish(event, cancelled) {
    const pointer = pointers.get(event.pointerId);
    if ((event.pointerType || 'mouse') === 'pen') penDown = false;
    if (!pointer) return;
    pointers.delete(event.pointerId);
    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch (error) { /* already let go */ }
    if (mode === 'pinch') {
      if (touches().length === 0) {
        mode = null;
        pinch = null;
      } else if (touches().length >= 2) startPinch();
      else pinch = null;
      return;
    }
    if (event.pointerId !== primary) return;
    stopTimer();
    const was = mode;
    mode = pointers.size === 0 ? null : 'dead';
    primary = null;
    delete canvas.dataset.panning;
    if (was === 'tool') {
      if (cancelled) host.cancel();
      else host.up(make(event));
    } else if (was === 'pan' && !cancelled && moved <= TAP_SLOP && event.button === 0) {
      host.tap(make(event));
    }
    if (mode === 'dead' && pointers.size === 0) mode = null;
  }

  function onUp(event) {
    finish(event, false);
    if (pointers.size === 0 && mode === 'dead') mode = null;
  }

  function onCancel(event) {
    finish(event, true);
    if (pointers.size === 0 && mode === 'dead') mode = null;
  }

  function onLeave() {
    if (mode === null) host.hover(null);
  }

  function onWheel(event) {
    event.preventDefault();
    const at = place(event);
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? view.height : 1;
    if (event.ctrlKey || event.metaKey) {
      view.zoomAbout(view.zoom * Math.exp(-event.deltaY * unit * 0.0015), at.sx, at.sy);
    } else {
      view.panBy(-event.deltaX * unit, -event.deltaY * unit);
    }
    host.viewChanged();
  }

  function onContextMenu(event) {
    event.preventDefault();
    // a finger held down raises this too; the long-press timer has it
    if (lastType === 'touch') return;
    // the pen's barrel button pans; some systems raise this as it goes down,
    // some as it comes up
    if (barrel) {
      barrel = false;
      return;
    }
    // the Menu key and Shift+F10: the menu is for the cursor's cell, wherever
    // the browser says the event was
    const keyboard = event.button === -1 || (event.clientX === 0 && event.clientY === 0) || performance.now() - menuKeyAt < 500;
    menuKeyAt = -Infinity;
    const ev = keyboard ? null : make(event);
    if (host.hasMenu(ev)) host.menu(ev);
  }

  function onMenuKey(event) {
    if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) menuKeyAt = performance.now();
  }

  // The middle button would start the browser's own scroll.
  function onAux(event) {
    if (event.button === 1) event.preventDefault();
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContextMenu);
  canvas.addEventListener('keydown', onMenuKey);
  canvas.addEventListener('auxclick', onAux);
  canvas.addEventListener('mousedown', onAux);

  return {
    get busy() {
      return mode === 'tool';
    },
    // Call off whatever is going on (the tool changed, the floor changed).
    reset() {
      cancelTool();
      mode = pointers.size === 0 ? null : 'dead';
      primary = null;
      delete canvas.dataset.panning;
    },
    detach() {
      stopTimer();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('keydown', onMenuKey);
      canvas.removeEventListener('auxclick', onAux);
      canvas.removeEventListener('mousedown', onAux);
    },
  };
}
