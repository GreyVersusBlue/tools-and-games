// Time is a season index (ARCHITECTURE 2.3): 0 is the first spring of calendar.base.
// A calendar lists the seasons that are played, cut into acts. Three acts is a
// calendar with gaps; the full run is one act with none. Same rule for both.

export const SEASONS = ['spring', 'summer', 'autumn', 'winter'];

export function seasonName(index) {
  return SEASONS[index % 4];
}

export function year(calendar, index) {
  return calendar.base + Math.floor(index / 4);
}

function lengthOf(calendar, length) {
  const l = calendar.lengths?.[length];
  if (!l) throw new Error(`calendar has no length "${length}"`);
  return l;
}

/** Every season index played in this length, in order. */
export function playedSeasons(calendar, length) {
  const out = [];
  for (const act of lengthOf(calendar, length).acts) {
    if (!(act.to >= act.from)) throw new Error(`calendar act ${act.from}..${act.to} runs backwards`);
    for (let i = act.from; i <= act.to; i++) out.push(i);
  }
  for (let i = 1; i < out.length; i++) {
    if (out[i] <= out[i - 1]) throw new Error('calendar acts overlap or are out of order');
  }
  return out;
}

export function seasonIndex(state, content) {
  const i = playedSeasons(content.calendar, state.length)[state.t];
  if (i === undefined) throw new Error(`t ${state.t} is past the end of the calendar`);
  return i;
}

/** The act (1, 2, ...) a season belongs to. Acts come from the "acts" length when the
    calendar has one, so the full run still knows which act a season sits in; a season in a
    gap belongs to the act that comes next. Past the last act it is the last. */
/** The acts (from, to) every rule that asks "which act" reads: the "acts" length when the
    calendar has one, so the full run numbers its acts the way the three-act run does. */
function actList(calendar, length) {
  return (calendar.lengths.acts ?? lengthOf(calendar, length)).acts;
}

/** The act (1, 2, ...) a season belongs to. A season in a gap belongs to the act that comes
    next. Past the last act it is the last. */
export function actOfSeason(calendar, length, idx) {
  const acts = actList(calendar, length);
  const k = acts.findIndex(a => idx <= a.to);
  return (k === -1 ? acts.length - 1 : k) + 1;
}

export function actOf(state, content) {
  return actOfSeason(content.calendar, state.length, seasonIndex(state, content));
}

/** True when state.t is the calendar's final played season. */
export function isLastSeason(state, content) {
  return state.t === playedSeasons(content.calendar, state.length).length - 1;
}

/** Position of the current season inside its act, as { i, of } (0-based i), for the
    "second half of an act" rule. Acts are numbered as actOf numbers them, in both lengths
    (MER-07): the full game's eleven seasons are not one long act. A gap season (full length
    only) belongs to the next act and sits before its first season, so i is 0 there. */
export function actPosition(state, content) {
  const idx = seasonIndex(state, content);
  const acts = actList(content.calendar, state.length);
  const k = acts.findIndex(a => idx <= a.to);
  const act = acts[k === -1 ? acts.length - 1 : k];
  return { i: Math.max(0, idx - act.from), of: act.to - act.from + 1 };
}
