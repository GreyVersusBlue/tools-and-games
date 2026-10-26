// Help's words, as data (spec 14, 3.15). Pure: it reads no DOM, so the Node
// test (test/engine/help.test.mjs) runs it against the real registries.
//
// What has a registry is read from it at run time and never copied here: the
// sections come from the rail (ui/app.js's SECTIONS), the shortcuts from the
// shell's list (shortcuts.list()), the numbers from the settings' defaults
// (engine/schema.js) and the engines' own constants. What has no registry is
// written here as plain sentences: what each section is for, a sentence for
// each group of shortcuts, the gestures, the words, and how load, travel time
// and late are worked out.
//
//   helpModel({ sections, shortcuts, settings, current }) -> {
//     current:   { id, name, purpose, first } | null   the section open now
//     sections:  [{ id, name, key, purpose, first, more, here }]  rail order
//     keys:      { rows, groups: [{ group, says }] }   rows as shortcuts.list()
//     gestures:  [{ id, device, items }]
//     words:     [{ term, meaning }]
//     numbers:   [{ id, title, sentences, uses }]
//   }
//
// `sections` are the rail's section objects ({ id, name, key }), `shortcuts`
// is shortcuts.list(), `settings` the project's (the defaults when left out).
// A section, a shortcut group or a setting with no words here still shows,
// with a sentence saying Help has nothing for it; the Node test fails first.

import { defaultSettings, STUDENTS_PER_LANE_CELL, DOOR_SIDES, DAY_TYPES_MOST, DEFAULT_DAY_TYPE_NAMES } from '../../engine/schema.js';
import { CROSSING_WAIT_MAX, CAP_FACTOR, CAP_MINIMUM_SECONDS, columnLength, walkingSeconds } from '../../engine/crowd.js';
import { routingGraph } from '../../engine/routing.js';
import { LOAD_BANDS, bandEdges } from '../../engine/load.js';
import { MIN_ZOOM, MAX_ZOOM } from '../surface/viewport.js';
import { LONG_PRESS_MS, SLOP } from '../surface/input.js';
import { HANDLE_MARGIN } from '../surface/tools/select.js';
import { periodWords, count } from '../components/words.js';

export const NOTHING_WRITTEN = 'Help has nothing written for this yet.';

// What each section is for, and what to do first. Keyed by the section's id
// in the rail; `more` is a line or two on its tabs.
export const SECTION_HELP = {
  building: {
    purpose: 'Draw the school once: each floor on a grid of cells, its corridors, its rooms with their numbers, other spaces, stairs between floors, and the exits. Every other section works from this drawing.',
    first: 'Draw a corridor with the Corridor tool (C), then rooms along it with the Room tool (R), and type each room’s number in the inspector. To draw over a photo of a floor plan, open the Floor tab and trace it.',
    more: 'The inspector has five tabs: Properties for what is selected, Rooms for this floor’s rooms, Floor for its name, size and traced image, Checks for what the building checks found, and Exits. Right-click a cell, or press and hold it, for what can be done there, a door included.',
  },
  schedule: {
    purpose: (w) => 'Enter the school day and who is where: the ' + w.many + ' and bells, the subjects, the teachers, and each group’s room for every ' + w.one + ' on every day type.',
    first: (w) => 'Add teachers under Teachers, then add a group under Groups and pick its room for each ' + w.one + '. Day sets how many ' + w.many + ' there are, what they are called, the day types and the bells.',
    more: (w) => 'Grid is the whole schedule as a spreadsheet: changes there wait for Apply, and its Day type choice shows every day type or one. Checks lists what is wrong (a double-booking, a walk too long for the passing time) with Show, Fix… and Accept. Import reads groups, teachers or subjects from a CSV file. Day holds the day types, up to ' + DAY_TYPES_MOST + ': each has its own classes or is the same as another, and Change… turns one into the other. It also holds the regular bells of each day type, and other bell schedules, such as an early release, where the ' + w.many + ' ticked No class do not meet. With more than two day types of their own, the group editor’s Show chips choose which are side by side.',
  },
  movement: {
    purpose: (w) => 'Watch every group walk between one ' + w.one + ' and the next: the routes, where the corridors fill, and who cannot make it in the passing time.',
    first: 'Read the first line: it says what is drawn and which routes failed. Change picks the groups, the day type and the transition. Play walks the groups second by second.',
    more: 'The inspector has four tabs: Hotspots ranks the busiest places, Travel time has every group’s walking and waiting, Summary has the figures and every route that failed, and Export prints or saves the picture and the tables.',
  },
  scenarios: {
    purpose: 'Try changes to the schedule apart from the real one, and see what they do: travel times, the busiest places and the checks, before and after.',
    first: 'Start a scenario, then add a change: move a group to another room, swap two of its periods, or swap two groups’ rooms. The map shows busier cells in red and quieter ones in blue-green. Apply puts every change into the schedule as one step you can undo; Discard drops them.',
    more: 'A scenario can also come from another project file of the same building: every slot that differs becomes a change. A change that no longer fits the schedule is listed and left out of Apply.',
  },
  safety: {
    purpose: 'See the way out from every room to its nearest exit, and print a door card for each room.',
    first: 'Mark the exits first: the Exit tool (X) in Building, on a corridor cell at the edge of a floor. Then pick a room on the map, or tick rooms under Door cards and print them.',
    more: 'Exits are numbered as well as coloured, on the map, in the key and in the inspector. Exits lists the rooms each exit serves and any room with no way out.',
  },
  staff: {
    purpose: 'Make the staff browser: a read-only lookup of where and when, for staff on their phones, published as one file.',
    first: 'Look at the preview, set a passcode, read Before you publish, then press Publish a file. Send the file to staff by mail or a shared drive: the planner sends nothing anywhere.',
    more: 'What is in it chooses the views the file carries. Below the form, batch printing makes every teacher’s schedule or every door sign at once.',
  },
  project: {
    purpose: 'The project as a whole: where it is saved, project files, snapshots, recovery points, sending it to another device, the settings, clearing it, and the sample school.',
    first: 'Export a project file now and then, so a copy is kept off this device. Settings holds every number the planner works with, each with a line saying what it does.',
    more: 'A snapshot is a copy you name and keep on this device. A recovery point is taken by the planner before anything that replaces the project. Every change is saved on this device within about a second without asking.',
  },
};

// A sentence for each group of shortcuts the shell's list uses.
export const SHORTCUT_GROUPS = {
  Sections: 'Open a section from anywhere. They are the digits in the corners of the rail.',
  Anywhere: 'Work on every screen.',
  Building: 'Work on the Building plan once it has the keyboard: Tab to it, or press F6 until it is reached.',
  'Schedule grid': 'Work in Schedule › Grid, with a slot chosen.',
  Movement: 'Work on the Movement map once it has the keyboard.',
  'Scenario lab': 'Work on the scenario lab’s map once it has the keyboard.',
  Safety: 'Work on the Safety map once it has the keyboard.',
  'Dialogs and menus': 'Work in any dialog or menu, this one included.',
  Fields: 'Work in any field you type in.',
};

export const GUARD = 'A single key does nothing while you are typing in a field, or while Ctrl, Alt or ⌘ is held. Inside a text field, undo and redo belong to the field.';

// The gestures of DESIGN 6 and spec 3.11 and 3.12, on every map.
export function gestures() {
  const zoom = Math.round(MIN_ZOOM * 100) + '% to ' + Math.round(MAX_ZOOM * 100) + '%';
  return [
    { id: 'mouse', device: 'Mouse', items: [
      'Left button: draw with the tool in hand, or pick what is under it.',
      'Right button: the menu of what can be done on that cell of the Building plan.',
      'Middle button, or Space held while you drag: move the map.',
      'Ctrl or ⌘ with the wheel: zoom about the pointer, from ' + zoom + '. The wheel alone moves the map.',
      'With the Select tool, a drag that starts on an empty cell moves the map.',
      'A drag that starts off the floor moves the map whatever the tool in hand, and so does one by a finger or a pen.',
      'A room drawn with the mouse, a pen or the keyboard puts you in its number field: type the number, and Enter keeps it and takes you back to the cursor on the plan.',
    ] },
    { id: 'touch', device: 'Touch', items: [
      'One finger: draw with the tool in hand, or tap to pick.',
      'Two fingers: move the map, and pinch to zoom. A second finger landing cancels what the first was drawing, and nothing changes.',
      'Press and hold for ' + (LONG_PRESS_MS / 1000) + ' seconds, moving less than ' + SLOP + ' px: on the Building plan, the menu for that cell.',
      'A selection can be grabbed up to ' + HANDLE_MARGIN + ' px outside its edge.',
      'A room drawn with a finger is selected, and the on-screen keyboard stays down: tap its number field to type.',
    ] },
    { id: 'pen', device: 'Pen', items: [
      'The tip draws, as one finger does.',
      'The barrel button held: move the map.',
      'While the pen is down, a hand resting on the screen does nothing.',
      'A room drawn with the pen puts you in its number field, as with the mouse.',
    ] },
    { id: 'keyboard', device: 'Keyboard', items: [
      'Tab to the plan or the map. The arrows move a cursor one cell; Enter does what a click would.',
      'Hold Shift and move with the arrows to drag; let go of Shift to finish.',
      'Space with the arrows moves the map. Escape cancels.',
      'On the Building plan the letters choose tools and Page Up and Page Down change floor. On every map = zooms in, - zooms out and 0 fits it to the window.',
      'Shift+F10 or the Menu key: on the Building plan, the menu for the cell under the cursor.',
      'A screen reader is told what is under the cursor and what each action did, in a sentence.',
    ] },
  ];
}

// Spec 2's words, with the school's period word where it is the school's.
export function words(settings) {
  const w = periodWords(settings);
  // No article before the school's word: "a hour" and "an mod" are both wrong.
  const own = w.One === 'Period' ? '' : ' This school’s word for it is ' + w.one + ', and the planner says ' + w.one + ' everywhere.';
  return [
    { term: 'Project', meaning: 'One school: its building, its schedule and its settings.' },
    { term: 'Floor', meaning: 'One level of the building, drawn on its own grid.' },
    { term: 'Cell', meaning: 'The smallest piece of a floor’s grid. Everything on a floor is drawn in cells.' },
    { term: 'Room', meaning: 'A space a group can be scheduled into. It has a room number.' },
    { term: 'Other space', meaning: 'A space nobody is scheduled into: a bathroom, an office, storage, a courtyard. It is shown and labelled, and routes do not pass through it.' },
    { term: 'Corridor', meaning: 'Hallway cells people walk along. A corridor can be named, such as North Corridor.' },
    { term: 'Stairs', meaning: 'A connection between two points, normally on different floors.' },
    { term: 'Elevator', meaning: 'A step-free connection between floors. It is planned, and not built yet.' },
    { term: 'Exit', meaning: 'A point on a corridor that leads outside. It can have a door name and an assembly point.' },
    { term: 'Door', meaning: 'Where a room opens onto a corridor. A room with no door opens onto every corridor cell beside it.' },
    { term: w.One, meaning: 'One slot of the school day. The school picks the word: Period, Mod, Block or Hour.' + own },
    { term: 'Day type', meaning: 'A named pattern of the day: which classes meet. A day type has its own classes, or is the same as another and follows it in everything. A new project has ' + DEFAULT_DAY_TYPE_NAMES.join(' and ') + ', and a project can have up to ' + DAY_TYPES_MOST + '.' },
    { term: 'Passing time', meaning: 'The gap between the end of one ' + w.one + ' and the start of the next.' },
    { term: 'Transition', meaning: 'The movement between two ' + w.many + ' that follow each other.' },
    { term: 'Group', meaning: 'A set of students who travel together all day. It has a name, and can have a grade and a head count.' },
    { term: 'Teacher', meaning: 'A named member of staff, with a subject and one or more rooms.' },
    { term: 'Subject', meaning: 'A department. It has a code, a name and a colour. The school keeps its own list.' },
    { term: 'Load', meaning: 'How many students (or groups) cross a corridor cell.' },
    { term: 'Scenario', meaning: 'A set of trial changes to the schedule, kept apart from the real schedule until it is applied.' },
    { term: 'Finding', meaning: 'Something a check has noticed: a problem, a warning or a note.' },
    // DESIGN 11.1's words, after spec 2's
    { term: 'Bell schedule', meaning: 'Which times ring: when each ' + w.one + ' starts and ends. A day type’s own are its regular bells; another bell schedule, such as an early release, gives the same classes other times.' },
    { term: 'Regular bells', meaning: 'The bell schedule a day type rings on an ordinary day, set under Schedule › Day.' },
    { term: 'No class', meaning: 'Under a bell schedule, the ' + w.many + ' ticked No class do not meet: their rooms are kept but not used, nobody moves into them and nobody teaches in them.' },
  ];
}

// "4 minutes", "4 minutes 30 seconds", "45 seconds".
export function duration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  const parts = [];
  if (minutes > 0) parts.push(count(minutes, 'minute'));
  if (rest > 0 || minutes === 0) parts.push(rest + (rest === 1 ? ' second' : ' seconds'));
  return parts.join(' ');
}

// A number from the settings: the project's, saying the default beside it.
function setting(settings, defaults, read, say) {
  const now = read(settings);
  const was = read(defaults);
  return now === was || now === undefined ? say(was) + ' (the default)' : say(now) + ' (the default is ' + say(was) + ')';
}

// One flight of stairs, as the engines take it. The route is chosen on the
// search cost (routing.js: secondsPerStair × floors); the walking time counts
// the flight as whole cells (crowd.js's walkingSeconds). Both are asked of the
// engines on a route of two cells joined by one connection `levels` floors
// long, so a change to either rule changes Help with it.
export function stairsFlight(settings, levels) {
  const nodeOfCell = (node) => Int32Array.of(node);
  const base = {
    count: 2,
    floors: [{ id: 'low', level: 0, nodeOfCell: nodeOfCell(0) }, { id: 'high', level: levels, nodeOfCell: nodeOfCell(1) }],
    floorIndex: new Map([['low', 0], ['high', 1]]),
    nodeFloor: Int32Array.of(0, 1),
    neighbours: new Int32Array(8).fill(-1),
    links: [{ id: 'flight', a: 0, b: 1, direction: 'both', levels, sameFloor: false }],
  };
  const graph = routingGraph({ settings, building: { floors: [] } }, base);
  const found = {
    ok: true,
    cells: [{ floorId: 'low', cell: 0 }, { floorId: 'high', cell: 0 }],
    connections: ['flight'],
    connectionAt: [0],
    from: { side: DOOR_SIDES[0] },
    to: { side: DOOR_SIDES[0] },
  };
  const walking = walkingSeconds(graph, found);
  const seconds = walking - 2 * graph.secondsPerCell;
  return {
    secondsPerCell: graph.secondsPerCell,
    secondsPerStair: graph.secondsPerStair,
    routeSeconds: graph.secondsPerStair * levels,
    cells: seconds / graph.secondsPerCell,
    seconds,
  };
}

// The four loads at which absolute bands 2 to 5 begin, as load.js reads them
// (its fallback included), from its own legend.
function absoluteStarts(scale) {
  return bandEdges({ ...(scale || {}), mode: 'absolute' }, 0).slice(1).map((edge) => edge.from).join(', ');
}

// The head count load.js and crowd.js give a group that has none.
function headCountUsed(settings, defaults) {
  const value = settings ? settings.defaultHeadCount : undefined;
  return Number.isInteger(value) && value >= 1 ? value : defaults.defaultHeadCount;
}

// How load, travel time and late are worked out: ARCHITECTURE 6.1 to 6.3 in
// plain words. `uses` names every setting a sentence takes a number from, as
// a path into the settings, so the Node test can hold them to the engines.
export function numbers(settings) {
  const defaults = defaultSettings();
  const s = settings || defaults;
  const w = periodWords(s);
  const seconds = (n) => n + (n === 1 ? ' second' : ' seconds');
  const students = (n) => count(n, 'student');
  const head = headCountUsed(s, defaults);
  const mode = (scale) => (scale && scale.mode === 'absolute' ? 'absolute' : 'relative');
  const one = stairsFlight(s, 1);
  const two = stairsFlight(s, 2);
  const oneWas = stairsFlight(defaults, 1);
  const speeds = (x) => (x === s ? one : oneWas);
  return [
    {
      id: 'load',
      title: 'Load',
      uses: ['defaultHeadCount', 'colourScale.mode', 'colourScale.bands'],
      sentences: [
        'Load is how many students cross a cell of corridor, or take a flight of stairs, between one ' + w.one + ' and the next. Every group that has a way through adds its head count to each cell on its way, once.',
        'A group with no head count counts as ' + setting(s, defaults, (x) => headCountUsed(x, defaults), students) + ': Default head count, in Project › Settings. When no group has a head count, load counts groups instead, each group as 1.',
        'Busiest is a cell’s load in its busiest transition of the day. Total adds up every transition.',
        'The map colours cells in ' + LOAD_BANDS + ' bands, quiet to busy. The colour scale is ' + setting(s, defaults, (x) => mode(x.colourScale), (v) => v) + '. Relative splits the busiest load on screen into fifths. Absolute starts bands 2 to 5 at the loads you set: ' + setting(s, defaults, (x) => absoluteStarts(x.colourScale), (v) => v) + '.',
        'Cells inside a Leave out zone are counted, but not coloured and not ranked among the hotspots.',
      ],
    },
    {
      id: 'travel',
      title: 'Travel time',
      uses: ['secondsPerCell', 'secondsPerStair', 'defaultHeadCount'],
      sentences: [
        'A route is the quickest way from the door of one room to the door of the next. It is chosen on ' + setting(s, defaults, (x) => speeds(x).secondsPerCell, seconds) + ' for each cell of corridor (Seconds per corridor cell), and ' + setting(s, defaults, (x) => speeds(x).secondsPerStair, seconds) + ' on stairs for each floor climbed or descended (Seconds per stair connection). Between two equally quick ways, the one with fewer turns is taken, then the one with fewer stairs, so the same building always gives the same route.',
        'Walking time is that route with the corridors empty, and it counts each flight of stairs as whole cells: a flight of one floor is ' + count(one.cells, 'cell') + ', ' + seconds(one.seconds) + ', and a flight of two floors ' + count(two.cells, 'cell') + ', ' + seconds(two.seconds) + '. The crowd model then walks every group at once, one second at a time. A group walks as a column one cell long for every ' + students(STUDENTS_PER_LANE_CELL) + ', so a group of ' + head + ' is ' + count(columnLength(head), 'cell') + ' long.',
        'People keep right, so groups going opposite ways pass each other. A group waits while the cell ahead of it in its lane is taken, for as long as that takes. A left turn across oncoming walkers waits for a gap in them, but for no more than ' + seconds(CROSSING_WAIT_MAX) + ' at one crossing; after that it turns as soon as the cell ahead is free.',
        'Travel time is walking time plus waiting time. Each second of waiting is charged to the cell or the flight of stairs the group was trying to enter, which is the estimated delay Hotspots gives for a place.',
        'A teacher’s walk between rooms is timed with the corridors empty, and the screen says so.',
      ],
    },
    {
      id: 'late',
      title: 'Late',
      uses: ['defaultPassingSeconds', 'checks.passingMarginSeconds'],
      sentences: [
        'The passing time comes from the bells: from the end of one ' + w.one + ' to the start of the next. Where the bells give no gap, because a time is missing or the next ' + w.one + ' starts no later than this one ends, the default passing time is used: ' + setting(s, defaults, (x) => x.defaultPassingSeconds, duration) + ', in Project › Settings.',
        'A group is late when its travel time is more than the passing time plus the passing margin: ' + setting(s, defaults, (x) => (x.checks ? x.checks.passingMarginSeconds : undefined), seconds) + ', under Checks in Project › Settings.',
        'A group still walking at ' + CAP_FACTOR + ' times the passing time, or after ' + duration(CAP_MINIMUM_SECONDS) + ' if that is longer, is stopped, reported as did not arrive, and counted as late.',
      ],
    },
  ];
}

function says(entry, w) {
  return typeof entry === 'function' ? entry(w) : entry;
}

export function helpModel(options) {
  const settings = (options && options.settings) || defaultSettings();
  const w = periodWords(settings);
  const rail = (options && options.sections) || [];
  const rows = (options && options.shortcuts) || [];
  const currentId = options && options.current;
  const sections = rail.map((section) => {
    const help = SECTION_HELP[section.id];
    return {
      id: section.id,
      name: section.name,
      key: section.key,
      purpose: help ? says(help.purpose, w) : NOTHING_WRITTEN,
      first: help ? says(help.first, w) : '',
      more: help ? says(help.more, w) : '',
      here: section.id === currentId,
      written: Boolean(help),
    };
  });
  const groups = [];
  for (const row of rows) if (!groups.includes(row.group)) groups.push(row.group);
  return {
    current: sections.find((section) => section.here) || null,
    sections,
    keys: {
      guard: GUARD,
      rows: rows.slice(),
      groups: groups.map((group) => ({ group, says: Object.hasOwn(SHORTCUT_GROUPS, group) ? SHORTCUT_GROUPS[group] : NOTHING_WRITTEN, written: Object.hasOwn(SHORTCUT_GROUPS, group) })),
    },
    gestures: gestures(),
    words: words(settings),
    numbers: numbers(settings),
  };
}
