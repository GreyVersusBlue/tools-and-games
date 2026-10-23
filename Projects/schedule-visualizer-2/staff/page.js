// The frame of a page, shared by every view: a heading, the sentence the page
// starts with, whatever follows, and under it what every page can do: print
// itself, be saved as an image, and be shared. A view returns pageOf(...) and
// the shell puts it on screen, moves focus to the heading and sets the tab's
// title.
//
// On paper a page is headed by the school (the shell's own line), what the
// page is (the heading) and the date it was printed (the line made here,
// which the screen never shows). The @media print block of staff/staff.css
// lays the paper out.

import { h } from './dom.js';
import { dayText } from './dates.js';
import { clockNow } from './clock.js';

function today() {
  return dayText(clockNow({ now: () => new Date() }).toISOString(), null);
}

// "Share": the device's own share sheet, with the page's name and, when the
// file is on a web address, that address. An address on disk means nothing on
// another phone, so it is never shared or copied. `title()` is asked when the
// button is pressed. Null where there is nothing to offer.
export function shareRow(title) {
  const hosted = globalThis.location.protocol === 'http:' || globalThis.location.protocol === 'https:';
  const nav = globalThis.navigator;
  const buttons = [];
  if (nav && typeof nav.share === 'function') {
    buttons.push(h('button', { class: 'btn', type: 'button', dataset: { share: 'share' }, onclick: () => {
      const what = { title: title(), text: title() };
      if (hosted) what.url = globalThis.location.href;
      Promise.resolve().then(() => nav.share(what)).catch(() => {
        // closing the share sheet without sending is not a failure
      });
    } }, 'Share'));
  }
  if (hosted && nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
    const says = h('span', { class: 'muted', role: 'status' });
    buttons.push(h('button', { class: 'btn', type: 'button', dataset: { share: 'copy' }, onclick: () => {
      nav.clipboard.writeText(globalThis.location.href).then(() => {
        says.textContent = 'Link copied.';
      }, () => {
        says.textContent = 'The link could not be copied. Copy it from the address bar.';
      });
    } }, 'Copy link'), says);
  }
  return buttons.length > 0 ? h('p', { class: 'actions', dataset: { actions: 'share' } }, buttons) : null;
}

// "Print this page": the browser's own print, which is also how a page is
// saved as a PDF. A page that has a print button of its own (anything marked
// data-print) is not given a second one.
export function printButton(label, primary) {
  return h('button', { class: primary ? 'btn btn--primary' : 'btn', type: 'button', dataset: { print: 'page' }, onclick: () => globalThis.print() }, label || 'Print this page');
}

// ---------------------------------------------------------------- a page as a picture

// "Save as image": the page as it stands on screen, drawn by this file's own
// code onto a canvas and handed over as a PNG, the way the lock-screen image
// is (staff/outputs.js). Nothing is copied from the screen: every box, line
// of text and map on the page is drawn again from where the browser has laid
// it out, so the picture is what the reader sees, and a name is drawn as text
// whatever characters it holds (a character the face has no glyph for is
// drawn as the device draws it on the page). What a sheet of paper leaves
// out, the picture leaves out too: the buttons, the bar, the pickers
// (PICTURE_LEAVES). A page that is one thing to hand over marks that part
// `data-picture` (the door sign's sheet), and only it is drawn; any other
// picture has the school's line and the publish line over the page, because
// a picture travels without the file it came from.

// Left out of a picture, as they are left off paper (the @media print blocks
// of staff/staff.css), with the bars around the page.
export const PICTURE_LEAVES = '.no-print, .actions, .page__outputs, .print-only, .page .tabs, .map__bar, .map__which, .map__pulse, .row__mark, .chips__remove, .note__input, .note__count, .bar, .bands, script, style, template, svg';

// A picture is drawn at three image pixels a page pixel for a phone's
// column, two for a desktop's, and less only where the device's canvas could
// not hold it: the most a canvas takes on any device the file is for is 16,384
// pixels a side and 16,777,216 in all (iOS). Under one image pixel a page
// pixel the words are not readable, and the picture is refused.
export const PICTURE_SCALE = 3;
export const PICTURE_WIDE_SCALE = 2;
export const PICTURE_WIDE_FROM = 600;
export const PICTURE_MOST_SIDE = 16384;
export const PICTURE_MOST_AREA = 16777216;
export const PICTURE_LEAST_SCALE = 1;
const PICTURE_STEP = 0.25;
const PICTURE_PAD = 16;

export const PICTURE_SAVED = 'Saved as ';
export const PICTURE_FAILED = 'The image could not be made on this device. Print the page instead.';
export const PICTURE_TOO_LONG = 'This page is too long for one image. Print it instead, or save it as a PDF from the print dialog.';

// The scale a picture of `width` by `height` page pixels is drawn at, or 0
// when no scale from PICTURE_LEAST_SCALE up fits a canvas.
export function pictureScale(width, height) {
  let scale = width >= PICTURE_WIDE_FROM ? PICTURE_WIDE_SCALE : PICTURE_SCALE;
  const holds = (at) => Math.ceil(width * at) <= PICTURE_MOST_SIDE && Math.ceil(height * at) <= PICTURE_MOST_SIDE && Math.ceil(width * at) * Math.ceil(height * at) <= PICTURE_MOST_AREA;
  while (scale >= PICTURE_LEAST_SCALE && !holds(scale)) scale -= PICTURE_STEP;
  return scale >= PICTURE_LEAST_SCALE ? scale : 0;
}

// The words of a file's name: letters and digits of any script, everything
// else a hyphen, at most 60 of them (a name in a script of three bytes a
// letter still fits any disk's 255).
export function fileWords(text) {
  const words = String(text).normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
  return Array.from(words).slice(0, 60).join('').replace(/-+$/, '');
}

// What each view's picture is called, before the page's own heading.
const PICTURE_WORDS = {
  teacher: 'schedule',
  me: 'schedule',
  group: 'group',
  room: 'room',
  map: 'building map',
  door: 'door sign',
  sub: 'substitute plan',
  coverage: 'coverage',
  common: 'common planning',
  free: 'free right now',
  now: 'where right now',
  directions: 'directions',
  staffing: 'staffing',
  search: 'search',
};

// "door-sign-room-101.png", "group-6a.png", "free-right-now.png": what the
// picture is, then the heading of the page when it says more. A heading that
// already starts with the view's words is not given them twice.
export function pictureName(viewId, heading) {
  const what = fileWords(PICTURE_WORDS[viewId] || 'page');
  let named = fileWords(heading || '');
  // "Door sign: Room 101" is already said by "door-sign"
  if (named === what || named.startsWith(what + '-')) named = named.slice(what.length).replace(/^-+/, '');
  const words = named === '' ? what : what + '-' + named;
  return Array.from(words).slice(0, 80).join('').replace(/-+$/, '') + '.png';
}

const NONE = /^(transparent|rgba\(0, 0, 0, 0\))$/;

function pixels(value) {
  const number = parseFloat(value);
  return Number.isFinite(number) ? number : 0;
}

function fontOf(style) {
  return [style.fontStyle, style.fontWeight, style.fontSize, style.fontFamily].join(' ');
}

function shapedText(text, transform) {
  if (transform === 'uppercase') return text.toUpperCase();
  if (transform === 'lowercase') return text.toLowerCase();
  if (transform === 'capitalize') return text.replace(/(^|\s)(\S)/gu, (all, space, first) => space + first.toUpperCase());
  return text;
}

function hidden(style) {
  return style.visibility === 'hidden' || style.visibility === 'collapse';
}

function boxPath(g, x, y, width, height, radius) {
  g.beginPath();
  if (radius > 0 && typeof g.roundRect === 'function') g.roundRect(x, y, width, height, Math.min(radius, width / 2, height / 2));
  else g.rect(x, y, width, height);
}

// An element's own box: its background, then its borders.
function paintBox(g, box, style, at) {
  const x = box.left - at.x;
  const y = box.top - at.y;
  const radius = pixels(style.borderTopLeftRadius);
  if (!NONE.test(style.backgroundColor)) {
    g.fillStyle = style.backgroundColor;
    boxPath(g, x, y, box.width, box.height, radius);
    g.fill();
  }
  const sides = ['Top', 'Right', 'Bottom', 'Left'].map((side) => ({
    side,
    width: style['border' + side + 'Style'] === 'none' || style['border' + side + 'Style'] === 'hidden' ? 0 : pixels(style['border' + side + 'Width']),
    colour: style['border' + side + 'Color'],
    dash: style['border' + side + 'Style'],
  }));
  const one = sides.every((each) => each.width === sides[0].width && each.colour === sides[0].colour && each.dash === sides[0].dash);
  if (one && sides[0].width > 0 && radius > 0 && !NONE.test(sides[0].colour)) {
    const w = sides[0].width;
    g.strokeStyle = sides[0].colour;
    g.lineWidth = w;
    g.setLineDash(sides[0].dash === 'dashed' ? [w * 3, w * 2] : sides[0].dash === 'dotted' ? [w, w] : []);
    boxPath(g, x + w / 2, y + w / 2, box.width - w, box.height - w, Math.max(0, radius - w / 2));
    g.stroke();
    g.setLineDash([]);
    return;
  }
  for (const each of sides) {
    if (each.width <= 0 || NONE.test(each.colour)) continue;
    const w = each.width;
    const line = {
      Top: [x, y + w / 2, x + box.width, y + w / 2],
      Right: [x + box.width - w / 2, y, x + box.width - w / 2, y + box.height],
      Bottom: [x, y + box.height - w / 2, x + box.width, y + box.height - w / 2],
      Left: [x + w / 2, y, x + w / 2, y + box.height],
    }[each.side];
    g.strokeStyle = each.colour;
    g.lineWidth = w;
    g.setLineDash(each.dash === 'dashed' ? [w * 3, w * 2] : each.dash === 'dotted' ? [w, w] : []);
    g.beginPath();
    g.moveTo(line[0], line[1]);
    g.lineTo(line[2], line[3]);
    g.stroke();
  }
  g.setLineDash([]);
}

// The ascent and descent of the face set on `g`, from what the canvas
// measures, so a word sits on the baseline the page drew it on.
function metricsOf(g, word, size) {
  const measured = g.measureText(word);
  const ascent = Number.isFinite(measured.fontBoundingBoxAscent) ? measured.fontBoundingBoxAscent : size * 0.8;
  const descent = Number.isFinite(measured.fontBoundingBoxDescent) ? measured.fontBoundingBoxDescent : size * 0.2;
  return { ascent, descent, width: measured.width };
}

// Is text in `element` underlined? A link's line is drawn under the text of
// every inline element inside it (a name in a <bdi>), though only the link
// itself carries it.
function underlined(element) {
  for (let at = element; at; at = at.parentElement) {
    const style = getComputedStyle(at);
    if (String(style.textDecorationLine).includes('underline')) return true;
    if (!style.display.startsWith('inline')) return false;
  }
  return false;
}

// A mark drawn before an element's content with no words of its own (a
// subject's colour in its chip): a box at the start of the element's
// content, standing in the middle of its height.
function paintBefore(g, element, box, style, at) {
  const mark = getComputedStyle(element, '::before');
  if (mark.content !== '""' || mark.display === 'none' || NONE.test(mark.backgroundColor)) return;
  const width = pixels(mark.width);
  const height = pixels(mark.height);
  if (width <= 0 || height <= 0) return;
  g.fillStyle = mark.backgroundColor;
  boxPath(g, box.left - at.x + pixels(style.borderLeftWidth) + pixels(style.paddingLeft), box.top - at.y + (box.height - height) / 2, width, height, pixels(mark.borderTopLeftRadius));
  g.fill();
}

// One run of text where the page put it: `rect` is the box the browser laid
// it out in.
function paintRun(g, text, rect, size, style, at) {
  const metrics = metricsOf(g, text, size);
  const x = rect.left - at.x;
  const y = rect.top - at.y + (rect.height - metrics.ascent - metrics.descent) / 2 + metrics.ascent;
  // a face the canvas draws a little wider than the page did is held to the page's width
  if (metrics.width > rect.width + 1) g.fillText(text, x, y, rect.width + 1);
  else g.fillText(text, x, y);
  if (style.underlined) {
    g.fillRect(x, y + Math.max(1, size * 0.1), Math.min(metrics.width, rect.width + 1), Math.max(1, size / 16));
  }
}

// The characters of a word one by one, for a word the page broke across two
// lines (a long name with no space in it).
function lettersOf(text) {
  if (typeof Intl === 'object' && typeof Intl.Segmenter === 'function') return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (part) => ({ text: part.segment, at: part.index }));
  const out = [];
  let at = 0;
  for (const letter of Array.from(text)) {
    out.push({ text: letter, at });
    at += letter.length;
  }
  return out;
}

// A text node, word by word, each word where the browser laid it out: lines
// break, wrap and run right to left on the picture exactly as on the page.
function paintText(g, node, at) {
  const parent = node.parentElement;
  if (!parent || !/\S/u.test(node.data)) return;
  const style = getComputedStyle(parent);
  if (hidden(style)) return;
  const size = pixels(style.fontSize);
  const run = { textTransform: style.textTransform, underlined: underlined(parent) };
  g.font = fontOf(style);
  g.fillStyle = style.color;
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.direction = style.direction === 'rtl' ? 'rtl' : 'ltr';
  if ('letterSpacing' in g) g.letterSpacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing;
  const range = document.createRange();
  for (const word of node.data.matchAll(/\S+/gu)) {
    range.setStart(node, word.index);
    range.setEnd(node, word.index + word[0].length);
    const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
    if (rects.length === 0) continue;
    if (rects.length === 1) {
      paintRun(g, shapedText(word[0], style.textTransform), rects[0], size, run, at);
      continue;
    }
    for (const letter of lettersOf(word[0])) {
      range.setStart(node, word.index + letter.at);
      range.setEnd(node, word.index + letter.at + letter.text.length);
      const box = Array.from(range.getClientRects()).find((rect) => rect.width > 0 && rect.height > 0);
      if (box) paintRun(g, shapedText(letter.text, style.textTransform), box, size, run, at);
    }
  }
  range.detach();
}

// The number or dot a list item stands after, on its first line.
function paintMarker(g, item, style, at) {
  const type = style.listStyleType;
  if (type === 'none' || style.display !== 'list-item') return;
  const list = item.parentElement;
  let marker = '•';
  if (type === 'decimal') {
    const start = list && list.localName === 'ol' && list.hasAttribute('start') ? Number(list.getAttribute('start')) : 1;
    const items = list ? Array.from(list.children).filter((child) => child.localName === 'li') : [item];
    marker = (start + items.indexOf(item)) + '.';
  } else if (type === 'circle') marker = '◦';
  else if (type === 'square') marker = '▪';
  const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT, { acceptNode: (node) => (/\S/u.test(node.data) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP) });
  const first = walker.nextNode();
  const box = item.getBoundingClientRect();
  if (!first) return;
  const range = document.createRange();
  range.selectNodeContents(first);
  const line = range.getClientRects()[0];
  range.detach();
  if (!line) return;
  const size = pixels(style.fontSize);
  g.font = fontOf(style);
  g.fillStyle = style.color;
  g.direction = 'ltr';
  g.textAlign = 'right';
  const metrics = metricsOf(g, marker, size);
  g.fillText(marker, box.left - at.x - size * 0.4, line.top - at.y + (line.height - metrics.ascent - metrics.descent) / 2 + metrics.ascent);
  g.textAlign = 'left';
}

// A field as it stands: what is chosen or typed in it, or a tick in a box.
function paintControl(g, element, box, style, at) {
  const type = element.localName === 'select' ? 'select' : String(element.type).toLowerCase();
  if (type === 'checkbox' || type === 'radio') {
    const side = Math.min(box.width, box.height);
    const x = box.left - at.x + (box.width - side) / 2;
    const y = box.top - at.y + (box.height - side) / 2;
    g.strokeStyle = style.color;
    g.lineWidth = Math.max(1, side / 12);
    boxPath(g, x + 0.5, y + 0.5, side - 1, side - 1, type === 'radio' ? side / 2 : side / 8);
    g.stroke();
    if (element.checked) {
      g.fillStyle = style.accentColor && style.accentColor !== 'auto' ? style.accentColor : style.color;
      if (type === 'radio') {
        boxPath(g, x + side * 0.25, y + side * 0.25, side * 0.5, side * 0.5, side / 4);
        g.fill();
      } else {
        g.beginPath();
        g.moveTo(x + side * 0.22, y + side * 0.52);
        g.lineTo(x + side * 0.42, y + side * 0.72);
        g.lineTo(x + side * 0.8, y + side * 0.28);
        g.strokeStyle = g.fillStyle;
        g.lineWidth = Math.max(1.5, side / 7);
        g.stroke();
      }
    }
    return;
  }
  // a date or a time is shown in the reader's own form, which the field does
  // not give back: the page says the date in words beside it (the substitute plan)
  if (['hidden', 'file', 'range', 'color', 'image', 'button', 'submit', 'reset', 'date', 'time', 'month', 'week', 'datetime-local'].includes(type)) return;
  const text = type === 'select' ? (element.selectedIndex >= 0 ? element.options[element.selectedIndex].text : '') : type === 'password' ? '•'.repeat(String(element.value).length) : String(element.value);
  if (text === '') return;
  const size = pixels(style.fontSize);
  g.font = fontOf(style);
  g.fillStyle = style.color;
  g.textAlign = 'left';
  g.direction = style.direction === 'rtl' ? 'rtl' : 'ltr';
  const left = box.left - at.x + pixels(style.borderLeftWidth) + pixels(style.paddingLeft);
  const fit = box.width - pixels(style.borderLeftWidth) - pixels(style.paddingLeft) - pixels(style.paddingRight) - pixels(style.borderRightWidth);
  const metrics = metricsOf(g, text, size);
  g.save();
  g.beginPath();
  g.rect(left, box.top - at.y, Math.max(0, fit), box.height);
  g.clip();
  g.fillText(text, left, box.top - at.y + (box.height - metrics.ascent - metrics.descent) / 2 + metrics.ascent);
  g.restore();
}

function paintElement(g, element, at) {
  if (element.matches(PICTURE_LEAVES)) return;
  const style = getComputedStyle(element);
  if (style.display === 'none') return;
  const opacity = Number(style.opacity);
  if (opacity <= 0) return;
  g.save();
  g.globalAlpha *= Number.isFinite(opacity) ? opacity : 1;
  const box = element.getBoundingClientRect();
  if (!hidden(style) && style.display !== 'contents') {
    paintBox(g, box, style, at);
    paintBefore(g, element, box, style, at);
    if (element.localName === 'li') paintMarker(g, element, style, at);
    if (element.localName === 'canvas' && element.width > 0 && element.height > 0 && box.width > 0 && box.height > 0) {
      g.drawImage(element, box.left - at.x, box.top - at.y, box.width, box.height);
    }
    if (element.localName === 'input' || element.localName === 'select') paintControl(g, element, box, style, at);
  }
  if (style.display !== 'contents' && (style.overflowX !== 'visible' || style.overflowY !== 'visible')) {
    g.beginPath();
    g.rect(box.left - at.x, box.top - at.y, box.width, box.height);
    g.clip();
  }
  for (const child of element.childNodes) {
    if (child.nodeType === 1) paintElement(g, child, at);
    else if (child.nodeType === 3) paintText(g, child, at);
  }
  g.restore();
}

// The colour behind an element: its own, or the first an ancestor has.
function paperOf(element) {
  for (let at = element; at; at = at.parentElement) {
    const colour = getComputedStyle(at).backgroundColor;
    if (!NONE.test(colour)) return colour;
  }
  return '#ffffff';
}

// The picture's own lines over a page: the school, then the line the foot of
// the page carries (the school and when this copy was published), in the
// page's own face at its body size and a little under it. Each is one line,
// shortened with an ellipsis where it is longer than the picture.
function headLines(target) {
  const lines = [];
  const page = getComputedStyle(target);
  const base = pixels(page.fontSize) || 16;
  const school = document.querySelector('.top__school');
  const foot = document.querySelector('.foot');
  if (school && school.textContent.trim() !== '') lines.push({ text: school.textContent.trim(), font: '600 ' + base + 'px ' + page.fontFamily, size: base, colour: page.color });
  if (foot && foot.textContent.trim() !== '') lines.push({ text: foot.textContent.trim(), font: '400 ' + Math.round(base * 0.8) + 'px ' + page.fontFamily, size: Math.round(base * 0.8), colour: getComputedStyle(foot).color });
  return lines;
}

function shortenedText(g, value, fit) {
  if (g.measureText(value).width <= fit) return value;
  let kept = Array.from(value);
  while (kept.length > 1 && g.measureText(kept.join('') + '…').width > fit) kept = kept.slice(0, -1);
  return kept.join('').trimEnd() + '…';
}

// Draw `target` (a page, or the part of it marked data-picture) on a new
// canvas. → { canvas, scale } or { refused: PICTURE_TOO_LONG }.
export function paintPicture(target, options) {
  const opts = options || {};
  const alone = opts.alone === true;
  const box = target.getBoundingClientRect();
  const lines = alone ? [] : headLines(target);
  const lineHeights = lines.map((line) => Math.ceil(line.size * 1.5));
  const pad = alone ? 0 : PICTURE_PAD;
  const head = lineHeights.reduce((sum, each) => sum + each, 0) + (lines.length > 0 ? PICTURE_PAD / 2 : 0);
  const width = Math.ceil(box.width + pad * 2);
  const height = Math.ceil(box.height + head + pad * 2);
  const scale = pictureScale(width, height);
  if (scale === 0) return { refused: PICTURE_TOO_LONG };
  const canvas = opts.canvas || document.createElement('canvas');
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const g = canvas.getContext('2d');
  g.setTransform(scale, 0, 0, scale, 0, 0);
  g.fillStyle = paperOf(target);
  g.fillRect(0, 0, width, height);
  let y = pad;
  lines.forEach((line, at) => {
    const size = line.size;
    g.font = line.font;
    g.fillStyle = line.colour;
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.direction = 'ltr';
    const metrics = metricsOf(g, line.text, size);
    g.fillText(shortenedText(g, line.text, width - pad * 2), pad, y + (lineHeights[at] - metrics.ascent - metrics.descent) / 2 + metrics.ascent);
    y += lineHeights[at];
  });
  if (lines.length > 0) y += PICTURE_PAD / 2;
  paintElement(g, target, { x: box.left - pad, y: box.top - y });
  return { canvas, scale };
}

// The picture as a PNG Blob. → { blob } or { refused: sentence }.
export function pictureImage(target, options) {
  let painted;
  try {
    painted = paintPicture(target, options);
  } catch (error) {
    return Promise.resolve({ refused: PICTURE_FAILED });
  }
  if (painted.refused) return Promise.resolve(painted);
  return new Promise((resolve) => {
    try {
      painted.canvas.toBlob((blob) => resolve(blob ? { blob } : { refused: PICTURE_FAILED }), 'image/png');
    } catch (error) {
      resolve({ refused: PICTURE_FAILED });
    }
  });
}

// Hand an image to the reader: through the device's share sheet where it
// takes a file (so it can go to Photos on a phone), else as a download.
// → 'shared', 'saved', or 'cancelled' when the share sheet was closed.
export async function handOver(blob, name, title) {
  const nav = globalThis.navigator;
  let file = null;
  try {
    file = new File([blob], name, { type: 'image/png' });
  } catch (error) {
    file = null;
  }
  if (file && nav && typeof nav.canShare === 'function' && typeof nav.share === 'function' && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file], title });
      return 'shared';
    } catch (error) {
      if (error && error.name === 'AbortError') return 'cancelled';
      // a share sheet that fails for any other reason: the download below
    }
  }
  const address = URL.createObjectURL(blob);
  const link = h('a', { href: address, download: name, hidden: true });
  document.body.appendChild(link);
  link.click();
  link.remove();
  globalThis.setTimeout(() => URL.revokeObjectURL(address), 60000);
  return 'saved';
}

// "Save as image", and the line that says how it went. The page is found
// when the button is pressed: the page the button is on, or the part of it
// marked data-picture. The view's name comes from the frame the shell puts
// the page in (data-view), the rest of the file's name from the heading.
export function pictureButton(label) {
  const says = h('span', { class: 'muted', role: 'status', dataset: { says: 'picture' } });
  const button = h('button', { class: 'btn', type: 'button', dataset: { output: 'picture' } }, label || 'Save as image');
  let busy = false;
  button.addEventListener('click', () => {
    if (busy) return;
    const page = button.closest('.page__body');
    if (!page) return;
    const part = page.querySelector('[data-picture]');
    const frame = page.closest('[data-view]');
    const heading = page.querySelector('.page__title');
    const name = pictureName(frame ? frame.dataset.view : '', heading ? heading.textContent : '');
    busy = true;
    says.textContent = 'Making the image…';
    pictureImage(part || page, { alone: Boolean(part) }).then((made) => {
      if (made.refused) return made.refused;
      return handOver(made.blob, name, document.title).then((how) => {
        if (how === 'shared') return 'Shared as ' + name + '.';
        if (how === 'saved') return PICTURE_SAVED + name + '.';
        return '';
      });
    }).catch(() => PICTURE_FAILED).then((sentence) => {
      busy = false;
      says.textContent = sentence;
    });
  });
  return [button, says];
}

// pageOf(typed(teacher.name), 'Teaches 5 classes.', ...more)
// `title` and `lede` are text or nodes; a name somebody typed goes in through
// typed() from dom.js. What is shared is the tab's title, which the shell
// sets from the view's own: the page's name, then the school's.
export function pageOf(title, lede, ...children) {
  const page = h('article', { class: 'page__body' },
    h('p', { class: 'print-only page__printed', dataset: { printed: 'date' } }, 'Printed ', today()),
    h('h1', { class: 'page__title', tabindex: '-1' }, title),
    lede ? h('p', { class: 'lede' }, lede) : null,
    children);
  const print = page.querySelector('[data-print]') ? null : h('p', { class: 'actions', dataset: { actions: 'print' } }, printButton(), pictureButton());
  const share = shareRow(() => document.title);
  if (print || share) page.appendChild(h('div', { class: 'page__outputs' }, print, share));
  return page;
}

// "Print this page" stands only on a page with something to print: a page
// that is still asking (which teacher, which rooms, what to search for) has
// no result, and says so with printWhen(page, false). The row leaves the
// page, and Share's frame with it when nothing else is in it.
export function printWhen(page, has) {
  page.dataset.result = has ? 'true' : 'none';
  const row = page.querySelector('[data-actions="print"]');
  if (row) row.hidden = !has;
  const outputs = page.querySelector('.page__outputs');
  if (outputs) outputs.hidden = Array.from(outputs.children).every((child) => child.hidden);
  return page;
}

// For a view whose result comes and goes as the reader chooses, before and
// after its page exists:
//
//   const gate = printGate();
//   gate.set(found.ok);                 in the view's own draw()
//   return gate.on(pageOf(...));
export function printGate() {
  let page = null;
  let has = false;
  return {
    set(value) {
      has = Boolean(value);
      if (page) printWhen(page, has);
    },
    on(made) {
      page = made;
      return printWhen(page, has);
    },
  };
}

// The date line of every page on screen is written again as printing starts,
// so a page left open since yesterday is not dated yesterday.
if (typeof globalThis.addEventListener === 'function') {
  globalThis.addEventListener('beforeprint', () => {
    for (const line of document.querySelectorAll('[data-printed="date"]')) line.replaceChildren('Printed ', today());
  });
}

// A page for an address that names something this file does not have: a
// teacher who has left, a link from an older copy.
export function missingPage(what) {
  return printWhen(pageOf('Not in this schedule', 'This copy of the schedule has no ' + what + ' at this address. It may be from an older or a newer copy.',
    h('p', null, h('a', { class: 'btn', href: '#/search' }, 'Search the schedule'))), false);
}

// What the search page says above its box when the address named no page of
// this file at all ("#/nonsense/route"): the shell puts it there.
export const UNKNOWN_PAGE_SENTENCE = 'That page is not in this schedule.';

// A view the publisher left out of this file.
export function leftOutPage(name) {
  return printWhen(pageOf(name, 'This view was not included when this schedule was published.',
    h('p', null, h('a', { class: 'btn', href: '#/search' }, 'Search the schedule'))), false);
}
