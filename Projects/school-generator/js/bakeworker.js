// bakeworker.js — the thread the bake runs on.
//
// Phase 27. bakelight.js is a pure function over the design; this file is
// the module worker that keeps it off the main thread, so the page never
// stutters while a school's worth of casts run. The protocol is one message
// each way plus progress:
//
//   in    { design }                    the design as save-load JSON — the
//                                       same string the autosave writes, so
//                                       nothing structured-clones a live
//                                       state the editor is still mutating
//   out   { type: 'progress', frac }    0..1, for the status line
//         { type: 'done', bake }        the *packed* bake (bakelight.js's
//                                       packBake), its byte arrays handed
//                                       over as transferables — copied never
//         { type: 'error', message }    the bake refused; the page keeps
//                                       live lighting and says why
//
// Cancellation is not a message: any structural edit terminates the worker
// outright (main.js owns that), which is cheaper and more honest than a
// cooperative flag the cast loop would have to keep checking.
//
// Not part of walk-main.js's import graph on purpose — an exported walk
// never bakes; it carries its bake as data. So this file rides no bundle and
// is tested the way the entry shells are: by the page that runs it.

import { deserialize } from './save-load.js';
import { catalogEntry } from './catalog.js';
import { bakeLight, packBake } from './bakelight.js';

self.onmessage = (e) => {
  try {
    const state = deserialize(e.data.design);
    const bake = bakeLight(state, catalogEntry, {
      onProgress: (frac) => self.postMessage({ type: 'progress', frac }),
    });
    const packed = packBake(bake);
    const transfer = [];
    for (const fl of packed.floors) transfer.push(fl.day.buffer, fl.fix.buffer);
    self.postMessage({ type: 'done', bake: packed }, transfer);
  } catch (err) {
    self.postMessage({ type: 'error', message: err && err.message ? err.message : String(err) });
  }
};
