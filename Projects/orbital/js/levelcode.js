/* ============================================================
   Orbital — level codec. One level in, one URL-safe string out.
   Pure module: no DOM, no physics. Attaches to globalThis so it
   loads in index.html as a plain script and under Node for the
   codec tests, the same way physics.js does.

   THE LETTERS AND THE FIELD ORDER ARE A WIRE FORMAT. A link
   somebody pasted into a chat window a year ago has to still open
   the level it names, so `o1` is frozen: add a type by taking a
   new letter, add a field by appending it, and take `o2` only if
   an old string genuinely cannot be read any more.

   The four delimiters are `$` between sections, `;` between bodies,
   `,` between fields and `@` before an orbit. Each was picked twice
   over: RFC 3986 allows all four raw in a fragment, so a chat client
   that linkifies the URL has no reason to touch them, and
   encodeURIComponent escapes all four, so none can survive inside a
   level's name and be mistaken for a delimiter. `|` fails the first
   half — Chrome keeps it, the grammar does not allow it, and a
   linkifier that percent-encodes it hands the next reader a level
   code in one piece.
   ============================================================ */
;(function (g) {
  "use strict";

  const W = 1000, H = 640;                // playfield, same numbers physics.js uses
  const MARGIN = 200;                     // how far outside it a body may sit
  const MAX_BODIES = 24;                  // a link is somebody else's input; the
  const MAX_CODE = 2000;                  // solver walks every body every substep
  const MAX_TEXT = 48;                    // name / sub, in characters

  // type letter <-> type name. Frozen; see the header.
  const LETTER = {
    planet: "p", star: "s", rock: "k", repulse: "u",
    blackhole: "b", wormhole: "w", booster: "t"
  };
  const TYPE = {};
  for (const k in LETTER) TYPE[LETTER[k]] = k;

  // What the editor drops when you place one, and what validate() holds it to.
  const DEFAULTS = {
    planet:    { r: 52, mass: 58 },
    star:      { r: 70, mass: 130 },
    rock:      { r: 30, mass: 18 },
    repulse:   { r: 34, mass: -48 },
    blackhole: { r: 26, mass: 180 },
    wormhole:  { r: 32, link: "a", exitTurn: 0 },
    booster:   { r: 40, dir: 0, boost: 180 }
  };
  const RANGE = {
    r: [8, 120], mass: [-400, 400], boost: [0, 400],
    goalR: [20, 120], orbitR: [0, 400], orbitSpeed: [-4, 4]
  };
  const GRAVITY = { planet: 1, star: 1, rock: 1, repulse: 1, blackhole: 1 };
  const SOLID = { planet: 1, star: 1, rock: 1, blackhole: 1 };

  // ---- number formatting -------------------------------------------------
  // Three decimals is finer than anything the editor can produce with a
  // pointer and coarser than float noise, so a round trip is exact.
  const NUM = /^-?(\d+\.?\d*|\.\d+)$/;
  function n2s(v) {
    if (typeof v !== "number" || !isFinite(v)) throw new Error(`cannot encode ${v} as a number`);
    const r = Math.round(v * 1000) / 1000;
    const s = Object.is(r, -0) ? "0" : String(r);
    // Exponent notation is the one shape decode cannot read back, so a number
    // big enough to reach it is an error at encode time rather than a link
    // that fails to open on somebody else's screen.
    if (!NUM.test(s)) throw new Error(`cannot encode ${v}: it formats as "${s}"`);
    return s;
  }
  function s2n(s, what) {
    if (!NUM.test(s)) throw new Error(`${what}: not a number ("${s}")`);
    const v = parseFloat(s);
    if (!isFinite(v)) throw new Error(`${what}: not finite ("${s}")`);
    return v;
  }
  const text = s => encodeURIComponent(String(s == null ? "" : s));
  function untext(s, what) {
    let v;
    try { v = decodeURIComponent(s); } catch (e) { throw new Error(`${what}: bad escape ("${s}")`); }
    if (v.length > MAX_TEXT) throw new Error(`${what}: longer than ${MAX_TEXT} characters`);
    return v;
  }

  // ---- encode ------------------------------------------------------------
  function encodeBody(b) {
    const L = LETTER[b.type];
    if (!L) throw new Error(`cannot encode body type "${b.type}"`);
    const f = [L, n2s(b.x), n2s(b.y), n2s(b.r)];
    if (b.type === "wormhole") { f.push(text(b.link), n2s(b.exitTurn || 0)); }
    else if (b.type === "booster") { f.push(n2s(b.dir || 0), n2s(b.boost || 0)); }
    else f.push(n2s(b.mass || 0));
    let s = f.join(",");
    if (b.orbit) {
      const o = b.orbit;
      s += "@" + [n2s(o.cx), n2s(o.cy), n2s(o.r), n2s(o.speed), n2s(o.a0)].join(",");
    }
    return s;
  }

  function encode(level) {
    const parts = [
      "o1",
      text(level.name),
      text(level.sub),
      n2s(level.start.x) + "," + n2s(level.start.y),
      [n2s(level.goal.x), n2s(level.goal.y), n2s(level.goal.r)].join(","),
      (level.bodies || []).map(encodeBody).join(";")
    ];
    return parts.join("$");
  }

  // ---- decode ------------------------------------------------------------
  // Strict on purpose. Everything this reads came out of somebody else's
  // address bar, so a field that is the wrong shape is an error with a reason
  // rather than a level with a NaN in it.
  function decodeBody(s, i) {
    const at = `body ${i + 1}`;
    const cut = s.indexOf("@");
    const head = cut === -1 ? s : s.slice(0, cut);
    const f = head.split(",");
    const type = TYPE[f[0]];
    if (!type) throw new Error(`${at}: unknown type letter "${f[0]}"`);
    // A wormhole carries a link and a turn, a booster a heading and a kick,
    // and everything else one mass. Six fields against five is the whole
    // difference, and it is checked rather than assumed.
    const want = (type === "wormhole" || type === "booster") ? 6 : 5;
    if (f.length !== want) throw new Error(`${at}: ${type} takes ${want} fields, got ${f.length}`);
    const b = { type, x: s2n(f[1], `${at} x`), y: s2n(f[2], `${at} y`), r: s2n(f[3], `${at} r`) };
    if (type === "wormhole") {
      b.link = untext(f[4], `${at} link`);
      if (!b.link) throw new Error(`${at}: wormhole has no link id`);
      b.exitTurn = s2n(f[5], `${at} exitTurn`);
    } else if (type === "booster") {
      b.dir = s2n(f[4], `${at} dir`);
      b.boost = s2n(f[5], `${at} boost`);
    } else {
      b.mass = s2n(f[4], `${at} mass`);
    }
    if (cut !== -1) {
      const o = s.slice(cut + 1).split(",");
      if (o.length !== 5) throw new Error(`${at}: orbit takes 5 fields, got ${o.length}`);
      b.orbit = {
        cx: s2n(o[0], `${at} orbit cx`), cy: s2n(o[1], `${at} orbit cy`),
        r: s2n(o[2], `${at} orbit r`), speed: s2n(o[3], `${at} orbit speed`),
        a0: s2n(o[4], `${at} orbit a0`)
      };
    }
    return b;
  }

  function decode(code) {
    if (typeof code !== "string") throw new Error("code is not a string");
    if (code.length > MAX_CODE) throw new Error(`code is ${code.length} characters, over the ${MAX_CODE} limit`);
    const parts = code.split("$");
    if (parts[0] !== "o1") throw new Error(`not an Orbital level code (expected "o1", got "${parts[0]}")`);
    if (parts.length !== 6) throw new Error(`expected 6 sections, got ${parts.length}`);

    const st = parts[3].split(",");
    if (st.length !== 2) throw new Error(`start takes 2 fields, got ${st.length}`);
    const gl = parts[4].split(",");
    if (gl.length !== 3) throw new Error(`goal takes 3 fields, got ${gl.length}`);

    const raw = parts[5] === "" ? [] : parts[5].split(";");
    if (raw.length > MAX_BODIES) throw new Error(`${raw.length} bodies, over the ${MAX_BODIES} limit`);

    return {
      name: untext(parts[1], "name"),
      sub: untext(parts[2], "sub"),
      start: { x: s2n(st[0], "start x"), y: s2n(st[1], "start y") },
      goal: { x: s2n(gl[0], "goal x"), y: s2n(gl[1], "goal y"), r: s2n(gl[2], "goal r") },
      bodies: raw.map(decodeBody)
    };
  }

  // ---- validate ----------------------------------------------------------
  // Semantics, not syntax: a level that decodes cleanly can still be one
  // nobody can play. Returns a list of sentences; empty means playable.
  // The editor shows them and keeps editing; a share link refuses to open
  // one with anything in it, which is why every message names the fix.
  const inRange = (v, k) => v >= RANGE[k][0] && v <= RANGE[k][1];
  const onField = (x, y) => x >= -MARGIN && x <= W + MARGIN && y >= -MARGIN && y <= H + MARGIN;

  function validate(level) {
    const out = [];
    if (level.start.x < 0 || level.start.x > W || level.start.y < 0 || level.start.y > H)
      out.push("The launch point is off the playfield.");
    if (level.goal.x < 0 || level.goal.x > W || level.goal.y < 0 || level.goal.y > H)
      out.push("The marker is off the playfield.");
    if (!inRange(level.goal.r, "goalR"))
      out.push(`The marker's radius is ${n2s(level.goal.r)}; it has to be between ${RANGE.goalR[0]} and ${RANGE.goalR[1]}.`);
    if (Math.hypot(level.goal.x - level.start.x, level.goal.y - level.start.y) < level.goal.r)
      out.push("The launch point is already inside the marker, so the level is won before it starts.");

    const bodies = level.bodies || [];
    if (bodies.length > MAX_BODIES) out.push(`${bodies.length} bodies; the limit is ${MAX_BODIES}.`);

    const links = {};
    bodies.forEach((b, i) => {
      const at = `${b.type} ${i + 1}`;
      if (!LETTER[b.type]) { out.push(`${at}: unknown type.`); return; }
      if (!onField(b.x, b.y)) out.push(`${at} sits more than ${MARGIN}px outside the playfield.`);
      if (!inRange(b.r, "r")) out.push(`${at} has radius ${n2s(b.r)}; it has to be between ${RANGE.r[0]} and ${RANGE.r[1]}.`);
      if (GRAVITY[b.type] && !inRange(b.mass, "mass"))
        out.push(`${at} has mass ${n2s(b.mass)}; it has to be between ${RANGE.mass[0]} and ${RANGE.mass[1]}.`);
      if (b.type === "booster") {
        if (!inRange(b.boost, "boost")) out.push(`${at} has boost ${n2s(b.boost)}; it has to be between ${RANGE.boost[0]} and ${RANGE.boost[1]}.`);
        if (!isFinite(b.dir)) out.push(`${at} has no direction.`);
      }
      if (b.type === "wormhole") links[b.link] = (links[b.link] || 0) + 1;
      if (b.orbit) {
        if (!onField(b.orbit.cx, b.orbit.cy)) out.push(`${at}'s orbit centre is off the playfield.`);
        if (!inRange(b.orbit.r, "orbitR")) out.push(`${at}'s orbit radius is ${n2s(b.orbit.r)}; the limit is ${RANGE.orbitR[1]}.`);
        if (!inRange(b.orbit.speed, "orbitSpeed")) out.push(`${at}'s orbit speed is ${n2s(b.orbit.speed)}; the limit is ${RANGE.orbitSpeed[1]}.`);
      }
      if (SOLID[b.type] && Math.hypot(b.x - level.start.x, b.y - level.start.y) < b.r)
        out.push(`The launch point is inside ${at}, so every shot crashes on the first step.`);
    });
    for (const id in links)
      if (links[id] !== 2)
        out.push(`Wormhole link "${id}" has ${links[id]} ${links[id] === 1 ? "mouth" : "mouths"}; a link needs exactly 2.`);

    return out;
  }

  // A level the editor can start from: one planet, a clear line past it.
  function blank() {
    return {
      name: "Untitled", sub: "",
      start: { x: 120, y: 500 },
      goal: { x: 880, y: 160, r: 44 },
      bodies: [{ type: "planet", x: 500, y: 330, r: 52, mass: 58 }]
    };
  }

  // A deep copy with only the fields the codec knows about, so anything the
  // campaign packs hang off a level (pack, key, localIdx) never leaks into a
  // draft and out into a link.
  function clean(level) {
    return decode(encode(level));
  }

  g.OrbitalCode = {
    VERSION: "o1", W, H, MARGIN, MAX_BODIES, MAX_CODE, MAX_TEXT,
    LETTER, TYPE, DEFAULTS, RANGE, GRAVITY, SOLID,
    encode, decode, validate, blank, clean
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
