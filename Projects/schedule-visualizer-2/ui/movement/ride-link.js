// How a link on the movement map is drawn (ARCHITECTURE 19.4, DESIGN 13.4).
// A stairs connection in use is the dotted arc of the Plan view's lanes
// (drawStairLink). An elevator ride is its own mark, so that nobody reads it
// as stairs: a straight dashed line between the two stops with an open ring
// round each stop, never an arc and never a filled dot. The screen map
// (index.js) and the PNG (export.js) both draw through drawLink.
//
//   drawRideLink(g, from, to, options)   the dashed line and the rings
//   drawLink(g, link, from, to, options) a stairs link or a ride, by link.elevator
//
// `from`, `to` and `options` are as drawStairLink's: { x, y } in pixels (`to`
// null when the other stop is on a floor that is not on screen, which the
// ring and `options.text` say), and { colour, edge, width, text, font, ink,
// labelScale }.

import { drawStairLink } from '../surface/overlays/lanes.js';

export function drawRideLink(g, from, to, options) {
  const width = options.width || 2;
  g.save();
  g.lineCap = 'butt';
  if (to) {
    for (const pass of ['edge', 'colour']) {
      g.beginPath();
      g.moveTo(from.x, from.y);
      g.lineTo(to.x, to.y);
      g.setLineDash([width * 3, width * 2]);
      g.strokeStyle = options[pass];
      g.lineWidth = pass === 'edge' ? width + 2 : width;
      g.stroke();
    }
  }
  g.setLineDash([]);
  const radius = width + 3;
  for (const point of to ? [from, to] : [from]) {
    for (const pass of ['edge', 'colour']) {
      g.beginPath();
      g.arc(point.x, point.y, radius, 0, Math.PI * 2);
      g.strokeStyle = options[pass];
      g.lineWidth = pass === 'edge' ? width + 2 : width;
      g.stroke();
    }
  }
  if (!to && options.text) {
    const large = options.labelScale > 0 ? options.labelScale : 1;
    g.font = '600 ' + Math.round(11 * large) + 'px ' + options.font;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.strokeStyle = options.edge;
    g.lineWidth = 3;
    g.strokeText(options.text, from.x + radius + 4, from.y);
    g.fillStyle = options.ink;
    g.fillText(options.text, from.x + radius + 4, from.y);
  }
  g.restore();
}

export function drawLink(g, link, from, to, options) {
  if (link.elevator === true) drawRideLink(g, from, to, options);
  else drawStairLink(g, from, to, options);
}
