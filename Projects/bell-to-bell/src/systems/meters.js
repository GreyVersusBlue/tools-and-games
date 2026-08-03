import { CFG } from '../config.js';
import { clamp01to100 } from '../state.js';

export function inTeachingZone(camera, zone) {
  return camera.position.z < zone.maxZ && Math.abs(camera.position.x) < zone.maxAbsX;
}

// Everything except Mastery. Mastery is no longer a meter you can add to — it is
// whatever the room understands, and the lesson system owns it (see systems/lesson.js).
export function tickMeters(state, dt, teaching, liveTells = 0) {
  if (!state.withitness) {
    if (teaching) {
      state.bandwidth -= CFG.teachBandwidthPerSec * dt;
      state.restless -= CFG.teachRestlessDecayPerSec * dt;
    } else {
      state.restless += CFG.awayRestlessPerSec * dt;
    }
  }
  // An unhandled thing does not stay where it is. This is what Room Temp reads.
  state.restless += liveTells * CFG.restlessPerLiveTellPerSec * dt;
  if (!teaching) state.fidelity += CFG.awayFidelityPerSec * dt;
  if (state.bandwidth < CFG.lowBandwidthThreshold) {
    state.masteryPending -= CFG.lowBandwidthMasteryPenalty * dt;
  }

  state.restless = Math.max(0, Math.min(100, state.restless));
  state.fidelity = clamp01to100(state.fidelity);
  state.rapport = clamp01to100(state.rapport);
  state.bandwidth = clamp01to100(state.bandwidth);
}

// Kept for anything that wants the raw band without taking a reading.
export function roomTemp(state, table) {
  for (const row of table) if (state.restless < row.below) return row.label;
  return table[table.length - 1].label;
}
