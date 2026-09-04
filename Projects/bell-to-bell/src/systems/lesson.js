import { CFG } from '../config.js';
import { clamp01, clamp01to100, applyEffects } from '../state.js';

// The lesson (T2). Mastery used to accrue from standing in a rectangle. Now it is
// the mean of twelve separate numbers, and the only things that move those numbers
// are: you delivering a beat, you checking whether it landed, and you saying it a
// second way for the three people it did not land on.
//
// A student with an active tell on them is not learning. That is the seam between
// this system and Withitness, and it is the whole reason the tells matter.
export function createLesson({ data, students, tellSystem, toast, onBoard, onRoomReact, rand = Math.random,
                               startComp = null }) {
  const L = CFG.lesson;
  const beats = data.beats;
  const filler = data.filler;
  const copy = data.copy;

  // Everyone starts somewhere slightly different, weighted by aptitude.
  // Phase 3: unless the semester record says where this kid actually is —
  // twelve numbers indexed by seat, which is who they are, never by desk.
  for (const s of students) {
    const apt = s.aptitude ?? 1;
    const carried = startComp && Number.isFinite(startComp[s.seat]) ? startComp[s.seat] : null;
    s.comp = carried != null
      ? clamp01(carried)
      : clamp01(L.startComprehension * apt + (rand() - 0.5) * 2 * L.startSpread);
    s.compShown = s.comp;
  }

  const current = state => (state.onFiller ? filler : beats[state.beat]) || filler;

  // Which students are currently carrying an unresolved tell, and how much
  // attention that tell leaves them.
  function attentionOf(seatIndex) {
    let factor = 1;
    for (const t of tellSystem.tells) {
      if (t.born === null || t.dead || t.resolved) continue;
      if (t.seat !== seatIndex && t.seat2 !== seatIndex) continue;
      const def = tellSystem.defs[t.type] || {};
      factor = Math.min(factor, def.attention ?? 0.2);
    }
    return factor;
  }

  function meanComp() {
    let sum = 0;
    for (const s of students) sum += s.comp;
    return sum / students.length;
  }

  // A mastery point is a point of the mean, so it comes off everyone evenly.
  function spendPending(state) {
    if (!state.masteryPending) return;
    const delta = state.masteryPending / 100;
    for (const s of students) s.comp = clamp01(s.comp + delta);
    state.masteryPending = 0;
  }

  function tick(state, dt, { teaching }) {
    const beat = current(state);
    const delivering = teaching && !state.withitness;

    if (delivering) {
      state.beatProgress += dt * CFG.timeScale;   // beats are measured in game seconds

      // Past the beat's natural length you are not adding much, you are filling.
      const over = state.beatProgress / (beat.seconds * L.belaborAfter);
      const pacing = over > 1 ? L.belaborFactor : 1;
      const drag = 1 - (state.restless / 100) * L.restlessDrag;

      const covered = (state.onFiller ? beats.length : state.beat + 1) / beats.length;

      for (const s of students) {
        const apt = s.aptitude ?? 1;
        const spread = 1 + (apt - 1) * (beat.spread ?? 1);

        // Their ceiling for the ground covered so far, and the taper into it.
        const cap = clamp01(L.startComprehension +
          (1 - L.startComprehension) * covered * (1 - L.capAptitude + L.capAptitude * apt * 1.15));
        const headroom = clamp01((cap - s.comp) / L.headroomBand);

        // T4: the front row gets more of you, and the kid you seated next to
        // trouble is spending part of the period managing it instead of listening.
        const seatFactor = (s.rowGain ?? 1) * (1 - (s.steadyLoad ?? 0));

        const gain = beat.gain * pacing * drag * spread * headroom * seatFactor *
                     attentionOf(s.seat) * dt * CFG.timeScale;
        s.comp = clamp01(s.comp + gain);
      }
      state.fidelity += L.deliveryFidelityPerSec * dt;
    } else {
      // Nobody is being taught. Things leak.
      for (const s of students) s.comp = clamp01(s.comp - L.forgetPerSec * dt * CFG.timeScale);
      if (teaching) state.fidelity += L.idleFidelityPerSec * dt;
    }

    // Locked constraint: Withitness drains Mastery while active. It does it here
    // now, one layer down, by taking it off the room rather than off a bar.
    if (state.withitness) {
      const d = CFG.scanMasteryDrainPerSec / 100 * dt;
      for (const s of students) s.comp = clamp01(s.comp - d);
    }

    spendPending(state);

    // The picture from your last check goes stale.
    if (state.lastCheckAt !== null && state.lastCheckAt - state.t > L.revealSeconds) {
      state.revealed = false;
    }

    state.mastery = clamp01to100(meanComp() * 100);
  }

  // ---- player actions -------------------------------------------------------

  function advance(state) {
    if (state.onFiller) { say(copy.outOfBeats); return { ok: false, reason: 'filler' }; }
    const beat = beats[state.beat];
    const frac = state.beatProgress / beat.seconds;

    if (frac < L.minFracToAdvance) {
      state.rushed++;
      state.fidelity += L.rushFidelity;
      state.restless += L.rushRestless;
      for (const s of students) s.comp = clamp01(s.comp + L.rushComprehension);
      say(copy.rushed);
    }

    state.beatsDelivered++;
    state.beat++;
    state.beatProgress = 0;
    state.checksThisBeat = 0;
    state.revealed = false;

    if (state.beat >= beats.length) {
      state.onFiller = true;
      say(copy.outOfBeats);
    } else {
      say(copy.advance, { label: beats[state.beat].label });
    }

    const now = current(state);
    if (now.fidelityBonus) state.fidelity += now.fidelityBonus;
    onBoard?.(now);
    onRoomReact?.('advance');
    return { ok: true, beat: now };
  }

  // Check for understanding. Costs bandwidth, buys you the truth.
  function check(state) {
    if (state.beatProgress < 25 && state.beat === 0 && !state.onFiller) {
      say(copy.checkCold);
      return { ok: false, reason: 'cold' };
    }
    const since = state.lastCheckAt === null ? Infinity : state.lastCheckAt - state.t;
    const stale = since >= L.checkCooldownSeconds;

    applyEffects(state, { bandwidth: L.checkBandwidth, restless: L.checkRestless });
    state.fidelity += L.checkFidelity * Math.pow(L.checkFidelityFalloff, state.checksThisBeat);

    if (stale) {
      // Saying it back helps the people who half had it.
      for (const s of students) {
        if (s.comp > 0.3 && s.comp < 0.75) s.comp = clamp01(s.comp + L.checkBump);
        s.compShown = s.comp;
      }
      say(copy.check);
    } else {
      for (const s of students) s.compShown = s.comp;
      say(copy.checkAgain);
    }

    state.checks++;
    state.checksThisBeat++;
    state.lastCheckAt = state.t;
    state.revealed = true;
    onRoomReact?.('check');
    return { ok: true, fresh: stale };
  }

  // Say it a different way. Expensive, and only worth it if you know who needs it.
  function reteach(state) {
    const fresh = state.revealed;
    const scale = fresh ? 1 : L.reteachBlindPenalty;
    const beat = current(state);

    applyEffects(state, { bandwidth: L.reteachBandwidth, rapport: L.reteachRapport * scale });
    state.beatProgress = Math.max(0, state.beatProgress - beat.seconds * L.reteachRewind);

    const sorted = [...students].sort((a, b) => a.comp - b.comp);
    const bottom = new Set(sorted.slice(0, Math.ceil(students.length / 3)).map(s => s.seat));
    for (const s of students) {
      const g = bottom.has(s.seat) ? L.reteachGain : L.reteachSpill;
      s.comp = clamp01(s.comp + g * scale);
    }

    state.reteaches++;
    say(fresh ? copy.reteach : copy.reteachBlind);
    onRoomReact?.('reteach');
    return { ok: true, fresh };
  }

  function say(c, vars = {}) {
    if (!c || !toast) return;
    let body = c.body || '';
    for (const [k, v] of Object.entries(vars)) body = body.replaceAll(`{${k}}`, v);
    toast(c.kind, c.title, body);
  }

  // The comprehension aura, only meaningful once you have actually checked.
  function auraOf(student, state) {
    if (!state.revealed) return null;
    const v = student.compShown;
    return v > 0.66 ? 'green' : v > 0.42 ? 'amber' : 'red';
  }

  function summary(state) {
    const beat = current(state);
    return {
      unit: data.unit,
      index: state.beat,
      total: beats.length,
      delivered: Math.min(state.beatsDelivered, beats.length),
      label: beat.label,
      line: beat.line,
      progress: state.beatProgress / beat.seconds   // uncapped: >1 means belabouring
    };
  }

  return { tick, advance, check, reteach, auraOf, summary, current, beats, filler, meanComp };
}
