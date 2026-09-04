import { dom } from './dom.js';

export function pickEnding(state, endings) {
  for (const e of endings) {
    const w = e.when;
    if (!w || Object.keys(w).length === 0) return e;
    const ok =
      (w.masteryAbove   == null || state.mastery   > w.masteryAbove) &&
      (w.masteryBelow   == null || state.mastery   < w.masteryBelow) &&
      (w.fidelityAbove  == null || state.fidelity  > w.fidelityAbove) &&
      (w.fidelityBelow  == null || state.fidelity  < w.fidelityBelow) &&
      (w.rapportAbove   == null || state.rapport   > w.rapportAbove) &&
      (w.rapportBelow   == null || state.rapport   < w.rapportBelow) &&
      (w.bandwidthBelow == null || state.bandwidth < w.bandwidthBelow);
    if (ok) return e;
  }
  return endings[endings.length - 1];
}

export function tierText(value, tiers) {
  for (const [threshold, text] of tiers) if (value > threshold) return text;
  return tiers[tiers.length - 1][1];
}

// T4. The chart is the one screen where the game hands you information, so the
// report is where it earns it back: everything below is something that happened
// because of where people were sitting, and none of it was visible at the time.
function seatingLines(seat, students) {
  if (!seat || !seat.plan) return [];
  const copy = seat.copy, plan = seat.plan, out = [];
  const nameOf = i => (students[i] ? students[i].name : '');

  const counts = new Map();
  for (const sup of plan.suppressed) counts.set(sup.by, (counts.get(sup.by) || 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top) {
    const s = students[top[0]];
    out.push(copy.suppressed.replaceAll('{name}', nameOf(top[0])));
    if (s) out.push(copy.suppressedCost.replaceAll('{name}', s.name)
      .replace('{comp}', Math.round(s.comp * 100)));
  }

  const sep = plan.separated[0];
  if (sep) out.push(copy.separated.replaceAll('{name}', nameOf(sep.seat)));

  const blind = students.filter(s => s.hidden).sort((a, b) => a.comp - b.comp)[0];
  if (blind) out.push(copy.blindSeat.replaceAll('{name}', blind.name));

  const front = students.filter(s => s.row === 0).sort((a, b) => b.comp - a.comp);
  const rest = students.filter(s => s.row !== 0);
  const mean = arr => arr.reduce((a, b) => a + b.comp, 0) / (arr.length || 1);
  if (front.length && mean(front) > mean(rest) + 0.015) {
    out.push(copy.frontRow.replace('{names}', front.map(s => s.name).join(', ')));
  }
  return out.slice(0, 4);        // the report is a rubric, not a novel
}

export function showReport(state, data, extra = {}) {
  const ending = pickEnding(state, data.endings);
  const ls = extra.lesson;
  const students = extra.students || [];

  const rows = data.reportLines.map(line => {
    const v = Math.round(state[line.key]);
    return `<div class="rubricline"><b>${line.label}</b>` +
      `<span style="text-align:right"><span class="mono">${v}</span><br>` +
      `${tierText(state[line.key], line.tiers)}</span></div>`;
  }).join('');

  const seat = extra.seating;
  const seatRow = seat ? `<div class="rubricline"><b>Seating</b>` +
    `<span style="text-align:right"><span class="mono">${state.rechart?.moved ?? 0} moved</span><br>` +
    `${seat.plan.suppressed.length} never happened \u00B7 ${seat.plan.separated.length} found another way` +
    `</span></div>` : '';

  const lessonRow = ls ? `<div class="rubricline"><b>Lesson delivered</b>` +
    `<span style="text-align:right"><span class="mono">${ls.delivered}/${ls.total}</span><br>` +
    `${state.checks} check${state.checks === 1 ? '' : 's'} for understanding \u00B7 ` +
    `${state.reteaches} reteach${state.reteaches === 1 ? '' : 'es'}</span></div>` : '';

  // Phase 2: only present on a class nobody authored.
  const seed = extra.seed;
  const seedRow = seed ? `<div class="rubricline"><b>${seed.copy.label}</b>` +
    `<span style="text-align:right"><span class="mono">${seed.value}</span><br>` +
    `${seed.copy.report.replace('{seed}', seed.value)}</span></div>` : '';

  // T7: only present on a period she actually visited.
  const obs = extra.observation;
  const obsRow = obs ? `<div class="rubricline"><b>${obs.copy.head}</b>` +
    `<span style="text-align:right"><span class="mono">${obs.result.satisfied.length}/${obs.result.total}</span><br>` +
    `${obs.labels.length ? obs.labels.join(' · ') : 'none of it'}</span></div>` : '';

  const c = data.closingLines;
  const quotes = [];
  const seatQuotes = seatingLines(extra.seating, students);
  if (state.sawCurveball) quotes.push(c.sawCurveball);
  if (!state.checks) quotes.push(c.neverChecked);
  if (state.rushed > 1) quotes.push(c.rushed.replace('{rushed}', state.rushed));
  if (state.reteaches) quotes.push(c.reteach.replace('{reteaches}', state.reteaches));
  if (ls && ls.delivered < ls.total) {
    quotes.push(c.unfinished.replace('{done}', ls.delivered).replace('{total}', ls.total));
  }
  const island = students.filter(s => s.comp > 0.8).sort((a, b) => b.comp - a.comp)[0];
  if (island && state.mastery < 55) quotes.push(c.greenIsland.replace('{name}', island.name));
  if (state.withitnessUses > 14) quotes.push(c.heavyScanning.replace('{uses}', state.withitnessUses));
  if (state.missed > 2) quotes.push(c.missedSeveral.replace('{missed}', state.missed));
  if (state.leverage.length) quotes.push(c.leverage.replace('{list}', state.leverage.join('; ')));
  // Phase 4: the conference is a path now, so every exchange gets its line,
  // in the order it was said.
  for (const opt of obs?.options || []) if (opt.result) quotes.push(opt.result);
  if (obs?.result?.announced) quotes.push(obs.copy.announced);
  if ((obs?.options || []).some(o => o.honest)) quotes.push(obs.copy.honest);
  for (const line of extra.followUpLines || []) quotes.push(line);
  // Phase 5: what the subject has to say. Lines, not a system.
  for (const line of extra.subjectLines || []) quotes.push(line);
  if (!quotes.length && !seatQuotes.length) quotes.push(c.quiet);
  quotes.push(...seatQuotes);

  // T6: what the button says and does is main.js's call \u2014 it's the one that
  // knows whether there's a next period or this is the last one.
  const restart = extra.restart || { label: 'Run it again', onClick: () => location.reload() };

  dom.endTitle.textContent = ending.title;
  dom.endSub.textContent =
    `${ending.sub} \u2014 ${extra.periodTag || '4TH PERIOD'} \u00B7 ${state.caught} ADDRESSED \u00B7 ${state.missed} MISSED`;
  dom.endBody.innerHTML = rows + lessonRow + obsRow + seatRow + seedRow +
    '<div style="height:16px"></div>' +
    quotes.map(q => `<div class="quote">${q}</div>`).join('') +
    `<button class="cta" id="againBtn">${restart.label}</button>`;
  dom.endScreen.classList.remove('hide');
  document.getElementById('againBtn').addEventListener('click', restart.onClick);
}
