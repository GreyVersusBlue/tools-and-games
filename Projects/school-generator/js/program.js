// program.js — the educational program: how many rooms of what kind a school
// for N students needs, and how big each of them is.
//
// This is the first half of Phase 8's generator, and it is deliberately not
// the half that draws anything. A school building is sized before it is
// planned: somebody decides that six hundred middle-schoolers need
// twenty-four teaching stations, a cafeteria that seats a third of them at a
// time, a gym, and parking for fifty staff — and only then does anyone pick
// up a pencil. Splitting the two means the numbers can be checked without a
// layout, the layout can be checked against numbers it didn't invent, and a
// person can read the schedule before generating anything at all.
//
// Every row says which rule produced it. That is the same bargain Phase 7's
// report struck and for the same reason: these are planning rules of thumb
// from school-district facility guidelines, not code minimums, and a number
// that can't say where it came from doesn't get printed. Nothing here is a
// simulation and nothing here is authoritative — it is arithmetic with its
// working shown.
//
// Pure module: no three.js, no DOM. Exercised by test/program.test.mjs.

// ---------- the bands ----------
//
// A grade band changes almost everything: how many children share a teacher,
// how much room each of them needs, whether the building has science labs or
// a kiln, and whether any of the students drive to it. These are the numbers
// the rest of the file multiplies.
export const BANDS = [
  {
    key: 'elementary',
    label: 'Elementary (K–5)',
    // Children per teaching station. Elementary classes are smaller and a
    // class stays in its room all day, so stations ≈ classes.
    classSize: 22,
    // Fraction of the day a teaching station is actually in use. An
    // elementary homeroom is occupied all day; a secondary room sits empty
    // one period in five, so a secondary school needs more of them.
    utilization: 0.95,
    classroom: { w: 30, d: 30 },     // ft — 900 ft², the usual elementary figure
    // Specials: the rooms that aren't homerooms. `per` is one room per that
    // many students, `min` is the floor below which you still build one.
    specials: [
      { key: 'art', name: 'Art Room', per: 400, min: 1, w: 34, d: 30, tpl: 'art' },
      { key: 'music', name: 'Music Room', per: 500, min: 1, w: 32, d: 28 },
      { key: 'sped', name: 'Resource Room', per: 250, min: 1, w: 24, d: 22 },
    ],
    gym: { w: 74, d: 54, name: 'Gymnasium' },
    // Seats at one lunch sitting, as a fraction of enrollment. Three sittings
    // is what an elementary school runs, so a third of the school eats at once.
    dining: { share: 0.36, sqftPerSeat: 15 },
    library: { per: 1, base: 1400, sqftPerStudent: 1.6 },
    staffRatio: 14,        // students per adult on site, teachers and everyone else
    driversShare: 0,       // nobody drives to an elementary school
    visitorStalls: 12,
  },
  {
    key: 'middle',
    label: 'Middle (6–8)',
    classSize: 25,
    utilization: 0.85,
    classroom: { w: 32, d: 28 },     // ~900 ft²
    specials: [
      { key: 'science', name: 'Science Lab', per: 220, min: 2, w: 36, d: 30, tpl: 'science' },
      { key: 'art', name: 'Art Room', per: 450, min: 1, w: 36, d: 30, tpl: 'art' },
      { key: 'music', name: 'Band Room', per: 600, min: 1, w: 40, d: 32 },
      { key: 'computer', name: 'Computer Lab', per: 400, min: 1, w: 32, d: 28, tpl: 'computer' },
      { key: 'sped', name: 'Resource Room', per: 300, min: 1, w: 24, d: 22 },
    ],
    gym: { w: 90, d: 62, name: 'Gymnasium' },
    dining: { share: 0.4, sqftPerSeat: 15 },
    library: { per: 1, base: 1800, sqftPerStudent: 1.8 },
    staffRatio: 12,
    driversShare: 0,
    visitorStalls: 16,
  },
  {
    key: 'high',
    label: 'High (9–12)',
    classSize: 26,
    utilization: 0.8,
    classroom: { w: 32, d: 28 },
    specials: [
      { key: 'science', name: 'Science Lab', per: 160, min: 3, w: 38, d: 32, tpl: 'science' },
      { key: 'art', name: 'Art Studio', per: 500, min: 1, w: 38, d: 32, tpl: 'art' },
      { key: 'music', name: 'Band Room', per: 700, min: 1, w: 44, d: 34 },
      { key: 'computer', name: 'Computer Lab', per: 350, min: 2, w: 34, d: 28, tpl: 'computer' },
      { key: 'shop', name: 'Makerspace', per: 800, min: 1, w: 44, d: 36, tpl: 'science' },
      { key: 'sped', name: 'Resource Room', per: 350, min: 1, w: 26, d: 22 },
    ],
    gym: { w: 104, d: 72, name: 'Gymnasium' },
    dining: { share: 0.34, sqftPerSeat: 15 },
    library: { per: 1, base: 2400, sqftPerStudent: 2 },
    staffRatio: 11,
    // Juniors and seniors with cars. The single biggest thing that makes a
    // high school's car park four times an elementary school's.
    driversShare: 0.28,
    visitorStalls: 20,
  },
];

const BY_KEY = new Map(BANDS.map((b) => [b.key, b]));
export const DEFAULT_BAND = 'middle';
export const bandEntry = (key) => BY_KEY.get(key) || BY_KEY.get(DEFAULT_BAND);

export const MIN_STUDENTS = 30;
export const MAX_STUDENTS = 4000;

// ---------- the brief ----------
//
// What a person actually chooses. Everything else in this file is derived
// from these five fields, which is why the generator's panel has five
// controls and not fifty.
export const DEFAULT_BRIEF = {
  students: 600,
  band: DEFAULT_BAND,
  storeys: 2,
  seed: 1,
  gym: true,
  cafeteria: true,
  library: true,
  site: true,
};

const clampInt = (v, dflt, lo, hi) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : dflt;
  return Math.min(hi, Math.max(lo, n));
};

export function normalizeBrief(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const band = BY_KEY.has(src.band) ? src.band : DEFAULT_BAND;
  const bool = (v, dflt) => (typeof v === 'boolean' ? v : dflt);
  return {
    students: clampInt(src.students, DEFAULT_BRIEF.students, MIN_STUDENTS, MAX_STUDENTS),
    band,
    storeys: clampInt(src.storeys, DEFAULT_BRIEF.storeys, 1, 4),
    seed: clampInt(src.seed, DEFAULT_BRIEF.seed, 1, 0x7fffffff),
    gym: bool(src.gym, DEFAULT_BRIEF.gym),
    cafeteria: bool(src.cafeteria, DEFAULT_BRIEF.cafeteria),
    library: bool(src.library, DEFAULT_BRIEF.library),
    site: bool(src.site, DEFAULT_BRIEF.site),
  };
}

// ---------- the schedule of accommodation ----------
//
// One row per room the building wants. `count` rooms of `w` x `d` feet, each
// carrying the name the generator will letter it with and the template
// `autofurnish.js` will fill it from — so a program row is already everything
// downstream needs about the room except where it goes.
//
// `group` is what the layout does with it: `wing` rooms hang off the corridor
// in ordinary bays, `block` rooms are too deep for a bay and get a wing of
// their own, and `service` rooms are small enough to tuck in wherever a bay
// has a remainder.
function row(key, name, count, w, d, opts = {}) {
  return {
    key,
    name,
    count,
    w, d,
    area: w * d,
    total: w * d * count,
    group: opts.group || 'wing',
    rule: opts.rule || '',
    // How the room gets furnished and how the layout should letter copies of
    // it — "Room 101, Room 102" for classrooms, "Science Lab 1" for labs.
    number: opts.number !== false,
    tpl: opts.tpl || null,
  };
}

// Teaching stations: the number this whole exercise turns on. A station is a
// room a class can be timetabled into, so the count is enrollment over class
// size, divided again by how much of the day a room is actually used.
export function teachingStations(students, band) {
  const b = bandEntry(band);
  return Math.max(1, Math.ceil(students / b.classSize / b.utilization));
}

// The specials come out of the same student count and then off the general
// classroom total: a science lab *is* a teaching station, it is just a
// particular one, and counting it twice builds a school half again too big.
function specialRows(students, b) {
  const rows = [];
  for (const sp of b.specials) {
    const n = Math.max(sp.min, Math.round(students / sp.per));
    if (n <= 0) continue;
    rows.push(row(sp.key, sp.name, n, sp.w, sp.d, {
      rule: `one per ${sp.per} students, at least ${sp.min}`,
      tpl: sp.tpl || null,
    }));
  }
  return rows;
}

// Restrooms. Fixture counts are a plumbing code question this tool has no
// business answering; what it can say is that a school puts a pair of
// restrooms near each end of each corridor, and that a bigger school puts
// more of them. One pair per 250 students, at least one pair per storey.
function restroomRows(students, storeys) {
  const pairs = Math.max(storeys, Math.ceil(students / 250));
  return [
    row('restroom-g', 'Girls Restroom', pairs, 20, 16, {
      group: 'service', rule: 'one pair per 250 students, at least one pair per storey',
    }),
    row('restroom-b', 'Boys Restroom', pairs, 20, 16, {
      group: 'service', rule: 'one pair per 250 students, at least one pair per storey',
    }),
  ];
}

// The office suite. Reception and the principal scale barely at all; the
// counselling and health rooms scale with enrollment, slowly.
function adminRows(students) {
  const counsel = Math.max(1, Math.round(students / 400));
  return [
    row('office', 'Main Office', 1, 34, 26, { number: false, rule: 'one per school', tpl: 'office' }),
    row('principal', 'Principal', 1, 16, 14, { group: 'service', number: false, rule: 'one per school' }),
    row('health', 'Health Office', 1, 20, 16, { group: 'service', number: false, rule: 'one per school' }),
    row('counsel', 'Counseling', counsel, 16, 14, {
      group: 'service', rule: 'one per 400 students, at least one',
    }),
    row('workroom', 'Staff Workroom', 1, 24, 20, { number: false, rule: 'one per school' }),
    row('custodial', 'Custodial', 1, 12, 12, { group: 'service', number: false, rule: 'one per school' }),
    row('mech', 'Mechanical', 1, 24, 16, { group: 'service', number: false, rule: 'one per school' }),
  ];
}

// The big rooms, each of which is a building in miniature and none of which
// fits in a classroom bay. Their sizes come off the band rather than off the
// enrollment, because a regulation court is a regulation court whether four
// hundred children or a thousand play on it — what enrollment changes is the
// cafeteria, which is seats, and the library, which is square feet.
function blockRows(students, b, brief) {
  const rows = [];
  if (brief.gym) {
    rows.push(row('gym', b.gym.name, 1, b.gym.w, b.gym.d, {
      group: 'block', number: false, tpl: 'gym',
      rule: `a ${b.gym.w}×${b.gym.d} ft court for this band`,
    }));
    rows.push(row('locker-g', 'Girls Locker Room', 1, 30, 24, {
      group: 'service', number: false, rule: 'one pair beside the gym',
    }));
    rows.push(row('locker-b', 'Boys Locker Room', 1, 30, 24, {
      group: 'service', number: false, rule: 'one pair beside the gym',
    }));
  }
  if (brief.cafeteria) {
    const seats = Math.ceil(students * b.dining.share);
    const area = seats * b.dining.sqftPerSeat;
    // Kept near square, and rounded to the 4ft lattice the layout works on so
    // the bay arithmetic downstream never has to deal in half cells.
    const side = Math.max(40, Math.round(Math.sqrt(area) / 4) * 4);
    rows.push(row('cafeteria', 'Cafeteria', 1, Math.round(side * 1.3 / 4) * 4, side, {
      group: 'block', number: false, tpl: 'cafeteria',
      seats,
      rule: `${seats} seats at ${Math.round(b.dining.share * 100)}% of enrollment, ` +
        `${b.dining.sqftPerSeat} ft² each`,
    }));
    rows.push(row('kitchen', 'Kitchen', 1, 40, 26, {
      number: false, rule: 'one serving line per cafeteria',
    }));
  }
  if (brief.library) {
    const area = b.library.base + students * b.library.sqftPerStudent;
    const side = Math.max(36, Math.round(Math.sqrt(area / 1.4) / 4) * 4);
    rows.push(row('library', 'Library', 1, Math.round(side * 1.4 / 4) * 4, side, {
      group: 'block', number: false, tpl: 'library',
      rule: `${b.library.base} ft² plus ${b.library.sqftPerStudent} ft² per student`,
    }));
  }
  return rows;
}

// The whole schedule, plus the roll-ups a panel prints and the layout reads.
export function buildProgram(brief) {
  const b0 = normalizeBrief(brief);
  const b = bandEntry(b0.band);
  const students = b0.students;

  const stations = teachingStations(students, b);
  const specials = specialRows(students, b);
  const specialCount = specials.reduce((n, r) => n + r.count, 0);
  // General classrooms are what's left of the teaching stations after the
  // specials have taken theirs. A very small school can want fewer stations
  // than it has specials, which is a real answer — it just means every room
  // in it is a special — so the floor is zero rather than an error.
  const generalCount = Math.max(0, stations - specialCount);

  const rooms = [];
  if (generalCount > 0) {
    rooms.push(row('classroom', 'Room', generalCount, b.classroom.w, b.classroom.d, {
      tpl: 'classroom',
      rule: `${stations} teaching stations (${students} students ÷ ${b.classSize} per class ` +
        `÷ ${Math.round(b.utilization * 100)}% utilization) less ${specialCount} specials`,
    }));
  }
  rooms.push(...specials);
  rooms.push(...blockRows(students, b, b0));
  rooms.push(...adminRows(students));
  rooms.push(...restroomRows(students, b0.storeys));

  const staff = Math.max(4, Math.ceil(students / b.staffRatio));
  const drivers = Math.round(students * b.driversShare);
  const parking = staff + drivers + b.visitorStalls;

  const netArea = rooms.reduce((n, r) => n + r.total, 0);
  // Net-to-gross: corridors, walls, stairs and the plenum are the building
  // that isn't a room, and in a school they are about a third of it. The
  // layout will produce its own gross area by drawing the thing; this is the
  // estimate that tells the layout how big a footprint to reach for.
  const grossFactor = 1.42;

  return {
    brief: b0,
    band: { key: b.key, label: b.label, classSize: b.classSize, utilization: b.utilization },
    students,
    stations,
    rooms,
    roomCount: rooms.reduce((n, r) => n + r.count, 0),
    netArea,
    grossFactor,
    grossArea: Math.round(netArea * grossFactor),
    staff,
    drivers,
    parking,
    // What the tool is *not* claiming. Printed under the schedule, because a
    // list of confident numbers with no caveat is the thing this phase most
    // wants to avoid being.
    caveat: 'Planning ratios from school-district facility guidelines, not code minimums. ' +
      'The building this produces is a starting point to edit, not a design.',
  };
}

// A flat, printable version — one line per row, for the panel and for anyone
// who wants to check the arithmetic before generating anything.
export function programLines(program) {
  return program.rooms.map((r) => ({
    key: r.key,
    label: r.count > 1 ? `${r.count} × ${r.name}` : r.name,
    size: `${r.w}′ × ${r.d}′`,
    area: r.total,
    rule: r.rule,
  }));
}
