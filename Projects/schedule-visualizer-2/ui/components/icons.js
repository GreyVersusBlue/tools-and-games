// The interface's icons: 20 by 20, drawn with a 1.5 px line, square corners.
// icon(name) returns an <svg> that is hidden from screen readers; the control
// it sits in carries the words.

const PATHS = {
  building: 'M3 3h14v14H3z M3 9h6 M9 3v10 M13 17v-5 M13 8h4',
  schedule: 'M3 4h14v13H3z M3 8h14 M3 12.5h14 M8 4v13 M12.5 4v13',
  movement: 'M4 17V10h8V4 M9 7l3-3 3 3',
  scenarios: 'M5 3v14 M5 12h4l4-5h4 M14.5 4.5 17 7l-2.5 2.5',
  safety: 'M3 3h9v14H3z M9 10h8 M14.5 7.5 17 10l-2.5 2.5',
  staff: 'M6 2h8v16H6z M9 15h2',
  project: 'M4 4h12v14H4z M7.5 4V2h5v2 M7 9h6 M7 12.5h6',
  undo: 'M7 4 3 8l4 4 M3 8h9a4.5 4.5 0 0 1 0 9H8',
  redo: 'M13 4l4 4-4 4 M17 8H8a4.5 4.5 0 0 0 0 9h4',
  search: 'M3.5 8.5a5 5 0 1 0 10 0a5 5 0 1 0-10 0 M12.2 12.2 17 17',
  theme: 'M3 10a7 7 0 1 0 14 0a7 7 0 1 0-14 0 M10 3v14',
  close: 'M5 5l10 10 M15 5 5 15',
  check: 'M4 10.5 8 14.5 16 5.5',
  sort: 'M6 8l4-4 4 4 M6 12l4 4 4-4',
  up: 'M5 12l5-5 5 5',
  down: 'M5 8l5 5 5-5',
  right: 'M8 5l5 5-5 5',
};

const SVG = 'http://www.w3.org/2000/svg';

export function icon(name, size) {
  const d = PATHS[name];
  if (!d) throw new Error('There is no icon called "' + name + '".');
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('width', String(size || 20));
  svg.setAttribute('height', String(size || 20));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', 'icon');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', d);
  svg.append(path);
  return svg;
}

export const ICON_NAMES = Object.keys(PATHS);
