// Tuning constants. Everything a designer would want to twiddle lives here,
// not scattered through the systems.
export const CFG = {
  periodSeconds: 47 * 60,
  timeScale: 10,          // game seconds elapsed per real second (~4.7 min play)

  withitnessRange: 13,    // metres; beyond this a tell will not annotate
  proximityRange: 2.6,    // how close you must stand for the Proximity option

  moveSpeed: 2.7,         // m/s
  eyeHeight: 1.65,

  keys: {
    advance: 'KeyE',
    check: 'KeyQ',
    reteach: 'KeyR',
    roomTemp: 'KeyT'
  },

  // withitness costs
  bandwidthDrainPerSec: 4.2,
  hyperGainPerSec: 5.0,
  hyperDecayPerSec: 1.1,
  hyperThreshold: 58,     // above this, false positives spawn
  scanMasteryDrainPerSec: 0.45,   // ~1.7x the best delivery rate: looking is not free
  scanRestlessPerSec: 0.9,

  // teaching
  teachBandwidthPerSec: 0.16,
  teachRestlessDecayPerSec: 0.10,
  awayRestlessPerSec: 0.35,
  restlessPerLiveTellPerSec: 0.75,   // the room heats up around anything unhandled
  awayFidelityPerSec: -0.12,
  lowBandwidthThreshold: 20,
  lowBandwidthMasteryPenalty: 0.09,

  // the lesson (T2). Comprehension is per student, 0..1. Mastery is its mean.
  lesson: {
    startComprehension: 0.38,   // matches start.mastery
    startSpread: 0.09,          // they do not all walk in level

    deliveryFidelityPerSec: 0.018,  // being on-beat at the front looks like teaching
    idleFidelityPerSec: -0.02,      // being at the front saying nothing does not

    restlessDrag: 0.55,         // at restless 100, delivery is worth 45%
    forgetPerSec: 0.00012,      // untended comprehension leaks

    // You cannot learn beat four while you are still lost on beat two. A student's
    // ceiling rises as the lesson covers ground, scaled by how quickly they pick
    // things up — and gain tapers as they approach it. Reteaching goes over the top.
    capAptitude: 0.42,          // how much aptitude moves the ceiling
    headroomBand: 0.26,         // gain tapers within this much of the ceiling

    minFracToAdvance: 0.55,     // advance before this and you rushed it
    rushComprehension: -0.035,
    rushFidelity: -2.0,
    rushRestless: 4,
    belaborAfter: 1.35,         // multiples of beat.seconds before diminishing
    belaborFactor: 0.28,

    checkBandwidth: -3,
    checkFidelity: 1.7,
    checkFidelityFalloff: 0.45, // each extra check this beat is worth less
    checkBump: 0.022,           // saying it back helps the middle of the room
    checkCooldownSeconds: 22,
    checkRestless: -6,
    revealSeconds: 80,          // how long a check's picture stays current

    reteachBandwidth: -5,
    reteachRewind: 0.45,        // fraction of the beat you give back
    reteachGain: 0.085,         // to the bottom third
    reteachSpill: 0.018,        // to everyone else
    reteachRapport: 1.5,
    reteachBlindPenalty: 0.5    // reteaching without a fresh check is half as good
  },

  // the seating chart (T4)
  seating: {
    // How much reach a desk has. Side by side is the loud one; the diagonal is
    // the one teachers forget about, so it is worth just under the threshold.
    adjacency: { side: 1.0, frontBack: 0.8, diagonal: 0.55 },

    // Front row learns fastest. There are four seats in it and twelve students,
    // and that is the entire puzzle.
    rowGain: [1.10, 1.00, 0.88],

    // "We JUST moved." Two swaps pass without comment.
    freeMoves: 2,
    rapportPerMove: -0.9,
    rapportMoveCap: -7,

    // What it costs the kid you keep using as furniture.
    steadyCompPenalty: 0.16,   // per thing they quietly absorbed
    steadyLoadCap: 0.45
  },

  roomTemp: {
    hotTellWeight: 9,           // an unresolved tell reads as heat
    quadrantMinShare: 0.45      // below this the reading is "evenly distributed"
  },

  // whisper audio (T8). Only reaches you in Withitness — it's a hearing
  // upgrade to go with the seeing one, not a free extra sense.
  whisper: {
    range: 9,           // metres; beyond this it fades below the noise floor
    panSpan: 4          // metres of lateral offset that reads as fully hard-panned
  },

  // unresolved tell expiry
  missedRestless: 8,
  missedMastery: -1.2,

  start: { mastery: 38, fidelity: 62, rapport: 55, bandwidth: 100, restless: 12 }
};
