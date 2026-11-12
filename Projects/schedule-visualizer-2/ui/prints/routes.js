// Routes for the printed plan: a route as runs of cells, and the ways out of
// a floor's rooms as planSvg's `routes` option takes them (a poster).
//
// A printed plan draws the routes evacuationRoutes() found; it never searches
// again. This module only splits them, a floor at a time. It lives beside
// plan-svg.js so that a print does not import a screen overlay: the overlay
// (ui/surface/overlays/evacuation.js) imports runsOf from here and exports it
// again for the Safety section.
//
//   runsOf(route) -> [[{ floorId, cell }, …], …]
//     a route as runs of cells, one run a floor it crosses, cut where a
//     stairs connection is taken: the room cell it leaves by first. A route
//     that is not ok has none.
//
//   waysOnFloor(entries, floorId, options?) -> [{ cells, start, exit, colour, number, faint, roomId }]
//     entries   evacuationRoutes()'s `rooms`: { roomId, floorId, route }
//     the part of every entry's route that lies on this floor, one way for
//     each run on it (a route that leaves a floor and comes back has two),
//     as planSvg's options.routes takes them: cells of the floor in walking
//     order, `start` the room cell it leaves by (the run that begins at the
//     room only), `exit` the exit's cell (the run that ends at it only).
//     options.numbering  Map exitId → { number, colour }: what to write on a
//                        way, by the exit it ends at (left out: no badge, and
//                        the colour planSvg takes for no number)
//     options.faint      (entry) → true to draw this entry's ways faint, as
//                        well as those of a room on another floor, which are
//                        faint always: a poster for a floor shows the way of
//                        its own rooms in colour and the part of an upper
//                        floor's way that comes down to the exit, grey
//     The result has the faint ways first, so the coloured ones are drawn
//     over them; within each, the order of `entries`.

export function runsOf(route) {
  if (!route || !route.ok || !Array.isArray(route.cells)) return [];
  const runs = [];
  let run = route.from ? [route.from] : [];
  const cuts = new Set(route.connectionAt || []);
  route.cells.forEach((place, index) => {
    run.push(place);
    if (cuts.has(index)) {
      runs.push(run);
      run = [];
    }
  });
  if (run.length > 0) runs.push(run);
  return runs.filter((each) => each.length > 0);
}

export function waysOnFloor(entries, floorId, options) {
  const opts = options || {};
  const numbering = opts.numbering instanceof Map ? opts.numbering : new Map();
  const faint = [];
  const strong = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const route = entry && entry.route;
    const runs = runsOf(route);
    const named = numbering.get(route && route.exitId) || {};
    const grey = entry.floorId !== floorId || (typeof opts.faint === 'function' && opts.faint(entry) === true);
    runs.forEach((run, index) => {
      if (run[0].floorId !== floorId) return;
      const begins = Boolean(route.from) && run[0] === route.from;
      const ends = index === runs.length - 1 && route.exit && route.exit.floorId === floorId && Number.isInteger(route.exit.cell);
      const cells = (begins ? run.slice(1) : run).filter((place) => place.floorId === floorId).map((place) => place.cell);
      const way = {
        cells,
        start: begins ? run[0].cell : null,
        exit: ends ? route.exit.cell : null,
        colour: named.colour,
        number: named.number,
        faint: grey,
        roomId: entry.roomId,
      };
      (grey ? faint : strong).push(way);
    });
  }
  return faint.concat(strong);
}
