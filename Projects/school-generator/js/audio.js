// audio.js — the school makes a noise.
//
// Everything you hear in this build is synthesized. There is not a single
// audio file in the repo and there was never going to be: this project has no
// build step, no dependencies and no binary assets, and a phase that arrived
// with forty megabytes of footstep recordings would have broken all three at
// once. The same call Phase 3 made about `DepthOfFieldPass` — the requirement
// here is narrower than the general-purpose thing, so write the narrow thing —
// applies to a school bell. A struck bell is seven detuned partials with
// different decay times (see sound.js); a footstep on terrazzo is a thump and
// a slap through a bandpass; a diffuser is filtered noise. That is a couple of
// hundred lines of oscillators, and it means the tool's whole soundtrack
// weighs nothing and can be *derived from the model* rather than matched to it.
//
// The graph, once:
//
//   voice -> level -> occlusion(lowpass) -+-> panner -> dry ---+
//                                         |                    +-> master -> out
//                                         +-> send -> predelay -> convolver
//                                                     -> tail(lowpass) -> wet -+
//
// Three things are worth knowing about it:
//
// * **The convolver's impulse response is generated from the room you are
//   standing in.** acoustics.js works out that room's volume, its surfaces and
//   its Sabine reverberation time; this file turns that number into a noise
//   burst with a matching decay. Walk from a carpeted library into a tiled
//   stairwell and the tail triples, because the model says it should — no
//   presets, no zones to author, no "reverb: large" field on a room.
// * **Distance is applied exactly once.** sound.js's dB math decides which
//   sources are worth a voice and what the readout says; the PannerNode's own
//   inverse-square law decides how loud each one is once it has one. Asking
//   both to do it attenuates twice and everything past thirty feet vanishes.
// * **Nothing exists until a user gesture.** An AudioContext created on page
//   load is a suspended AudioContext and, in some browsers, a console warning
//   and a tab marked as making noise. `resume()` is called from the click that
//   enters the walkthrough, which is the first gesture that means "I want to
//   be in the building".
//
// Silence while editing is deliberate, not an oversight: a floor-plan editor
// that hums at you is a bad neighbour, and the acoustics readout in the panel
// works whether or not anything is making a sound.

import * as THREE from 'three';
import { EYE_H, FLOOR_H } from './grid.js';
import { catalogEntry as defaultCatalogEntry } from './catalog.js';
import { storeyAt } from './collide.js';
import {
  roomAcoustics, roomAt, reverbSpec, wetFraction, isOutside,
} from './acoustics.js';
import {
  MAX_VOICES, REF_DIST, BELL_PARTIALS, BELL_HZ, BELL_DB, BELL_RINGS, BELL_GAP,
  PA_CHIME, PA_DB, PA_BAND,
  soundSources, tagRooms, budgetSounds, gainAtRef, dbAt, pathLoss, pathLossRay,
  DOOR_LATCH, DOOR_SHUT,
} from './sound.js';
import { sightBlockers } from './sightline.js';
import { roomToneSpec } from './murmur.js';

// How often the budget and the listener's room are recomputed. Both cost a
// flood fill or a sort, neither changes meaningfully inside a tenth of a
// second, and a walker crossing a threshold wants the room to follow within
// about a footstep — which at 12 ft/s this does.
const BUDGET_HZ = 4;
// The listener's own ambient bed level, before the master. Quiet on purpose:
// this is the sound of a building being switched on, not weather.
const BED_LEVEL = 0.16;
// A voice fading in or out. Long enough not to click, short enough that
// walking past a door doesn't smear the room's machinery across the corridor.
const VOICE_FADE = 0.35;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function initAudio(camera, opts = {}) {
  const catalogEntry = opts.catalogEntry || defaultCatalogEntry;

  let listener = null, ctx = null;
  let master = null, dryBus = null, sendBus = null, wetBus = null;
  let predelay = null, convolver = null, tail = null;
  let noiseBuf = null;
  let started = false;

  let active = false;          // are we in the walkthrough?
  let volume = 0.7, muted = false;

  let world = null;
  let sources = [];            // every noise-making prop in the design
  // Phase 28: the crowd's emitters, replaced wholesale by `setMurmur` a few
  // times a second. They ride the same budget as the props — same ranking,
  // same ray, same voice cap — which is the entire design: murmur is not a
  // second mixer, it is more sources.
  let murmurs = [];
  let voices = new Map();      // source id -> live loop voice
  let bed = null;              // { inside, outside, insideGain, outsideGain }
  let acc = 0;                 // seconds since the last budget refresh
  let room = null;             // the listener's room acoustics
  let roomKey = '';
  let irKey = '';
  // Acoustics per room, not per position. Working a room out costs a flood
  // fill and three dozen ceiling probes, and the answer only changes when the
  // design does — so it is derived once per room and thrown away wholesale on
  // the next edit, which is the same bargain the collider's build-once
  // lifecycle makes.
  let roomCache = new Map();
  // Phase 24: transmission by ray. The storey's sight-blocking segments are
  // derived once per storey per world — the same cache bargain the room
  // acoustics make — and `leavesSource` is the shell's window onto the live
  // door leaves, so a shut door muffles what is behind it *now*. When either
  // is missing the constant answers, exactly as it did for twenty phases.
  let segsCache = new Map();
  let leavesSource = null;      // (floorIndex) => the collider's live leaves
  // How wrong the building runs, in cents. Applied to every tuned node the
  // loops own — at 35 cents nobody can name what changed, only that it did.
  let detuneCents = 0;
  // The creature's own persistent voice, and the failing fixture's buzz.
  // Each holds one of the eight voices while it lives — see `voiceCap`.
  let lurker = null;
  let buzzer = null;
  // Everything the sound panel prints. `heard`/`dropped`/`muted` are about the
  // continuous sources only — a bell is not "audible", it is silent until it
  // is rung — so `machines` is beside them and the counts add up.
  let report = {
    running: false, room: null, heard: 0, dropped: 0, muted: 0,
    total: 0, machines: 0, clocks: 0, bells: 0, speakers: 0, murmurs: 0,
  };

  // ---------- the graph ----------

  function makeNoise() {
    const len = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // A looping noise player at a random offset, so two diffusers in the same
  // corridor don't phase against each other.
  function noiseNode(loop = true) {
    const n = ctx.createBufferSource();
    n.buffer = noiseBuf;
    n.loop = loop;
    return n;
  }

  // The impulse response for one room. Exponential decay to -60 dB over the
  // room's own RT60, with a one-pole lowpass running *inside* the loop so the
  // tail loses its highs as it goes — which is what actually distinguishes a
  // carpeted library from a tiled stairwell, more than the length does.
  //
  // Two channels of independent noise, which is the whole of the stereo width:
  // a real room's two ears hear different reflections, and uncorrelated noise
  // is an honest cheap model of that.
  function makeIR(spec) {
    const sr = ctx.sampleRate;
    const len = Math.max(64, Math.floor(sr * clamp(spec.rt60, 0.1, 4)));
    const buf = ctx.createBuffer(2, len, sr);
    // One-pole coefficient for the tail's corner frequency.
    const k = clamp(1 - Math.exp((-2 * Math.PI * spec.hf) / sr), 0.02, 1);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        // -60 dB is 1/1000 in amplitude, reached exactly at rt60.
        const env = Math.pow(10, (-3 * (i / sr)) / spec.rt60);
        lp += k * (Math.random() * 2 - 1 - lp);
        // A few milliseconds of build, so the tail swells instead of slapping.
        d[i] = lp * env * (1 - Math.exp(-i / (sr * 0.005)));
      }
    }
    return buf;
  }

  function build() {
    listener = new THREE.AudioListener();
    ctx = listener.context;
    camera.add(listener);

    master = ctx.createGain();
    master.gain.value = muted ? 0 : volume;
    master.connect(listener.getInput());

    dryBus = ctx.createGain();
    dryBus.connect(master);

    wetBus = ctx.createGain();
    wetBus.connect(master);

    sendBus = ctx.createGain();
    predelay = ctx.createDelay(0.2);
    convolver = ctx.createConvolver();
    tail = ctx.createBiquadFilter();
    tail.type = 'lowpass';
    tail.frequency.value = 6000;
    sendBus.connect(predelay);
    predelay.connect(convolver);
    convolver.connect(tail);
    tail.connect(wetBus);

    noiseBuf = makeNoise();
    applyRoom(true);
  }

  function ensure() {
    if (!started) { build(); started = true; }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // ---------- voices ----------

  // Every voice hangs off this: a level, an occlusion lowpass, a panner and a
  // reverb send. One-shots and loops differ only in what they plug into the
  // top of it and whether anything ever stops them.
  function makeChannel(at, level, path, wet) {
    const gain = ctx.createGain();
    gain.gain.value = level;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = clamp(path.hz, 200, 20000);
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = REF_DIST;
    panner.rolloffFactor = 1;
    panner.maxDistance = 500;
    panner.positionX.value = at.x;
    panner.positionY.value = at.y;
    panner.positionZ.value = at.z;
    const dry = ctx.createGain();
    dry.gain.value = 1 - wet * 0.6;
    const send = ctx.createGain();
    send.gain.value = wet;

    gain.connect(lp);
    lp.connect(panner);
    panner.connect(dry);
    dry.connect(dryBus);
    lp.connect(send);
    send.connect(sendBus);
    return { input: gain, gain, lp, panner, dry, send };
  }

  function movePanner(ch, at) {
    ch.panner.positionX.value = at.x;
    ch.panner.positionY.value = at.y;
    ch.panner.positionZ.value = at.z;
  }

  // Phase 28: how each murmur kind is voiced. All of them are the same
  // recipe — noise through a band, two vocal formants when people are
  // talking, slow modulation so the crowd swells and lulls — differing only
  // in proportions, exactly the way the machines differ below. `syllable`
  // is the modulation rate: a lecture breathes in paragraphs, a cafeteria
  // babbles, a corridor is mostly feet (no formants, fast tremolo).
  const WALLA = {
    lesson:  { formants: true,  syllable: 0.45, depth: 0.4, extra: null },
    chat:    { formants: true,  syllable: 0.8,  depth: 0.45, extra: null },
    chatter: { formants: true,  syllable: 1.7,  depth: 0.3, extra: { hz: 2400, q: 2, g: 0.06 } },
    gym:     { formants: false, syllable: 1.1,  depth: 0.5, extra: { hz: 2600, q: 9, g: 0.16 } },
    rush:    { formants: false, syllable: 6.5,  depth: 0.3, extra: { hz: 300, q: 0.6, g: 0.2 } },
  };

  // A crowd: noise shaped into voices. Never words — the formants make it
  // vocal, the band-limit keeps it unintelligible, which is what walla is.
  function startWalla(src, ch, nodes, tuned, t) {
    const spec = WALLA[src.kind];
    const n = noiseNode();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = src.hz;
    bp.Q.value = src.q;
    bp.detune.value = detuneCents;
    tuned.push(bp.detune);
    const vg = ctx.createGain();
    vg.gain.value = 0.5;
    if (spec.formants) {
      // The two peaks that turn noise into vowels — same pair `speak` uses.
      const f1 = ctx.createBiquadFilter();
      f1.type = 'peaking'; f1.frequency.value = 620; f1.Q.value = 4; f1.gain.value = 10;
      const f2 = ctx.createBiquadFilter();
      f2.type = 'peaking'; f2.frequency.value = 1500; f2.Q.value = 5; f2.gain.value = 8;
      n.connect(bp); bp.connect(f1); f1.connect(f2); f2.connect(vg);
    } else {
      n.connect(bp); bp.connect(vg);
    }
    vg.connect(ch.input);
    // The swell and lull. The LFO rides the band's gain, never to zero — a
    // crowd breathes, it doesn't gate.
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = spec.syllable * (0.85 + Math.random() * 0.3);
    const depth = ctx.createGain();
    depth.gain.value = 0.5 * spec.depth;
    lfo.connect(depth); depth.connect(vg.gain);
    n.start(t + Math.random() * 1.5);
    lfo.start(t);
    nodes.push(n, lfo);
    // The kind's own garnish: squeak for the gym, feet for the rush, a
    // bright edge for the cafeteria. Its own noise, so it doesn't phase.
    if (spec.extra) {
      const en = noiseNode();
      const eb = ctx.createBiquadFilter();
      eb.type = 'bandpass';
      eb.frequency.value = spec.extra.hz;
      eb.Q.value = spec.extra.q;
      const eg = ctx.createGain();
      eg.gain.value = spec.extra.g;
      en.connect(eb); eb.connect(eg); eg.connect(ch.input);
      const elfo = ctx.createOscillator();
      elfo.type = 'sine';
      elfo.frequency.value = spec.syllable * 1.9;
      const ed = ctx.createGain();
      ed.gain.value = spec.extra.g * 0.8;
      elfo.connect(ed); ed.connect(eg.gain);
      en.start(t + Math.random() * 1.5);
      elfo.start(t);
      nodes.push(en, elfo);
    }
  }

  // A continuous machine: a hum, a hiss or a burble. All three are the same
  // three ingredients in different proportions, which is why they are one
  // function — a compressor is mostly tone and a diffuser is mostly air.
  // Phase 28 adds the crowd's kinds on the same terms; see `startWalla`.
  function startLoop(src, level, path, wet) {
    const ch = makeChannel(src, 0, path, wet);
    const nodes = [];
    const tuned = [];        // every detune AudioParam this voice owns
    const t = ctx.currentTime;

    if (WALLA[src.kind]) {
      startWalla(src, ch, nodes, tuned, t);
    } else if (src.kind === 'hum') {
      // A motor: its line frequency and the octave above it, plus a little
      // broadband from the fan that shares the housing.
      for (const [mult, g] of [[1, 1], [2, 0.42], [3, 0.16]]) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = src.hz * mult;
        o.detune.value = detuneCents;
        tuned.push(o.detune);
        const og = ctx.createGain();
        og.gain.value = 0.32 * g;
        o.connect(og); og.connect(ch.input);
        o.start(t);
        nodes.push(o);
      }
      const n = noiseNode();
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = src.hz * 6; bp.Q.value = 0.9;
      bp.detune.value = detuneCents;
      tuned.push(bp.detune);
      const ng = ctx.createGain(); ng.gain.value = 0.1;
      n.connect(bp); bp.connect(ng); ng.connect(ch.input);
      n.start(t + Math.random() * 1.5);
      nodes.push(n);
    } else {
      // Moving air (a diffuser, a radiator) or moving water (a bubbler): noise
      // through one resonance. The burble's resonance wanders, which is the
      // only difference between air and bubbles at this level of detail.
      const n = noiseNode();
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = src.hz;
      bp.Q.value = src.q;
      bp.detune.value = detuneCents;
      tuned.push(bp.detune);
      n.connect(bp); bp.connect(ch.input);
      n.start(t + Math.random() * 1.5);
      nodes.push(n);
      if (src.kind === 'burble') {
        const lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 1.7;
        const depth = ctx.createGain();
        depth.gain.value = src.hz * 0.55;
        lfo.connect(depth); depth.connect(bp.frequency);
        lfo.start(t);
        nodes.push(lfo);
      }
    }

    ch.gain.gain.setTargetAtTime(level, t, VOICE_FADE / 3);
    return { ch, nodes, src, level, tuned };
  }

  function stopVoice(v) {
    const t = ctx.currentTime;
    v.ch.gain.gain.setTargetAtTime(0, t, VOICE_FADE / 3);
    for (const n of v.nodes) {
      try { n.stop(t + VOICE_FADE * 2); } catch { /* already stopped */ }
    }
    setTimeout(() => { try { v.ch.dry.disconnect(); v.ch.send.disconnect(); } catch { /* gone */ } },
      VOICE_FADE * 2200);
  }

  // ---------- one-shots ----------

  // A short burst of filtered noise with a percussive envelope. Footsteps,
  // latches and hammer strikes are all this, tuned differently.
  function burst(ch, { hz, q = 1, type = 'bandpass', level = 1, decay = 0.1, delay = 0 }) {
    const t = ctx.currentTime + delay;
    const n = noiseNode(false);
    n.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = hz; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0008, t + decay);
    n.connect(f); f.connect(g); g.connect(ch.input);
    n.start(t, Math.random() * 1.5, decay + 0.05);
  }

  // A pitched partial with an exponential decay — one voice of a bell, one
  // note of a chime, the body of a footstep.
  function tone(ch, { hz, level = 1, decay = 1, type = 'sine', delay = 0, bend = 0 }) {
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(hz, t);
    if (bend) o.frequency.exponentialRampToValueAtTime(Math.max(20, hz * bend), t + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0006, t + decay);
    o.connect(g); g.connect(ch.input);
    o.start(t);
    o.stop(t + decay + 0.08);
  }

  // Where the ear is, in world feet, and which storey and room it is in — the
  // three things every level calculation below needs.
  function ear() {
    const feet = camera.position.y - EYE_H;
    return {
      x: camera.position.x, y: camera.position.y, z: camera.position.z,
      floor: world ? storeyAt(world, feet) : 0,
      room: room && !isOutside(room) ? room.id : null,
    };
  }

  // What the trip from a source to the ear costs — by ray where there is a
  // storey's geometry to cast against, by the old constant where there isn't
  // (no world, or a different storey, where the slab answers). This one
  // function is what Phase 24 gives the *daytime* for free: every hum, tick
  // and footstep now arrives through the walls actually between you and it.
  function rayPath(src, e) {
    if (world && (src.floor ?? 0) === (e.floor ?? 0)) {
      const f = src.floor ?? 0;
      let segs = segsCache.get(f);
      if (segs === undefined) { segs = sightBlockers(world, f); segsCache.set(f, segs); }
      return pathLossRay(src, e, segs, leavesSource ? leavesSource(f) : null);
    }
    return pathLoss(src, e);
  }

  // A one-shot at a place: work out how loud it arrives, how muffled, and how
  // much of it is room rather than source, then hand back a channel to play
  // into. Null when it isn't worth playing at all.
  function shotChannel(at, db, opts = {}) {
    const e = ear();
    const src = { x: at.x, y: at.y, z: at.z, floor: at.floor ?? e.floor, room: at.room ?? null };
    const path = opts.path || rayPath(src, e);
    const dist = Math.hypot(src.x - e.x, src.y - e.y, src.z - e.z);
    if (dbAt(db, dist) - path.db < 10) return null;
    const wet = opts.wet ?? wetFraction(room, dist);
    return makeChannel(src, gainAtRef(db - path.db), path, wet);
  }

  // ---------- the ambient bed ----------

  // Two beds, crossfaded by whether you are indoors: the building's own
  // machinery, and the wind outside it. Neither is positional — they are what
  // is left when you subtract everything you can point at.
  function startBed() {
    const t = ctx.currentTime;
    const make = (hz, q, lvl) => {
      const n = noiseNode();
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = hz; f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      n.connect(f); f.connect(g); g.connect(dryBus);
      const s = ctx.createGain();
      s.gain.value = 0.25;
      g.connect(s); s.connect(sendBus);
      n.start(t + Math.random());
      return { n, f, g, lvl };
    };
    bed = {
      inside: make(220, 0.7, BED_LEVEL),
      // Wind is broader and brighter than a plenum, and it wanders.
      outside: make(900, 0.5, BED_LEVEL * 1.15),
    };
    const lfo = ctx.createOscillator();
    lfo.type = 'sine'; lfo.frequency.value = 0.09;
    const depth = ctx.createGain(); depth.gain.value = 0.35;
    lfo.connect(depth); depth.connect(bed.outside.g.gain);
    lfo.start(t);
    bed.lfo = lfo;
  }

  function stopBed() {
    if (!bed) return;
    const t = ctx.currentTime;
    for (const b of [bed.inside, bed.outside]) {
      b.g.gain.setTargetAtTime(0, t, 0.2);
      try { b.n.stop(t + 1); } catch { /* already stopped */ }
    }
    try { bed.lfo.stop(t + 1); } catch { /* already stopped */ }
    bed = null;
  }

  function aimBed() {
    if (!bed) return;
    const t = ctx.currentTime;
    const out = isOutside(room);
    // Phase 28: the inside bed is *this room's* HVAC, not a building-wide
    // constant — a big hard gym breathes more plant and brighter, a small
    // carpeted office barely registers. Derived from the same acoustics
    // record the reverb reads, so the two always describe the same room.
    const tone = out ? null : roomToneSpec(room);
    const lvl = tone ? bed.inside.lvl * tone.gain : bed.inside.lvl;
    if (tone) bed.inside.f.frequency.setTargetAtTime(tone.hz, t, 0.5);
    bed.inside.g.gain.setTargetAtTime(out ? 0 : lvl, t, 0.5);
    bed.outside.g.gain.setTargetAtTime(out ? bed.outside.lvl : bed.outside.lvl * 0.12, t, 0.5);
  }

  // ---------- the room ----------

  // Re-derive the listener's acoustics, and rebuild the convolver when the
  // answer has actually changed. The key buckets RT60 to a tenth of a second
  // and the tail corner to a few hundred hertz: two classrooms with the same
  // finishes shouldn't cost an impulse response each, and a walker crossing
  // between them shouldn't hear the reverb re-seed.
  function applyRoom(force = false) {
    if (!ctx) return;
    const feet = camera.position.y - EYE_H;
    const floor = world ? storeyAt(world, feet) : 0;
    const here = world ? roomAt(world, floor, camera.position.x, camera.position.z) : null;
    const key = here ? `${floor}:${here.id}` : '';
    if (!force && key === roomKey) return;
    roomKey = key;
    if (!world) room = null;
    else if (roomCache.has(key)) room = roomCache.get(key);
    else {
      room = roomAcoustics(world, floor, camera.position.x, camera.position.z, catalogEntry);
      roomCache.set(key, room);
    }
    report.room = room;
    aimBed();

    const spec = reverbSpec(room);
    if (!(spec.rt60 > 0)) {
      // Outdoors there is no room to convolve. Rather than swap the IR for an
      // empty one, shut the wet bus — the tail that is already ringing gets to
      // finish, which is what walking out of a door actually sounds like.
      wetBus.gain.setTargetAtTime(0, ctx.currentTime, 0.25);
      return;
    }
    wetBus.gain.setTargetAtTime(0.85, ctx.currentTime, 0.25);
    predelay.delayTime.setTargetAtTime(spec.predelay, ctx.currentTime, 0.1);
    tail.frequency.setTargetAtTime(spec.hf, ctx.currentTime, 0.2);
    const ik = `${spec.rt60.toFixed(1)}:${Math.round(spec.hf / 400)}`;
    if (ik === irKey) return;
    irKey = ik;
    convolver.buffer = makeIR(spec);
  }

  // ---------- the budget ----------

  function refreshBudget() {
    if (!ctx || !active) return;
    const e = ear();
    // The creature's voice and the buzz each hold one of the eight while
    // they live — the budget honoured, stated rather than hoped.
    const cap = Math.max(1, MAX_VOICES - (lurker ? 1 : 0) - (buzzer ? 1 : 0));
    // The crowd's emitters and the design's machines, one list, one ranking:
    // the cafeteria at lunch out-shouts the vending machine beside it and
    // takes its voice, which is the budget doing exactly its job.
    const b = budgetSounds([...sources.filter((s) => s.loop), ...murmurs], e,
      { cap, pathFor: rayPath });
    const keep = new Set();
    for (const r of b.heard) {
      keep.add(r.src.id);
      const wet = wetFraction(room, r.dist);
      const level = gainAtRef(r.src.db - r.path.db);
      let v = voices.get(r.src.id);
      if (!v) {
        v = startLoop(r.src, level, r.path, wet);
        voices.set(r.src.id, v);
        continue;
      }
      const t = ctx.currentTime;
      // A machine stands still; a knot of walkers doesn't. Following the
      // emitter is free, and a prop's position simply never changes.
      movePanner(v.ch, r.src);
      v.ch.gain.gain.setTargetAtTime(level, t, 0.2);
      v.ch.lp.frequency.setTargetAtTime(clamp(r.path.hz, 200, 20000), t, 0.2);
      v.ch.send.gain.setTargetAtTime(wet, t, 0.2);
      v.ch.dry.gain.setTargetAtTime(1 - wet * 0.6, t, 0.2);
    }
    for (const [id, v] of [...voices]) {
      if (keep.has(id)) continue;
      stopVoice(v);
      voices.delete(id);
    }
    report.heard = b.heard.length;
    report.dropped = b.dropped;
    report.muted = b.muted;
  }

  function stopAllVoices() {
    for (const v of voices.values()) stopVoice(v);
    voices.clear();
  }

  // ---------- the public half ----------

  // Which fixtures a rung bell or a PA announcement comes out of. A school
  // with no bells in it doesn't ring; a school with nine rings from all nine,
  // budgeted like anything else, which is why a bell in the next wing arrives
  // late and muffled and the one over your head does not.
  function fixtures(kind) {
    return sources.filter((s) => s.kind === kind);
  }

  function rebuildSources() {
    sources = world
      ? tagRooms(soundSources(world, catalogEntry, world.floorHt || FLOOR_H), (floor, x, z) => {
        const r = roomAt(world, floor, x, z);
        return isOutside(r) ? null : r.id;
      })
      : [];
    report.total = sources.length;
    report.machines = sources.filter((x) => x.loop).length;
    report.clocks = fixtures('tick').length;
    report.bells = fixtures('bell').length;
    report.speakers = fixtures('pa').length;
  }

  return {
    get started() { return started; },
    get running() { return started && active && ctx.state === 'running'; },
    get volume() { return volume; },
    get muted() { return muted; },
    get report() {
      report.running = started && active && ctx && ctx.state === 'running';
      return report;
    },

    setVolume(v) {
      volume = clamp(Number.isFinite(v) ? v : 0.7, 0, 1);
      if (master) master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.05);
    },
    setMuted(on) {
      muted = !!on;
      if (master) master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.05);
    },

    // Call from inside a user gesture. Safe to call repeatedly.
    resume() { ensure(); },

    setWorld(state) {
      world = state;
      roomCache = new Map();
      segsCache = new Map();
      roomKey = '';
      rebuildSources();
      if (started) { applyRoom(true); refreshBudget(); }
    },

    // The shell's window onto the live door leaves, per storey — the same
    // handoff the label gate gets. Without it the ray casts against the
    // pre-walk plan, which has no doors in motion.
    setLeavesSource(fn) { leavesSource = typeof fn === 'function' ? fn : null; },

    // Phase 28: the crowd's emitters, replaced wholesale — murmur.js derives
    // them, the shell hands them over on its own cadence, and the next
    // budget refresh voices the ones worth voicing. An empty list is a quiet
    // building; the fade-outs are the budget's ordinary fade-outs.
    setMurmur(emitters) {
      murmurs = Array.isArray(emitters) ? emitters : [];
      report.murmurs = murmurs.length;
    },

    // Entering or leaving the walkthrough. Leaving stops every voice rather
    // than muting them: an editor that is silent because its gain is zero is
    // still an editor doing FFTs in the background.
    setActive(on) {
      if (on === active) return;
      active = !!on;
      if (active) {
        ensure();
        rebuildSources();
        applyRoom(true);
        if (!bed) startBed();
        aimBed();
        refreshBudget();
      } else if (started) {
        stopAllVoices();
        stopBed();
        murmurs = [];
        report.heard = 0; report.dropped = 0; report.muted = 0; report.murmurs = 0;
      }
    },

    update(dt) {
      if (!started || !active) return;
      // The listener rides the camera, so its transform has to be current
      // before anything is placed against it. `walk.update()` has already
      // moved the camera this frame; the renderer hasn't run yet.
      camera.updateMatrixWorld(true);
      acc += dt;
      if (acc < 1 / BUDGET_HZ) return;
      acc = 0;
      applyRoom();
      refreshBudget();
      tick();
    },

    // --- the events the walker sends ---

    // One footstep. `spec` is sound.js's material record and `at` the foot's
    // own position, so a step you take on a stair tread over a lobby is heard
    // where your feet are and reverberates into the lobby.
    step(spec, at) {
      if (!this.running) return;
      const ch = shotChannel(at, spec.db);
      if (!ch) return;
      const wob = 0.94 + Math.random() * 0.12;
      tone(ch, { hz: spec.hz * 1.6 * wob, level: 0.5, decay: spec.decay, bend: 0.45 });
      burst(ch, { hz: spec.tone * wob, q: 0.7, level: spec.scuff, decay: spec.decay * 0.7 });
    },

    // A door latch releasing, or a leaf coming to rest against its stop.
    // `force` is Phase 24's one addition: a leaf driven shut at slam rate
    // hits its stop harder than one drifting closed, and the bang says so.
    door(kind, at, force = 1) {
      if (!this.running) return;
      const f = clamp(force, 0.5, 2);
      const spec = kind === 'shut' ? DOOR_SHUT : DOOR_LATCH;
      const ch = shotChannel(at, spec.db + 6 * (f - 1));
      if (!ch) return;
      if (kind === 'shut') {
        tone(ch, { hz: spec.hz, level: 0.55 * f, decay: spec.decay * f, bend: 0.5 });
        burst(ch, { hz: 1100, q: 0.6, level: 0.5 * f, decay: spec.decay });
        burst(ch, { hz: 3400, q: 3, level: 0.3 * f, decay: 0.05, delay: 0.02 });
      } else {
        burst(ch, { hz: spec.hz, q: 4, level: 0.6, decay: spec.decay });
      }
    },

    // A landing, which is a footstep with the weight of a body behind it.
    land(spec, at, force = 1) {
      if (!this.running) return;
      const ch = shotChannel(at, spec.db + 6 * clamp(force, 0.3, 2));
      if (!ch) return;
      tone(ch, { hz: spec.hz * 1.1, level: 0.8, decay: spec.decay * 1.6, bend: 0.4 });
      burst(ch, { hz: spec.tone * 0.7, q: 0.6, level: spec.scuff * 1.2, decay: spec.decay });
    },

    // Furniture sliding on a floor (Phase 11). A short low scrape with a bit
    // of grit on top, quiet enough that walking down a row of chairs is a
    // corridor rather than a machine shop. `force` is how far the thing
    // actually went, 0..1 against shove.js's own per-frame cap.
    scoot(at, force = 1) {
      if (!this.running) return;
      const f = clamp(force, 0.12, 1);
      const ch = shotChannel(at, 44 + 10 * f);
      if (!ch) return;
      burst(ch, { hz: 300, q: 0.5, level: 0.34 * f, decay: 0.17 });
      burst(ch, { hz: 1500, q: 1.3, level: 0.11 * f, decay: 0.09, delay: 0.012 });
    },

    // --- Phase 24: the night's voices ---

    // How wrong the building runs. ±50 cents at the very most — at 35 nobody
    // can name what changed, only that something did, which is the point.
    // Applied to every tuned node the loops own, and to the ones started
    // after; 0 puts the building back in tune.
    setDetune(cents) {
      detuneCents = clamp(Number.isFinite(cents) ? cents : 0, -50, 50);
      if (!ctx) return;
      const t = ctx.currentTime;
      for (const v of voices.values()) {
        for (const p of v.tuned || []) p.setTargetAtTime(detuneCents, t, 1.5);
      }
    },

    // Something heavy, one corridor over. The whole game is hearing this
    // through `rayPath`'s walls: close and unobstructed it is a footfall of
    // something too big, far and muffled it is the building settling. Maybe.
    thud(at, force = 1) {
      if (!this.running) return;
      const f = clamp(force, 0.2, 1.5);
      const ch = shotChannel(at, 60 + 8 * f);
      if (!ch) return;
      tone(ch, { hz: 55, level: 0.85 * f, decay: 0.5, bend: 0.55 });
      burst(ch, { hz: 130, q: 0.5, level: 0.35 * f, decay: 0.3, delay: 0.01 });
    },

    // A found star. Two soft sines a sixth apart — the one unambiguously
    // friendly sound this file makes, which is what makes it a trap.
    chime(at) {
      if (!this.running) return;
      const e = ear();
      const ch = shotChannel(at || e, 66);
      if (!ch) return;
      tone(ch, { hz: 880, level: 0.3, decay: 0.5 });
      tone(ch, { hz: 1480, level: 0.22, decay: 0.7, delay: 0.09 });
    },

    // The creature's own persistent voice — the eighth voice, reserved while
    // it lives (see `refreshBudget`). `spec` is `{ at, mode }`: 'lurk' is a
    // slow breath of banded noise, 'chase' brings up a beating drone under
    // it. Null stops it and gives the voice back.
    creatureVoice(spec) {
      if (!spec) {
        if (lurker) {
          const t = ctx.currentTime;
          lurker.ch.gain.gain.setTargetAtTime(0, t, 0.4);
          for (const n of lurker.nodes) { try { n.stop(t + 1.5); } catch { /* stopped */ } }
          lurker = null;
        }
        return;
      }
      if (!this.running) return;
      const t = ctx.currentTime;
      if (!lurker) {
        const ch = makeChannel(spec.at, 0, { db: 0, hz: 4000 }, 0.5);
        const nodes = [];
        // The breath: banded noise gated at a slow, wrong rhythm.
        const n = noiseNode();
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 340; bp.Q.value = 1.4;
        const bg = ctx.createGain(); bg.gain.value = 0.2;
        const lfo = ctx.createOscillator();
        lfo.type = 'sine'; lfo.frequency.value = 0.21;
        const depth = ctx.createGain(); depth.gain.value = 0.12;
        lfo.connect(depth); depth.connect(bg.gain);
        n.connect(bp); bp.connect(bg); bg.connect(ch.input);
        n.start(t); lfo.start(t);
        nodes.push(n, lfo);
        // The drone: two low saws a hair apart, beating. Silent until a chase.
        const dg = ctx.createGain(); dg.gain.value = 0;
        for (const hz of [46, 46.7]) {
          const o = ctx.createOscillator();
          o.type = 'sawtooth'; o.frequency.value = hz;
          const og = ctx.createGain(); og.gain.value = 0.24;
          o.connect(og); og.connect(dg);
          o.start(t);
          nodes.push(o);
        }
        const dlp = ctx.createBiquadFilter();
        dlp.type = 'lowpass'; dlp.frequency.value = 160;
        dg.connect(dlp); dlp.connect(ch.input);
        lurker = { ch, nodes, drone: dg };
        ch.gain.gain.setTargetAtTime(1, t, 0.6);
      }
      movePanner(lurker.ch, spec.at);
      lurker.drone.gain.setTargetAtTime(spec.mode === 'chase' ? 0.5 : 0, t, 0.3);
    },

    // The failing fixture's ballast, 120 Hz and narrow, gated by the same
    // flicker curve that drives its light — they fail together or the trick
    // reads as two tricks. `gain` is 0..1; 0 releases the voice.
    buzz(at, gain = 0) {
      if (!this.running) return;
      const g = clamp(gain, 0, 1);
      const t = ctx.currentTime;
      if (!buzzer) {
        if (g <= 0) return;
        const ch = makeChannel(at, 0, { db: 0, hz: 4000 }, 0.35);
        const o = ctx.createOscillator();
        o.type = 'sawtooth'; o.frequency.value = 120;
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass'; f.frequency.value = 120; f.Q.value = 8;
        const o2 = ctx.createOscillator();
        o2.type = 'sine'; o2.frequency.value = 240;
        const g2 = ctx.createGain(); g2.gain.value = 0.4;
        o.connect(f); f.connect(ch.input);
        o2.connect(g2); g2.connect(ch.input);
        o.start(t); o2.start(t);
        buzzer = { ch, nodes: [o, o2] };
      }
      movePanner(buzzer.ch, at);
      buzzer.ch.gain.gain.setTargetAtTime(g * 0.22, t, 0.08);
      if (g <= 0) {
        const b = buzzer;
        buzzer = null;
        for (const n of b.nodes) { try { n.stop(t + 0.6); } catch { /* stopped */ } }
      }
    },

    // --- the things the building does ---

    // The bell. Three strikes out of every bell fixture in the design; if
    // there aren't any, one strike where you're standing, and the panel says
    // so rather than pretending a school with no bells has one.
    ring() {
      ensure();
      if (!ctx || ctx.state !== 'running') return false;
      const bells = fixtures('bell');
      const e = ear();
      const at = bells.length ? bells : [{ ...e, db: BELL_DB, hz: BELL_HZ, room: e.room }];
      for (const b of at) {
        const ch = shotChannel(b, b.db ?? BELL_DB);
        if (!ch) continue;
        const hz = b.hz || BELL_HZ;
        for (let n = 0; n < BELL_RINGS; n++) {
          const t0 = n * BELL_GAP;
          // The hammer, before the bell it is hitting.
          burst(ch, { hz: hz * 3, q: 1.4, level: 0.5, decay: 0.05, delay: t0 });
          for (const p of BELL_PARTIALS) {
            tone(ch, {
              hz: hz * p.ratio,
              level: p.gain * 0.34,
              // The last strike is allowed to ring out; the first two are cut
              // short by the next hammer, the way a real repeater is.
              decay: p.decay * (n === BELL_RINGS - 1 ? 1 : 0.75),
              delay: t0,
            });
          }
        }
      }
      return bells.length > 0;
    },

    // The PA: three notes down a major triad, then somebody saying something
    // you can't quite make out. The announcement is band-limited noise with a
    // syllable envelope on it — an intercom is a telephone-band device, and
    // once you take everything above 3 kHz away, that is most of what makes a
    // voice down a corridor sound like a voice down a corridor.
    //
    // Phase 28: when the shell has a real voice to play (the Web Speech API,
    // reading murmur.js's script), `opts.voice` keeps the mumble out of its
    // way — the key-click and the chime still come out of every speaker,
    // through the room's own reverb, and the words ride over them.
    announce(opts = {}) {
      ensure();
      if (!ctx || ctx.state !== 'running') return false;
      const speakers = fixtures('pa');
      const e = ear();
      const at = speakers.length ? speakers : [{ ...e, db: PA_DB, room: e.room }];
      for (const s of at) {
        const ch = shotChannel(s, s.db ?? PA_DB);
        if (!ch) continue;
        // The click of a PA keying up, which is half the sound of a PA.
        burst(ch, { hz: 2200, q: 5, level: 0.25, decay: 0.03 });
        PA_CHIME.forEach((hz, i) => {
          tone(ch, { hz, level: 0.3, decay: 0.75, type: 'triangle', delay: 0.06 + i * 0.3 });
        });
        if (!opts.voice) speak(ch, 1.1);
      }
      return speakers.length > 0;
    },
  };

  // A second and a half of "someone is talking". Noise through the PA's own
  // passband, gated into syllables at about four a second, which is the rate
  // English actually runs at.
  function speak(ch, delay) {
    const t = ctx.currentTime + delay;
    const n = noiseNode(false);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = PA_BAND.lo;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = PA_BAND.hi;
    // Two formants, which is the difference between noise and a vowel.
    const f1 = ctx.createBiquadFilter();
    f1.type = 'peaking'; f1.frequency.value = 620; f1.Q.value = 5; f1.gain.value = 14;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'peaking'; f2.frequency.value = 1500; f2.Q.value = 6; f2.gain.value = 11;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    const dur = 1.6;
    for (let s = 0; s < 7; s++) {
      const at = t + s * (dur / 7);
      const on = 0.1 + Math.random() * 0.22;
      g.gain.linearRampToValueAtTime(on, at + 0.03);
      g.gain.linearRampToValueAtTime(0.02, at + dur / 7 - 0.03);
    }
    g.gain.linearRampToValueAtTime(0, t + dur);
    n.connect(hp); hp.connect(lp); lp.connect(f1); f1.connect(f2); f2.connect(g);
    g.connect(ch.input);
    n.start(t, Math.random() * 0.3, dur + 0.05);
  }

  // Clocks. The only looped source that isn't a continuous one: a tick is a
  // scheduled shot, so it rides the budget refresh rather than a node graph.
  function tick() {
    const now = ctx.currentTime;
    for (const s of sources) {
      if (s.kind !== 'tick') continue;
      if (s._next === undefined) s._next = now + Math.random() * s.every;
      if (s._next > now + 1) continue;
      const e = ear();
      const path = rayPath(s, e);
      const dist = Math.hypot(s.x - e.x, s.y - e.y, s.z - e.z);
      if (dbAt(s.db, dist) - path.db >= 14) {
        const ch = makeChannel(s, gainAtRef(s.db - path.db), path, wetFraction(room, dist));
        burst(ch, { hz: s.hz, q: 9, level: 0.7, decay: 0.035, delay: Math.max(0, s._next - now) });
      }
      s._next += s.every;
      if (s._next < now) s._next = now + s.every;
    }
  }
}
