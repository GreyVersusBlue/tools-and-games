// bootcheck.js — why the tool did not start, in words somebody can act on.
//
// Until this file existed, every way of failing to boot looked identical and
// looked *fine*: the chrome is plain HTML and paints whether or not a line of
// JavaScript ever runs, so a page with no WebGL, or one opened straight off
// the disk, drew the whole toolbar, lit the status line with "Floor — click /
// drag to lay floor tiles", and then did nothing at all, for ever, silently.
// A tool that is broken should say so; a tool that is broken for a reason the
// person can fix should say which.
//
// Four ways it can happen, and they need different sentences:
//
//   file-url      the page was opened from disk, so the browser refused every
//                 ES module before one of them ran. Nothing on the page works
//                 and nothing ever will until it is served over http.
//   no-webgl      the browser has no WebGL context to give. There is no 2D
//                 fallback and there is not going to be one — the whole tool
//                 is a 3D scene.
//   context-lost  there *was* a context and the driver took it back: waking
//                 from sleep, a GPU reset, a phone under memory pressure. The
//                 scene is gone; a reload gets it back.
//   crashed       something threw during boot. We can't be more specific than
//                 the error itself, so the error itself is what we show.
//
// This module is pure — no DOM, no globals, no `window`. It holds the words
// and the decision; index.html's inline guard and main.js hold the two hands
// that put them on the screen. The guard has to be a classic inline script
// rather than an import of this file, because the one case it exists to catch
// is precisely the one where no module can load — so it carries its own copy
// of the two sentences it needs and `test/bootcheck.test.mjs` reads
// index.html and fails if the two ever drift. Same bargain, and for the same
// reason, as theme.js and the `:root` block.

export const BOOT_FAILURES = {
  'file-url': {
    title: 'This page has to be served, not opened from a file.',
    detail:
      'Browsers refuse to load ES modules over file:// , so none of the ' +
      'tool’s code ran. Everything you can see is the empty page ' +
      'underneath it.',
    remedy:
      'Run any static server from the school-generator folder — for ' +
      'example `npx serve`, or `python3 -m http.server` — and open the ' +
      'address it prints. Or just use the deployed copy.',
  },
  'no-webgl': {
    title: 'This browser can’t give the tool a 3D view.',
    detail:
      'The School Generator draws everything — the plan as well as the ' +
      'walkthrough — with WebGL, and this browser has no WebGL context ' +
      'available. There is no 2D fallback.',
    remedy:
      'Turn hardware acceleration back on in your browser’s settings, ' +
      'or open the tool in a different browser. On a managed machine this is ' +
      'sometimes switched off by policy.',
  },
  'context-lost': {
    title: 'The 3D view was lost.',
    detail:
      'The browser took the graphics context back — usually a machine ' +
      'waking from sleep, a driver reset, or a phone short on memory. Your ' +
      'design is safe: it is autosaved in this browser.',
    remedy: 'Reload the page and it will come back with your work in it.',
  },
  crashed: {
    title: 'The tool hit an error while starting up.',
    detail:
      'Something threw before the editor finished loading, so nothing on ' +
      'this page is connected to anything.',
    remedy:
      'Reload the page. If it keeps happening, the message below is the ' +
      'thing worth reporting.',
  },
};

// What went wrong, from what the page can observe about itself. Returns a key
// of BOOT_FAILURES, or null when there is nothing to complain about.
//
//   protocol  location.protocol, e.g. 'https:' or 'file:'
//   webgl     did a WebGL context come back? null/undefined = not probed yet
//   error     the thing that threw during boot, if anything did
//
// Order matters and is the order of certainty. A file:// page cannot probe
// anything meaningful — its modules never ran — so that answer comes first
// and the rest is not consulted. A missing WebGL context explains a boot
// error, so it is preferred over the error it caused.
export function diagnose(env = {}) {
  if (env.protocol === 'file:') return 'file-url';
  if (env.webgl === false) return 'no-webgl';
  if (env.error) return 'crashed';
  return null;
}

// The three lines for a failure, or null for a code nobody defined. Callers
// paint these; nothing here knows what an element is.
export function failureText(code) {
  return BOOT_FAILURES[code] || null;
}

// Is there a WebGL context to be had? Takes the canvas-maker rather than
// reaching for `document`, so the suite can hand it a stub and this file can
// stay a module the tests can load.
//
// The probe canvas is deliberately its own throwaway element: asking the real
// one for a context here would take the only context the renderer is about to
// want, and a canvas hands out exactly one.
export function probeWebGL(makeCanvas) {
  try {
    const c = makeCanvas();
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return false;
    // Some environments hand back a context object that is already lost.
    return !(typeof gl.isContextLost === 'function' && gl.isContextLost());
  } catch {
    return false;
  }
}
