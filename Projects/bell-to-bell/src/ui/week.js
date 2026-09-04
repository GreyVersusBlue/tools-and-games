import { dom } from './dom.js';
import { pickEnding } from './report.js';

// Phase 3 — THE FRIDAY REPORT. Five days of meters and three lines about what
// changed, on the report screen's card and its rubric lines, with none of the
// period report's logic: everything in here is read off a weekSummary().
// Titles are the same four endings-by-meter-shape the period report uses,
// read off the week's means instead of one bell, which is the first time
// they have had anything longitudinal to read.
const fmt = v => (Number.isFinite(v) ? String(Math.round(v)) : '—');
const fill = (s, vars) => Object.entries(vars).reduce((t, [k, v]) => t.replaceAll(`{${k}}`, v), s);
// Mastery gets a wider "flat" band than Fidelity: Monday's classes walk in
// fresh at CFG.start and close high, so a good week reads a few points down
// from Monday without anything having been lost.
const trend = (from, to, band) => (to - from > band ? 'Up' : from - to > band ? 'Down' : 'Flat');

export function showWeek(summary, { admin, endings, district }, restart) {
  const W = admin.week, L = W.lines;
  const rungById = Object.fromEntries(admin.escalation.ladder.map(r => [r.id, r]));

  const ending = pickEnding({
    mastery: summary.means.mastery ?? 0, fidelity: summary.means.fidelity ?? 0,
    rapport: summary.means.rapport ?? 0, bandwidth: summary.means.bandwidth ?? 100
  }, endings);

  const head = `<div class="rubricline weekhead"><b>${W.columns.day}</b>` +
    `<span class="mono">${[W.columns.mastery, W.columns.fidelity, W.columns.rapport, W.columns.missed, W.columns.admin].join(' · ')}</span></div>`;
  const rows = summary.days.map(d => {
    const rung = d.admin ? (rungById[d.admin]?.label || d.admin) : '—';
    return `<div class="rubricline"><b>${admin.shortDays[d.day] || d.day}</b>` +
      `<span class="mono">${fmt(d.mastery)} · ${fmt(d.fidelity)} · ${fmt(d.rapport)} · ${d.missed} · ${rung}</span></div>`;
  }).join('');
  const means = `<div class="rubricline"><b>${W.means}</b>` +
    `<span class="mono">${fmt(summary.means.mastery)} · ${fmt(summary.means.fidelity)} · ${fmt(summary.means.rapport)} · ${summary.missed} · ${summary.rungs.length ? summary.rungs.map(id => rungById[id]?.label || id).join(', ') : '—'}</span></div>`;

  const quotes = [];
  if (summary.from && summary.to) {
    const m = { from: fmt(summary.from.mastery), to: fmt(summary.to.mastery) };
    quotes.push(fill(L['mastery' + trend(summary.from.mastery, summary.to.mastery, 6)], m));
    const f = { from: fmt(summary.from.fidelity), to: fmt(summary.to.fidelity), district: fmt(district) };
    quotes.push(fill(L['fidelity' + trend(summary.from.fidelity, summary.to.fidelity, 3)], f));
  }
  const learned = summary.learned;
  quotes.push(learned.edges + learned.steadies
    ? fill(L.learned, { edges: learned.edges, edgesS: learned.edges === 1 ? '' : 's',
        steadies: learned.steadies, steadiesS: learned.steadies === 1 ? '' : 's' })
    : L.learnedNothing);
  if (summary.curveballs) quotes.push(fill(L.curveballs, { n: summary.curveballs, nS: summary.curveballs === 1 ? '' : 's' }));
  for (const id of summary.rungs) if (rungById[id]?.report) quotes.push(rungById[id].report);
  if (!summary.rungs.length) quotes.push(admin.escalation.clear);

  dom.endTitle.textContent = ending.title;
  dom.endSub.textContent = `${ending.sub} — ${fill(W.sub, { week: summary.week, days: summary.days.length, periods: summary.periods })}`;
  dom.endBody.innerHTML = head + rows + means +
    '<div style="height:16px"></div>' +
    quotes.map(q => `<div class="quote">${q}</div>`).join('') +
    `<button class="cta" id="weekBtn">${restart.label}</button>`;
  dom.endScreen.classList.remove('hide');
  document.getElementById('weekBtn').addEventListener('click', restart.onClick);
}
