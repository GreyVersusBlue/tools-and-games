import { CFG } from '../config.js';
import { applyEffects } from '../state.js';

// ROOM TEMP (T3). One glance, cheap, whole-room, no per-kid detail — the ability
// the treatment says should be used most. It tells you the shape of the room and
// roughly where the heat is. It never names a kid. That is what the expensive
// ability is for.
export function createRoomTemp({ data, students, tellSystem, toast, onPulse }) {
  const cfg = data.roomTempReading;
  const bands = data.roomTemp;

  function band(restless) {
    for (const row of bands) if (restless < row.below) return row;
    return bands[bands.length - 1];
  }

  // Heat is where the unresolved things are. Quadrants, not seats.
  function hotZone() {
    const buckets = {};
    let total = 0;
    for (const t of tellSystem.tells) {
      if (t.born === null || t.dead || t.resolved) continue;
      const s = students[t.seat];
      if (!s) continue;
      const key = (s.z > 0.4 ? 'back' : 'front') + '-' + (s.x < 0 ? 'left' : 'right');
      buckets[key] = (buckets[key] || 0) + CFG.roomTemp.hotTellWeight;
      total += CFG.roomTemp.hotTellWeight;
    }
    if (!total) return null;
    // #890: two quadrants level at the top are not a direction. This used to
    // hand back whichever one's tell was born first, so the same room read as
    // the front left or the back right depending on who started it.
    let best = null, bestV = 0, level = false;
    for (const [k, v] of Object.entries(buckets)) {
      if (v > bestV) { best = k; bestV = v; level = false; }
      else if (v === bestV) level = true;
    }
    if (level) return 'middle';
    return bestV / total >= CFG.roomTemp.quadrantMinShare ? best : 'middle';
  }

  function read(state) {
    const since = state.tempReadAt === null ? Infinity : state.tempReadAt - state.t;
    if (since < cfg.cooldownSeconds) return { ok: false, reason: 'cooldown' };

    applyEffects(state, cfg.cost);
    state.tempReadAt = state.t;
    state.tempUses++;

    const row = band(state.restless);
    const zone = hotZone();
    state.tempZone = zone;
    state.tempLabel = row.label;

    const where = zone
      ? cfg.zoneTemplate.replace('{zone}', cfg.zoneNames[zone] || zone)
      : cfg.zoneNone;
    toast?.('', row.label, `${row.line} ${where}`);
    onPulse?.(row, zone);
    return { ok: true, label: row.label, zone };
  }

  // What the HUD shows between readings. A reading is a snapshot of a moment you
  // were standing there, not a live feed, so it ages and then says so.
  function display(state) {
    if (state.tempReadAt === null) return { label: cfg.unreadLabel, sub: 'not read yet', fresh: false };
    const age = state.tempReadAt - state.t;
    if (age > cfg.staleAfterSeconds) {
      return { label: state.tempLabel, sub: cfg.staleLabel, fresh: false };
    }
    return {
      label: state.tempLabel,
      sub: state.tempZone ? (cfg.zoneNames[state.tempZone] || state.tempZone) : 'even',
      fresh: true
    };
  }

  return { read, display, band, hotZone };
}
