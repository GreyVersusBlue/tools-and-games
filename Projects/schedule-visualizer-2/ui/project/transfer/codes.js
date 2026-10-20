// The connection codes on screen: shown as a QR code and as text to copy,
// and taken in by the camera or by pasting.
//
//   codeShown(code, { label }) → { element }   the QR code, the text and Copy
//   codeTaken({ label, connect, say, kind })  → { element, field, scanner, stop(), focus() }
//
// The QR code is an SVG drawn from vendor/qr-encode (error correction M,
// the level engine/transfer.js sizes a code for), dark on white whatever the
// theme, with the four-module quiet margin the standard asks for.
//
// The camera is asked for only when the person chooses to scan, and stopped
// when they stop it, when a code is read, and when the dialog closes (stop()).
// A frame is read by BarcodeDetector where the browser has one that reads QR
// codes, and otherwise by vendor/qr-decode on the frame drawn into a canvas
// at most SCAN_WIDTH pixels wide (a full-size frame takes a quarter of a
// second to a half to decode). One frame is read at a time; the next is
// asked for only once the last is done, so the page stays responsive.

import { h, uid } from '../../components/dom.js';
import { encodeQr, qrPathData } from '../../../vendor/qr-encode/qr-encode.js';
import { luminanceOf, decodeLuminance } from '../../../vendor/qr-decode/qr-decode.js';
import { SIGNAL_PREFIX } from '../../../engine/transfer.js';

export const SCAN_WIDTH = 640;
// Between two reads when the browser has no requestVideoFrameCallback.
export const SCAN_GAP_MS = 120;
export const QR_LEVEL = 'M';
const SVG = 'http://www.w3.org/2000/svg';

export function looksLikeCode(text) {
  return typeof text === 'string' && text.trim().slice(0, SIGNAL_PREFIX.length).toUpperCase() === SIGNAL_PREFIX;
}

function svg(tag, attributes) {
  const el = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, String(value));
  return el;
}

// The QR code of `code` as an <svg>, one unit a module.
export function qrSvg(code, label) {
  const symbol = encodeQr(code, { level: QR_LEVEL });
  const side = symbol.size + 8;
  const figure = svg('svg', { viewBox: '0 0 ' + side + ' ' + side, class: 'xfer__qr', role: 'img', 'aria-label': label, 'shape-rendering': 'crispEdges', 'data-version': symbol.version });
  figure.append(svg('rect', { x: 0, y: 0, width: side, height: side, fill: '#ffffff' }), svg('path', { d: qrPathData(symbol, 4), fill: '#000000' }));
  return figure;
}

async function copyText(text, box) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // no clipboard permission (an http page, an old browser): select it so
    // the device's own Copy works, and try the old command
    box.focus();
    box.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    }
  }
}

export function codeShown(code, options) {
  const textId = uid('xfer-code');
  const box = h('textarea', { class: 'xfer__code', id: textId, readonly: true, rows: '4', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', data: { code: options.kind } });
  box.value = code;
  const copied = h('p', { class: 'xfer__copied', role: 'status' });
  const copy = h('button', { type: 'button', class: 'btn', data: { action: 'copy-' + options.kind } }, 'Copy the code');
  copy.addEventListener('click', async () => {
    const ok = await copyText(code, box);
    copied.textContent = ok ? 'Copied. Paste it on the other device.' : 'The code is selected. Copy it with the device’s own Copy.';
  });
  const element = h('div', { class: 'xfer__shown' },
    h('div', { class: 'xfer__qr-frame' }, qrSvg(code, options.label)),
    h('label', { class: 'field__label', for: textId }, 'The same code as text'),
    box,
    h('div', { class: 'card__buttons' }, copy),
    copied,
  );
  return { element, box };
}

// ---------------------------------------------------------------- the camera

function detectorFor() {
  const Detector = globalThis.BarcodeDetector;
  if (typeof Detector !== 'function') return Promise.resolve(null);
  const formats = typeof Detector.getSupportedFormats === 'function' ? Detector.getSupportedFormats() : Promise.resolve(['qr_code']);
  return formats.then((list) => (list.includes('qr_code') ? new Detector({ formats: ['qr_code'] }) : null), () => null);
}

// Reads codes from the camera into onCode(text). The element carries
// data-camera ('off', 'starting', 'on', 'refused') and, while on,
// data-reader ('barcode-detector' or 'decoder').
export function createScanner(options) {
  const video = h('video', { class: 'xfer__video', muted: true, playsinline: true, autoplay: true, 'aria-hidden': 'true' });
  video.muted = true;
  const element = h('div', { class: 'xfer__camera', data: { camera: 'off' }, hidden: true }, video);
  let stream = null;
  let running = false;
  let canvas = null;
  let reads = 0;

  function set(state) {
    element.dataset.camera = state;
  }

  async function readOnce(detector) {
    if (video.readyState < 2 || video.videoWidth === 0) return null;
    if (detector) {
      const found = await detector.detect(video);
      const hit = found.find((each) => looksLikeCode(each.rawValue));
      return hit ? hit.rawValue : null;
    }
    const scale = Math.min(1, SCAN_WIDTH / video.videoWidth);
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));
    if (!canvas) canvas = document.createElement('canvas');
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const g = canvas.getContext('2d', { willReadFrequently: true });
    g.drawImage(video, 0, 0, width, height);
    const read = decodeLuminance(luminanceOf(g.getImageData(0, 0, width, height).data, width, height), width, height);
    return read && looksLikeCode(read.text) ? read.text : null;
  }

  function next(fn) {
    if (typeof video.requestVideoFrameCallback === 'function') video.requestVideoFrameCallback(() => fn());
    else setTimeout(fn, SCAN_GAP_MS);
  }

  async function loop(detector) {
    if (!running) return;
    let text = null;
    try {
      text = await readOnce(detector);
    } catch {
      text = null;
    }
    reads += 1;
    element.dataset.reads = String(reads);
    if (!running) return;
    if (text) {
      stop();
      options.onCode(text.trim());
      return;
    }
    next(() => loop(detector));
  }

  async function start() {
    if (running) return;
    const media = navigator.mediaDevices;
    if (!media || typeof media.getUserMedia !== 'function') {
      set('refused');
      options.say('This browser cannot use a camera here. Paste the code instead.');
      return;
    }
    running = true;
    element.hidden = false;
    set('starting');
    let got;
    try {
      got = await media.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    } catch (error) {
      running = false;
      element.hidden = true;
      set('refused');
      const denied = error && (error.name === 'NotAllowedError' || error.name === 'SecurityError');
      options.say(denied ? 'The camera was not allowed. Paste the code instead, or allow the camera for this page and scan again.' : 'The camera could not be started. Paste the code instead.');
      return;
    }
    if (!running) {
      // stopped while the browser was asking
      for (const track of got.getTracks()) track.stop();
      return;
    }
    stream = got;
    video.srcObject = stream;
    try {
      await video.play();
    } catch { /* autoplay with muted video starts by itself */ }
    const detector = await detectorFor();
    element.dataset.reader = detector ? 'barcode-detector' : 'decoder';
    set('on');
    options.say('Hold the other device’s QR code in front of the camera.');
    loop(detector);
  }

  function stop() {
    running = false;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      stream = null;
    }
    video.srcObject = null;
    element.hidden = true;
    if (element.dataset.camera !== 'refused') set('off');
  }

  return {
    element,
    start,
    stop,
    get running() {
      return running;
    },
  };
}

// Where a code comes in: the paste field, Connect, and the camera.
//   options: { kind: 'offer' | 'answer', label, connect(text), say(text) }
export function codeTaken(options) {
  const fieldId = uid('xfer-paste');
  const field = h('textarea', { class: 'xfer__paste', id: fieldId, rows: '3', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', autocorrect: 'off', data: { paste: options.kind } });
  const connect = h('button', { type: 'button', class: 'btn btn--primary', data: { action: 'connect-' + options.kind } }, options.button);
  const scanButton = h('button', { type: 'button', class: 'btn', data: { action: 'scan-' + options.kind } }, 'Scan it with the camera');
  const scanner = createScanner({
    onCode(text) {
      field.value = text;
      scanButton.textContent = 'Scan it with the camera';
      options.connect(text);
    },
    say: options.say,
  });
  scanButton.addEventListener('click', () => {
    if (scanner.running) {
      scanner.stop();
      scanButton.textContent = 'Scan it with the camera';
      options.say('The camera is off.');
      return;
    }
    scanButton.textContent = 'Stop the camera';
    scanner.start().then(() => {
      if (!scanner.running) scanButton.textContent = 'Scan it with the camera';
    });
  });
  connect.addEventListener('click', () => {
    scanner.stop();
    scanButton.textContent = 'Scan it with the camera';
    options.connect(field.value);
  });
  const element = h('div', { class: 'xfer__taken' },
    h('label', { class: 'field__label', for: fieldId }, options.label),
    field,
    h('div', { class: 'card__buttons' }, connect, scanButton),
    scanner.element,
  );
  return {
    element,
    field,
    scanner,
    stop() {
      scanner.stop();
    },
    focus() {
      field.focus();
    },
  };
}
