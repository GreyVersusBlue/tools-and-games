// ui.js — rendering + interaction flows. All engine mutation goes through engine modules.
import { DB, fmtMoney } from "./data.js";
import { S, save, wipeSave, dayName, isWeekend, weekOf, seasonOf, levelInfo, LEVELS, activeClients, clientSlotsMax,
         getClientRec, contentClient, log, addRep, addCash, rand, pick,
         loadHall, hallSlot, hallBests, mergeHall } from "./state.js";
import { SLOTS_PER_DAY, spendSlots, endDay } from "./engine/calendar.js";
import { marketHeat, trueValue, suggested, bumpKnowledge, knowledgeEdge, playerListingValue } from "./engine/marketFacade.js";
import * as Clients from "./engine/clients.js";
import * as Deals from "./engine/deals.js";
import * as Seller from "./engine/seller.js";
import { maybeFireEvent } from "./engine/events.js";
import { financingType, closeDaysFor } from "./engine/financing.js";
import * as Esc from "./engine/escalation.js";
import * as Com from "./engine/commercial.js";

let screen = "dashboard";
const $ = sel => document.querySelector(sel);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function render() {
  renderTopbar(); renderNav();
  const main = $("#main"); main.innerHTML = "";
  ({ dashboard: renderDashboard, clients: renderClients, mls: renderMLS,
     mylistings: renderMyListings, office: renderOffice, log: renderLog, hall: renderHall }[screen])(main);
  renderChoiceQueue();
  renderScorecard();
  save();
}

function setScreen(s) { screen = s; render(); }

// ---------------- TOP BAR / NAV ----------------
// Rep/XP/Rate collapse behind a tap below 620px (see the media query in
// style.css) — Date/Slots/Cash are the three a player checks mid-day, the
// other three are checked far less often and cost the same four rows of an
// iPhone viewport either way. Kept expanded by default above that width, so
// this only changes anything on the narrow layout it was written for.
let statsExpanded = false;
function renderTopbar() {
  const lv = levelInfo();
  const ended = S.careerEnded;
  $("#topbar").innerHTML = `
    <div class="letterhead">
      <span class="lh-name">CLOSING TIME</span>
      <span class="lh-sub">${esc(DB.brokerages[S.brokerageId].name)} · ${esc(lv.title)}</span>
    </div>
    <div class="statgrid">
      <div class="stat-primary">
        <div class="stat"><span class="stat-label">Date</span><span class="stat-val">${dayName(S.day)}, Wk ${weekOf(S.day)} <em class="season">${seasonOf(S.day)}</em></span></div>
        <div class="stat"><span class="stat-label">Slots</span><span class="stat-val slots">${"●".repeat(S.slotsLeft)}${"○".repeat(Math.max(0, SLOTS_PER_DAY - S.slotsLeft))}</span></div>
        <div class="stat"><span class="stat-label">Cash</span><span class="stat-val money">${fmtMoney(S.cash)}</span></div>
        <button class="stat-toggle" id="statToggle" aria-expanded="${statsExpanded}">${statsExpanded ? "Less ▴" : "More ▾"}</button>
      </div>
      <div class="stat-secondary${statsExpanded ? " open" : ""}">
        <div class="stat"><span class="stat-label">Reputation</span><span class="stat-val">${S.rep}<span class="dim">/100</span></span></div>
        <div class="stat"><span class="stat-label">XP</span><span class="stat-val">${S.xp}${LEVELS[S.level] ? `<span class="dim">/${LEVELS[S.level].xp}</span>` : ""}</span></div>
        <div class="stat"><span class="stat-label">Rate</span><span class="stat-val">${S.market.rate.toFixed(2)}%</span></div>
      </div>
    </div>
    <button class="btn btn-red" id="endDayBtn" ${ended ? "disabled" : ""}>${ended ? "Career complete" : S.day >= 336 ? "Close out the year →" : "End day →"}</button>`;
  $("#statToggle").onclick = () => { statsExpanded = !statsExpanded; renderTopbar(); };
  if (!ended) {
    $("#endDayBtn").onclick = () => {
      if (S.choiceQueue.length) { toast("Handle the pending decisions first."); return; }
      endDay(); render();
    };
  }
}

function renderNav() {
  const items = [["dashboard", "Desk"], ["clients", "Clients"], ["mls", "MLS Board"], ["mylistings", "My Listings"], ["office", "Office"], ["log", "Ledger"], ["hall", "Hall"]];
  $("#nav").innerHTML = items.map(([id, label]) =>
    `<button class="nav-item ${screen === id ? "active" : ""}" data-nav="${id}">${label}${badge(id)}</button>`).join("");
  $("#nav").querySelectorAll("[data-nav]").forEach(b => b.onclick = () => setScreen(b.dataset.nav));
}
function badge(id) {
  if (id === "clients") { const n = activeClients().length; return n ? ` <span class="badge">${n}</span>` : ""; }
  if (id === "mylistings") { const n = S.playerListings.filter(p => ["live", "underContract", "prep"].includes(p.status)).length; return n ? ` <span class="badge">${n}</span>` : ""; }
  return "";
}

// ---------------- DASHBOARD ----------------
function renderDashboard(main) {
  const wrap = el("div", "cols");
  const left = el("div", "col");
  left.appendChild(card("Today", todayPanel()));
  left.appendChild(card("This week", schedulePanel()));
  const right = el("div", "col");
  right.appendChild(card("Active deals", dealsPanel()));
  right.appendChild(card("Recent ledger", logPanel(8)));
  wrap.append(left, right); main.appendChild(wrap);
}

function todayPanel() {
  const d = el("div");
  d.appendChild(el("p", "muted", `${dayName(S.day)} — ${isWeekend(S.day)
    ? "Weekend. Prime time for showings and open houses; the banks are asleep."
    : "Weekday. Paperwork, appraisers, and lenders are awake. Buyers mostly aren't."}`));
  const acts = el("div", "actions");
  const cand = Clients.nextIntakeCandidate();
  acts.appendChild(actionBtn(`Meet a new client${cand ? ` (${esc(DB.clients[cand.id].name)})` : ""}`, 1,
    !cand || activeClients().length >= clientSlotsMax(),
    () => { if (!spendSlots()) return; flowIntake(cand.id); }));
  acts.appendChild(actionBtn("Work the phones (small rep + knowledge)", 1, false, () => {
    if (!spendSlots()) return;
    addRep(1, "an afternoon of calls, favors, and being remembered");
    bumpKnowledge(pick(Object.keys(DB.neighborhoods)), 0.4);
    maybeFireEvent("any", 0.25); render();
  }));
  d.appendChild(acts);
  if (activeClients().length >= clientSlotsMax()) d.appendChild(el("p", "warn", `Client roster full (${clientSlotsMax()}). Close, fire, or level up.`));
  return d;
}

function schedulePanel() {
  const d = el("div");
  const upcoming = S.schedule.filter(it => it.day >= S.day && it.day < S.day + 7);
  if (!upcoming.length) d.appendChild(el("p", "muted", "Nothing on the calendar. In this business that's either peace or a problem."));
  upcoming.forEach(it => d.appendChild(el("div", "sched-row",
    `<span class="sched-day">${it.day === S.day ? "TODAY" : dayName(it.day)}</span> <span>${esc(it.label)}</span>`)));
  return d;
}

function dealsPanel() {
  const d = el("div");
  const buyDeals = S.deals.filter(x => ["offerPending", "underContract"].includes(x.stage));
  const sellDeals = S.playerListings.filter(p => ["live", "underContract", "prep"].includes(p.status));
  if (!buyDeals.length && !sellDeals.length) d.appendChild(el("p", "muted", "No live deals. The MLS board awaits."));
  buyDeals.forEach(deal => {
    const l = DB.listings[deal.listingId];
    const rec = getClientRec(deal.clientRecId);
    d.appendChild(el("div", "deal-row",
      `<b>${esc(contentClient(rec).name)}</b> buying ${esc(l.address)} — ${fmtMoney(deal.price)} <span class="tag">${esc(financingType(deal.financing).label)}</span> <span class="stamp stamp-sm">${deal.stage === "offerPending" ? "OFFER OUT" : "UNDER CONTRACT"}</span>`));
  });
  sellDeals.forEach(pl => {
    d.appendChild(el("div", "deal-row",
      `<b>${esc(pl.listing.address)}</b> (${esc(contentClient(getClientRec(pl.clientRecId)).name)}) — ${pl.status === "prep" ? "in prep" : pl.status === "live" ? `live at ${fmtMoney(pl.price)}, interest ${pl.interest.toFixed(1)}` : `under contract at ${fmtMoney(pl.acceptedOffer.price)}`}`));
  });
  return d;
}

// ---------------- CLIENTS ----------------
function renderClients(main) {
  const wrap = el("div");
  wrap.appendChild(el("p", "muted", `Roster: ${activeClients().length}/${clientSlotsMax()} active.`));
  S.clients.filter(c => c.status === "active").forEach(rec => wrap.appendChild(clientCard(rec)));
  const done = S.clients.filter(c => c.status !== "active");
  if (done.length) {
    wrap.appendChild(el("h3", "subhead", "Past clients"));
    done.forEach(rec => wrap.appendChild(el("div", "past-row",
      `${esc(contentClient(rec).name)} — ${({ closedBuyer: "bought a home", closedSeller: "sold their home", fired: "fired", walked: "walked" })[rec.status] || rec.status}${rec.referredBy ? ` · referred by ${esc(rec.referredBy.name)}` : ""}`)));
  }
  main.appendChild(wrap);
}

function clientCard(rec) {
  const c = contentClient(rec);
  const d = el("div", "card client-card");
  const patCls = rec.patience <= 2 ? "bad" : rec.patience <= 4 ? "warn" : "";
  d.appendChild(el("div", "client-head", `<b>${esc(c.name)}</b> <span class="tag">${c.type}</span> <span class="tag">${esc(c.archetype)}</span>${rec.referredBy ? ` <span class="tag tag-ref">via ${esc(rec.referredBy.name)}</span>` : ""}`));
  d.appendChild(el("p", "intro", esc(c.intro)));
  const facts = [];
  if (c.type === "buyer") facts.push(`Budget: <b>${fmtMoney(rec.budget)}</b>`, `Buying: <b>${esc(financingType(rec.financing).label)}</b>`, `Wants: ${c.statedReqs.minBeds || "?"}+ beds${(c.statedReqs.mustFeatures || []).length ? ", " + c.statedReqs.mustFeatures.map(esc).join(", ") : ""}`, `Areas: ${(c.statedReqs.neighborhoods || []).map(n => esc(DB.neighborhoods[n].name)).join(", ") || "flexible"}`);
  facts.push(`<span class="${patCls}">Patience: ${rec.patience}</span>`, `Mood: ${rec.mood}`, `Satisfaction: ${rec.satisfaction}`);
  if (c.statedReqs.notes) facts.push(`<span class="muted">${esc(c.statedReqs.notes)}</span>`);
  d.appendChild(el("p", "facts", facts.join(" · ")));
  if (c.type === "buyer") d.appendChild(el("p", "muted", esc(financingType(rec.financing).blurb)));
  rec.revealed.forEach(i => d.appendChild(el("p", "reveal-line", "◈ " + esc(c.hiddenPrefs[i].desc))));
  const acts = el("div", "actions");
  if (c.type === "buyer" && !rec.dealId) {
    acts.appendChild(actionBtn("Find homes (MLS)", 0, false, () => { mlsFilterClient = rec.recId; setScreen("mls"); }));
  }
  if (c.type === "seller" && !rec.dealId) {
    acts.appendChild(actionBtn("Take the listing", 1, false, () => { if (!spendSlots()) return; const pl = Seller.takeListing(rec); flowPrepListing(pl); }));
  }
  acts.appendChild(actionBtn("Schmooze ($120)", 1, S.cash < 120, () => {
    if (!spendSlots()) return; addCash(-120, `lunch with ${c.name}`, rec.recId);
    Clients.schmooze(rec); render();
  }));
  acts.appendChild(actionBtn("Fire client", 0, !!rec.dealId, () => confirmModal(`Part ways with ${esc(c.name)}? (−5 reputation, frees a slot)`, () => { Clients.fireClient(rec); render(); })));
  d.appendChild(acts);
  return d;
}

// ---------------- MLS BOARD ----------------
let mlsFilterClient = null;
let mlsSort = "price";
function renderMLS(main) {
  const bar = el("div", "filterbar");
  const clientOpts = [`<option value="">— no client lens —</option>`]
    .concat(activeClients().filter(r => contentClient(r).type === "buyer")
      .map(r => `<option value="${r.recId}" ${mlsFilterClient === r.recId ? "selected" : ""}>${esc(contentClient(r).name)}</option>`));
  bar.innerHTML = `
    <label>Client lens <select id="mlsClient">${clientOpts.join("")}</select></label>
    <label>Sort <select id="mlsSort">
      <option value="price" ${mlsSort === "price" ? "selected" : ""}>Price</option>
      <option value="dom" ${mlsSort === "dom" ? "selected" : ""}>Days on market</option>
      <option value="fit" ${mlsSort === "fit" ? "selected" : ""}>Fit (needs client)</option>
    </select></label>`;
  main.appendChild(bar);
  bar.querySelector("#mlsClient").onchange = e => { mlsFilterClient = e.target.value || null; render(); };
  bar.querySelector("#mlsSort").onchange = e => { mlsSort = e.target.value; render(); };

  const rec = mlsFilterClient ? getClientRec(mlsFilterClient) : null;
  const tiers = levelInfo().tiers;
  let rows = Object.values(DB.listings).filter(l => S.listingsState[l.id].status === "onMarket");
  rows.forEach(l => l._fit = rec ? Clients.fitScore(rec, l) : null);
  rows.sort((a, b) => mlsSort === "price" ? S.listingsState[a.id].price - S.listingsState[b.id].price
    : mlsSort === "dom" ? S.listingsState[b.id].dom - S.listingsState[a.id].dom
    : (b._fit || 0) - (a._fit || 0));
  const grid = el("div", "mls-grid");
  rows.forEach(l => grid.appendChild(listingCard(l, rec, tiers.includes(l.tier))));
  main.appendChild(grid);
}

function listingCard(l, rec, tierOK) {
  const ls = S.listingsState[l.id];
  const nb = DB.neighborhoods[l.neighborhood];
  const com = Com.isCommercial(l);
  const d = el("div", "flyer" + (tierOK ? "" : " locked") + (com ? " commercial" : ""));
  const stampTxt = ls.dom <= 7 ? "NEW" : ls.dom >= 45 ? "STALE" : "";
  // A commercial flyer leads with the arithmetic, because that is what a
  // commercial flyer leads with. Beds and baths on a six-bay strip would be a
  // number nobody asked for standing where the yield should be.
  const facts = com
    ? `${esc(nb.name)} · ${l.commercial.units} units · ${l.sqft.toLocaleString()} sqft · DOM ${ls.dom}`
    : `${esc(nb.name)} · ${l.beds}bd/${l.baths}ba · ${l.sqft.toLocaleString()} sqft · DOM ${ls.dom}`;
  d.innerHTML = `
    ${stampTxt ? `<span class="stamp">${stampTxt}</span>` : ""}
    <div class="flyer-price">${fmtMoney(ls.price)}</div>
    <div class="flyer-addr">${esc(l.address)}</div>
    <div class="flyer-nb">${facts}</div>
    ${com ? `<div class="flyer-uw">${esc(l.commercial.assetType)} · NOI <b>${fmtMoney(Com.noi(l))}</b> · <b>${Com.pct(Com.capAt(l, ls.price))}</b> at ask · ${Math.round(l.commercial.rollPct * 100)}% of the rent roll expires this year</div>` : ""}
    <div class="flyer-blurb">${esc(l.blurb)}</div>
    ${com ? `<div class="flyer-blurb muted">${esc(l.commercial.rentRoll)}</div>` : ""}
    <div class="flyer-feat">${l.features.map(f => `<span class="tag">${esc(f)}</span>`).join("")}</div>
    <div class="flyer-agent">Listed by ${esc(DB.agents[l.listingAgentId].name)}</div>
    ${rec ? `<div class="fitline">Fit for ${esc(contentClient(rec).name)}: <b class="${l._fit >= 65 ? "good" : l._fit >= 45 ? "" : "bad"}">${l._fit}</b>/100</div>` : ""}`;
  if (!tierOK) {
    d.appendChild(el("div", "lock-note", com
      ? "Commercial. The board opens these at Broker-Track, and not before."
      : "Above your current tier — level up to work this listing."));
    return d;
  }
  const acts = el("div", "actions");
  if (rec && !rec.dealId) {
    const viewed = rec.viewed[l.id];
    acts.appendChild(actionBtn(viewed ? "Show again" : "Schedule showing", 1, false, () => { if (!spendSlots()) return; flowViewing(rec, l); }));
    if (viewed) acts.appendChild(actionBtn("Write offer", 1, false, () => { if (!spendSlots()) return; flowOffer(rec, l); }));
  }
  d.appendChild(acts);
  return d;
}

// ---------------- MY LISTINGS (seller side) ----------------
function renderMyListings(main) {
  const list = S.playerListings.filter(p => p.status !== "sold");
  const sold = S.playerListings.filter(p => p.status === "sold");
  if (!list.length && !sold.length) main.appendChild(el("p", "muted", "No listings yet. Seller clients arrive through intake — treat them well; the whole street is watching."));
  list.forEach(pl => main.appendChild(playerListingCard(pl)));
  if (sold.length) {
    main.appendChild(el("h3", "subhead", "Sold"));
    sold.forEach(pl => main.appendChild(el("div", "past-row", `${esc(pl.listing.address)} — closed at ${fmtMoney(pl.acceptedOffer.price)}`)));
  }
}

function playerListingCard(pl) {
  const rec = getClientRec(pl.clientRecId);
  const d = el("div", "card");
  d.appendChild(el("div", "client-head", `<b>${esc(pl.listing.address)}</b> <span class="tag">${esc(DB.neighborhoods[pl.listing.neighborhood].name)}</span> <span class="stamp stamp-sm">${pl.status === "prep" ? "IN PREP" : pl.status === "live" ? "LIVE" : "UNDER CONTRACT"}</span>`));
  d.appendChild(el("p", "facts", `Seller: ${esc(contentClient(rec).name)} · ${pl.listing.beds}bd/${pl.listing.baths}ba · suggested value ${fmtMoney(suggested(pl))}${pl.price ? ` · listed ${fmtMoney(pl.price)}` : ""}${pl.status === "live" ? ` · DOM ${pl.dom} · interest ${pl.interest.toFixed(1)}` : ""}`));
  const acts = el("div", "actions");
  if (pl.status === "prep") acts.appendChild(actionBtn("Continue prep", 0, false, () => flowPrepListing(pl)));
  if (pl.status === "live") {
    acts.appendChild(actionBtn("Host open house (full day, weekend)", S.slotsLeft, !isWeekend(S.day), () => {
      S.slotsLeft = 0; flowOpenHouse(pl);
    }));
    acts.appendChild(actionBtn("Adjust price", 1, false, () => { if (!spendSlots()) return; flowReprice(pl); }));
    const open = pl.offers.filter(o => o.status === "open");
    if (open.length) acts.appendChild(actionBtn(
      Number.isFinite(pl.hbDeadline) ? `Review offers (${open.length}) — best due day ${pl.hbDeadline}`
        : Esc.canCallHighestAndBest(pl) ? `Review offers (${open.length}) — a field`
        : `Review offers (${open.length})`,
      1, false, () => { if (!spendSlots()) return; flowOfferReview(pl); }));
  }
  d.appendChild(acts);
  return d;
}

// ---------------- OFFICE ----------------
function renderOffice(main) {
  const lv = levelInfo();
  const wrap = el("div", "cols");
  const left = el("div", "col");
  const career = el("div");
  LEVELS.forEach(L => career.appendChild(el("div", "ladder-row " + (L.level === S.level ? "current" : L.level < S.level ? "done" : ""),
    `<b>${L.title}</b> — ${L.xp} XP · ${L.slots} client slots · ${L.tiers.join("/")}`)));
  left.appendChild(card("Career ladder", career));
  const stats = el("div");
  stats.innerHTML = `<p>Deals closed: <b>${S.stats.closed}</b> · Volume: <b>${fmtMoney(S.stats.volume)}</b> · Referrals earned: <b>${S.stats.referrals}</b> · Disclosures made: <b>${S.stats.honesty}</b></p>`;
  left.appendChild(card("Your numbers", stats));
  const right = el("div", "col");
  const bk = DB.brokerages[S.brokerageId];
  const bkDiv = el("div");
  bkDiv.innerHTML = `<p><b>${esc(bk.name)}</b> — split ${Math.round(bk.commissionSplit * 100)}% to you.</p>
    <p class="muted">${esc(bk.pitch)}</p>${(bk.perks || []).map(p => `<p>· ${esc(p)}</p>`).join("")}`;
  Object.values(DB.brokerages).filter(b => b.id !== S.brokerageId && S.rep >= b.reputationRequirement).forEach(b => {
    const row = el("div", "actions");
    row.appendChild(actionBtn(`Switch to ${b.name} (${Math.round(b.commissionSplit * 100)}% split)`, 0, false,
      () => confirmModal(`Leave ${esc(bk.name)} for ${esc(b.name)}?`, () => { S.brokerageId = b.id; log(`You've moved your license to ${b.name}.`, "milestone"); render(); })));
    bkDiv.appendChild(row);
  });
  right.appendChild(card("Brokerage", bkDiv));
  const know = el("div");
  Object.keys(DB.neighborhoods).forEach(id => know.appendChild(el("div", "know-row",
    `${esc(DB.neighborhoods[id].name)} <span class="know-pips">${"▮".repeat(Math.floor(S.knowledge[id] || 0))}${"▯".repeat(5 - Math.floor(S.knowledge[id] || 0))}</span>`)));
  right.appendChild(card("Local market knowledge", know));
  wrap.append(left, right); main.appendChild(wrap);
}

// ---------------- LOG ----------------
// A filter, not just a longer logPanel(8) — see the "this client only" option,
// which needs the roster (including past clients, since the ledger is
// historical) rather than logPanel's plain slice.
let ledgerFilter = "all";
function renderLog(main) {
  const bar = el("div", "filterbar");
  const clientOpts = S.clients.map(rec =>
    `<option value="client:${rec.recId}" ${ledgerFilter === "client:" + rec.recId ? "selected" : ""}>${esc(contentClient(rec).name)} only</option>`);
  bar.innerHTML = `
    <label>Filter <select id="ledgerFilter">
      <option value="all" ${ledgerFilter === "all" ? "selected" : ""}>Everything</option>
      <option value="money" ${ledgerFilter === "money" ? "selected" : ""}>Money only</option>
      <option value="rep" ${ledgerFilter === "rep" ? "selected" : ""}>Reputation only</option>
      ${clientOpts.join("")}
    </select></label>`;
  main.appendChild(bar);
  bar.querySelector("#ledgerFilter").onchange = e => { ledgerFilter = e.target.value; render(); };
  main.appendChild(card("Ledger", logPanel(80, ledgerFilter)));
}
function logPanel(n, filter = "all") {
  const d = el("div", "logpanel");
  let rows = S.log;
  if (filter === "money" || filter === "rep") rows = rows.filter(it => it.kind === filter);
  else if (filter.startsWith("client:")) {
    // Matches the stamped recId on the log entry, not the client's display
    // name — a substring match used to false-positive on two clients whose
    // names collide, or go stale the moment a client's name changed.
    const recId = filter.slice(7);
    rows = rows.filter(it => it.recId === recId);
  }
  rows.slice(0, n).forEach(it => d.appendChild(el("div", "log-row log-" + (it.cls || "plain"),
    `<span class="log-day">D${it.day}</span> ${esc(it.text)}`)));
  return d;
}


// ---------------- HALL ----------------
// The hall of past careers: every year that reached day 336, newest first,
// with the best on each count marked. Read from its own key on every render
// rather than cached, so an import or a just-closed year shows without a
// reload. The hall is not the career: "New career" wipes the desk and leaves
// this alone, and the export/import here move the hall on its own.
export function renderHall(main) {
  const hall = loadHall();
  const bests = hallBests(hall);
  const wrap = el("div");
  if (!hall.careers.length) {
    wrap.appendChild(el("p", "muted hall-empty",
      "No year has closed its books yet. A career that reaches day 336 is filed here, and stays filed when you start the next one."));
  } else {
    const rows = [...hall.careers].reverse();
    const bestMark = (e, k) => bests[k] === e.id && hall.careers.length > 1 ? ` <span class="hall-best" title="Best of your careers">★</span>` : "";
    rows.forEach(e => wrap.appendChild(el("div", "hall-row", `
      <div class="hall-head"><b>Career #${e.seq}</b> · ${esc(e.brokerage)} · <span class="muted">${esc(e.title)}, level ${e.level}</span></div>
      <div class="hall-line">Closings <b>${e.closings}</b>${bestMark(e, "closings")} · Volume <b>${fmtMoney(e.volume)}</b>${bestMark(e, "volume")} · Referrals <b>${e.referrals}</b> · Disclosures <b>${e.honesty}</b></div>
      <div class="hall-line">Reputation <b>${e.finalRep}</b>/100${bestMark(e, "finalRep")} · Cash on hand <b>${fmtMoney(e.cash)}</b>${bestMark(e, "cash")}${e.recordedAt ? ` · <span class="muted">filed ${esc(e.recordedAt.slice(0, 10))}</span>` : ""}</div>`)));
  }
  const acts = el("div", "actions hall-actions");
  const slot = hallSlot();
  const exportBtn = btn("Export hall", () => {
    if (!hall.careers.length) { toast("Nothing to export yet."); return; }
    toast("Saved to " + slot.exportToFile(hall));
  });
  exportBtn.dataset.hall = "export";
  const importBtn = btn("Import hall", () => {
    slot.promptImport().then(incoming => {
      const { added } = mergeHall(incoming);
      toast(added ? `${added} career${added === 1 ? "" : "s"} added to the hall.` : "Nothing new in that file.");
      render();
    }).catch(err => toast(err.message));
  });
  importBtn.dataset.hall = "import";
  acts.append(exportBtn, importBtn);
  wrap.appendChild(acts);
  const count = hall.careers.length;
  main.appendChild(card(`Hall of careers${count ? ` — ${count} year${count === 1 ? "" : "s"} on the wall` : ""}`, wrap));
}

// ---------------- FLOWS (modals) ----------------
function flowIntake(clientId) {
  const c = DB.clients[clientId];
  const rec = Clients.meetClient(clientId);
  const body = el("div");
  body.appendChild(el("p", "", esc(c.intro)));
  if (c.type === "buyer") body.appendChild(el("p", "facts", `Stated budget <b>${fmtMoney(c.budget)}</b> · ${c.statedReqs.minBeds || "?"}+ beds · ${(c.statedReqs.mustFeatures || []).map(esc).join(", ") || "no must-haves stated"} · areas: ${(c.statedReqs.neighborhoods || []).map(n => esc(DB.neighborhoods[n].name)).join(", ")}`));
  else body.appendChild(el("p", "facts", `Wants to sell: ${esc(c.sellerListing.address)}, ${esc(DB.neighborhoods[c.sellerListing.neighborhood].name)}.`));
  body.appendChild(el("p", "muted", esc(c.statedReqs.notes || "")));
  body.appendChild(el("p", "hint", "What they say and what they mean won't fully overlap. Viewings, questions, and lunches surface the rest."));
  modal(`New client: ${esc(c.name)}`, body, [["Welcome aboard", () => { closeModal(); render(); }]]);
}

function flowViewing(rec, l) {
  const res = Deals.startViewing(rec, l);
  const v = rec.viewed[l.id];
  const body = el("div");
  body.appendChild(el("p", "", `You walk ${esc(contentClient(rec).name)} through ${esc(l.address)}.${res.weekendBonus ? " Weekend light flatters everything, including the flaws." : ""}`));
  const issuesDiv = el("div");
  const renderIssues = () => {
    issuesDiv.innerHTML = "";
    v.revealedIssues.forEach(i => { const is = l.hiddenIssues[i];
      issuesDiv.appendChild(el("p", "issue issue-" + is.severity, `${is.severity.toUpperCase()}: ${esc(is.desc)} (${is.repairCost ? "est. " + fmtMoney(is.repairCost) : "no fix"})${is.disclosureRequired ? " · disclosure-required" : ""}`)); });
    if (!v.revealedIssues.length) issuesDiv.appendChild(el("p", "muted", "Nothing jumps out on the walkthrough."));
  };
  renderIssues();
  body.appendChild(issuesDiv);
  const qWrap = el("div", "actions");
  let questionsLeft = 2;
  const qNote = el("p", "hint", `Ask the listing agent (${esc(DB.agents[l.listingAgentId].name)}) about... (${questionsLeft} questions left)`);
  body.appendChild(qNote);
  Deals.askTopics(l).forEach(topic => {
    const b = el("button", "btn btn-sm", esc(topic));
    b.onclick = () => {
      if (questionsLeft <= 0 || v.askedTopics.includes(topic)) return;
      questionsLeft--; qNote.textContent = `Questions left: ${questionsLeft}`;
      const out = Deals.askQuestion(rec, l, topic);
      b.disabled = true;
      b.textContent = topic + (out.found.length ? " ✓ (found something)" : " — 'no known issues'");
      renderIssues();
    };
    qWrap.appendChild(b);
  });
  body.appendChild(qWrap);
  const fit = Clients.fitScore(rec, l);
  body.appendChild(el("p", "fitline", `Read on the client: fit <b>${fit}</b>/100. ${fit >= 70 ? "They're lingering in doorways. Good sign." : fit >= 50 ? "Polite interest. Convertible, maybe." : "They keep checking their phone."}`));
  modal(`Showing — ${esc(l.address)}`, body, [
    ["Tell them everything you know", () => { const fresh = Deals.discloseToClient(rec, l); toast(fresh.length ? "Disclosed. Trust noted." : "They already knew all of it."); }],
    [`Order full inspection ($450)`, () => { const found = Deals.orderPreInspection(rec, l); renderIssues(); toast(found.length ? `Inspector found ${found.length} more issue(s).` : "Inspection came back clean."); }],
    ["Wrap up", () => {
      if (fit < 45) { Clients.patienceTick(rec, 1, "(a mismatched showing)"); Clients.satisfactionDelta(rec, -3, "being shown a house that missed the brief"); }
      else { Clients.satisfactionDelta(rec, 2, "a showing worth their Saturday"); }
      bumpKnowledge(l.neighborhood, 0.2);
      closeModal(); render();
    }],
  ], true);
}

function flowOffer(rec, l) {
  const ls = S.listingsState[l.id];
  const com = Com.isCommercial(l);
  const body = el("div");
  const known = (rec.knownIssues[l.id] || []).reduce((s, i) => s + l.hiddenIssues[i].repairCost, 0);
  body.appendChild(el("p", "", `Ask: <b>${fmtMoney(ls.price)}</b> · est. value: <b>${fmtMoney(Math.round(trueValue(l)))}</b>${knowledgeEdge(l.neighborhood) >= 0.4 ? " (your read, sharpened by local knowledge)" : " (rough guess — you don't know this area well yet)"} · known issue costs: ${fmtMoney(known)} · client budget: <b>${fmtMoney(rec.budget)}</b>`));
  const priceIn = el("input"); priceIn.type = "number"; priceIn.value = Math.round(ls.price * 0.97 / 500) * 500; priceIn.step = 500; priceIn.className = "input-lg";
  body.appendChild(labelWrap("Offer price", priceIn));

  // The underwriting panel: the whole commercial tier, on one screen, live off
  // the price box. Every number here comes out of commercial.js rather than
  // being re-derived locally, so what the player reads and what the financing
  // milestone will do two weeks from now are the same arithmetic. The two red
  // lines are the two walls — the bank's and the client's — and neither one is
  // a surprise later if it was read here.
  if (com) {
    const uw = el("div", "underwriting");
    const paint = () => {
      const price = parseInt(priceIn.value, 10) || ls.price;
      const u = Com.underwrite(rec, l, price);
      uw.innerHTML = `
        <div class="uw-row">NOI <b>${fmtMoney(u.noi)}</b> · market cap <b>${Com.pct(u.cap)}</b> · modeled value <b>${fmtMoney(u.value)}</b>${u.knownCapex ? ` · capital you have found <b>${fmtMoney(u.knownCapex)}</b>` : ""}</div>
        <div class="uw-row">At ${fmtMoney(price)}: yield <b>${Com.pct(u.capAtPrice)}</b> · debt service <b>${fmtMoney(u.debtService)}</b> · coverage <b class="${u.sizes ? "good" : "bad"}">${Com.dscrText(u.dscr)}</b> against ${Com.DEBT.minDscr.toFixed(2)}x</div>
        ${u.sizes ? "" : `<div class="uw-row bad">The loan does not size here. The bank is short ${fmtMoney(u.shortfall)}; ${fmtMoney(u.sizingPrice)} is the number that finances at today's rate.</div>`}
        ${u.overCeiling ? `<div class="uw-row bad">Above what ${esc(contentClient(rec).name)} will pay: ${Com.pct(Com.requiredCap(rec))} on this building is ${fmtMoney(u.ceiling)}.</div>` : ""}`;
    };
    priceIn.oninput = paint;
    paint();
    body.appendChild(uw);
  }
  // The financing type is the client's, not a field on this form — you write the
  // offer your buyer can actually write. What it changes is spelled out here
  // rather than left for the player to infer from a rejection: a cash buyer has
  // no appraisal to waive and can close in two weeks, an FHA buyer cannot close
  // inside a month and arrives looking weaker than their price.
  const f = financingType(rec.financing);
  const strengthWord = f.strength > 0 ? "reads stronger than the number on it"
    : f.strength < 0 ? "reads weaker than the number on it" : "reads as written";
  body.appendChild(el("p", "muted",
    `Financing: <b>${esc(f.label)}</b> — ${esc(f.blurb)} To ${esc(DB.agents[l.listingAgentId].name)} this offer ${strengthWord}.`));

  const waiveIns = checkbox("Waive inspection (stronger offer, riskier)");
  const waiveApp = checkbox(f.needsAppraisal ? "Waive appraisal contingency" : "Waive appraisal contingency — no lender, nothing to waive");
  waiveApp.input.disabled = !f.needsAppraisal;
  const closeDays = closeDaysFor(rec.financing);
  const closeSel = el("select"); closeDays.forEach(d => closeSel.appendChild(el("option", "", d + " days")));
  closeSel.selectedIndex = Math.min(1, closeDays.length - 1);
  body.append(waiveIns.wrap, waiveApp.wrap, labelWrap("Close in", closeSel));

  // The escalation clause, the same instrument the NPC agents point at you.
  // Collapsed behind its own checkbox because it is the one term on this form
  // that can cost the client money they never agreed to in the room, and the
  // hint says the price of it out loud: the listing agent reads the cap.
  const useEsc = checkbox("Attach an escalation clause");
  const capIn = el("input"); capIn.type = "number"; capIn.step = 500;
  capIn.value = Math.min(Math.round(rec.budget / 500) * 500, Math.round(ls.price * 1.04 / 500) * 500);
  const incIn = el("input"); incIn.type = "number"; incIn.step = 500; incIn.value = 1000;
  const escWrap = el("div", "esc-clause");
  escWrap.append(labelWrap("Beat any competing offer by", incIn), labelWrap("…up to a cap of", capIn));
  escWrap.appendChild(el("p", "hint", `Reads stronger on paper, and tells ${esc(DB.agents[l.listingAgentId].name)} exactly how high you will go. They will counter at the cap.`));
  escWrap.hidden = true;
  useEsc.input.onchange = () => { escWrap.hidden = !useEsc.input.checked; };
  body.append(useEsc.wrap, escWrap);

  const agent = DB.agents[l.listingAgentId];
  body.appendChild(el("p", "muted", `${esc(agent.name)} — ${esc(agent.bio)}`));
  modal(`Offer — ${esc(l.address)}`, body, [
    ["Submit offer", () => {
      const price = parseInt(priceIn.value, 10) || ls.price;
      if (price > rec.budget * 1.1) { toast("Your client laughs, not warmly. That's beyond even their stretch."); return; }
      // An investor's stated yield is a wall in the same way a buyer's budget
      // is: 10% of stretch in it, and past that they simply do not sign. Inside
      // the stretch it costs satisfaction below, because a yield you talked
      // them past is a yield they will remember at the closing table.
      const ceiling = com ? Com.investorCeiling(rec, l) : Infinity;
      if (price > ceiling * 1.1) {
        toast(`${contentClient(rec).name} puts the pen down. At ${fmtMoney(price)} this building yields ${Com.pct(Com.capAt(l, price))}, and they told you ${Com.pct(Com.requiredCap(rec))}.`);
        return;
      }
      const escalation = useEsc.input.checked
        ? { cap: parseInt(capIn.value, 10), increment: parseInt(incIn.value, 10) || 1000 }
        : null;
      if (escalation && escalation.cap > rec.budget * 1.1) { toast("A cap your client cannot reach is a promise you cannot keep."); return; }
      const deal = Deals.writeOffer(rec, l, price, { waiveInspection: waiveIns.input.checked, waiveAppraisal: waiveApp.input.checked, closeDays: closeDays[closeSel.selectedIndex], escalation });
      if (price > rec.budget) Clients.satisfactionDelta(rec, -4, "you pushing past their stated budget");
      if (com && price > ceiling) Clients.satisfactionDelta(rec, -5, "an offer priced above the yield they gave you");
      closeModal(); flowNegotiate(deal, price);
    }],
    ["Cancel", () => { S.slotsLeft++; closeModal(); render(); }],
  ]);
}

function flowNegotiate(deal, price) {
  const l = DB.listings[deal.listingId];
  const rec = getClientRec(deal.clientRecId);
  const agent = DB.agents[deal.agentId];
  const resp = Deals.agentRespond(deal, price);
  const body = el("div");
  body.appendChild(el("p", "npc-say", `${esc(agent.name)}: “${esc(resp.say)}”`));
  if (resp.verdict === "accept") {
    deal.price = price; Deals.acceptDeal(deal);
    modal("Offer accepted", body, [["Shake on it", () => { closeModal(); render(); }]]);
    return;
  }
  if (resp.verdict === "reject") {
    deal.stage = "dead"; rec.dealId = null;
    Clients.satisfactionDelta(rec, -5, "the rejection");
    modal("Offer rejected", body, [["Walk away", () => { closeModal(); render(); }]]);
    return;
  }
  body.appendChild(el("p", "", `Counter: <b>${fmtMoney(resp.counter)}</b> (your last: ${fmtMoney(price)} · budget: ${fmtMoney(rec.budget)})`));
  if (resp.readTheClause) body.appendChild(el("p", "hint", `They countered at your cap. They read the clause — that is what a clause costs when nobody is actually bidding against you.`));
  const counterIn = el("input"); counterIn.type = "number"; counterIn.value = Math.round((price + resp.counter) / 2 / 500) * 500; counterIn.step = 500; counterIn.className = "input-lg";
  body.appendChild(labelWrap("Counter back at", counterIn));
  modal(`Negotiation, round ${deal.round} — ${esc(l.address)}`, body, [
    ["Accept their counter", () => { deal.price = resp.counter; if (resp.counter > rec.budget) Clients.satisfactionDelta(rec, -6, "accepting a number past their budget"); Deals.acceptDeal(deal); closeModal(); render(); }],
    ["Counter back", () => { const p = parseInt(counterIn.value, 10) || price; closeModal(); flowNegotiate(deal, p); }],
    ["Walk away", () => { deal.stage = "dead"; rec.dealId = null; log(`You walk from ${l.address}. ${agent.name} pretends not to care.`, "", undefined, rec.recId); Clients.satisfactionDelta(rec, 2, "you refusing to overpay"); closeModal(); render(); }],
  ]);
}

// ----- Seller prep / reprice / offer review / open house -----
function flowPrepListing(pl) {
  const rec = getClientRec(pl.clientRecId);
  const body = el("div");
  body.appendChild(el("p", "", `Walkthrough at ${esc(pl.listing.address)}. Suggested value: <b>${fmtMoney(suggested(pl))}</b>.`));
  pl.listing.issues.forEach((is, i) => {
    if (is.discovery === "inspection" && !pl.preInspected) return;
    const row = el("div", "issue issue-" + is.severity);
    row.innerHTML = `${is.severity.toUpperCase()}: ${esc(is.desc)} (${is.repairCost ? fmtMoney(is.repairCost) : "n/a"})${is.disclosureRequired ? " · disclosure-required" : ""} `;
    if (!pl.repairsDone.includes(i)) {
      if (is.repairCost > 0) { const fix = el("button", "btn btn-sm", "Repair (seller pays, +value)"); fix.onclick = () => { Seller.doRepair(pl, i); flowRefresh(() => flowPrepListing(pl)); }; row.appendChild(fix); }
      if (is.disclosureRequired && !pl.disclosed.includes(i)) { const dis = el("button", "btn btn-sm", "Disclose"); dis.onclick = () => { Seller.discloseIssue(pl, i); flowRefresh(() => flowPrepListing(pl)); }; row.appendChild(dis); }
    } else row.append(" ✓ repaired");
    body.appendChild(row);
  });
  if (!pl.preInspected) {
    const insBtn = el("button", "btn btn-sm", "Pre-listing inspection ($450) — find what the buyer's inspector will");
    insBtn.onclick = () => { addCash(-450, "pre-listing inspection", rec.recId); pl.preInspected = true; flowRefresh(() => flowPrepListing(pl)); };
    body.appendChild(insBtn);
  }
  const stageSel = el("select"); ["No staging ($0)", "Light staging ($500)", "Full staging ($1,500)"].forEach(t => stageSel.appendChild(el("option", "", t)));
  stageSel.selectedIndex = pl.staged;
  const photoSel = el("select"); ["Phone photos ($0)", "Pro photos ($300)", "Twilight + drone ($900)"].forEach(t => photoSel.appendChild(el("option", "", t)));
  const priceIn = el("input"); priceIn.type = "number"; priceIn.value = suggested(pl); priceIn.step = 1000; priceIn.className = "input-lg";
  body.append(labelWrap("Staging", stageSel), labelWrap("Photography", photoSel), labelWrap("List price", priceIn));
  body.appendChild(el("p", "hint", "Price under value: fast interest, seller side-eye. Over value: crickets, then a price-cut conversation nobody enjoys."));
  modal(`Prep listing — ${esc(pl.listing.address)}`, body, [
    ["Go live", () => {
      const stageCost = [0, 500, 1500][stageSel.selectedIndex], photoCost = [0, 300, 900][photoSel.selectedIndex];
      if (stageCost + photoCost > S.cash) { toast("You can't front that much for staging and photos right now."); return; }
      if (stageCost + photoCost > 0) addCash(-(stageCost + photoCost), "listing prep at " + pl.listing.address, rec.recId);
      Seller.setStaging(pl, stageSel.selectedIndex);
      Seller.goLive(pl, parseInt(priceIn.value, 10) || suggested(pl), photoSel.selectedIndex);
      closeModal(); render();
    }],
    ["Save for later", () => { closeModal(); render(); }],
  ], true);
}

function flowReprice(pl) {
  const body = el("div");
  const priceIn = el("input"); priceIn.type = "number"; priceIn.value = pl.price; priceIn.step = 1000; priceIn.className = "input-lg";
  body.append(el("p", "", `Currently ${fmtMoney(pl.price)}; value ~${fmtMoney(suggested(pl))}; DOM ${pl.dom}; interest ${pl.interest.toFixed(1)}.`), labelWrap("New price", priceIn));
  modal(`Reprice — ${esc(pl.listing.address)}`, body, [["Update", () => {
    const p = parseInt(priceIn.value, 10);
    if (p < pl.price) {
      const rec = getClientRec(pl.clientRecId);
      Clients.satisfactionDelta(rec, -3, "the price cut");
      log(`Price improved (the polite term): ${pl.listing.address} → ${fmtMoney(p)}.`, "", undefined, rec && rec.recId);
    }
    pl.price = p; closeModal(); render();
  }], ["Cancel", () => { S.slotsLeft++; closeModal(); render(); }]]);
}

function flowOfferReview(pl) {
  const body = el("div");
  // The list is the RESOLVED field now, not the raw offers. A clause that is
  // worth $2,500 more than its paper has to say so on the card the player
  // decides from — the arithmetic is in escalation.js and nothing here
  // re-implements it (#34).
  const field = Esc.resolveField(Esc.openOffers(pl));
  if (field.length > 1) {
    const clauses = field.filter(r => r.clause).length;
    body.appendChild(el("p", "hint", `${field.length} offers on the table${clauses ? `, ${clauses} carrying an escalation clause` : ""}. Ranked by what each one is worth against the others, not by what is written on it.`));
  }
  field.forEach((r, i) => {
    const o = r.offer;
    const a = DB.agents[o.agentId];
    const reaction = Seller.sellerReaction(pl, o, r.final);
    const row = el("div", "card offer-row");
    const escalated = r.final > r.base;
    row.innerHTML = `<b>${fmtMoney(r.final)}</b>${escalated ? ` <span class="tag">escalated from ${fmtMoney(r.base)}</span>` : ""}${i === 0 && field.length > 1 ? ` <span class="stamp stamp-sm">LEADING</span>` : ""} — ${esc(a.name)} (${esc(a.negotiationStyle)}) · ${esc(financingType(o.financing).label)}${o.inspection ? "" : " · inspection waived"} · close ${o.closeDays}d
      ${r.clause ? `<div class="hint">Fine print: escalates ${fmtMoney(r.clause.increment)} over any competing offer, cap ${fmtMoney(r.clause.cap)}.${r.capped ? " They are at the cap and still behind." : escalated ? ` Beating the ${fmtMoney(r.beat)} behind it.` : " Nothing to beat yet."}</div>` : ""}
      <div class="muted">Seller's read: ${reaction.notes.map(esc).join(" ") || (reaction.inclination > 0 ? "Warm-ish." : "Unimpressed.")}</div>`;
    const acts = el("div", "actions");
    const counterIn = el("input"); counterIn.type = "number"; counterIn.value = Math.min(pl.price, Math.round(r.final * 1.03 / 500) * 500); counterIn.step = 500;
    acts.appendChild(btn("Advise accept", () => { Seller.respondToOffer(pl, o, "accept"); closeModal(); render(); }));
    acts.append(counterIn, btn("Counter", () => { const res = Seller.respondToOffer(pl, o, "counter", parseInt(counterIn.value, 10)); closeModal(); if (res.recounter) flowOfferReview(pl); else render(); }));
    acts.appendChild(btn("Reject", () => { Seller.respondToOffer(pl, o, "reject"); flowRefresh(() => pl.offers.some(x => x.status === "open") ? flowOfferReview(pl) : (closeModal(), render())); }));
    row.appendChild(acts);
    body.appendChild(row);
  });
  if (!field.length) body.appendChild(el("p", "muted", "No open offers."));

  const actions = [];
  if (Esc.canCallHighestAndBest(pl)) {
    actions.push(["Call for highest and best", () => { closeModal(); flowCallHighestAndBest(pl); }]);
  } else if (Number.isFinite(pl.hbDeadline)) {
    body.appendChild(el("p", "hint", `Highest and best is out: answers due day ${pl.hbDeadline}. Nothing to do until then.`));
  } else if (pl.hbCalledDay) {
    body.appendChild(el("p", "muted", "You have already called highest and best on this listing. You get one."));
  }
  actions.push(["Close folder", () => { closeModal(); render(); }]);
  modal(`Offers — ${esc(pl.listing.address)}`, body, actions, true);
}

/**
 * The call itself, with its price on the label.
 *
 * A confirmation step rather than a straight button because this is the one
 * seller-side move that can end with nothing on the table — `lowballer` walks
 * 45% of the time before the cold-market multiplier, and a cold field can empty
 * entirely. The preview says how warm the neighborhood is so the gamble is a
 * read rather than a coin flip.
 */
function flowCallHighestAndBest(pl) {
  const p = Esc.highestAndBestPreview(pl);
  const body = el("div");
  body.appendChild(el("p", "", `You tell every buyer's agent on ${esc(pl.listing.address)} that the field closes in ${Esc.HB_DEADLINE_DAYS} days and you want their best number. Right now the top of the table is <b>${fmtMoney(p.top)}</b> across ${p.count} offers${p.clauses ? `, ${p.clauses} of them escalating` : ""}.`));
  body.appendChild(el("p", "muted", `The neighborhood is running ${p.heat >= 1.08 ? "hot — buyers here raise rather than leave" : p.heat <= 0.95 ? "cold, and a cold field walks" : "about even"} (heat ${p.heat.toFixed(2)}). Everyone answers or withdraws. Nobody splits the difference, and asking for a best number is how you find out you did not have a field.`));
  body.appendChild(el("p", "hint", "One call per listing. Offers stay open until the deadline instead of expiring."));
  modal(`Highest and best — ${esc(pl.listing.address)}`, body, [
    ["Make the call", () => { Esc.callHighestAndBest(pl); closeModal(); render(); }],
    ["Not yet", () => { S.slotsLeft++; closeModal(); render(); }],
  ]);
}

function flowOpenHouse(pl) {
  S.pendingLowball = null;
  maybeFireEvent("openHouse", 0.5);
  const oh = Seller.runOpenHouse(pl);
  let i = 0, captured = 0; const honesty = { honest: 0, spin: 0 };
  const step = () => {
    if (S.pendingLowball) { const lb = S.pendingLowball; S.pendingLowball = null; return lowballStep(lb); }
    if (i >= oh.visitors.length) return finish();
    const vis = oh.visitors[i++];
    const body = el("div");
    body.appendChild(el("p", "", esc(vis.text)));
    const btns = [];
    if (vis.honestyTest) {
      btns.push(["Answer straight — list the known flaws", () => { honesty.honest++; captured += vis.interest * 1.1; step2(); }]);
      btns.push(["Spin it — 'every house has quirks'", () => { honesty.spin++; captured += vis.interest * 0.7; step2(); }]);
    } else {
      btns.push(["Work the room (talk it up)", () => { captured += vis.interest; step2(); }]);
      btns.push(["Let the house speak (note their signals)", () => { captured += vis.interest * 0.8; pl.interest += 0.2; step2(); }]);
    }
    if (vis.knowledge) btns.push(["Pump the neighbor for gossip", () => { bumpKnowledge(pl.listing.neighborhood, 0.7); captured += 0.1; step2(); }]);
    const step2 = () => { closeModal(); step(); };
    modal(`Open house — visitor ${i}/${oh.visitors.length}`, body, btns);
  };
  const lowballStep = (lb) => {
    const price = Math.round(pl.price * (lb.pctMin + rand() * (lb.pctMax - lb.pctMin)) / 500) * 500;
    const body = el("div", "", `<p>A visitor corners you by the island: cash, no contingencies, <b>${fmtMoney(price)}</b>, "today only."</p>`);
    modal("Lowball, live", body, [
      ["Take it to your seller as a real offer", () => {
        pl.offers.push({ id: "off_lb" + S.day, agentId: "ag_sal_dimeo", price, financing: "cash", inspection: false, closeDays: 14, day: S.day, status: "open", escalation: null });
        const rec = getClientRec(pl.clientRecId);
        log(`Verbal lowball formalized: ${fmtMoney(price)} cash on ${pl.listing.address}.`, "deal", undefined, rec && rec.recId);
        closeModal(); step();
      }],
      ["Decline with a smile", () => { closeModal(); step(); }],
    ]);
  };
  const finish = () => {
    Seller.finishOpenHouse(pl, captured, honesty);
    modal("Open house wrapped", el("p", "", `${oh.traffic} through the door. Interest captured: ${captured.toFixed(1)}. Sign-in sheet has ${Math.round(captured * 2)} names, one of which is fake.`), [["Lock up", () => { closeModal(); render(); }]]);
  };
  step();
}

// ---------------- CHOICE QUEUE (events & milestone decisions) ----------------
function renderChoiceQueue() {
  if (!S.choiceQueue.length || $("#modal-root").childElementCount) return;
  const ch = S.choiceQueue[0];
  const done = () => { S.choiceQueue.shift(); closeModal(); render(); };
  const deal = ch.dealId ? S.deals.find(d => d.id === ch.dealId) : null;
  const pl = ch.plId ? S.playerListings.find(p => p.id === ch.plId) : null;
  const body = el("div"); body.appendChild(el("p", "", esc(ch.text)));
  const M = { 
    inspectionResult: () => modal("Inspection results", body, [
      ["Demand a repair credit", () => { Deals.inspectionDecision(deal, "credit", ch.totalCost); done(); }],
      ["Proceed as-is", () => { Deals.inspectionDecision(deal, "asis", ch.totalCost); done(); }],
      ["Advise the client to walk", () => { Deals.inspectionDecision(deal, "walk", ch.totalCost); done(); }]]),
    loanShortfall: () => modal("The loan will not size", body, [
      ["Buyer puts in more equity", () => { Deals.loanShortfallDecision(deal, "cover", ch.shortfall, ch.sizingPrice); done(); }],
      ["Push the seller to the number that finances", () => { Deals.loanShortfallDecision(deal, "renegotiate", ch.shortfall, ch.sizingPrice); done(); }],
      ["Let it die", () => { Deals.loanShortfallDecision(deal, "die", ch.shortfall, ch.sizingPrice); done(); }]]),
    appraisalGap: () => modal("Appraisal gap", body, [
      ["Buyer covers the gap in cash", () => { Deals.appraisalDecision(deal, "cover", ch.gap); done(); }],
      ["Push seller down to appraisal", () => { Deals.appraisalDecision(deal, "renegotiate", ch.gap); done(); }],
      ["Let it die", () => { Deals.appraisalDecision(deal, "die", ch.gap); done(); }]]),
    competingOffer: () => { const buyerRec = getClientRec(deal.clientRecId);
      // A clause is the decision you already made, in writing. The rival number
      // is the one the event implies: what your price would have to become to
      // stay in front of it.
      const clause = Esc.clauseOf(deal);
      const rival = Math.round(deal.price * (1 + ch.bumpPct) / 500) * 500;
      const acts = [];
      if (clause) {
        const preview = Esc.escalateAgainst(deal, rival);
        body.appendChild(el("p", "hint", `Your clause is already on the paper: ${fmtMoney(clause.increment)} over any competing offer, cap ${fmtMoney(clause.cap)}. Against ${fmtMoney(rival)} it lands at <b>${fmtMoney(preview.final)}</b>${preview.capped ? " — the cap, which may not be enough" : ""}.`));
        acts.push(["Let the clause do it", () => { Deals.fireBuyerClause(deal, rival); done(); }]);
      }
      acts.push(["Raise your offer", () => { deal.price = rival; log(`You raise to ${fmtMoney(deal.price)} to hold position.`, "deal", undefined, buyerRec && buyerRec.recId); done(); }]);
      acts.push(["Stand pat", () => { if (rand() < 0.4) Deals.killDeal(deal, "the other offer won."); else log("You stand pat. The other offer blinks first.", "deal", undefined, buyerRec && buyerRec.recId); done(); }]);
      acts.push(["Withdraw", () => { Deals.killDeal(deal, "you withdrew rather than bid up."); done(); }]);
      return modal("Competing offer", body, acts); },
    coldFeet: () => { const buyerRec = getClientRec(deal.clientRecId); return modal("Cold feet", body, [
      ["Talk them through it (schmooze on the house)", () => { addCash(-120, "emergency reassurance dinner", buyerRec && buyerRec.recId); log("Two hours, one dessert, zero cancelled contracts.", "", undefined, buyerRec && buyerRec.recId); done(); }],
      ["Give them space", () => { if (rand() < ch.walkChance) Deals.killDeal(deal, "the buyer walked after a long night of doubt."); else log("They call back at 8am: 'Ignore me. We're good.'", "", undefined, buyerRec && buyerRec.recId); done(); }]]); },
    coldFeetSeller: () => { const sellerRec = getClientRec(pl.clientRecId); return modal("Seller cold feet", body, [
      ["Sit with them at the kitchen table", () => { addCash(-120, "a long talk over coffee", sellerRec && sellerRec.recId); log("The house stays sold. The kitchen table did its job.", "", undefined, sellerRec && sellerRec.recId); done(); }],
      ["Give them space", () => { if (rand() < ch.walkChance) Seller.failSellerDeal(pl, "the seller pulled out"); else log("They come around by morning.", "", undefined, sellerRec && sellerRec.recId); done(); }]]); },
    highestAndBest: () => {
      // The ladder, in the order the seller will read it, with the reasoning on
      // each rung. describeRow() is escalation.js's own sentence — the modal
      // does not re-derive who beat whom.
      const field = Esc.resolveField(Esc.openOffers(pl));
      const list = el("div");
      // Counted here rather than carried on the choice: a fresh offer can land
      // between the call resolving and this modal rendering, and a number
      // written two days ago over a list drawn now is just wrong.
      body.appendChild(el("p", "hint", field.length
        ? `${field.length} offer${field.length === 1 ? "" : "s"} on the table as it stands.`
        : "Nothing on the table."));
      field.forEach((r, i) => list.appendChild(el("div", i === 0 ? "card offer-row" : "past-row",
        `${i === 0 ? "<b>Leading</b> · " : ""}${esc(Esc.describeRow(r))}`)));
      if (!field.length) list.appendChild(el("p", "muted", "Nothing left standing."));
      body.appendChild(list);
      return modal(`Highest and best — ${esc(pl.listing.address)}`, body, [
        ["Open the folder", () => { S.choiceQueue.shift(); closeModal(); if (Esc.openOffers(pl).length) flowOfferReview(pl); else render(); }]], true);
    },
    sellerInspectionHit: () => { const sellerRec = getClientRec(pl.clientRecId); return modal("Buyer's inspection findings", body, [
      ["Offer a credit (~70% of cost)", () => { Seller.sellerInspectionDecision(pl, "credit", ch.cost); if (ch.undisclosedRequired) addRep(-6, "an undisclosed required issue surfaced under contract", sellerRec && sellerRec.recId); done(); }],
      ["Refuse — dare them to walk", () => { Seller.sellerInspectionDecision(pl, "refuse", ch.cost); if (ch.undisclosedRequired) addRep(-6, "an undisclosed required issue surfaced under contract", sellerRec && sellerRec.recId); done(); }]]); },
    poach: () => { const rec2 = getClientRec(ch.recId); const a = DB.agents[ch.agentId];
      modal("Poaching attempt", body, [
        ["Counter-schmooze immediately ($200)", () => { addCash(-200, "damage-control dinner", rec2.recId); log(`${contentClient(rec2).name} stays. ${a.name} sends a winking emoji.`, "", undefined, rec2.recId); done(); }],
        ["Trust the relationship", () => {
          const stay = ch.resistBase + rec2.satisfaction / 200 + (rec2.referredBy ? 0.15 : 0);
          if (rand() < stay) log(`${contentClient(rec2).name} laughs it off. Loyalty: earned.`, "", undefined, rec2.recId);
          else { rec2.status = "walked"; rec2.dealId = null; log(`${contentClient(rec2).name} signs with ${a.name}. It stings exactly as much as you'd think.`, "bad", undefined, rec2.recId); }
          done(); }]]); },
    brokerageOffer: () => { const b = DB.brokerages[ch.brokerageId];
      body.appendChild(el("p", "muted", esc(b.pitch)));
      body.appendChild(el("p", "", `Split: <b>${Math.round(b.commissionSplit * 100)}%</b> to you${b.signingBonus ? ` · signing bonus <b>${fmtMoney(b.signingBonus)}</b>` : ""}.`));
      modal(`Recruitment — ${esc(b.name)}`, body, [
        ["Sign with them", () => { S.brokerageId = b.id; if (b.signingBonus) addCash(b.signingBonus, "signing bonus"); log(`You've joined ${b.name}.`, "milestone"); done(); }],
        ["Decline politely", () => { log(`You pass on ${b.name}. Doors like this tend to reopen. Usually.`, ""); done(); }]]); },
    referralArrive: () => { const c = DB.clients[ch.clientId];
      modal("Referral", body, [
        ["Take them on", () => {
          if (activeClients().length >= clientSlotsMax()) { toast("Roster full — free a slot first."); return; }
          Clients.meetClient(ch.clientId, ch.referredBy); done(); }],
        ["Pass (they'll find someone)", () => { S.clientQueue = S.clientQueue.filter(id => id !== ch.clientId).concat(ch.clientId); done(); }]]); },
  };
  (M[ch.kind] || (() => { S.choiceQueue.shift(); }))();
}

// ---------------- CAREER END ----------------
// Dismissable per page load, not per save — reopening on the next visit is a
// feature (nothing else on this screen replaces "the career you finished"),
// and closeModal()/renderChoiceQueue() would otherwise reopen it on every nav
// click once dismissed, since S.careerEnded never goes back to false.
let scorecardDismissed = false;
function renderScorecard() {
  if (!S.careerEnded || scorecardDismissed || $("#modal-root").childElementCount) return;
  const sc = S.scorecard || {};
  const body = el("div");
  body.appendChild(el("p", "", `Alder Falls, day ${sc.day ?? S.day}. The books close on year one.`));
  const stats = el("div");
  stats.innerHTML = `
    <p>Final title: <b>${esc(sc.title ?? levelInfo().title)}</b> (level ${sc.level ?? S.level})</p>
    <p>Deals closed: <b>${sc.closings ?? S.stats.closed}</b> · Volume: <b>${fmtMoney(sc.volume ?? S.stats.volume)}</b></p>
    <p>Referrals earned: <b>${sc.referrals ?? S.stats.referrals}</b></p>
    <p>Final reputation: <b>${sc.finalRep ?? S.rep}</b>/100</p>
    <p>Cash on hand: <b>${fmtMoney(sc.cash ?? S.cash)}</b></p>`;
  body.appendChild(stats);
  const filed = loadHall().careers.find(e => e.id === S.careerId);
  body.appendChild(el("p", "hall-note", filed
    ? `Filed in your hall as career #${filed.seq}. It stays there when you start the next one.`
    : "This year could not be filed in your hall — this browser blocks storage, so export the career before you close the tab."));
  body.appendChild(el("p", "hint", "Start fresh right now, or keep browsing the finished desk — “New career” in the footer does the same thing later."));
  modal("Year one, closed", body, [
    ["Start a new career", () => confirmModal("Start a new career at Alder Falls? This desk will be wiped; the hall keeps the year.", () => { wipeSave(); location.reload(); })],
    ["See the hall", () => { scorecardDismissed = true; closeModal(); setScreen("hall"); }],
    ["Keep browsing the desk", () => { scorecardDismissed = true; closeModal(); }],
  ], true);
}

// ---------------- WIDGETS ----------------
function card(title, contentEl) { const d = el("div", "card"); d.appendChild(el("h2", "card-title", esc(title))); d.appendChild(contentEl); return d; }
function actionBtn(label, cost, disabled, fn) {
  const b = el("button", "btn", `${label}${cost ? ` <span class="cost">${"●".repeat(cost)}</span>` : ""}`);
  b.disabled = disabled || (cost > 0 && S.slotsLeft < cost);
  b.onclick = fn; return b;
}
function btn(label, fn) { const b = el("button", "btn btn-sm", label); b.onclick = fn; return b; }
function labelWrap(text, input) { const w = el("label", "field"); w.appendChild(el("span", "field-label", text)); w.appendChild(input); return w; }
function checkbox(text) { const wrap = el("label", "check"); const input = el("input"); input.type = "checkbox"; wrap.append(input, document.createTextNode(" " + text)); return { wrap, input }; }

let modalStack = 0;
function modal(title, bodyEl, buttons, wide = false) {
  const root = $("#modal-root"); root.innerHTML = "";
  const back = el("div", "modal-back");
  const box = el("div", "modal" + (wide ? " modal-wide" : ""));
  box.appendChild(el("h2", "modal-title", title));
  box.appendChild(bodyEl);
  const acts = el("div", "actions modal-actions");
  buttons.forEach(([label, fn]) => { const b = el("button", "btn", label); b.onclick = fn; acts.appendChild(b); });
  box.appendChild(acts); back.appendChild(box); root.appendChild(back);
  box.querySelector("button")?.focus();
}
function closeModal() { $("#modal-root").innerHTML = ""; renderChoiceQueue(); }
function flowRefresh(reopen) { closeModal(); reopen(); }
function toast(text) {
  const t = el("div", "toast", esc(text)); document.body.appendChild(t);
  setTimeout(() => t.classList.add("show"), 10); setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, 2600);
}

export { toast, modal, closeModal };
function confirmModal(text, yes) { modal("Confirm", el("p", "", text), [["Yes", () => { closeModal(); yes(); }], ["No", () => closeModal()]]); }
