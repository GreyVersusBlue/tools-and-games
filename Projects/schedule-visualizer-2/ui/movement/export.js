// The Export tab of the movement view's inspector (spec 7.7, 17):
//
//   the picture   as a PNG image at three resolutions, and as a print (which
//                 a browser saves as PDF) with, each by choice, the legend of
//                 the groups, the colour scale and the hotspot table
//   the tables    the hotspot table and the two travel-time tables as CSV
//   the report    the congestion report, as a print
//
//   exportPanel(env) -> { element, update(state) }
//
// `env` and `state` are described at the top of ./index.js.
//
// The image is never a copy of the screen. It is drawn again from the model
// on a canvas of its own, by the plan's renderer and the lanes overlay the
// map itself uses, on light paper whatever the theme, at the size of the
// whole map (every floor on show, not the part the window holds), under a
// header that says the school and what is shown.
//
// Every download is named by the one rule for download names
// (engine/exports.js exportFileName) and a CSV is written by the one writer
// (engine/csv.js, through csvText: a byte-order mark and CRLF, as every CSV
// of the tool has).
//
// An image is only as large as the browser's canvas. A canvas past a
// browser's limit is not refused: it is handed over and stays blank, and a
// blank PNG would be saved. So before a picture is drawn a canvas of the size
// meant is asked for and one pixel of it is written and read back
// (canvasHolds); when that fails the picture is drawn a step smaller
// (heldScale), and the line under the button says which size was saved and
// why.
//
// What is exported is the map as it is drawn. While the routes are being
// worked out again after a change, or could not be, the map is from before
// the change, and a line at the top of the tab says so (`data-behind` on the
// panel: 'no', 'pending' or 'stale'). The buttons stay as they are.
//
// The panel's element carries `exports` for the tests and the console:
//   { hooks, picture(options), sizes() }
//   hooks.deliver   when set, it is given { fileName, mime, text | blob,
//                   width, height } and nothing is downloaded
//   hooks.holds     when set, it answers for canvasHolds: (width, height) -> boolean
//   picture({ resolution, pattern })   draws the picture: { canvas, width, height, scale, asked, fell, pixels, origin, world }
//   sizes()         the three resolutions with their sizes in pixels; the one
//                   chosen is the size the browser really holds (`fell` steps down from `asked`)

import { h, uid } from '../components/dom.js';
import { openPrintPreview } from '../components/print-preview.js';
import { createViewport, CELL } from '../surface/viewport.js';
import { createRenderer } from '../surface/renderer.js';
import { lanesOverlay, drawStairLink, BAND_EXCLUDED } from '../surface/overlays/lanes.js';
import { parse, readable } from '../colour.js';
import { csvText, exportFileName } from '../../engine/exports.js';
import { schoolName, printDate, TOOL_NAME } from '../prints/document.js';
import { bandLines, shownSentence, colourSentence } from '../prints/movement.js';
import { unitWord } from './model.js';
import { layoutFloors, placeOf } from './layout.js';
import { bandText } from './legend.js';
import { hotspotRows, hotspotsCsv } from './hotspots.js';
import { transitionsCsv, dayCsv } from './tables.js';

// Pixels of the image for one pixel of the map at 100%.
export const RESOLUTIONS = [
  { id: 'standard', label: 'Standard', scale: 1 },
  { id: 'high', label: 'High', scale: 2 },
  { id: 'print', label: 'Print', scale: 4 },
];
// The most this tool asks a browser's canvas for: the longer side and the
// area, in pixels. A map too large for a resolution is first brought inside
// these (fitScale). They are not what a browser holds: that is asked of the
// browser itself (canvasHolds), and they answer for it only where there is
// no canvas to ask (WebKit's area limit is about 16.7 million pixels, well
// under MAX_AREA; Chromium's side is 32767 and older ones' 16384).
export const MAX_SIDE = 12000;
export const MAX_AREA = 60e6;
// No picture is drawn smaller than this many pixels for one of the map at 100%.
export const LOWEST_SCALE = 0.25;
// The picture inside the print: enough pixels for a sheet, small enough to carry.
const PRINT_SIDE = 3200;

const PAD = 24;
const HEAD = 64;
const FOOT = 28;
const NARROWEST = 720;
const KEY_HEIGHT = 74;
const CHIP_ROW = 22;

function download(fileName, blob) {
  const url = URL.createObjectURL(blob);
  const link = h('a', { href: url, download: fileName, hidden: true });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// The scale a resolution gets on a picture of this size, before the browser is asked.
export function fitScale(width, height, scale) {
  return Math.min(scale, MAX_SIDE / width, MAX_SIDE / height, Math.sqrt(MAX_AREA / (width * height)));
}

const probed = new Map();

// Does the browser really give a canvas of this many pixels? One pixel, at
// the far corner, is written and read back: on a canvas past the browser's
// limit nothing is ever written. A size the browser held is not asked about
// again; one it did not hold is asked about every time, since what a browser
// refuses for want of memory it may give a minute later. The canvas is let go.
//   make   something that makes a canvas, for a test; the answer is then not kept
export function canvasHolds(width, height, make) {
  const w = Math.round(width);
  const t = Math.round(height);
  if (!(w >= 1 && t >= 1)) return false;
  if (typeof make !== 'function' && typeof document === 'undefined') return w <= MAX_SIDE && t <= MAX_SIDE && w * t <= MAX_AREA;
  const key = w + ' ' + t;
  if (typeof make !== 'function' && probed.has(key)) return probed.get(key);
  let ok = false;
  let canvas = null;
  try {
    canvas = typeof make === 'function' ? make() : document.createElement('canvas');
    canvas.width = w;
    canvas.height = t;
    const g = canvas.getContext('2d');
    if (g && canvas.width === w && canvas.height === t) {
      g.fillStyle = '#000000';
      g.fillRect(w - 1, t - 1, 1, 1);
      ok = g.getImageData(w - 1, t - 1, 1, 1).data[3] === 255;
    }
  } catch (error) {
    ok = false;
  }
  if (canvas) {
    try {
      canvas.width = 0;
      canvas.height = 0;
    } catch (error) { /* it goes with the page */ }
  }
  if (typeof make !== 'function' && ok) probed.set(key, true);
  return ok;
}

// The next size down: 4, 2, 1, a half, a quarter of the map at 100%.
export function stepDown(scale) {
  let next = 2 ** Math.ceil(Math.log2(scale));
  if (next >= scale) next /= 2;
  return next;
}

// The scale a picture is really drawn at: the one asked for, or the first
// step down from it that the browser holds.
//   holds(width, height) -> boolean, in pixels of the image
//   -> { scale, fell }: fell is how many steps down it took; scale is 0 when
//      nothing down to LOWEST_SCALE is held
export function heldScale(width, height, scale, holds) {
  let at = scale;
  let fell = 0;
  while (!holds(Math.round(width * at), Math.round(height * at))) {
    at = stepDown(at);
    fell += 1;
    if (at < LOWEST_SCALE) return { scale: 0, fell };
  }
  return { scale: at, fell };
}

// The lines that stand beside a band's colour on paper, over a floor's cells.
function patternOverlay(picture) {
  return (g, view, floor, theme) => {
    const bands = picture.bands ? picture.bands.get(floor.id) : null;
    if (!bands) return;
    const seen = view.visible(floor);
    const size = view.size;
    g.beginPath();
    for (let y = seen.y0; y < seen.y1; y += 1) {
      for (let x = seen.x0; x < seen.x1; x += 1) {
        const band = bands[y * floor.width + x];
        if (band === 0 || band === BAND_EXCLUDED) continue;
        for (const [x1, y1, x2, y2] of bandLines(band)) {
          g.moveTo(view.x + (x + x1) * size, view.y + (y + y1) * size);
          g.lineTo(view.x + (x + x2) * size, view.y + (y + y2) * size);
        }
      }
    }
    g.strokeStyle = theme.ink;
    g.globalAlpha = 0.55;
    g.lineWidth = 1;
    g.stroke();
    g.globalAlpha = 1;
  };
}

// Where each chip of the groups' legend goes, a row at a time.
function chipRows(g, groups, room, font) {
  g.font = '500 13px ' + font;
  const rows = [[]];
  let x = 0;
  for (const group of groups) {
    const wide = 18 + Math.ceil(g.measureText(group.name).width) + 16;
    if (x + wide > room && rows[rows.length - 1].length > 0) {
      rows.push([]);
      x = 0;
    }
    rows[rows.length - 1].push({ group, x, wide });
    x += wide;
  }
  return rows;
}

// The size of the picture before it is drawn: the map's own size, and room
// for the header, the scale, the groups' legend and the foot.
//   g      any 2D context, to measure the groups' names with
//   font   the plan's typeface (the --font-plan token)
export function measurePicture(g, font, picture, how, options) {
  const opts = options || {};
  const head = opts.bare === true ? 0 : HEAD;
  const foot = opts.bare === true ? PAD / 2 : FOOT;
  const world = layoutFloors(picture.floors, how);
  const mapW = world.width * CELL;
  const mapH = world.height * CELL;
  const width = Math.max(NARROWEST, Math.ceil(mapW) + PAD * 2);
  const withKey = opts.scale !== false && picture.mode === 'load' && Boolean(picture.load);
  const chips = opts.legend !== false && picture.groups.length > 0 ? chipRows(g, picture.groups, width - PAD * 2, font) : [];
  const height = head + Math.ceil(mapH) + PAD + (withKey ? KEY_HEIGHT : 0) + (chips.length > 0 ? chips.length * CHIP_ROW + 26 : 0) + foot;
  return { world, mapW, mapH, width, height, withKey, chips, head };
}

// Draw the picture. `movement` is the view's handle (ui/movement/index.js).
// options: { resolution, legend, scale, pattern, side, now, bare, holds }
//   holds           what answers for canvasHolds (the panel's test hook)
//   legend, scale   false leaves the groups' legend or the colour scale off
//   bare            no header and no foot: the picture goes into a document that has both
//   pattern         the bands' lines as well as their colours (for paper)
//   side            a longest side in pixels, instead of a resolution
export function drawPicture(movement, options) {
  const opts = options || {};
  const state = movement.state;
  const picture = movement.picture;
  const project = state.project;

  // a canvas in a light island of the page, so that the renderer reads the light theme's colours
  const canvas = h('canvas');
  const host = h('div', { class: 'mov-export-host', 'aria-hidden': 'true', data: { theme: 'light' } }, canvas);
  document.body.append(host);
  try {
    const renderer = createRenderer(canvas);
    const theme = renderer.theme();
    const g = canvas.getContext('2d');
    const style = getComputedStyle(canvas);
    const bandColours = [1, 2, 3, 4, 5].map((band) => {
      const value = style.getPropertyValue('--load-' + band).trim();
      return parse(value) ? value : '#888888';
    });
    const { world, mapW, mapH, width, height, withKey, chips, head } = measurePicture(g, theme.font, picture, movement.world ? movement.world.how : 'side', opts);
    const withChips = chips.length > 0;
    const wanted = RESOLUTIONS.find((each) => each.id === opts.resolution) || RESOLUTIONS[0];
    // the size meant, then the size the browser holds: never a canvas that would stay blank
    const asked = fitScale(width, height, Number.isFinite(opts.side) ? opts.side / Math.max(width, height) : wanted.scale);
    const held = heldScale(width, height, asked, typeof opts.holds === 'function' ? opts.holds : canvasHolds);
    if (held.scale === 0) throw new Error('This browser could not make an image of this map, even a small one.');
    const scale = held.scale;
    renderer.resize(width, height, scale);
    const whole = () => g.setTransform(scale, 0, 0, scale, 0, 0);
    whole();
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, width, height);

    // the header: the school, then what is shown
    if (opts.bare !== true) {
      g.textAlign = 'left';
      g.textBaseline = 'alphabetic';
      g.fillStyle = theme.ink;
      g.font = '600 18px ' + theme.font;
      g.fillText(schoolName(project), PAD, 28, width - PAD * 2);
      g.font = '500 13px ' + theme.font;
      g.fillStyle = theme.ink2;
      g.fillText([shownSentence(project, picture), colourSentence(picture)].filter((line) => line !== '').join(' '), PAD, 48, width - PAD * 2);
    }

    // the floors, each by the plan's renderer with the lanes laid over it
    const colours = new Map();
    const colourOf = (groupId) => {
      if (!colours.has(groupId)) {
        const group = project.groups.find((each) => each.id === groupId);
        colours.set(groupId, group && parse(group.colour) ? readable(group.colour, theme.corridor, 3) : theme.ink2);
      }
      return colours.get(groupId);
    };
    const lanes = lanesOverlay(() => ({
      bands: picture.bands,
      bandColours,
      lanes: picture.lanes,
      markers: picture.markers,
      labels: picture.choice.labels,
      constantWidth: picture.choice.constantWidth,
      colourOf,
    }));
    const overlays = opts.pattern === true ? [lanes, patternOverlay(picture)] : [lanes];
    const left0 = Math.round((width - mapW) / 2);
    for (const slot of world.slots) {
      const left = left0 + Math.round(slot.x * CELL);
      const top = head + Math.round(slot.y * CELL);
      const right = left0 + Math.round((slot.x + slot.w) * CELL);
      const bottom = head + Math.round((slot.y + slot.h) * CELL);
      whole();
      g.font = '600 15px ' + theme.font;
      g.textAlign = 'left';
      g.textBaseline = 'alphabetic';
      g.fillStyle = theme.ink;
      g.fillText(slot.floor.name, left, top - 8);
      const view = createViewport();
      view.resize(width, height);
      view.zoom = 1;
      view.x = left - slot.box.x * CELL;
      view.y = top - slot.box.y * CELL;
      g.save();
      g.beginPath();
      g.rect(left, top, right - left, bottom - top);
      g.clip();
      renderer.draw({ project, floor: slot.floor, view, selection: [], hover: null, cursor: null, preview: null, overlays });
      g.restore();
      whole();
      g.strokeStyle = theme.lineStrong;
      g.lineWidth = 1;
      g.strokeRect(left + 0.5, top + 0.5, right - left - 1, bottom - top - 1);
    }

    // the stairs links in use
    const pixel = (floorId, cell) => {
      const place = placeOf(world, floorId, cell);
      return place ? { x: left0 + (place.x + 0.5) * CELL, y: head + (place.y + 0.5) * CELL } : null;
    };
    const alone = picture.groups.length === 1 ? colourOf(picture.groups[0].id) : null;
    for (const link of picture.links) {
      const a = pixel(link.a.floorId, link.a.cell);
      const b = pixel(link.b.floorId, link.b.cell);
      if (!a && !b) continue;
      const how = { colour: alone || theme.ink, edge: theme.card, width: 3, font: theme.font, ink: theme.ink };
      if (a && b) {
        drawStairLink(g, a, b, how);
      } else {
        const other = project.building.floors.find((floor) => floor.id === (a ? link.b.floorId : link.a.floorId));
        drawStairLink(g, a || b, null, { ...how, text: link.label + (other ? ' to ' + other.name : '') });
      }
    }

    // the colour scale in numbers
    let y = head + Math.ceil(mapH) + PAD;
    whole();
    g.textAlign = 'left';
    if (withKey) {
      const load = picture.load;
      const many = unitWord(load.unit, 2);
      g.font = '600 13px ' + theme.font;
      g.fillStyle = theme.ink;
      g.textBaseline = 'alphabetic';
      const zones = load.zones === 0 ? '' : ' ' + load.zones + (load.zones === 1 ? ' exclusion zone is' : ' exclusion zones are') + ' left out.';
      g.fillText('Load: ' + many + ' crossing a cell. ' + (load.mode === 'absolute' ? 'Absolute scale.' : 'Relative scale: fifths of ' + load.max + '.') + zones, PAD, y + 12, width - PAD * 2);
      const box = 64;
      load.edges.forEach((edge, index) => {
        const x = PAD + index * (box + 8);
        g.fillStyle = bandColours[edge.band - 1];
        g.fillRect(x, y + 22, box, 20);
        if (opts.pattern === true) {
          g.save();
          g.beginPath();
          g.rect(x, y + 22, box, 20);
          g.clip();
          g.beginPath();
          for (let i = 0; i < 4; i += 1) {
            for (const [x1, y1, x2, y2] of bandLines(edge.band)) {
              g.moveTo(x + (i + x1) * 20, y + 22 + y1 * 20);
              g.lineTo(x + (i + x2) * 20, y + 22 + y2 * 20);
            }
          }
          g.strokeStyle = theme.ink;
          g.globalAlpha = 0.55;
          g.lineWidth = 1;
          g.stroke();
          g.restore();
        }
        g.strokeStyle = theme.lineStrong;
        g.lineWidth = 1;
        g.strokeRect(x + 0.5, y + 22.5, box - 1, 19);
        g.fillStyle = theme.ink;
        g.font = '500 12px ' + theme.font;
        g.fillText(edge.band + ': ' + bandText(edge, false), x, y + 58, box + 6);
      });
      y += KEY_HEIGHT;
    }

    // the groups on the map
    if (withChips) {
      g.font = '600 13px ' + theme.font;
      g.fillStyle = theme.ink;
      g.textBaseline = 'alphabetic';
      g.fillText(picture.groups.length === 1 ? 'The group on the map' : 'The ' + picture.groups.length + ' groups on the map', PAD, y + 12);
      y += 22;
      g.textBaseline = 'middle';
      g.font = '500 13px ' + theme.font;
      for (const row of chips) {
        for (const chip of row) {
          g.fillStyle = colourOf(chip.group.id);
          g.fillRect(PAD + chip.x, y + 4, 12, 12);
          g.strokeStyle = theme.lineStrong;
          g.strokeRect(PAD + chip.x + 0.5, y + 4.5, 11, 11);
          g.fillStyle = theme.ink;
          g.fillText(chip.group.name, PAD + chip.x + 18, y + 11);
        }
        y += CHIP_ROW;
      }
    }

    // the foot: the tool, and the day this was made
    if (opts.bare !== true) {
      g.font = '500 11px ' + theme.font;
      g.fillStyle = theme.ink2;
      g.textBaseline = 'alphabetic';
      g.textAlign = 'left';
      const date = printDate(opts.now);
      g.fillText(TOOL_NAME + (date === '' ? '' : ' · ' + date), PAD, height - 10);
    }

    // origin: where the map's own (0, 0) is in the picture, in its units; a cell is CELL of them
    // asked: the scale meant; fell: how many steps down the browser's canvas made it
    return { canvas, width, height, scale, asked, fell: held.fell, pixels: { width: canvas.width, height: canvas.height }, origin: { x: left0, y: head }, world };
  } finally {
    host.remove();
  }
}

// Did the canvas of a drawn picture stay blank? The far corner of the paper
// is always painted: a canvas that reads back nothing there holds no picture.
export function isBlank(drawn) {
  return drawn.canvas.getContext('2d').getImageData(drawn.pixels.width - 1, drawn.pixels.height - 1, 1, 1).data[3] === 0;
}

export function exportPanel(env) {
  const ctx = env.ctx;
  const hooks = { deliver: null, holds: null };
  const holds = (width, height) => (typeof hooks.holds === 'function' ? hooks.holds(width, height) === true : canvasHolds(width, height));
  // said when the map, and so what is exported, is from before the last change
  const behind = h('p', { class: 'mov-panel__note mov-export__behind', role: 'status', hidden: true, data: { export: 'behind' } });
  const status = h('p', { class: 'mov-panel__note mov-export__status', role: 'status', data: { export: 'status' } });
  let last = null;

  const movement = () => {
    const section = document.querySelector('.mov');
    return section ? section.movement : null;
  };
  const now = () => (ctx.clock ? ctx.clock() : null);

  function tick(key, label, checked) {
    const id = uid('export-' + key);
    const box = h('input', { type: 'checkbox', id, name: 'export-' + key, data: { part: key } });
    box.checked = checked;
    return { box, element: h('label', { class: 'mov-check', for: id }, box, h('span', null, label)) };
  }
  const legendTick = tick('legend', 'The legend of the groups', true);
  const scaleTick = tick('scale', 'The colour scale in numbers', true);
  const tableTick = tick('hotspots', 'The hotspot table (on the print)', true);
  const parts = () => ({ legend: legendTick.box.checked, scale: scaleTick.box.checked, hotspots: tableTick.box.checked });

  const resolutionId = uid('export-resolution');
  const resolution = h('select', { class: 'field__input mov-ctl__select', id: resolutionId, data: { export: 'resolution' } },
    RESOLUTIONS.map((each) => h('option', { value: each.id }, each.label)));

  function button(action, label, run, primary) {
    const el = h('button', { type: 'button', class: primary ? 'btn btn--primary' : 'btn', data: { action } }, label);
    el.addEventListener('click', async () => {
      if (el.getAttribute('aria-disabled') === 'true') {
        status.textContent = el.dataset.why || 'There is nothing to export yet.';
        return;
      }
      try {
        await run(el);
      } catch (error) {
        status.textContent = '';
        ctx.toast({ kind: 'problem', text: 'That was not exported. ' + (error && error.message ? error.message : 'Try again.') });
      }
    });
    return el;
  }

  function deliver(file) {
    if (typeof hooks.deliver === 'function') {
      hooks.deliver(file);
    } else {
      download(file.fileName, file.blob || new Blob([file.text], { type: file.mime + ';charset=utf-8' }));
      ctx.toast({ text: 'Saved ' + file.fileName + ' to your downloads.' });
    }
    status.textContent = 'Saved ' + file.fileName + '.';
  }

  // The sizes the three resolutions come out at, for the picture as chosen now.
  const scratch = h('canvas', { width: '1', height: '1' });
  function sizes() {
    const view = movement();
    if (!view || !view.state || !view.picture || !view.world) return [];
    // measured, not drawn: the same arithmetic the picture is laid out by
    const font = getComputedStyle(document.documentElement).getPropertyValue('--font-plan').trim() || 'sans-serif';
    const { width, height } = measurePicture(scratch.getContext('2d'), font, view.picture, view.world.how, parts());
    return RESOLUTIONS.map((each) => {
      const asked = fitScale(width, height, each.scale);
      // the browser is asked about the resolution chosen only: asking makes a canvas of that size
      const held = each.id === resolution.value ? heldScale(width, height, asked, holds) : { scale: asked, fell: 0 };
      const scale = held.scale;
      return { id: each.id, label: each.label, scale, asked, fell: held.fell, width: Math.round(width * scale), height: Math.round(height * scale), askedWidth: Math.round(width * asked), askedHeight: Math.round(height * asked) };
    });
  }

  function picture(options) {
    const view = movement();
    if (!view || !view.state || !view.picture) throw new Error('The map is not drawn yet.');
    return drawPicture(view, { ...parts(), now: now(), holds, ...options });
  }

  const savePng = button('png', 'Save the picture as an image', async () => {
    const drawn = picture({ resolution: resolution.value });
    const blob = isBlank(drawn) ? null : await new Promise((resolve) => drawn.canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('The browser could not make an image this large. Choose a lower resolution.');
    deliver({ fileName: exportFileName(last.project, 'movement picture', 'png', now()), mime: 'image/png', blob, width: drawn.pixels.width, height: drawn.pixels.height });
    if (drawn.fell > 0) {
      const wanted = RESOLUTIONS.find((each) => each.id === resolution.value);
      status.textContent += ' This browser could not hold the picture at ' + wanted.label.toLowerCase() + ' resolution (' + Math.round(drawn.width * drawn.asked) + ' by ' + Math.round(drawn.height * drawn.asked) + ' pixels), so it was saved '
        + (drawn.fell === 1 ? 'one size' : drawn.fell + ' sizes') + ' down, at ' + drawn.pixels.width + ' by ' + drawn.pixels.height + ' pixels.';
    }
  }, true);

  const printPicture = button('print-picture', 'Print the picture', (opener) => {
    // the document has the header, the foot, the groups' legend and the colour scale itself,
    // so the image carries none of them: the scale is on the paper once
    const drawn = picture({ pattern: true, side: PRINT_SIDE, bare: true, legend: false, scale: false });
    // as for the saved image: a canvas that reads back nothing at its far corner holds no picture
    if (isBlank(drawn)) throw new Error('The browser could not make the picture for the print.');
    // the document is made from what the image was drawn from: the view's own state
    const view = movement();
    const from = view.state;
    status.textContent = '';
    openPrintPreview(ctx, 'movement', {
      opener,
      movement: { choice: view.picture.choice, parts: parts(), picture: { url: drawn.canvas.toDataURL('image/png'), width: drawn.width, height: drawn.height }, project: from.project, results: from.results, graph: from.graph },
    });
  });

  function csv(action, label, what, rows) {
    return button(action, label, () => {
      deliver({ fileName: exportFileName(last.project, what, 'csv', now()), mime: 'text/csv', text: csvText(rows(last)) });
    });
  }
  const hotspotsFile = csv('csv-hotspots', 'Hotspots', 'hotspots', (state) => hotspotsCsv(state.project, hotspotRows(state.project, state.results, state.graph, state.picture), state.picture));
  const transitionsFile = csv('csv-transitions', 'Travel time, by transition', 'travel time by transition', (state) => transitionsCsv(state.project, state.results, state.picture.choice.dayTypeId, state.picture.choice.bellsId));
  const dayFile = csv('csv-day', 'Travel time, by group', 'travel time by group', (state) => dayCsv(state.project, state.results, state.picture.choice.dayTypeId, state.picture.choice.bellsId));

  const report = button('print-congestion', 'Print the congestion report', (opener) => {
    status.textContent = '';
    openPrintPreview(ctx, 'congestion', { opener, bellsId: last.picture.choice.bellsId, movement: { project: last.project, results: last.results, graph: last.graph } });
  });

  const sizeNote = h('p', { class: 'mov-panel__note', data: { export: 'size' } });
  const element = h('div', { class: 'mov-panel mov-export', data: { panel: 'export' } },
    h('h2', { class: 'mov-panel__title' }, 'Export'),
    behind,
    h('h3', { class: 'mov-panel__sub' }, 'The picture'),
    h('p', null, 'The whole map as it is chosen now, drawn again on light paper under the school\'s name and what is shown.'),
    h('fieldset', { class: 'mov-export__parts' }, h('legend', { class: 'mov-ctl__label' }, 'With it'), legendTick.element, scaleTick.element, tableTick.element),
    h('div', { class: 'mov-export__row' }, h('label', { class: 'mov-ctl__label', for: resolutionId }, 'Resolution of the image'), resolution),
    sizeNote,
    h('div', { class: 'mov-export__buttons' }, savePng, printPicture),
    h('p', { class: 'mov-panel__note' }, 'For a PDF, print the picture and choose "Save as PDF" as the printer. The paper size is chosen in the preview.'),
    h('h3', { class: 'mov-panel__sub' }, 'The tables, as CSV'),
    h('p', null, 'Each opens in a spreadsheet. The hotspots are those of the map as chosen; travel time is every group on the day type shown.'),
    h('div', { class: 'mov-export__buttons' }, hotspotsFile, transitionsFile, dayFile),
    h('h3', { class: 'mov-panel__sub' }, 'The congestion report'),
    h('p', null, 'For each day type: the three worst transitions, the ten busiest places, and the groups that cannot arrive in time. Every group of the school, whatever the map shows.'),
    h('div', { class: 'mov-export__buttons' }, report),
    status);

  function drawSizes() {
    const list = sizes();
    for (const option of resolution.options) {
      const size = list.find((each) => each.id === option.value);
      const base = RESOLUTIONS.find((each) => each.id === option.value).label;
      // a size the browser cannot hold at all has no pixels to give: the name alone, and the line under says why
      option.textContent = size && size.scale > 0 ? base + ' (' + size.width + ' × ' + size.height + ')' : base;
    }
    const chosen = list.find((each) => each.id === resolution.value);
    const full = RESOLUTIONS.find((each) => each.id === resolution.value).scale;
    sizeNote.textContent = !chosen ? ''
      : chosen.scale === 0 ? 'This browser cannot hold an image of this map, even a small one.'
        : chosen.fell > 0 ? 'This browser cannot hold the map at that resolution (' + chosen.askedWidth + ' by ' + chosen.askedHeight + ' pixels), so the image is ' + chosen.width + ' by ' + chosen.height + ' pixels.'
          : chosen.scale < full ? 'This map is too large for that resolution, so the image is ' + chosen.width + ' by ' + chosen.height + ' pixels, the most this tool asks a browser for.'
            : 'The image is ' + chosen.width + ' by ' + chosen.height + ' pixels.';
  }
  for (const each of [legendTick.box, scaleTick.box, resolution]) each.addEventListener('change', drawSizes);

  function able(el, ok, why) {
    if (ok) {
      el.removeAttribute('aria-disabled');
      delete el.dataset.why;
    } else {
      el.setAttribute('aria-disabled', 'true');
      el.dataset.why = why;
    }
  }

  element.exports = { hooks, picture, sizes };

  return {
    element,
    update(state) {
      last = state;
      const ready = Boolean(state.results);
      const shown = ready && state.picture.mode !== 'empty';
      const why = !ready ? 'The routes are still being worked out.' : 'Nothing is shown on the map. Choose a group, a grade or every group first.';
      for (const el of [savePng, printPicture, hotspotsFile]) able(el, shown, why);
      for (const el of [transitionsFile, dayFile, report]) able(el, ready, 'The routes are still being worked out.');
      // the map on screen is the last answer: stale after a derive that failed, pending while one is awaited
      const section = document.querySelector('.mov');
      // once a new answer is being asked for, that is what is said: "could
      // not be worked out" was about the ask before it
      const asking = Boolean(section) && section.dataset.pending === 'true';
      const stale = ready && !asking && Boolean(section) && section.dataset.stale === 'true';
      const pending = ready && !stale && (asking || state.project !== ctx.store.project);
      element.dataset.behind = stale ? 'stale' : pending ? 'pending' : 'no';
      behind.hidden = !stale && !pending;
      behind.textContent = stale ? 'The routes could not be worked out after your last change. The map, and everything exported here, is from before that change.'
        : pending ? 'The routes are being worked out again after your last change. Until they are, the map, and everything exported here, is from before that change.' : '';
      drawSizes();
    },
  };
}
