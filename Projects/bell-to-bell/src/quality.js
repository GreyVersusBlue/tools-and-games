import { CFG } from './config.js';

// Phase 8 — the frame budget, and what gets given up to stay inside it.
//
// The budget is a number in CFG.quality (33.3 ms, which is 30 fps) rather than
// a feeling, and this file is the only thing that decides what to drop when
// the room misses it. Two decisions, on two different clocks:
//
//   pickTier() runs once, at boot, off what the device will admit to. It is
//   the only place that may decide against the rigged characters or against
//   antialiasing, because WebGL will not turn MSAA off after the context
//   exists and twelve people cannot be unskinned mid-period without the room
//   blinking.
//
//   createFrameBudget() runs every frame and may only turn resolution down.
//   That is the lever that is free at any moment, and on a phone panel it is
//   also the biggest one: this room is fill-bound long before it is
//   vertex-bound.
//
// Neither of these has been measured on a real phone. Nobody in this repo has
// had one in front of them, and a frame-time number taken off a software-
// rendered Chromium is not evidence about a mid-range Android (root CLAUDE.md,
// decision 53). So the game measures itself on whatever it is actually running
// on, out loud, and `report()` is what a tester reads back.

// Pure. Which boot tier a device gets, from the hints it will admit to.
// `cores` is navigator.hardwareConcurrency and `memory` is deviceMemory in GB;
// both are absent on plenty of browsers, and absent means "assume a desktop"
// unless the pointer is coarse, because a phone that hides its core count is
// still a phone.
export function pickTier({ coarse = false, cores = null, memory = null } = {}) {
  if (!coarse) return cores !== null && cores <= 2 ? 'medium' : 'high';
  // A coarse pointer with four or more cores and 4 GB is a current phone; the
  // ones below that line are where twelve skinned characters stop being
  // affordable, so those take the primitive bodies from the first frame.
  if ((cores !== null && cores <= 4) || (memory !== null && memory <= 3)) return 'low';
  return 'medium';
}

export function tierSettings(name) {
  return CFG.quality.tiers[name] || CFG.quality.tiers.high;
}

// Pure. The middle of a list, which is the number that matters here: a mean
// frame time is one garbage-collection pause away from lying in either
// direction, and a median of ninety frames is not.
export function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// The running measurement. Fed one frame time per frame; hands back a new
// pixel ratio on the frame it decides the budget has been missed for long
// enough, and null on every other frame.
//
// "Long enough" is deliberately several seconds. One slow window is a texture
// upload or somebody switching apps; four seconds of slow windows is the
// device telling you what it can do.
export function createFrameBudget(over = {}) {
  const q = CFG.quality;
  const budgetMs = over.budgetMs ?? q.budgetMs;
  const sampleFrames = over.sampleFrames ?? q.sampleFrames;
  const overBudgetSeconds = over.overBudgetSeconds ?? q.overBudgetSeconds;
  const ratios = over.ratios ?? q.pixelRatios;
  // Where in the ladder this device started: a phone whose devicePixelRatio is
  // 2 starts at 2 and can fall three steps; one that was already capped at 1
  // by its boot tier can only fall one.
  const startAt = ratios.findIndex(r => r <= (over.startRatio ?? ratios[0]));
  let index = startAt < 0 ? ratios.length - 1 : startAt;

  const window = [];
  let overSeconds = 0;
  let lastMedian = 0;
  const drops = [];

  function push(ms) {
    window.push(ms);
    if (window.length < sampleFrames) return null;
    lastMedian = median(window);
    const windowSeconds = window.reduce((a, b) => a + b, 0) / 1000;
    window.length = 0;

    if (lastMedian <= budgetMs) { overSeconds = 0; return null; }
    overSeconds += windowSeconds;
    if (overSeconds < overBudgetSeconds) return null;

    overSeconds = 0;
    if (index >= ratios.length - 1) return null;   // nothing left to give up
    index++;
    drops.push({ to: ratios[index], medianMs: Math.round(lastMedian * 10) / 10 });
    return { pixelRatio: ratios[index], medianMs: lastMedian };
  }

  // What a tester reads back off the console. The number, not an adjective.
  function report() {
    return {
      budgetMs,
      medianMs: Math.round(lastMedian * 10) / 10,
      fps: lastMedian ? Math.round(1000 / lastMedian) : 0,
      pixelRatio: ratios[index],
      drops: drops.slice()
    };
  }

  return { push, report };
}
