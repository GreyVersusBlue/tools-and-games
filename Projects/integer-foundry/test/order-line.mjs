// order-line.mjs — plan a line that delivers exactly `want` to a sink.
//
// Pure: no DOM, no page, no clicks. It hands back cells and facings; browser.mjs
// does the clicking and smoke-targets.mjs checks the arithmetic. That split is
// the point of the file existing at all.
//
// WHY IT IS NOT INLINE IN browser.mjs ANY MORE (#387, #388). It was, and it put
// the sink at column 8 on a floor whose columns are 0 to 7, but only when the
// operators filled row 2 and the last one was still facing east, which is
// exactly and only an order of 8. The opening order is rolled, weighted low, and
// one order size out of eleven never came up in eighteen local runs. CI drew it
// on the first try and aborted the suite at 38 checks with `No element found for
// selector: #grid .cell[data-x="8"][data-y="2"]`.
//
// A browser run tests one order size, whichever the game happened to roll. The
// arithmetic can be checked against every size the game can ask for, in
// milliseconds and with no browser at all, and that is what smoke-targets.mjs
// now does. The geometry was never the browser's to hold.
//
// The floor's shape is an argument rather than a constant so the check can feed
// it the game's own BASE_COLS/BASE_ROWS: if the base floor ever shrinks, the
// check fails instead of the suite aborting on a cell that stopped existing.

/** Cells available to a line on this floor, sink included. */
export const lineCapacity = (cols) => 2 * (cols - 1);

/**
 * A source at (0, ROW_OUT), `want - 1` +1 operators, and a sink.
 *
 * A source emits 1 and every +1 adds one, so delivering `want` takes want-1 of
 * them. They run east along ROW_OUT, turn down at the last column, and run back
 * west along ROW_BACK. The sink is the next cell of that same path — NOT a step
 * taken off the last operator's facing, which is what walked off the board.
 * Every cell in the path is on the floor by construction, so there is no arrangement
 * of them that is not.
 *
 * Returns null rather than throwing, and null rather than a plan that does not
 * fit. A throw here aborts the whole browser suite; a null is one named failure
 * with the order size in it.
 */
export const ROW_OUT = 2, ROW_BACK = 3;

export function planOrderLine(want, cols, rows) {
  if (!Number.isInteger(want) || want < 2) return null;
  if (!Number.isInteger(cols) || !Number.isInteger(rows)) return null;
  if (cols < 2 || rows <= ROW_BACK) return null;
  if (want > lineCapacity(cols)) return null;

  const path = [];
  for (let x = 1; x <= cols - 1; x++) path.push({ x, y: ROW_OUT });
  for (let x = cols - 1; x >= 1; x--) path.push({ x, y: ROW_BACK });

  const cells = path.slice(0, want);
  const chain = cells.slice(0, want - 1).map((c, i) => ({
    x: c.x,
    y: c.y,
    // Where this operator pushes its packet: onto the next cell of the path,
    // which is the next operator or the sink. Clicking a placed tile with the
    // same tool selected steps E > S > W > N, so `turns` is how many clicks.
    dir: cells[i + 1].y !== c.y ? 'S' : cells[i + 1].x > c.x ? 'E' : 'W',
  }));

  return { source: { x: 0, y: ROW_OUT }, chain, sink: cells[want - 1] };
}

/** Clicks needed to rotate a freshly placed tile to `dir`. Placement faces east. */
export const turnsFor = (dir) => (dir === 'E' ? 0 : dir === 'S' ? 1 : dir === 'W' ? 2 : 3);
