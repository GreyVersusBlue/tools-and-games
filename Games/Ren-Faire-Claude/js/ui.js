// ui.js — turns state into HTML strings. No event listeners live here;
// main.js wires all interaction via event delegation on #content.

import { CONFIG, PERFORMERS, VENDORS, TIME_BLOCKS, GRID, STRUCTURE_TYPES } from './data.js';
import { performerById, vendorById, terrainAt, computePlotAttributes, quoteBuild } from './engine.js';

const money = (n) => `$${Math.round(n).toLocaleString()}`;

export function renderLedger(state) {
  const repLabel = state.reputation >= 75 ? 'Renowned' : state.reputation >= 50 ? 'Well-regarded' : state.reputation >= 25 ? 'Modest' : 'Struggling';
  const weekendNames = ['', 'Friday', 'Saturday', 'Sunday'];
  return `
    <div class="ledger-item">
      <span class="ledger-label">Day ${state.day}</span>
      <span class="ledger-sub">${weekendNames[state.weekendDay]}</span>
    </div>
    <div class="ledger-item">
      <span class="ledger-label mono">${money(state.cash)}</span>
      <span class="ledger-sub">on hand</span>
    </div>
    <div class="ledger-item">
      <span class="ledger-label">${Math.round(state.reputation)}</span>
      <span class="ledger-sub">${repLabel}</span>
    </div>
  `;
}

export function renderTabs(activeTab, phase) {
  if (phase !== 'plan') return '';
  const tabs = [
    { id: 'office', label: 'Office' },
    { id: 'backstage', label: 'Backstage' },
    { id: 'fairfloor', label: 'Fair Floor' },
  ];
  return tabs.map(t => `<button class="tab-btn${t.id === activeTab ? ' active' : ''}" data-tab="${t.id}">${t.label}</button>`).join('');
}

export function renderOffice(state) {
  const builtCount = state.builtPlots.length;
  const rosterCost = state.roster.map(performerById).reduce((s, p) => s + (p?.cost || 0), 0);
  const vendorCost = state.hiredVendors.map(vendorById).reduce((s, v) => s + (v?.cost || 0), 0);
  const overhead = 150 + state.builtPlots.filter(p => p.kind === 'stage').length * 20;
  return `
    <section class="panel">
      <h2>The Ledger Desk</h2>
      <p class="flavor">Set tonight's admission price and see what the books say you're carrying.</p>

      <div class="field-row">
        <label for="ticketPrice">Ticket price</label>
        <input type="range" id="ticketPrice" min="${CONFIG.ticketPrice.min}" max="${CONFIG.ticketPrice.max}" value="${state.ticketPrice}">
        <span class="mono">${money(state.ticketPrice)}</span>
      </div>

      <table class="ledger-table">
        <tr><td>Contracted performers</td><td class="mono">${money(rosterCost)}/day</td></tr>
        <tr><td>Hired stalls</td><td class="mono">${money(vendorCost)}/day</td></tr>
        <tr><td>Grounds overhead</td><td class="mono">${money(overhead)}/day</td></tr>
        <tr class="total-row"><td>Daily nut before a single ticket sells</td><td class="mono">${money(rosterCost + vendorCost + overhead)}</td></tr>
      </table>

      <p class="hint">${builtCount} plot${builtCount === 1 ? '' : 's'} built on the grounds. Head to <strong>Fair Floor</strong> to build stages and stalls, and <strong>Backstage</strong> to contract acts.</p>
    </section>
  `;
}

export function renderBackstage(state, warn) {
  const rows = PERFORMERS.map(p => {
    const contracted = state.roster.includes(p.id);
    const quirkLabel = p.quirk ? `<span class="quirk-tag" title="${quirkDesc(p.quirk)}">${quirkTitle(p.quirk)}</span>` : '';
    return `
      <tr class="${contracted ? 'is-contracted' : ''}">
        <td>${p.name}${quirkLabel}</td>
        <td class="mono">${p.role}</td>
        <td class="mono">${'\u2605'.repeat(Math.round(p.popularity / 2))}</td>
        <td class="mono">${money(p.cost)}/day</td>
        <td>${contracted
          ? `<button class="btn small danger" data-action="release" data-id="${p.id}">Release</button>`
          : `<button class="btn small" data-action="contract" data-id="${p.id}">Contract</button>`}</td>
      </tr>`;
  }).join('');

  const vendorRows = VENDORS.map(v => {
    const hired = state.hiredVendors.includes(v.id);
    return `
      <tr class="${hired ? 'is-contracted' : ''}">
        <td>${v.name}</td>
        <td class="mono">${v.type}</td>
        <td class="mono">${'\u2605'.repeat(Math.round(v.quality / 2))}</td>
        <td class="mono">${money(v.cost)}/day</td>
        <td>${hired
          ? `<button class="btn small danger" data-action="fireVendor" data-id="${v.id}">Let go</button>`
          : `<button class="btn small" data-action="hireVendor" data-id="${v.id}">Hire</button>`}</td>
      </tr>`;
  }).join('');

  return `
    <section class="panel">
      <h2>The Tiring House</h2>
      <p class="flavor">Contract the acts who'll carry the day, and staff for the stalls you've built.</p>
      ${warn ? `<p class="warn">${warn}</p>` : ''}
      <table class="roster-table">
        <thead><tr><th>Performer</th><th>Role</th><th>Draw</th><th>Cost</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>

      <h3>Vendors &amp; Stalls</h3>
      <p class="hint">Stalls only sell if you've built the plot for them on the Fair Floor first.</p>
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
function renderGroundsMap(state, pendingBuild) {
  const cells = [];
  for (let y = 0; y < GRID.rows; y++) {
    for (let x = 0; x < GRID.cols; x++) {
      const terrain = terrainAt(x, y) || 'clearing';
      cells.push(`<div class="terrain-cell" data-terrain="${terrain}" style="grid-column:${x + 1};grid-row:${y + 1};"></div>`);
    }
  }

  const occupied = new Set(state.builtPlots.map(p => `${p.x},${p.y}`));
  const builtMarkers = state.builtPlots.map(p => {
    const glyph = STRUCTURE_TYPES[p.kind]?.icon || '?';
    const style = `grid-column:${p.x + 1};grid-row:${p.y + 1};`;
    const attrs = computePlotAttributes(p, state.builtPlots);
    const title = `${p.name} \u2014 built (sightline ${pct(attrs.sightline)}, shade ${pct(attrs.shade)}, traffic ${pct(attrs.traffic)})`;
    return `<div class="plot-marker kind-${p.kind} built" style="${style}" title="${title}">${glyph}</div>`;
  }).join('');

  let ghostMarkers = '';
  if (pendingBuild) {
    const ghosts = [];
    for (let y = 0; y < GRID.rows; y++) {
      for (let x = 0; x < GRID.cols; x++) {
        if (occupied.has(`${x},${y}`)) continue;
        const quote = quoteBuild(pendingBuild, x, y);
        if (!quote) continue;
        const style = `grid-column:${x + 1};grid-row:${y + 1};`;
        ghosts.push(`<button class="plot-marker ghost" style="${style}" title="${quote.name} \u2014 ${money(quote.cost)}" data-action="placeAt" data-kind="${pendingBuild}" data-x="${x}" data-y="${y}">+</button>`);
      }
    }
    ghostMarkers = ghosts.join('');
  }

  return `
    <div class="grounds-map" style="--cols:${GRID.cols};--rows:${GRID.rows};">${cells.join('')}${builtMarkers}${ghostMarkers}</div>
    <p class="map-legend mono">\u{1F3D4}\ufe0f hill &middot; \u{1F332} woods &middot; \u{1F3DE}\ufe0f path &middot; \u{1F33E} clearing</p>
  `;
}

// Build palette: pick a structure kind, then tap an open cell on the map
// above (rendered as ghost "+" buttons while a kind is selected).
function renderBuildPalette(pendingBuild) {
  const buttons = Object.entries(STRUCTURE_TYPES).map(([kind, type]) => `
    <button class="btn small ${pendingBuild === kind ? 'active' : ''}" data-action="selectBuild" data-kind="${kind}">
      ${type.icon} ${type.label} <span class="mono">from ${money(type.baseCost)}</span>
    </button>`).join('');
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

export function renderFairFloor(state, conflicts, pendingBuild) {
  const mapHtml = renderGroundsMap(state, pendingBuild);
  const paletteHtml = renderBuildPalette(pendingBuild);

  const plotRows = state.builtPlots.length === 0
    ? `<p class="hint">Nothing built yet \u2014 pick a structure above and tap a spot on the map.</p>`
    : state.builtPlots.map(p => {
      const attrs = computePlotAttributes(p, state.builtPlots);
      const adjacencyNote = attrs.nearbyStages > 0
        ? (p.kind === 'stage'
          ? `<span class="warn-tag" title="Nearby built stages are stepping on this one's sightlines">crowded \u2212${attrs.nearbyStages * 10}% sightline</span>`
          : `<span class="hint-tag" title="A nearby built stage sends its crowd this way">near a stage +${attrs.nearbyStages * 5}% traffic</span>`)
        : '';
      return `
        <div class="plot-card built" data-kind="${p.kind}">
          <div class="plot-card-head">
            <h4>${p.name}</h4>
            <span class="plot-kind">${p.kind}</span>
          </div>
          <div class="plot-stats mono">
            ${p.kind === 'stage' ? `sightline ${pct(attrs.sightline)} &middot; shade ${pct(attrs.shade)} &middot; traffic ${pct(attrs.traffic)} &middot; cap ${p.capacity}` : `traffic ${pct(attrs.traffic)}`}
            ${adjacencyNote}
          </div>
          <span class="built-tag">Built for ${money(p.cost)}</span>
        </div>`;
    }).join('');

  const builtStages = state.builtPlots.filter(p => p.kind === 'stage');

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
            <td>${block.label}</td>
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
    </table>`;

  return `
    <section class="panel">
      <h2>The Grounds</h2>
      <p class="flavor">Dirt paths, old woods, and a good hill for a stage \u2014 build what the faire needs.</p>
      ${mapHtml}
      ${paletteHtml}
      <h3>Built So Far</h3>
      <div class="plot-grid">${plotRows}</div>

      <h3>Today's Schedule</h3>
      ${conflicts && conflicts.length ? `<p class="warn">${conflicts.join('<br>')}</p>` : ''}
      ${scheduleGrid}
    </section>
  `;
}

export function renderReport(state, result) {
  const netClass = result.cashDelta >= 0 ? 'good' : 'bad';
  const satLabel = result.satisfaction >= 75 ? 'Delighted' : result.satisfaction >= 55 ? 'Content' : result.satisfaction >= 35 ? 'Grumbling' : 'Miserable';
  return `
    <div class="ticket-stub">
      <div class="ticket-notch left"></div>
      <div class="ticket-notch right"></div>
      <h2>Day ${result.day} \u2014 Closed the Gates</h2>
      <div class="ticket-row"><span>Attendance</span><span class="mono">${result.attendance.toLocaleString()}</span></div>
      <div class="ticket-row"><span>Crowd mood</span><span class="mono">${satLabel} (${result.satisfaction}/100)</span></div>
      <hr>
      <div class="ticket-row"><span>Ticket revenue</span><span class="mono">${money(result.ticketRevenue)}</span></div>
      <div class="ticket-row"><span>Stall revenue (house cut)</span><span class="mono">${money(result.vendorRevenue)}</span></div>
      <div class="ticket-row"><span>Performer wages</span><span class="mono">-${money(result.performerCosts)}</span></div>
      <div class="ticket-row"><span>Stall staffing</span><span class="mono">-${money(result.vendorCosts)}</span></div>
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

function pct(n) { return `${Math.round(n * 100)}%`; }
function quirkTitle(id) { return { crowd_pleaser: 'Crowd Pleaser', prima_donna: 'Prima Donna', chaos_prone: 'Chaos-Prone' }[id] || id; }
function quirkDesc(id) {
  return {
    crowd_pleaser: 'Draws 15% better wherever they play.',
    prima_donna: 'Sulks if sharing a block with an equally popular act.',
    chaos_prone: 'Raises the odds of a Rowdy Crowd event.',
  }[id] || '';
}
