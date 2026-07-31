// ui.js — turns state into HTML strings. No event listeners live here;
// main.js wires all interaction via event delegation on #content.

import { CONFIG, PERFORMERS, VENDORS, TIME_BLOCKS, STRUCTURE_TYPES, AD_CAMPAIGNS, CONTRACT_OPTIONS, GRID_EXPANSIONS, ENTRANCE, PLACEMENT_RULES, GROUNDS_DRAW, WEEKEND_DAY_ATTENDANCE } from './data.js';
import { performerById, vendorById, terrainAt, computePlotAttributes, quoteBuild, isLegalPlacement, effectivePerformerCost, effectiveVendorCost, isSeasonUnlocked, currentGridSize, nextGridExpansion, stallSummary, footprintFor, footprintCells, plotFootprintCells, STALL_KIND_BY_VENDOR_TYPE, totalUpkeep, computeFootTraffic, countBuiltOfKind, previewCommitAll, computeReachability, computeGroundsDraw, priceFactor, ticketRevenueIndex, priceSatisfactionDelta } from './engine.js';

const money = (n) => `$${Math.round(n).toLocaleString()}`;

export function renderLedger(state) {
  const repLabel = state.reputation >= 75 ? 'Renowned' : state.reputation >= 50 ? 'Well-regarded' : state.reputation >= 25 ? 'Modest' : 'Struggling';
  const weekendNames = ['', 'Friday', 'Saturday', 'Sunday'];
  const rep = Math.round(state.reputation);
  // Stage 19: grounds draw is the headline new mechanic, so it gets a
  // permanent slot in the HUD rather than living only in the day report.
  // A player needs to be able to watch this number move as they build.
  const draw = computeGroundsDraw(state.builtPlots);
  const drawPct = ((draw.mult - GROUNDS_DRAW.floor) / (GROUNDS_DRAW.ceiling - GROUNDS_DRAW.floor)) * 100;
  const cashClass = state.cash < 0 ? ' bad' : '';
  return `
    <div class="ledger-item" title="${weekendNames[state.weekendDay] || 'This day'}'s crowd runs ${(WEEKEND_DAY_ATTENDANCE[state.weekendDay] || 1).toFixed(2)}x the base draw, before reputation, price, or the grounds.">
      <span class="ledger-label">Weekend ${state.season}</span>
      <span class="ledger-sub">${weekendNames[state.weekendDay] || ''} &middot; Day ${state.day}</span>
    </div>
    <div class="ledger-item">
      <span class="ledger-label mono${cashClass}">${money(state.cash)}</span>
      <span class="ledger-sub">on hand</span>
    </div>
    <div class="ledger-item">
      <span class="ledger-label mono">${rep}</span>
      <span class="ledger-sub">${repLabel}</span>
      <span class="meter ${rep >= 70 ? 'is-high' : rep < 35 ? 'is-low' : ''}"><i style="width:${clampPct(rep)}%"></i></span>
    </div>
    <div class="ledger-item" title="How much of a crowd the built grounds pull on their own, before reputation, price, or the bill. An empty field sits at ${GROUNDS_DRAW.floor.toFixed(2)}x; every built stage, staffed stall, and demo camp raises it, with diminishing returns.">
      <span class="ledger-label mono">${draw.mult.toFixed(2)}&times;</span>
      <span class="ledger-sub">grounds draw</span>
      <span class="meter ${drawPct >= 66 ? 'is-high' : drawPct < 12 ? 'is-low' : ''}"><i style="width:${clampPct(drawPct)}%"></i></span>
    </div>
  `;
}

function clampPct(n) { return Math.max(0, Math.min(100, Math.round(n))); }

export function renderTabs(activeTab, phase) {
  if (phase !== 'plan') return '';
  const tabs = [
    { id: 'office', label: 'Office' },
    { id: 'backstage', label: 'Backstage' },
    { id: 'fairfloor', label: 'Fair Floor' },
  ];
  return tabs.map(t => `<button class="tab-btn${t.id === activeTab ? ' active' : ''}" data-tab="${t.id}">${t.label}</button>`).join('');
}

export function renderOffice(state, warn) {
  const rosterCost = state.roster.reduce((s, id) => s + effectivePerformerCost(state, id), 0);
  const vendorCost = state.hiredVendors.reduce((s, id) => s + effectiveVendorCost(state, id), 0);
  const overhead = CONFIG.baseOverhead;
  const upkeep = totalUpkeep(state.builtPlots);
  const fixedNut = rosterCost + vendorCost + upkeep + overhead;
  // Stage 19: with a per-guest cost in play, the useful thing to tell the
  // player is not just "what you owe" but "how many people have to walk
  // through the gate before you stop losing money" — the break-even gate.
  const perGuestMargin = state.ticketPrice - CONFIG.perGuestCost;
  const breakEven = perGuestMargin > 0 ? Math.ceil(fixedNut / perGuestMargin) : null;
  const satDelta = priceSatisfactionDelta(state.ticketPrice);

  return `
    <section class="panel">
      <h2>The Ledger Desk</h2>
      <p class="flavor">Set today's admission and see what the books say you're carrying.</p>
      ${warn ? `<p class="warn">${warn}</p>` : ''}

      <div class="field-row">
        <label for="ticketPrice">Ticket price</label>
        <input type="range" id="ticketPrice" min="${CONFIG.ticketPrice.min}" max="${CONFIG.ticketPrice.max}" value="${state.ticketPrice}">
        <span class="price-readout" id="priceReadout">${money(state.ticketPrice)}</span>
      </div>
      ${renderPriceCurve(state)}
      <p class="hint">${priceAdvice(state.ticketPrice, satDelta)}</p>

      <table class="ledger-table">
        <tr><td>Contracted performers</td><td class="mono">${money(rosterCost)}/day</td></tr>
        <tr><td>Hired stalls</td><td class="mono">${money(vendorCost)}/day</td></tr>
        <tr><td>Plot upkeep <span class="hint">(${Math.round(CONFIG.upkeepRate * 100)}% of build cost, staffed or not)</span></td><td class="mono">${money(upkeep)}/day</td></tr>
        <tr><td>Grounds overhead</td><td class="mono">${money(overhead)}/day</td></tr>
        <tr class="total-row"><td>Fixed nut before a single ticket sells</td><td class="mono">${money(fixedNut)}</td></tr>
      </table>
      <table class="ledger-table">
        <tr><td>Cost per guest through the gate <span class="hint">(water, waste, gate staff, per-head insurance)</span></td><td class="mono">${money(CONFIG.perGuestCost)}</td></tr>
        <tr><td>Margin per guest at ${money(state.ticketPrice)} admission</td><td class="mono ${perGuestMargin > 0 ? '' : 'neg'}">${money(perGuestMargin)}</td></tr>
        <tr class="total-row"><td>Break-even gate</td><td class="mono">${breakEven === null ? 'never at this price' : `${breakEven.toLocaleString()} guests`}</td></tr>
      </table>
      <p class="hint">Stall revenue lands on top of that and can carry a thin gate \u2014 but only from stalls that actually have a vendor seated in them.</p>

      ${renderMarketing(state)}
    </section>
  `;
}

// A sparkline of the real ticket-revenue-per-guest curve the simulation
// uses, with the player's current price and the curve's peak both marked.
// The point is to make the shape visible: through Stage 18 this curve rose
// all the way to the maximum price, so the slider had one correct answer
// and no reason to exist. Showing the curve is how a player learns it
// doesn't any more.
function renderPriceCurve(state) {
  const bars = [];
  let peak = CONFIG.ticketPrice.min;
  for (let p = CONFIG.ticketPrice.min; p <= CONFIG.ticketPrice.max; p++) {
    if (ticketRevenueIndex(p) > ticketRevenueIndex(peak)) peak = p;
  }
  const max = ticketRevenueIndex(peak);
  for (let p = CONFIG.ticketPrice.min; p <= CONFIG.ticketPrice.max; p++) {
    const h = Math.max(4, Math.round((ticketRevenueIndex(p) / max) * 100));
    const cls = p === state.ticketPrice ? 'at' : p === peak ? 'peak' : '';
    bars.push(`<i class="${cls}" style="height:${h}%" title="${money(p)} \u2014 gate takings index ${(ticketRevenueIndex(p) / max * 100).toFixed(0)}"></i>`);
  }
  return `
    <div class="price-panel">
      <div class="price-curve" title="Gate takings per guest across the price range. Green marks the peak; gold marks where you are.">${bars.join('')}</div>
      <div class="price-axis">
        <span>${money(CONFIG.ticketPrice.min)}</span>
        <span>gate takings per guest &middot; peak at <b>${money(peak)}</b></span>
        <span>${money(CONFIG.ticketPrice.max)}</span>
      </div>
    </div>`;
}

function priceAdvice(price, satDelta) {
  if (satDelta <= -6) return `Steep. The gate takes more per head, but the crowd notices \u2014 roughly ${Math.abs(Math.round(satDelta))} points off the day's mood, and mood is what reputation is built from.`;
  if (satDelta >= 3) return `A bargain gate. Thin margins today, but the crowd arrives happy and word travels.`;
  return `About what folk expect to pay. Sliding either way trades cash against goodwill.`;
}

// One campaign runs at a time (non-stacking). A card shows what it costs
// and does; once launched it shows a running countdown, and once it ends
// it shows a cooldown countdown before that same campaign can fire again.
function renderMarketing(state) {
  const cards = AD_CAMPAIGNS.map(c => {
    if (!isSeasonUnlocked(state, c.unlockSeason)) {
      return `
        <div class="campaign-card locked">
          <div class="campaign-head"><strong>${c.name}</strong><span class="mono">?</span></div>
          <p class="flavor">A bigger campaign than the faire can arrange yet.</p>
          <span class="hint-tag">Unlocks in Weekend ${c.unlockSeason}</span>
        </div>`;
    }
    const isActive = state.activeCampaign?.id === c.id;
    const cooldown = state.campaignCooldowns[c.id] || 0;
    const disabled = !!state.activeCampaign || cooldown > 0;
    let status = '';
    if (isActive) {
      const d = state.activeCampaign.daysRemaining;
      status = `<span class="campaign-tag running">running \u2014 ${d} day${d === 1 ? '' : 's'} left</span>`;
    } else if (cooldown > 0) {
      status = `<span class="campaign-tag cooldown">cooldown \u2014 ${cooldown} day${cooldown === 1 ? '' : 's'}</span>`;
    }
    return `
      <div class="campaign-card${isActive ? ' is-active' : ''}">
        <div class="campaign-head"><strong>${c.name}</strong><span class="mono">${money(c.cost)}</span></div>
        <p class="flavor">${c.desc}</p>
        <p class="hint mono">+${Math.round((c.attendanceMult - 1) * 100)}% draw for ${c.durationDays} day${c.durationDays === 1 ? '' : 's'}</p>
        ${status}
        <button class="btn small" data-action="launchCampaign" data-id="${c.id}" ${disabled ? 'disabled' : ''}>Launch</button>
      </div>`;
  }).join('');
  return `
    <h3>Marketing</h3>
    <p class="hint">One campaign at a time \u2014 launching one costs cash up front and boosts attendance while it runs.</p>
    <div class="campaign-grid">${cards}</div>
  `;
}

// Stage 10: "N/M filled" tracker — shows how many committed stalls of each
// kind actually have a vendor seated, so it's obvious at a glance whether
// there's room to hire, and whether any already-hired vendor is sitting
// idle. This is also what makes the hard hire cap (see state.js's
// hireVendor) legible instead of just a rejected click.
function renderStallSummary(state) {
  const summary = stallSummary(state);
  const gauge = (label, kind) => {
    const { filled, total } = summary[kind];
    const full = total > 0 && filled >= total;
    return `<div class="stall-gauge${full ? ' full' : ''}">${label} <span class="mono">${filled}/${total} filled</span></div>`;
  };
  return `
    <div class="stall-summary">
      ${gauge('Food Stalls', 'food')}
      ${gauge('Craft Stalls', 'vendor')}
      <button class="btn small" data-action="autoFillStalls">Auto-Fill Stalls</button>
    </div>
  `;
}

export function renderBackstage(state, warn) {
  const rows = PERFORMERS.map(p => {
    const contracted = state.roster.includes(p.id);
    const quirkLabel = p.quirk ? `<span class="quirk-tag" title="${quirkDesc(p.quirk)}">${quirkTitle(p.quirk)}</span>` : '';
    const costCell = contracted ? `${money(effectivePerformerCost(state, p.id))}/day` : `${money(p.cost)}/day`;
    let actionCell;
    if (contracted) {
      const contract = state.contracts[p.id];
      const option = CONTRACT_OPTIONS[contract.contractId];
      const lockNote = contract.commitDaysRemaining > 0
        ? `<span class="warn-tag" title="Releasing before the commitment ends charges a cancellation fee">${option.label} \u2014 ${contract.commitDaysRemaining} day${contract.commitDaysRemaining === 1 ? '' : 's'} left</span>`
        : `<span class="hint-tag">${option.label}</span>`;
      actionCell = `${lockNote}<br><button class="btn small danger" data-action="release" data-id="${p.id}">Release</button>`;
    } else {
      const buttons = Object.values(CONTRACT_OPTIONS)
        .filter(opt => isSeasonUnlocked(state, opt.unlockSeason))
        .map(opt => {
          const rate = Math.round(p.cost * opt.priceMult);
          const label = opt.priceMult < 1 ? `${opt.label} (${money(rate)}/day)` : opt.label;
          return `<button class="btn small" data-action="contract" data-id="${p.id}" data-contract="${opt.id}">${label}</button>`;
        }).join('');
      const nextUnlock = Object.values(CONTRACT_OPTIONS)
        .filter(opt => !isSeasonUnlocked(state, opt.unlockSeason))
        .sort((a, b) => a.unlockSeason - b.unlockSeason)[0];
      const lockedHint = nextUnlock ? `<br><span class="hint-tag">${nextUnlock.label} unlocks Weekend ${nextUnlock.unlockSeason}</span>` : '';
      actionCell = buttons + lockedHint;
    }
    return `
      <tr class="${contracted ? 'is-contracted' : ''}">
        <td>${p.name}${quirkLabel}</td>
        <td class="mono">${p.role}</td>
        <td class="mono stars">${'\u2605'.repeat(Math.round(p.popularity / 2))}</td>
        <td class="mono">${costCell}</td>
        <td>${actionCell}</td>
      </tr>`;
  }).join('');

  const summary = stallSummary(state);
  const footTraffic = computeFootTraffic(state.builtPlots);
  const vendorRows = VENDORS.map(v => {
    const hired = state.hiredVendors.includes(v.id);
    const costCell = hired ? `${money(effectiveVendorCost(state, v.id))}/day` : `${money(v.cost)}/day`;
    let actionCell;
    if (hired) {
      const contract = state.vendorContracts[v.id];
      const option = CONTRACT_OPTIONS[contract.contractId];
      const lockNote = contract.commitDaysRemaining > 0
        ? `<span class="warn-tag" title="Letting them go before the commitment ends charges a cancellation fee">${option.label} \u2014 ${contract.commitDaysRemaining} day${contract.commitDaysRemaining === 1 ? '' : 's'} left</span>`
        : `<span class="hint-tag">${option.label}</span>`;
      const seatedPlot = state.builtPlots.find(p => p.assignedVendorId === v.id);
      const trafficTag = seatedPlot && footTraffic[seatedPlot.id]
        ? ` <span class="mono" title="Foot traffic here vs. the grounds\u2019 average staffed stall today">${footTraffic[seatedPlot.id].mult.toFixed(2)}x traffic</span>`
        : '';
      const seatNote = seatedPlot
        ? `<span class="hint-tag" title="Currently selling from this stall">seated: ${seatedPlot.name}</span>${trafficTag}`
        : `<span class="warn-tag" title="Hired and drawing wages, but not selling anything today">not seated \u2014 earning nothing</span>`;
      actionCell = `${lockNote} ${seatNote}<br><button class="btn small danger" data-action="fireVendor" data-id="${v.id}">Let go</button>`;
    } else {
      const stallKind = STALL_KIND_BY_VENDOR_TYPE[v.type];
      const kindLabel = v.type === 'food' ? 'food' : 'craft';
      const { filled, total } = summary[stallKind];
      if (filled >= total) {
        actionCell = total === 0
          ? `<span class="warn-tag">Build a ${kindLabel} stall first</span>`
          : `<span class="warn-tag">No open ${kindLabel} stalls</span>`;
      } else {
        const buttons = Object.values(CONTRACT_OPTIONS)
          .filter(opt => isSeasonUnlocked(state, opt.unlockSeason))
          .map(opt => {
            const rate = Math.round(v.cost * opt.priceMult);
            const label = opt.priceMult < 1 ? `${opt.label} (${money(rate)}/day)` : opt.label;
            return `<button class="btn small" data-action="hireVendor" data-id="${v.id}" data-contract="${opt.id}">${label}</button>`;
          }).join('');
        const nextUnlock = Object.values(CONTRACT_OPTIONS)
          .filter(opt => !isSeasonUnlocked(state, opt.unlockSeason))
          .sort((a, b) => a.unlockSeason - b.unlockSeason)[0];
        const lockedHint = nextUnlock ? `<br><span class="hint-tag">${nextUnlock.label} unlocks Weekend ${nextUnlock.unlockSeason}</span>` : '';
        actionCell = buttons + lockedHint;
      }
    }
    return `
      <tr class="${hired ? 'is-contracted' : ''}">
        <td>${v.name}</td>
        <td class="mono">${v.type}</td>
        <td class="mono stars">${'\u2605'.repeat(Math.round(v.quality / 2))}</td>
        <td class="mono">${costCell}</td>
        <td>${actionCell}</td>
      </tr>`;
  }).join('');

  return `
    <section class="panel">
      <h2>The Tiring House</h2>
      <p class="flavor">Contract the acts who'll carry the day, and staff for the stalls you've built.</p>
      <p class="hint">Day Rate has no commitment \u2014 release anytime for free. Weekend Package is cheaper per day but locks the act in; breaking it early costs a fee.</p>
      ${warn ? `<p class="warn">${warn}</p>` : ''}
      <table class="roster-table">
        <thead><tr><th>Performer</th><th>Role</th><th>Draw</th><th>Cost</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>

      <h3>Vendors &amp; Stalls</h3>
      <p class="hint">Stalls only sell if you've built the plot for them on the Fair Floor first, hired a matching vendor, and seated them there \u2014 hiring auto-seats them into an open stall, but check Fair Floor if you've been moving people around.</p>
      ${renderStallSummary(state)}
      <table class="roster-table">
        <thead><tr><th>Vendor</th><th>Type</th><th>Quality</th><th>Cost</th><th></th></tr></thead>
        <tbody>${vendorRows}</tbody>
      </table>
    </section>
  `;
}

// Real coordinate grid: terrain cells + built-plot markers overlaid at their
// (x,y). Built markers are inert divs (tooltip shows computed stats). When
// `pendingBuild` (a structure kind, or null) is set, every open cell also
// gets a ghost button quoting cost via quoteBuild() — clicking one fires
// data-action="placeAt" through the same delegation main.js already uses.
// `pendingMove` (Stage 10): { plotId, kind } while relocating an existing
// plot (planning or built) — reuses the exact same ghost-cell mechanism as
// fresh placement, just excluding the plot's own current cell (so it's a
// legal target for a same-cell no-op, though there's little reason to) and
// wiring ghosts to `moveTo` instead of `placeAt`.
function renderGroundsMap(state, pendingBuild, pendingMove, footTraffic, reachability) {
  // Stage 8: only render the grounds the player has actually reached — the
  // full TERRAIN_ROWS/GRID extent is authored ahead of time, but cells past
  // the current fence line (see currentGridSize) aren't shown or buildable
  // yet. The map footprint (and the CSS grid it sits in) simply grows once
  // a new GRID_EXPANSIONS tier unlocks.
  const size = currentGridSize(state);
  const cells = [];
  for (let y = 0; y < size.rows; y++) {
    for (let x = 0; x < size.cols; x++) {
      const terrain = terrainAt(x, y) || 'clearing';
      cells.push(`<div class="terrain-cell" data-terrain="${terrain}" style="grid-column:${x + 1};grid-row:${y + 1};"></div>`);
    }
  }
  // Stage 17: the gate itself, so a player can see at a glance which cells
  // in the grounds map below actually sit close to it.
  let gateMarker = '';
  if (ENTRANCE.y < size.rows && ENTRANCE.x < size.cols) {
    gateMarker = `<div class="gate-marker" style="grid-column:${ENTRANCE.x + 1};grid-row:${ENTRANCE.y + 1};" title="Front Gate \u2014 every guest's walk starts here">\u26f2</div>`;
  }

  // Stage 12: occupancy now covers a plot's WHOLE footprint (a 2x2 stage
  // claims 4 cells), not just its anchor — otherwise a ghost/blocked marker
  // could render right on top of a cell a bigger structure already covers.
  const movingPlot = pendingMove ? state.builtPlots.find(p => p.id === pendingMove.plotId) : null;
  const occupied = new Set();
  for (const p of state.builtPlots) {
    if (movingPlot && p.id === movingPlot.id) continue;
    for (const c of plotFootprintCells(p)) occupied.add(`${c.x},${c.y}`);
  }
  const builtMarkers = state.builtPlots.map(p => {
    const glyph = STRUCTURE_TYPES[p.kind]?.icon || '?';
    const w = p.w || 1, h = p.h || 1;
    const style = `grid-column:${p.x + 1} / span ${w};grid-row:${p.y + 1} / span ${h};`;
    const attrs = computePlotAttributes(p, state.builtPlots);
    const statusWord = p.status === 'planning' ? 'planned, not yet built' : 'built';
    const footNote = (p.status === 'built' && (p.kind === 'food' || p.kind === 'vendor') && footTraffic && footTraffic[p.id])
      ? `, foot traffic ${footTraffic[p.id].mult.toFixed(2)}x`
      : '';
    // Stage 17: reachability applies to built stages too (not just stalls),
    // so it's noted alongside foot traffic rather than folded into it.
    const reachNote = (p.status === 'built' && reachability && reachability[p.id])
      ? `, ${reachability[p.id].mult.toFixed(2)}x gate reach`
      : '';
    const title = `${p.name} \u2014 ${statusWord} (sightline ${pct(attrs.sightline)}, shade ${pct(attrs.shade)}, traffic ${pct(attrs.traffic)}${footNote}${reachNote})`;
    const statusClass = p.status === 'planning' ? 'planning' : 'built';
    const movingClass = movingPlot && movingPlot.id === p.id ? ' moving' : '';
    return `<div class="plot-marker kind-${p.kind} ${statusClass}${movingClass}" style="${style}" title="${title}">${glyph}</div>`;
  }).join('');

  let ghostMarkers = '';
  const ghostKind = pendingMove ? pendingMove.kind : pendingBuild;
  if (ghostKind) {
    const ghosts = [];
    const excludeId = pendingMove ? pendingMove.plotId : undefined;
    const { w: gw, h: gh } = footprintFor(ghostKind);
    for (let y = 0; y < size.rows; y++) {
      for (let x = 0; x < size.cols; x++) {
        if (occupied.has(`${x},${y}`)) continue;
        const style = `grid-column:${x + 1} / span ${gw};grid-row:${y + 1} / span ${gh};`;
        // Stage 12: a footprint bigger than 1x1 can hang off the currently-
        // unlocked grounds even when its anchor is on-grid — render that as
        // a blocked cell (1x1, since spanning past the visible grid would
        // draw outside it) rather than silently skipping it.
        if (x + gw > size.cols || y + gh > size.rows) {
          ghosts.push(`<div class="plot-marker blocked" style="grid-column:${x + 1};grid-row:${y + 1};" title="That would run past the fence line \u2014 expand the grounds first.">\u2715</div>`);
          continue;
        }
        const quote = quoteBuild(ghostKind, x, y, state.builtPlots, excludeId);
        if (!quote) continue;
        // Stage 11/12: an illegal footprint (path under a stage/demo, too
        // close to another stage, no path frontage, or overlapping a
        // neighbor cell of a bigger structure) is shown as a non-interactive
        // blocked marker rather than silently omitted, so the player can see
        // *why* it's off-limits instead of just not finding a "+" there.
        const legal = isLegalPlacement(ghostKind, x, y, state.builtPlots, excludeId);
        if (!legal.ok) {
          ghosts.push(`<div class="plot-marker blocked" style="${style}" title="${legal.reason}">\u2715</div>`);
          continue;
        }
        if (pendingMove) {
          ghosts.push(`<button class="plot-marker ghost" style="${style}" title="Move here \u2014 ${quote.name}" data-action="moveTo" data-plot="${pendingMove.plotId}" data-x="${x}" data-y="${y}">\u2794</button>`);
        } else {
          ghosts.push(`<button class="plot-marker ghost" style="${style}" title="${quote.name} \u2014 ${money(quote.cost)}" data-action="placeAt" data-kind="${pendingBuild}" data-x="${x}" data-y="${y}">+</button>`);
        }
      }
    }
    ghostMarkers = ghosts.join('');
  }

  return `
    <div class="plat-sheet">
      <div class="grounds-map" style="--cols:${size.cols};--rows:${size.rows};">${cells.join('')}${gateMarker}${builtMarkers}${ghostMarkers}</div>
      ${COMPASS_ROSE}
    </div>
    <p class="map-legend mono">Everything built must sit on or beside a path &middot; \u{1F3AD} stages need a clear 2\u00d72 &middot; \u{1F357}\u{1F6D2} stalls can't take hill ground</p>
  `;
}

// A plat sheet gets a compass rose. Inline SVG rather than a glyph so it
// inherits the sheet's ink colour and stays crisp at any cell size.
const COMPASS_ROSE = `
  <svg class="compass" viewBox="0 0 40 40" aria-hidden="true">
    <circle cx="20" cy="20" r="15" fill="none" stroke="#6B5433" stroke-width="0.8"/>
    <path d="M20 3 L23.2 18.2 L20 21 L16.8 18.2 Z" fill="#6B5433"/>
    <path d="M20 37 L16.8 21.8 L20 19 L23.2 21.8 Z" fill="#6B5433" opacity="0.45"/>
    <path d="M37 20 L21.8 23.2 L19 20 L21.8 16.8 Z" fill="#6B5433" opacity="0.3"/>
    <path d="M3 20 L18.2 16.8 L21 20 L18.2 23.2 Z" fill="#6B5433" opacity="0.3"/>
    <text x="20" y="12" text-anchor="middle" font-size="6" fill="#F2E6C6" font-family="serif">N</text>
  </svg>`;

// Stage 19: the site plan is now a permanent fixture beside the desk rather
// than a section buried inside the Fair Floor tab, so it gets its own
// top-level renderer. Everything that is *about the ground itself* — the
// map, which grounds tier is unlocked, and the build palette — lives here;
// everything that is paperwork about what sits on it (plot cards, the day's
// schedule) stays in renderFairFloor.
export function renderGroundsPanel(state, pendingBuild, pendingMove, warn) {
  const footTraffic = computeFootTraffic(state.builtPlots);
  const reachability = computeReachability(state.builtPlots);
  const size = currentGridSize(state);
  const next = nextGridExpansion(state);
  const mapHtml = renderGroundsMap(state, pendingMove ? null : pendingBuild, pendingMove, footTraffic, reachability);
  const paletteHtml = pendingMove ? renderMoveBanner(state, pendingMove) : renderBuildPalette(state, pendingBuild);
  const built = state.builtPlots.filter(p => p.status === 'built').length;
  const planned = state.builtPlots.length - built;
  return `
    <div class="plat">
      <div class="plat-head">
        <span class="plat-title">${size.label}</span>
        <span class="plat-sub">${size.cols}&times;${size.rows} &middot; ${built} built${planned > 0 ? ` &middot; ${planned} planned` : ''}</span>
      </div>
      ${mapHtml}
      ${warn ? `<p class="warn">${warn}</p>` : ''}
      <p class="hint grounds-status">${next
        ? `<span class="hint-tag">${next.label} (${next.cols}\u00d7${next.rows}) unlocks Weekend ${next.unlockSeason}</span>`
        : `<span class="hint-tag">Full grounds explored</span>`}</p>
      ${paletteHtml}
    </div>
  `;
}

// Build palette: pick a structure kind, then tap an open cell on the map
// above (rendered as ghost "+" buttons while a kind is selected).
// Stage 15: the "from $X" label now reflects how many of that kind are
// already built, not just STRUCTURE_TYPES' flat baseCost — so the palette
// itself is where a player first notices a kind getting pricier.
function renderBuildPalette(state, pendingBuild) {
  const buttons = Object.entries(STRUCTURE_TYPES).map(([kind, type]) => {
    const builtCount = countBuiltOfKind(state.builtPlots, kind);
    const escalated = Math.round((type.baseCost * Math.pow(1 + CONFIG.escalatingBuildCostRate, builtCount)) / 10) * 10;
    // Stage 18: a kind with a maxBuiltByKind cap (currently just demo camps)
    // shows how many are already claimed instead of/alongside the price —
    // unlike the spatial legality rules (spacing, terrain bans), this cap
    // isn't discoverable by trying a cell, since it blocks every cell at
    // once once reached.
    const cap = PLACEMENT_RULES.maxBuiltByKind ? PLACEMENT_RULES.maxBuiltByKind[kind] : null;
    // any status (built or still-planning) counts toward the cap, same as
    // isLegalPlacement itself checks.
    const claimedCount = (state.builtPlots || []).filter(p => p.kind === kind).length;
    const atCap = cap != null && claimedCount >= cap;
    const priceTag = atCap
      ? `<span class="mono" title="The grounds can only support ${cap} ${type.label}s at once">${claimedCount}/${cap} built</span>`
      : builtCount > 0
        ? `<span class="mono" title="${builtCount} already built \u2014 the next one costs more">from ${money(escalated)}</span>`
        : `<span class="mono">from ${money(escalated)}</span>`;
    return `
    <button class="btn small ${pendingBuild === kind ? 'active' : ''}" data-action="selectBuild" data-kind="${kind}">
      ${type.icon} ${type.label} ${priceTag}
    </button>`;
  }).join('');
  const cancel = pendingBuild ? `<button class="btn small danger" data-action="cancelBuild">Cancel</button>` : '';
  const hint = pendingBuild
    ? `Placing a ${STRUCTURE_TYPES[pendingBuild].label} \u2014 tap an open spot on the map above.`
    : `Choose what to build, then tap an open spot on the map above. Cost and capacity both depend on the terrain you pick.`;
  return `
    <div class="build-palette">
      <p class="hint">${hint}</p>
      <div class="palette-buttons">${buttons}${cancel}</div>
    </div>
  `;
}

// Stage 10: shown instead of the build palette while relocating an existing
// plot — same "tap a spot on the map above" pattern, just for a plot that
// already exists rather than a fresh one.
function renderMoveBanner(state, pendingMove) {
  const plot = state.builtPlots.find(p => p.id === pendingMove.plotId);
  if (!plot) return '';
  const costNote = plot.status === 'planning'
    ? 'free while it\u2019s still just a plan'
    : 'costs a demolition fee plus a discounted rebuild at the new spot';
  return `
    <div class="build-palette">
      <p class="hint">Moving <strong>${plot.name}</strong> (${costNote}) \u2014 tap a new spot on the map above.</p>
      <div class="palette-buttons"><button class="btn small danger" data-action="cancelMove">Cancel</button></div>
    </div>
  `;
}

// Stage 10: a single plot card, aware of whether the plot is still a
// free/movable "plan" or already committed and functioning. Food/vendor
// (craft) plots also get an inline vendor-seating control once built.
function renderPlotCard(state, p, footTraffic, reachability) {
  const attrs = computePlotAttributes(p, state.builtPlots);
  const isPlanning = p.status === 'planning';
  const adjacencyNote = !isPlanning && attrs.nearbyStages > 0
    ? (p.kind === 'stage'
      ? `<span class="warn-tag" title="Nearby built stages are stepping on this one's sightlines">crowded \u2212${attrs.nearbyStages * 10}% sightline</span>`
      : `<span class="hint-tag" title="A nearby built stage sends its crowd this way">near a stage +${attrs.nearbyStages * 5}% traffic</span>`)
    : '';
  const demoNote = !isPlanning && (p.kind === 'food' || p.kind === 'vendor') && attrs.nearbyDemos > 0
    ? `<span class="hint-tag" title="A nearby demo camp draws its own lingering crowd your way">near a demo camp +${attrs.nearbyDemos * 7}% traffic</span>`
    : '';
  // Stage 14: how this stall's own foot traffic compares to the grounds'
  // average staffed stall today — the actual number simulateDay uses to
  // scale its sales. Stages don't get one (footTraffic only tracks
  // food/vendor plots); a still-planning stall doesn't either, since it
  // isn't really on the grounds yet.
  const footEntry = !isPlanning && footTraffic && footTraffic[p.id];
  const footTrafficTag = footEntry
    ? `<span class="${footEntry.mult >= 1.05 ? 'hint-tag' : footEntry.mult <= 0.95 ? 'warn-tag' : 'hint-tag'}" title="How this stall's placement compares to the grounds\u2019 average foot traffic today">${footEntry.mult.toFixed(2)}x foot traffic</span>`
    : '';
  // Stage 17: reachability applies to stages too (unlike foot traffic,
  // which only ever tracked food/vendor stalls), so this checks reachability
  // directly rather than piggybacking on footEntry's kind restriction.
  const reachEntry = !isPlanning && reachability && reachability[p.id];
  const reachabilityTag = reachEntry
    ? `<span class="${reachEntry.mult >= 1.03 ? 'hint-tag' : reachEntry.mult <= 0.97 ? 'warn-tag' : 'hint-tag'}" title="How close a walk from the front gate this spot is, vs. the grounds\u2019 average built stage/stall today">${reachEntry.mult.toFixed(2)}x gate reach</span>`
    : '';

  let vendorNote = '';
  if (!isPlanning && (p.kind === 'food' || p.kind === 'vendor')) {
    if (p.assignedVendorId) {
      const v = vendorById(p.assignedVendorId);
      vendorNote = `<p class="plot-vendor hint">Staffed by <strong>${v ? v.name : p.assignedVendorId}</strong> <button class="btn small danger" data-action="unassignVendor" data-id="${p.id}">Unassign</button></p>`;
    } else {
      const vendorType = p.kind === 'food' ? 'food' : 'craft';
      const seatedElsewhere = new Set(state.builtPlots.filter(o => o.assignedVendorId).map(o => o.assignedVendorId));
      const openVendors = state.hiredVendors
        .map(vendorById)
        .filter(v => v && v.type === vendorType && !seatedElsewhere.has(v.id));
      if (openVendors.length > 0) {
        const options = openVendors.map(v => `<option value="${v.id}">${v.name}</option>`).join('');
        vendorNote = `<div class="plot-vendor">
          <select data-action="assignVendor" data-plot="${p.id}"><option value="">\u2014 seat a vendor \u2014</option>${options}</select>
        </div>`;
      } else {
        vendorNote = `<p class="plot-vendor hint">No hired, unseated ${vendorType} vendors \u2014 hire one on Backstage.</p>`;
      }
    }
  }

  // Stage 15: a planning plot's stored cost is only the estimate taken at
  // placement time; escalating build cost means that can go stale if
  // other same-kind plots get built in the meantime. Re-quote live so the
  // "Commit" button and the tag below always match what commitPlot will
  // actually charge right now.
  const liveQuote = isPlanning ? quoteBuild(p.kind, p.x, p.y, state.builtPlots) : null;
  const commitCost = liveQuote ? liveQuote.cost : p.cost;
  const demolishFee = Math.round(p.cost * CONFIG.demolishFeeMult);
  const actionButtons = isPlanning
    ? `
      <button class="btn small" data-action="commitPlot" data-id="${p.id}">Commit \u2014 ${money(commitCost)}</button>
      <button class="btn small" data-action="selectMove" data-id="${p.id}" data-kind="${p.kind}">Move</button>
      <button class="btn small" data-action="renamePlot" data-id="${p.id}">Rename</button>
      <button class="btn small danger" data-action="deletePlanningPlot" data-id="${p.id}">Delete</button>
    `
    : `
      <button class="btn small" data-action="selectMove" data-id="${p.id}" data-kind="${p.kind}">Relocate</button>
      <button class="btn small" data-action="renamePlot" data-id="${p.id}">Rename</button>
      <button class="btn small danger" data-action="demolishPlot" data-id="${p.id}">Demolish \u2014 ${money(demolishFee)}</button>
    `;

  return `
    <div class="plot-card ${isPlanning ? 'planning' : 'built'}" data-kind="${p.kind}">
      <div class="plot-card-head">
        <h4>${p.name}</h4>
        <span class="plot-kind">${p.kind}${isPlanning ? ' \u00b7 planned' : ''}</span>
      </div>
      <div class="plot-stats mono">
        ${p.kind === 'stage' ? `sightline ${pct(attrs.sightline)} &middot; shade ${pct(attrs.shade)} &middot; traffic ${pct(attrs.traffic)} &middot; cap ${p.capacity}` : `traffic ${pct(attrs.traffic)}`}
        ${adjacencyNote}
        ${demoNote}
        ${footTrafficTag}
        ${reachabilityTag}
      </div>
      ${vendorNote}
      <div class="plot-actions">${actionButtons}</div>
      <span class="built-tag">${isPlanning ? `Planned \u2014 ${money(commitCost)} to commit` : `Built for ${money(p.cost)}`}</span>
    </div>`;
}

export function renderFairFloor(state, conflicts, warn) {
  // Stage 19: the map, grounds status, and build palette moved out to
  // renderGroundsPanel (they are permanently visible now). What remains
  // here is the paperwork about what has been placed: the plot roster and
  // the day's running order.
  const footTraffic = computeFootTraffic(state.builtPlots);
  const reachability = computeReachability(state.builtPlots);

  const planningPlots = state.builtPlots.filter(p => p.status === 'planning');
  const commitAllTotal = planningPlots.length > 0 ? previewCommitAll(state.builtPlots).total : 0;
  const commitBanner = planningPlots.length > 0
    ? `<div class="commit-banner">
        <span>${planningPlots.length} plot${planningPlots.length === 1 ? '' : 's'} still just a plan \u2014 ${money(commitAllTotal)} to commit them all</span>
        <button class="btn small primary" data-action="commitAll">Commit All</button>
      </div>`
    : '';

  const plotRows = state.builtPlots.length === 0
    ? `<p class="hint">Nothing on the grounds yet. Pick a structure in the build palette beside the map, then tap an open spot.</p>`
    : state.builtPlots.map(p => renderPlotCard(state, p, footTraffic, reachability)).join('');

  const builtStages = state.builtPlots.filter(p => p.kind === 'stage' && p.status === 'built');

  const scheduleGrid = builtStages.length === 0
    ? `<p class="hint">Build at least one stage to start scheduling acts.</p>`
    : `
    <table class="schedule-table">
      <thead>
        <tr><th>Time block</th>${builtStages.map(s => `<th>${s.name}</th>`).join('')}</tr>
      </thead>
      <tbody>
        ${TIME_BLOCKS.map(block => `
          <tr>
            <td title="${heatNote(block)}">${block.label}${heatPips(block)}</td>
            ${builtStages.map(stage => {
              const currentId = state.schedule[block.id]?.[stage.id] || '';
              const options = state.roster.map(performerById).filter(Boolean)
                .map(p => `<option value="${p.id}" ${p.id === currentId ? 'selected' : ''}>${p.name}</option>`).join('');
              return `<td>
                <select data-action="schedule" data-block="${block.id}" data-stage="${stage.id}">
                  <option value="">\u2014 empty \u2014</option>
                  ${options}
                </select>
              </td>`;
            }).join('')}
          </tr>`).join('')}
      </tbody>
    </table>
    <p class="hint">Sun pips mark the hot blocks. A shaded grove stage is worth more to the crowd then; an open hilltop is better in the cool blocks, where its long sightlines carry.</p>`;

  return `
    <section class="panel">
      <h2>The Grounds</h2>
      <p class="flavor">What stands on the plan, and who plays where today.</p>
      ${warn ? `<p class="warn">${warn}</p>` : ''}
      <h3>Built So Far</h3>
      ${commitBanner}
      <div class="plot-grid">${plotRows}</div>

      <h3>Today's Schedule</h3>
      ${conflicts && conflicts.length ? `<p class="warn">${conflicts.join('<br>')}</p>` : ''}
      ${scheduleGrid}
    </section>
  `;
}

// Stage 19: a compact visual for a time block's `heat`, so the shade/
// sightline tradeoff introduced this stage is discoverable from the
// schedule table rather than only from the manual.
function heatPips(block) {
  const n = Math.max(0, Math.min(3, Math.round((block.heat || 0) * 3)));
  return '<span class="heat-pip"></span>'.repeat(n);
}
function heatNote(block) {
  const h = block.heat || 0;
  if (h >= 0.85) return 'Full sun \u2014 shade counts for a lot here, open hilltops bake.';
  if (h >= 0.5) return 'Warm \u2014 shade counts for something.';
  return 'Cool light \u2014 shade barely matters; sightlines carry the block.';
}

// Stage 19: attendance is now the product of five separate terms
// (reputation, price, the bill, the campaign, and the grounds themselves).
// Presenting the result as a bare number teaches nothing, so the report
// shows which levers actually produced today's crowd.
function renderDrawBreakdown(result) {
  const parts = [];
  if (result.groundsDraw) parts.push(`grounds <b>${result.groundsDraw.mult.toFixed(2)}\u00d7</b>`);
  if (typeof result.priceMult === 'number') parts.push(`price <b>${result.priceMult.toFixed(2)}\u00d7</b>`);
  if (result.scheduledCount) parts.push(`<b>${result.scheduledCount}</b> act${result.scheduledCount === 1 ? '' : 's'} on the bill`);
  if (result.priceSatDelta) parts.push(`gate mood <b>${result.priceSatDelta > 0 ? '+' : ''}${result.priceSatDelta}</b>`);
  if (!parts.length) return '';
  return `<div class="draw-breakdown">${parts.join('<span>&middot;</span>')}</div>`;
}

export function renderReport(state, result) {
  const netClass = result.cashDelta >= 0 ? 'good' : 'bad';
  const satLabel = result.satisfaction >= 75 ? 'Delighted' : result.satisfaction >= 55 ? 'Content' : result.satisfaction >= 35 ? 'Grumbling' : 'Miserable';
  return `
    <div class="ticket-stub">
      <h2>Day ${result.day} \u2014 Closed the Gates</h2>
      <div class="ticket-row"><span>Attendance</span><span class="mono">${result.attendance.toLocaleString()}</span></div>
      ${renderDrawBreakdown(result)}
      ${result.campaignActive ? `<div class="ticket-row"><span>${result.campaignActive}</span><span class="mono">+${Math.round((result.adFactor - 1) * 100)}% draw</span></div>` : ''}
      <div class="ticket-row"><span>Crowd mood</span><span class="mono">${satLabel} (${result.satisfaction}/100)</span></div>
      <hr>
      <div class="ticket-row"><span>Ticket revenue</span><span class="mono">${money(result.ticketRevenue)}</span></div>
      <div class="ticket-row"><span>Stall revenue (house cut)</span><span class="mono">${money(result.vendorRevenue)}</span></div>
      <div class="ticket-row"><span>Performer wages</span><span class="mono">-${money(result.performerCosts)}</span></div>
      <div class="ticket-row"><span>Stall staffing</span><span class="mono">-${money(result.vendorCosts)}</span></div>
      <div class="ticket-row"><span>Plot upkeep</span><span class="mono">-${money(result.upkeep)}</span></div>
      <div class="ticket-row"><span>Hosting the crowd <span class="hint">(${result.attendance.toLocaleString()} &times; ${money(CONFIG.perGuestCost)})</span></span><span class="mono">-${money(result.guestCosts || 0)}</span></div>
      <div class="ticket-row"><span>Grounds overhead</span><span class="mono">-${money(result.overhead)}</span></div>
      <hr>
      <div class="ticket-row total"><span>Net</span><span class="mono ${netClass}">${result.cashDelta >= 0 ? '+' : ''}${money(result.cashDelta)}</span></div>
      <div class="ticket-row"><span>Reputation</span><span class="mono ${result.reputationDelta >= 0 ? 'good' : 'bad'}">${result.reputationDelta >= 0 ? '+' : ''}${result.reputationDelta}</span></div>

      ${result.warnings.length ? `<p class="warn">${result.warnings.join('<br>')}</p>` : ''}
      ${result.log.length ? `<p class="flavor-log">${result.log.join('<br>')}</p>` : `<p class="flavor-log">A quiet day \u2014 nothing remarkable happened.</p>`}

      <button class="btn" data-action="nextDay">Next Day \u2192</button>
    </div>
  `;
}

// Stage 6: shown when phase === 'weekendEnd', in place of the tabs/panel.
// `summary` comes from engine.js's summarizeWeekend(state.history,
// CONFIG.seasonLength) — main.js computes it and passes it in, keeping this
// function a pure state->HTML renderer like everything else here.
export function renderWeekendEnd(state, summary) {
  const netClass = summary.totalNet >= 0 ? 'good' : 'bad';
  const dayRows = summary.days.map(d => `
    <div class="ticket-row"><span>Day ${d.day}</span><span class="mono">${d.attendance.toLocaleString()} in \u00b7 ${d.cashDelta >= 0 ? '+' : ''}${money(d.cashDelta)}</span></div>
  `).join('');
  return `
    <div class="ticket-stub weekend-summary">
      <h2>Weekend ${state.season} \u2014 Gates Closed for the Season</h2>
      <div class="ticket-row"><span>Total attendance</span><span class="mono">${summary.totalAttendance.toLocaleString()}</span></div>
      <div class="ticket-row"><span>Average crowd mood</span><span class="mono">${summary.avgSatisfaction}/100</span></div>
      <hr>
      ${dayRows}
      <hr>
      <div class="ticket-row total"><span>Weekend net</span><span class="mono ${netClass}">${summary.totalNet >= 0 ? '+' : ''}${money(summary.totalNet)}</span></div>
      <div class="ticket-row"><span>Reputation</span><span class="mono ${summary.repDelta >= 0 ? 'good' : 'bad'}">${summary.repDelta >= 0 ? '+' : ''}${summary.repDelta}</span></div>
      ${renderUnlockNotice(state)}
      <button class="btn primary" data-action="startNextWeekend">Begin Weekend ${state.season + 1} \u2192</button>
    </div>
  `;
}

// Flags anything that unlocks specifically at the START of next weekend, so
// the player notices new options the moment they become available rather
// than discovering them buried in the Office/Backstage panels.
function renderUnlockNotice(state) {
  const nextSeason = state.season + 1;
  const items = [
    ...AD_CAMPAIGNS.filter(c => c.unlockSeason === nextSeason).map(c => `${c.name} campaign`),
    ...Object.values(CONTRACT_OPTIONS).filter(o => o.unlockSeason === nextSeason).map(o => `${o.label} contracts`),
    ...GRID_EXPANSIONS.filter(g => g.unlockSeason === nextSeason).map(g => `${g.label} grounds expansion (${g.cols}\u00d7${g.rows})`),
  ];
  if (!items.length) return '';
  return `<p class="hint unlock-note">New this weekend: ${items.join(', ')} unlocked!</p>`;
}

// Stage 16: shown when phase === 'victory' — a one-time celebration the
// instant the win condition first passes at a weekend boundary, before the
// normal weekend-end summary. "Continue Playing" (acknowledgeVictory) drops
// straight into that same weekend-end screen — nothing about the save
// changes, so this is a milestone, not an ending.
export function renderVictory(state) {
  const w = CONFIG.winCondition;
  return `
    <div class="ticket-stub victory-stub">
      <h2>\u2728 A Legendary Faire \u2728</h2>
      <p class="flavor-log">Word has spread the length of the shire. By Weekend ${state.season}, the faire stands ${Math.round(state.reputation)} reputation strong with ${money(state.cash)} in the coffers \u2014 past every mark that matters (Weekend ${w.seasonTarget}+, ${w.minReputation}+ reputation, ${money(w.minCash)}+ cash).</p>
      <div class="ticket-row"><span>Weekend</span><span class="mono">${state.season}</span></div>
      <div class="ticket-row"><span>Reputation</span><span class="mono good">${Math.round(state.reputation)}</span></div>
      <div class="ticket-row"><span>Cash on hand</span><span class="mono good">${money(state.cash)}</span></div>
      <button class="btn primary" data-action="acknowledgeVictory">Continue the Faire \u2192</button>
    </div>
  `;
}

// Stage 16: shown when phase === 'gameOver' — cash crossed
// CONFIG.bankruptcyFloor. Terminal for this save; the only action is
// starting a fresh faire (same reset path as the header's Reset button,
// just without a confirmation dialog since the run is already over).
export function renderGameOver(state) {
  return `
    <div class="ticket-stub gameover-stub">
      <h2>The Faire Folds</h2>
      <p class="flavor-log">The coffers ran dry \u2014 ${money(state.cash)} on hand by Weekend ${state.season}, ${['', 'Friday', 'Saturday', 'Sunday'][state.weekendDay]}. Creditors have called in what's owed, and there's no shire left willing to extend credit. The grounds close for good.</p>
      <div class="ticket-row"><span>Final weekend</span><span class="mono">${state.season}</span></div>
      <div class="ticket-row"><span>Final reputation</span><span class="mono">${Math.round(state.reputation)}</span></div>
      <div class="ticket-row"><span>Final cash</span><span class="mono bad">${money(state.cash)}</span></div>
      <button class="btn primary" data-action="newFaire">Start a New Faire \u2192</button>
    </div>
  `;
}

function pct(n) { return `${Math.round(n * 100)}%`; }
function quirkTitle(id) { return { crowd_pleaser: 'Crowd Pleaser', prima_donna: 'Prima Donna', chaos_prone: 'Chaos-Prone', night_owl: 'Night Owl' }[id] || id; }
function quirkDesc(id) {
  return {
    crowd_pleaser: 'Draws 15% better wherever they play.',
    prima_donna: 'Sulks if sharing a block with an equally popular act.',
    chaos_prone: 'Raises the odds of a Rowdy Crowd event.',
    night_owl: '+20% draw in Golden Hour, \u221210% in Morning Procession.',
  }[id] || '';
}
