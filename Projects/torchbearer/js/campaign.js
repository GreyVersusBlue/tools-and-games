// campaign.js — the campaign record: an ordered list of adventures, the flags
// they leave behind them, and the gates that read those flags.
//
// Before this, `snapshot()` held one `advId` and one `sceneId`, `startAdventure`
// did `this.flags = {}`, and finishing an adventure called `toTitle()`. Nothing
// an author could write connected two adventures, and nothing in a save
// remembered that the first one had happened. That is the difference between an
// engine that runs a one-shot and one that runs a table's year.
//
// Two scopes, one grammar (locked decision #121). A flag named `met-maud` is the
// running adventure's, in `App.flags`, and dies with it. A flag named
// `barrowmoor/met-maud` is the campaign's, in `App.campaignFlags`, and was
// folded there when Barrowmoor ended. `flagOk` reads whichever scope the name
// asks for, so a scene's `"if"` and a campaign entry's `"if"` are the same
// expression language and two adventures that both use `knows-name` cannot
// collide.
//
// Nothing here touches the DOM, the Registry or a save. It takes the campaign
// object and the two saved fields and returns plain data, so `test/smoke.mjs`
// drives a whole campaign under plain Node.

/** The separator that makes a flag name a campaign-scoped one. */
export const SCOPE = "/";

/** `barrowmoor` + `bell-answered` → `barrowmoor/bell-answered`. */
export function scopedFlag(advId, flag) { return `${advId}${SCOPE}${flag}`; }

/** True for a name that reads the campaign record rather than the running adventure. */
export function isScoped(name) { return typeof name === "string" && name.includes(SCOPE); }

/**
 * `App.award` writes `awarded:<key>` into the adventure's flags so a fight
 * reached twice pays once (locked #116). That is bookkeeping for one run, not
 * something a later adventure should ever gate on, so the fold drops it.
 */
export const BOOKKEEPING = /^awarded:/;

/**
 * Every flag name an adventure's own data is able to set: a scene's
 * `onEnter.flag` and a choice's `flagOnce`. Sorted, so a validator message
 * listing them reads the same way twice.
 */
export function flagsSetBy(adv) {
  const out = new Set();
  Object.values((adv && adv.scenes) || {}).forEach(sc => {
    if (sc && sc.onEnter && sc.onEnter.flag) out.add(sc.onEnter.flag);
    ((sc && sc.choices) || []).forEach(c => { if (c && c.flagOnce) out.add(c.flagOnce); });
  });
  return [...out].sort();
}

/**
 * Fold one finished adventure's flat flag map into the campaign record, under
 * `<advId>/<flag>`. Returns a new object; the caller's maps are not touched.
 */
export function foldFlags(advId, flags, into) {
  const out = { ...(into || {}) };
  Object.keys(flags || {}).forEach(k => {
    if (!flags[k] || BOOKKEEPING.test(k)) return;
    out[scopedFlag(advId, k)] = true;
  });
  return out;
}

/**
 * The one flag expression in the game. A leading `!` negates; a name carrying a
 * `/` reads `campaign`, and anything else reads `local`. An absent expression is
 * an open gate, which is what an ungated campaign entry and an ungated choice
 * both want.
 */
export function flagOk(expr, local, campaign) {
  if (!expr) return true;
  const neg = expr.startsWith("!");
  const name = neg ? expr.slice(1) : expr;
  const map = isScoped(name) ? campaign : local;
  const v = !!(map && map[name]);
  return neg ? !v : v;
}

/**
 * A campaign's entries, in order. An entry is an object — never a bare id
 * string (locked decision #120) — so `{"adventure": "x"}` has somewhere to grow
 * an `if` and a `locked` line later without a second shape to parse.
 */
export function entriesOf(campaign) {
  const list = campaign && campaign.adventures;
  return Array.isArray(list) ? list.filter(e => e && typeof e.adventure === "string") : [];
}

/**
 * One row per entry, in order: which adventure, whether the save says it is
 * finished, and whether its gate is open. `state` is `{completed, campaignFlags}`
 * — the two save fields, nothing else.
 */
export function progress(campaign, state) {
  const done = new Set(Array.isArray(state && state.completed) ? state.completed : []);
  const cf = (state && state.campaignFlags) || {};
  return entriesOf(campaign).map((e, index) => ({
    index,
    advId: e.adventure,
    gate: e.if || null,
    locked: e.locked || null,
    done: done.has(e.adventure),
    open: flagOk(e.if, {}, cf)
  }));
}

/** The first entry that is open and not yet finished, or null. */
export function nextAdventure(campaign, state) {
  const row = progress(campaign, state).find(r => r.open && !r.done);
  return row ? row.advId : null;
}

/**
 * Nothing left that the hero could walk into. A locked entry counts as done
 * with, not as owed: a campaign with a branch the run never opened is finished
 * when its open branch is, and the board still shows the locked road and why.
 */
export function isComplete(campaign, state) {
  const rows = progress(campaign, state);
  return rows.length > 0 && !rows.some(r => r.open && !r.done);
}
