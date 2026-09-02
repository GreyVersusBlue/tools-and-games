// fragment.js — what can be in the address bar.
//
// Three things ride a `#`: a design (share.js, `#s=…`), a session to join
// (wire.js, `#c=room`) and a design in a store (cloud.js, `#d=id`). Each
// module reads its own, and until Phase 42 each read it with its own copy of
// the same loop — split on `&`, find the `key=`, trim the value. This is that
// loop, once, and the three keys beside it, so that the shell can ask *which*
// of the three a link is without loading the module that answers it: the
// session stack is fifty kilobytes the tool does not fetch until somebody
// asks for company, and a session link is somebody asking.
//
// The fragment, for the same reason share.js chose it: the one part of a URL
// a browser never sends anywhere.
//
// Pure module: no DOM. Exercised by test/fragment.test.mjs.

export const FRAGMENT_KEYS = Object.freeze({
  share: 's',      // a design, deflated and base64url'd — see share.js
  session: 'c',    // a session id, and maybe a relay — see wire.js
  cloud: 'd',      // a design id in a store, and maybe its address — see cloud.js
});

// The value after `key=` in a fragment, trimmed, or null when the key is not
// there or has nothing after it. Written against the string rather than
// against `URL` so it can be tested headless and so a hash this build did not
// write cannot throw. The first occurrence wins, which is what every reader
// did before this one.
export function fragmentValue(hash, key) {
  const text = String(hash || '');
  const body = text.startsWith('#') ? text.slice(1) : text;
  if (!body || typeof key !== 'string' || !key) return null;
  for (const part of body.split('&')) {
    const eq = part.indexOf('=');
    if (eq < 0 || part.slice(0, eq) !== key) continue;
    const value = part.slice(eq + 1).trim();
    return value || null;
  }
  return null;
}

// Whether a link is one that needs company — a session to join or a design
// in a store — as opposed to a design carried in the link itself or no link
// at all. The one question the shell asks before deciding what to fetch.
export const wantsCompany = (hash) =>
  fragmentValue(hash, FRAGMENT_KEYS.session) !== null ||
  fragmentValue(hash, FRAGMENT_KEYS.cloud) !== null;
