// What every printed output shares: the escape helper, the paper sizes, and
// the frame of a print document (DESIGN 8): a header that says the school,
// what this is and the date; the body; a footer.
//
// A print module builds its body as a string of markup and hands it here.
// Every string that came from the project goes through esc() on its way in.
// Nothing here reads the screen, the clock or the device: the date is given
// (`options.now`), so the same project and options give the same document.
//
// options, for every output:
//   paper   { size: a key of PAPERS, orientation: 'portrait' | 'landscape' };
//           the project's own setting when left out
//   now     a Date or an ISO string for the header's date; no date when left out
//   base    where the two stylesheets are, as the document will see it
//           ("ui/" from the planner's page, which is the default)

export const TOOL_NAME = 'Schedule Visualizer 2';

// Millimetres, portrait, in the order the preview offers them; the keys are
// engine/schema.js PAPER_SIZES. `css` is the page rule's keyword where CSS
// has one that every browser reads; the others are written as lengths.
// `poster` marks the sizes a print shop or a plotter prints, not an office
// printer. Tabloid is 11 × 17 in.
export const PAPERS = {
  letter: { label: 'US Letter', css: 'letter', width: 215.9, height: 279.4 },
  a4: { label: 'A4', css: 'A4', width: 210, height: 297 },
  tabloid: { label: 'Tabloid', width: 279.4, height: 431.8 },
  a3: { label: 'A3', width: 297, height: 420 },
  a2: { label: 'A2', poster: true, width: 420, height: 594 },
  a1: { label: 'A1', poster: true, width: 594, height: 841 },
  a0: { label: 'A0', poster: true, width: 841, height: 1189 },
  'poster-24x36': { label: '24 × 36 in', poster: true, width: 609.6, height: 914.4 },
};
export const ORIENTATIONS = { portrait: 'Portrait', landscape: 'Landscape' };

// The margins print.css gives a page, in millimetres. The footer's line sits
// in the bottom one.
export const MARGIN = { top: 12, right: 12, bottom: 16, left: 12 };

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

// A string as text inside markup, or inside a quoted attribute. Anything that
// is not a string is written the way String() gives it; null and undefined
// are nothing.
export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (character) => ESCAPES[character]);
}

// What XML 1.0 cannot hold at all, even as a character reference: the C0
// controls but tab, newline and carriage return, U+FFFE, U+FFFF, and a
// surrogate that is not half of a pair.
const NOT_XML = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

// A string as text inside a stand-alone SVG, which is XML: as esc(), and each
// character XML cannot hold written as U+FFFD, so the file still parses (the
// floor plan's PNG, SV2-32k). HTML holds these as typed, so a print keeps esc().
export function escXml(value) {
  return esc(value).replace(NOT_XML, '\ufffd');
}

// The paper a document is laid out for: what was asked, else the project's
// setting, else US Letter upright. Anything unknown falls back the same way.
export function paperOf(project, options) {
  const asked = (options && options.paper) || {};
  const set = (project && project.settings && project.settings.paper) || {};
  const size = PAPERS[asked.size] ? asked.size : PAPERS[set.size] ? set.size : 'letter';
  const orientation = ORIENTATIONS[asked.orientation] ? asked.orientation : ORIENTATIONS[set.orientation] ? set.orientation : 'portrait';
  return { size, orientation };
}

// The sheet in millimetres as it will be read: { width, height }.
export function paperBox(paper) {
  const sheet = PAPERS[paper.size];
  return paper.orientation === 'landscape' ? { width: sheet.height, height: sheet.width } : { width: sheet.width, height: sheet.height };
}

// The part of the sheet inside the margins.
export function printableBox(paper) {
  const box = paperBox(paper);
  return { width: box.width - MARGIN.left - MARGIN.right, height: box.height - MARGIN.top - MARGIN.bottom };
}

// "@page { size: letter portrait; }", or for a size CSS has no keyword for,
// its two lengths the way the sheet is read: "@page { size: 841mm 594mm; }".
export function pageRule(paper) {
  const sheet = PAPERS[paper.size];
  if (sheet.css) return '@page { size: ' + sheet.css + ' ' + paper.orientation + '; }';
  const box = paperBox(paper);
  return '@page { size: ' + mm(box.width) + ' ' + mm(box.height) + '; }';
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// "8 October 2026", in the device's own zone. "" for anything that is not a date.
export function printDate(now) {
  if (now === null || now === undefined || now === '') return '';
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) return '';
  return date.getDate() + ' ' + MONTHS[date.getMonth()] + ' ' + date.getFullYear();
}

export function schoolName(project) {
  const name = project && project.settings && typeof project.settings.schoolName === 'string' ? project.settings.schoolName : '';
  return name.trim() === '' ? TOOL_NAME : name;
}

// A number of millimetres for a style: at most two decimals, no exponent.
export function mm(value) {
  return String(Math.round(value * 100) / 100) + 'mm';
}

// The whole document.
//
// frame(project, { output, what, pages, options })
//   output   the output's id, kept on the root as data-output
//   what     what this is, in words: "Checks report". The document's title is
//            this and the school.
//   pages    [{ what, body }]: each starts a new sheet of paper under its own
//            header. `what` (text) is the header's line when it differs from
//            the document's; `body` is markup, already escaped by its maker.
//            Inside a body, an element with the class "new-sheet" starts a
//            new sheet of paper too (print.css), and the preview counts it.
//   foot     false leaves off the closing line, the tool's name, which a
//            browser with no page margin boxes prints once after the last
//            sheet. A batch says so: its last sheet is as tall as the paper,
//            and the line after it was a sheet of its own that the preview
//            never counted.
// returns { title, html }
export function frame(project, parts) {
  const options = parts.options || {};
  const paper = paperOf(project, options);
  const box = paperBox(paper);
  const school = schoolName(project);
  const date = printDate(options.now);
  const base = typeof options.base === 'string' ? options.base : 'ui/';
  const title = parts.what + ' · ' + school;

  const pages = parts.pages.map((page) => [
    '<section class="page">',
    '<header class="doc-head">',
    '<p class="doc-head__school">' + esc(school) + '</p>',
    '<h1 class="doc-head__what">' + esc(page.what || parts.what) + '</h1>',
    date === '' ? '' : '<p class="doc-head__date">' + esc(date) + '</p>',
    '</header>',
    '<div class="doc-body">',
    page.body,
    '</div>',
    '</section>',
  ].join('\n'));

  const html = [
    '<!doctype html>',
    '<html lang="en" class="print-doc" data-theme="light" data-output="' + esc(parts.output) + '" data-paper="' + paper.size + '" data-orientation="' + paper.orientation + '"'
      + ' style="--page-w: ' + mm(box.width) + '; --page-h: ' + mm(box.height) + ';">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light">',
    '<title>' + esc(title) + '</title>',
    '<link rel="stylesheet" href="' + esc(base) + 'tokens.css">',
    '<link rel="stylesheet" href="' + esc(base) + 'print.css">',
    '<style id="page-size">' + pageRule(paper) + '</style>',
    '</head>',
    '<body>',
    // the sheets are the document's main part, and the closing line its foot,
    // so a screen reader can go to either (axe's landmark rules, SV2-32g1)
    '<main class="doc-main">',
    pages.join('\n'),
    '</main>',
  ].concat(parts.foot === false ? [] : ['<footer class="doc-foot">' + esc(TOOL_NAME) + '</footer>'], [
    '</body>',
    '</html>',
    '',
  ]).join('\n');

  return { title, html };
}
