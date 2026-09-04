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
    roomTemp: 'KeyT',
    // T7: the rubric's other look-fors. Checks for understanding (KeyQ, above)
    // is the one that is also just good teaching; the one-shot keys below and
    // the held wait key are close to pure performance.
    //
    // Phase 4: one key per one-shot look-for in data/observation.json's pool,
    // named `look:<key>` so main.js's action dispatch can hand the suffix
    // straight to observation.satisfy() without knowing what is in the pool.
    // Adding a look-for is a row in that file and a line here, and the letter
    // in the row has to be the letter here.
    'look:objective': 'KeyO',
    'look:question': 'KeyH',
    'look:discourse': 'KeyG',
    'look:modeling': 'KeyM',
    'look:vocabulary': 'KeyV',
    'look:nonverbal': 'KeyN',
    'look:evidence': 'KeyC'
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

  // T7: The Observation. Phase 4: whether she comes at all, when in the window
  // she arrives, whether it was on the calendar days ahead and which five of
  // the nine look-fors she brought are all in data/observation.json, because
  // they are content. What is left in here is what it costs.
  observation: {
    alertSeconds: 9,       // real seconds between the Admin Proximity Alert and AP walking in
    windowMinutes: 11,     // game-minutes the rubric window stays open once she has
    waitHoldSeconds: 5,    // real seconds KeyF must be held to bank "wait time"

    // Ambient cost of performing for an audience instead of teaching, applied
    // through masteryPending (never state.mastery directly) regardless of
    // whether you chase a single look-for. Over the full 11-minute window this
    // is about a 5-point Mastery dent on its own — a fact about being watched,
    // not a fact about what you do with it.
    masteryDrainPerSec: 0.008,

    lookForFidelity: 2.4,     // per look-for satisfied, the rubric actually rewarding the show
    lookForBandwidth: -1.2    // performing it is not free either
  },

  // Phase 1: the school day, as opposed to the period. Bandwidth is the one
  // meter the treatment says does not regenerate during the day, so it is the
  // one meter that crosses the bell — everything else in `start` below is a
  // fact about walking into a room and resets at every one.
  day: {
    passingPeriodRecovery: 26   // what four minutes in the hallway give back
  },

  // Phase 3: the semester. What a class walks in with tomorrow is a function
  // of what it walked out with today, and these are the functions. All of it
  // is design math until somebody plays a week; the balance harness's week
  // table is where a wrong number shows up before Thursday does.
  semester: {
    daysPerWeek: 5,
    // Overnight, a student's comprehension relaxes toward their walking-in
    // level (CFG.lesson.startComprehension x aptitude) from either side: this
    // much of what you taught them above it survives the night, and the same
    // share of what a bad period took out from under it comes back, because
    // they knew that part last week. The weekend is the between-days sibling
    // of CFG.lesson.forgetPerSec, and it is the bigger one. A class taught
    // well plateaus in the mid 70s by Wednesday; a class taught badly does
    // not spiral to zero, it just stays bad.
    retainOvernight: 0.82,
    retainWeekend: 0.64,
    // Fidelity is admin's running opinion, and admin's opinion drifts back
    // toward the district mean every night unless something keeps moving it.
    // 0.7 is what keeps a +22 period from pinning the meter at 100 by
    // Tuesday: the good teacher opens near 71 and closes near 93, the
    // wanderer opens near 59 and closes near 53, which is under the first
    // rung of the ladder in data/admin.json and stays there.
    districtFidelity: 62,
    fidelityRevert: 0.70,       // per night, of the distance from the district mean
    // Rapport carries too, and they will be over most of it by Thursday: a
    // seven-point rechart is a two-point grudge three nights later.
    rapportRevert: 0.50
  },

  // unresolved tell expiry
  missedRestless: 8,
  missedMastery: -1.2,

  start: { mastery: 38, fidelity: 62, rapport: 55, bandwidth: 100, restless: 12 }
};
