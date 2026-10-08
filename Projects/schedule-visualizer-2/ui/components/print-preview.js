// The print preview sheet (spec 3.16, DESIGN 8). It shows one printable output
// as it will be on paper, lets the paper size and orientation be chosen, and
// prints.
//
// The output is a document a module of ui/prints/ built from the model. It is
// shown in a frame the width of the sheet of paper, scaled to fit the window;
// "Print" prints the frame, so what goes to the printer is the document and
// nothing of the planner around it. The frame runs no script: every string in
// the document is escaped by its maker, and the frame's sandbox means a
// string that got through anyway could still do nothing.
//
//   openPrintPreview(ctx, outputId, options)
//     outputId   an id in ui/prints/index.js: 'floor-plan', 'room-list', 'checks'
//     options    { floorId, sort, opener }: floorId and sort go to the output;
//                opener is what gets focus back (the focused element, left out)
//   returns { element, frame, close(), closed, ready(), state }
//     ready()    resolves when the document on show has been laid out
//     state      { output, paper: { size, orientation }, floorId, traceImage, title }
//
//   printButton(ctx, entry, getOptions)
//     a button for one entry of `printButtons` (ui/prints/index.js); the
//     screen that owns the place mounts it. getOptions() is asked at each
//     click, for the floor on show.
//
// The floor plan can carry the image a floor was traced over. It is off
// until asked for, and the tick is offered only when a floor being printed
// has an image that is shown on screen and is on this device. The bytes are
// read from the device (ctx.storage.getImage) when it is ticked and handed to
// the output as data URLs, so the document still fetches nothing.
//
// The paper chosen here is the project's setting (Settings › Paper size), so
// it is remembered and is one undo step, like any other setting. In a tab that
// cannot change the project the choice lasts for this sheet only.

import { h, uid } from './dom.js';
import { choice } from './choice.js';
import { setSetting } from '../../engine/actions.js';
import { outputFor } from '../prints/index.js';
import { tracedFloors } from '../prints/floor-plan.js';
import { PAPERS, ORIENTATIONS, paperOf, paperBox, MARGIN } from '../prints/document.js';

const SHEET = new URL('../print.css', import.meta.url).href;
const UI_BASE = new URL('../', import.meta.url).href;
const MM = 96 / 25.4; // CSS pixels in a millimetre
// Room around the sheets inside the frame, in pixels.
const EDGE = 8;

// How long a stylesheet that is already in the page is waited for. One that
// failed before this module looked will never say so.
const SHEET_WAIT_MS = 3000;

let sheet = null;

// The sheet's own rules are in print.css, which index.html links (the link
// marked data-sheet="print"). This waits for that link; a page with no such
// link gets one, once.
function stylesheet() {
  if (sheet) return sheet;
  let link = document.querySelector('link[data-sheet="print"]');
  if (link && link.sheet) {
    sheet = Promise.resolve(true);
    return sheet;
  }
  const waiting = link !== null;
  if (!link) link = h('link', { rel: 'stylesheet', href: SHEET, data: { sheet: 'print' } });
  sheet = new Promise((resolve) => {
    link.addEventListener('load', () => resolve(true), { once: true });
    link.addEventListener('error', () => resolve(false), { once: true });
    if (waiting) setTimeout(() => resolve(Boolean(link.sheet)), SHEET_WAIT_MS);
  });
  if (!waiting) document.head.append(link);
  return sheet;
}

// A stored image as a data URL, for a document that may fetch nothing.
function dataUrl(value) {
  const blob = value.blob.type ? value.blob : new Blob([value.blob], { type: value.type || 'image/jpeg' });
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(typeof reader.result === 'string' ? reader.result : null));
    reader.addEventListener('error', () => resolve(null));
    reader.readAsDataURL(blob);
  });
}

// Whether this browser prints the page boxes of print.css (the tool's name
// and "Page 1 of 3" at the foot of every sheet). Where it does, the
// document's own closing line is left off the paper.
function printsPageBoxes() {
  return typeof globalThis.CSSMarginRule === 'function';
}

export function openPrintPreview(ctx, outputId, options) {
  const output = outputFor(outputId);
  if (!output) throw new Error('There is no printable output called "' + outputId + '".');
  const opts = options || {};
  const opener = opts.opener || document.activeElement;
  const store = ctx.store;
  const project = () => store.project;

  const state = {
    output: output.id,
    paper: paperOf(project(), null),
    floorId: opts.floorId || 'all',
    traceImage: false,
    title: '',
  };
  let settle;
  const closed = new Promise((resolve) => {
    settle = resolve;
  });
  let laidOut = Promise.resolve();
  let derived = null;
  let alive = true;

  const titleId = uid('preview-title');
  const sizeLabel = uid('preview-size');
  const turnLabel = uid('preview-turn');
  const floorLabel = uid('preview-floor');
  const statusId = uid('preview-status');
  const traceId = uid('preview-trace');

  const title = h('h2', { class: 'preview__title', id: titleId }, 'Print: ' + output.name);
  const status = h('p', { class: 'preview__status', id: statusId, role: 'status' });

  const frame = h('iframe', {
    class: 'preview__frame',
    title: 'Preview of the ' + output.name.toLowerCase() + ' as it will print',
    sandbox: 'allow-same-origin allow-modals',
  });
  const fit = h('div', { class: 'preview__fit' }, frame);
  const stage = h('div', { class: 'preview__stage', tabindex: '0', role: 'group', 'aria-label': 'Preview' }, fit);

  function setPaper(key, value) {
    if (state.paper[key] === value) return;
    state.paper = { ...state.paper, [key]: value };
    try {
      store.apply(setSetting, { key: 'paper.' + key, value });
    } catch (error) {
      // a tab that cannot change the project: the choice lasts for this sheet
    }
    show();
  }

  const size = choice({
    name: uid('paper-size'),
    labelledBy: sizeLabel,
    options: Object.entries(PAPERS).map(([value, paper]) => ({ value, label: paper.label })),
    value: state.paper.size,
    onChange: (value) => setPaper('size', value),
  });
  const turn = choice({
    name: uid('paper-turn'),
    labelledBy: turnLabel,
    options: Object.entries(ORIENTATIONS).map(([value, label]) => ({ value, label })),
    value: state.paper.orientation,
    onChange: (value) => setPaper('orientation', value),
  });

  const controls = [
    h('div', { class: 'preview__control' }, h('span', { class: 'preview__label', id: sizeLabel }, 'Paper size'), size.element),
    h('div', { class: 'preview__control' }, h('span', { class: 'preview__label', id: turnLabel }, 'Orientation'), turn.element),
  ];

  // "This floor / every floor", for the outputs that are about the building.
  const floors = project().building.floors;
  const takesFloor = output.id === 'floor-plan' || output.id === 'room-list';
  if (takesFloor && floors.length > 1) {
    const select = h('select', { class: 'preview__select', id: floorLabel + '-field', 'aria-labelledby': floorLabel },
      h('option', { value: 'all' }, 'Every floor'),
      floors.map((floor) => h('option', { value: floor.id }, floor.name)));
    select.value = floors.some((floor) => floor.id === state.floorId) ? state.floorId : 'all';
    state.floorId = select.value;
    select.addEventListener('change', () => {
      state.floorId = select.value;
      refresh();
    });
    controls.push(h('div', { class: 'preview__control' }, h('span', { class: 'preview__label', id: floorLabel }, 'Floors'), select));
  }

  // "Show the traced image under the plan": hidden unless a floor on these
  // sheets has an image to show (show() decides, each time).
  const traceBox = h('input', { type: 'checkbox', class: 'preview__check-box', id: traceId, name: 'traceImage' });
  const traceControl = h('div', { class: 'preview__control preview__control--check', hidden: true, data: { control: 'trace' } },
    h('label', { class: 'preview__check', for: traceId }, traceBox, h('span', null, 'Show the traced image under the plan')));
  if (output.id === 'floor-plan') controls.push(traceControl);
  // imageId -> its bytes as a data URL, or null when the device has none
  const traceUrls = new Map();
  const tracedNow = () => (output.id === 'floor-plan' ? tracedFloors(project(), { floorId: state.floorId }) : []);

  // Read the bytes of every image these sheets would show, once each.
  async function loadTraces() {
    for (const floor of tracedNow()) {
      const imageId = floor.image.imageId;
      if (traceUrls.has(imageId)) continue;
      let url = null;
      try {
        const value = ctx.storage ? await ctx.storage.getImage(imageId) : null;
        if (value && value.blob) url = await dataUrl(value);
      } catch (error) {
        url = null;
      }
      traceUrls.set(imageId, url);
    }
  }

  // Draw again after a choice that may need an image's bytes first. The
  // document on show is let finish before it is replaced (see below, where
  // the checks report waits for the same reason).
  function refresh() {
    if (!alive || !state.traceImage || tracedNow().every((floor) => traceUrls.has(floor.image.imageId))) return show();
    element.dataset.ready = 'false';
    const settled = laidOut.then(loadTraces, loadTraces);
    laidOut = settled.then(() => show());
    return laidOut;
  }

  traceBox.addEventListener('change', () => {
    state.traceImage = traceBox.checked;
    refresh();
  });

  const printNow = h('button', { type: 'button', class: 'btn btn--primary', data: { action: 'print' } }, 'Print');
  const closeButton = h('button', { type: 'button', class: 'btn', data: { action: 'close' } }, 'Close');

  const element = h('dialog', { class: 'preview', id: 'print-preview', 'aria-labelledby': titleId, 'aria-describedby': statusId, data: { output: output.id, ready: 'false' } },
    h('div', { class: 'preview__head' }, title, controls),
    stage,
    h('div', { class: 'preview__foot' }, status, printNow, closeButton),
  );

  // The frame is the sheet's own width; the window is rarely that wide, so it
  // is scaled down to fit (and never up).
  function place() {
    const doc = frame.contentDocument;
    if (!doc || !doc.documentElement) return;
    const box = paperBox(state.paper);
    const width = Math.ceil(box.width * MM) + EDGE * 2;
    frame.style.width = width + 'px';
    frame.style.height = 'auto';
    const height = Math.max(doc.documentElement.scrollHeight, Math.ceil(box.height * MM) + EDGE * 2);
    frame.style.height = height + 'px';
    const room = stage.clientWidth - parseFloat(getComputedStyle(stage).paddingLeft) * 2;
    const scale = room > 0 ? Math.min(1, room / width) : 1;
    frame.style.transform = 'scale(' + scale + ')';
    fit.style.width = Math.floor(width * scale) + 'px';
    fit.style.height = Math.ceil(height * scale) + 'px';
    // How many sheets of paper: each .page starts one, and so does each
    // .new-sheet inside it; a stretch longer than the sheet runs on to more.
    const printable = (box.height - MARGIN.top - MARGIN.bottom) * MM;
    let sheets = 0;
    for (const page of doc.querySelectorAll('.page')) {
      const style = doc.defaultView.getComputedStyle(page);
      const edge = page.getBoundingClientRect();
      const top = edge.top + parseFloat(style.paddingTop);
      const bottom = Math.max(top, edge.top + page.scrollHeight - parseFloat(style.paddingBottom));
      const starts = [top].concat(Array.from(page.querySelectorAll('.new-sheet')).map((el) => el.getBoundingClientRect().top), [bottom]);
      for (let i = 0; i < starts.length - 1; i += 1) sheets += Math.max(1, Math.ceil((starts[i + 1] - starts[i] - 1) / printable));
    }
    element.dataset.sheets = String(sheets);
    const lost = state.traceImage && tracedNow().some((floor) => traceUrls.get(floor.image.imageId) === null);
    status.textContent = PAPERS[state.paper.size].label + ', ' + ORIENTATIONS[state.paper.orientation].toLowerCase() + '. About ' + sheets + (sheets === 1 ? ' sheet.' : ' sheets.')
      + (lost ? ' A traced image could not be read from this device, so its plan prints without it.' : '');
  }

  function show() {
    if (!alive) return laidOut;
    element.dataset.ready = 'false';
    traceControl.hidden = tracedNow().length === 0;
    const traceImages = {};
    for (const [imageId, url] of traceUrls) if (url !== null) traceImages[imageId] = url;
    const rendered = output.render(project(), derived, {
      paper: state.paper,
      now: ctx.clock ? ctx.clock() : null,
      base: UI_BASE,
      floorId: state.floorId,
      sort: opts.sort,
      traceImage: state.traceImage,
      traceImages,
    });
    state.title = rendered.title;
    laidOut = new Promise((resolve) => {
      frame.addEventListener('load', async () => {
        const doc = frame.contentDocument;
        if (doc && doc.documentElement) {
          doc.documentElement.classList.toggle('has-page-boxes', printsPageBoxes());
          // with the focus inside the preview, Ctrl/Cmd+P is still this document
          doc.addEventListener('keydown', (event) => {
            if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'p') {
              event.preventDefault();
              print();
            }
          });
          // the sheets are measured once their stylesheets and faces are in
          await Promise.all(Array.from(doc.querySelectorAll('link[rel="stylesheet"]')).map((link) => (link.sheet ? null : new Promise((done) => {
            link.addEventListener('load', done, { once: true });
            link.addEventListener('error', done, { once: true });
          }))));
          if (doc.fonts && doc.fonts.ready) await doc.fonts.ready;
        }
        if (alive) {
          place();
          element.dataset.paper = state.paper.size + ' ' + state.paper.orientation;
          element.dataset.ready = 'true';
        }
        resolve();
      }, { once: true });
    });
    frame.srcdoc = rendered.html;
    return laidOut;
  }

  function close() {
    if (!alive) return;
    alive = false;
    observer.disconnect();
    element.close();
    element.remove();
    if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus();
    else if (typeof ctx.focusSurface === 'function') ctx.focusSurface();
    settle(null);
  }

  function print() {
    const view = frame.contentWindow;
    if (!view) return;
    // the printed job is named for the document, where the browser takes a name
    const name = document.title;
    if (state.title) document.title = state.title;
    try {
      view.print();
    } finally {
      document.title = name;
    }
  }

  printNow.addEventListener('click', print);
  closeButton.addEventListener('click', close);
  element.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  // Ctrl/Cmd+P inside the sheet prints the document, not the planner behind it.
  element.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'p') {
      event.preventDefault();
      print();
    }
  });

  const observer = new ResizeObserver(() => {
    if (element.dataset.ready === 'true') place();
  });

  document.body.append(element);
  element.showModal();
  closeButton.focus();
  observer.observe(stage);

  const first = stylesheet().then(() => show());
  laidOut = first;

  // The checks report prints the findings the planner already has, walk
  // figures included, when something is working them out; the first document
  // (the checks alone) is replaced when they arrive.
  if (output.id === 'checks' && store.derived && store.derived.engine) {
    // only once the first document is laid out: replacing it while its
    // stylesheets and faces are still awaited would leave that wait, and
    // ready() with it, pending for good
    store.derived.results().then((result) => first.then(() => {
      if (!alive || !result || !result.findings) return;
      derived = { findings: result.findings, walks: result.walks };
      show();
    })).catch(() => { /* the document already on show stands */ });
  }

  return {
    element,
    frame,
    close,
    closed,
    state,
    ready: () => first.then(() => laidOut),
  };
}

// A button that opens the preview for one entry of `printButtons`.
export function printButton(ctx, entry, getOptions) {
  const button = h('button', { type: 'button', class: 'btn', id: entry.id, data: { print: entry.output } }, entry.label);
  button.addEventListener('click', () => {
    openPrintPreview(ctx, entry.output, { ...(typeof getOptions === 'function' ? getOptions() : null), opener: button });
  });
  return button;
}
