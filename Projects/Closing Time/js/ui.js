// ui.js — rendering + interaction flows. All engine mutation goes through engine modules.
import { DB, fmtMoney } from "./data.js";
import { S, save, dayName, isWeekend, weekOf, seasonOf, levelInfo, LEVELS, activeClients, clientSlotsMax,
         getClientRec, contentClient, log, addRep, addCash, rand, pick } from "./state.js";
import { SLOTS_PER_DAY, spendSlots, endDay } from "./engine/calendar.js";
import { marketHeat, trueValue, suggested, bumpKnowledge, knowledgeEdge, playerListingValue } from "./engine/marketFacade.js";
import * as Clients from "./engine/clients.js";
import * as Deals from "./engine/deals.js";
import * as Seller from "./engine/seller.js";
import { maybeFireEvent } from "./engine/events.js";

let screen = "dashboard";
const $ = sel => document.querySelector(sel);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function render() {
  renderTopbar(); renderNav();
  const main = $("#main"); main.innerHTML = "";
  ({ dashboard: renderDashboard, clients: renderClients, mls: renderMLS,
     mylistings: renderMyListings, office: renderOffice, log: renderLog }[screen])(main);
  renderChoiceQueue();
  save();
}

function setScreen(s) { screen = s; render(); }

// ---------------- TOP BAR / NAV ----------------
function renderTopbar() {
  const lv = levelInfo();
  $("#topbar").innerHTML = `
    <div class="letterhead">
      <span class="lh-name">CLOSING TIME</span>
      <span class="lh-sub">${esc(DB.brokerages[S.brokerageId].name)} · ${esc(lv.title)}</span>
    </div>
    <div class="statgrid">
      <div class="stat"><span class="stat-label">Date</span><span class="stat-val">${dayName(S.day)}, Wk ${weekOf(S.day)} <em class="season">${seasonOf(S.day)}</em></span></div>
      <div class="stat"><span class="stat-label">Slots</span><span class="stat-val slots">${"●".repeat(S.slotsLeft)}${"○".repeat(Math.max(0, SLOTS_PER_DAY - S.slotsLeft))}</span></div>
      <div class="stat"><span class="stat-label">Cash</span><span class="stat-val money">${fmtMoney(S.cash)}</span></div>
      <div class="stat"><span class="stat-label">Reputation</span><span class="stat-val">${S.rep}<span class="dim">/100</span></span></div>
      <div class="stat"><span class="stat-label">XP</span><span class="stat-val">${S.xp}${LEVELS[S.level] ? `<span class="dim">/${LEVELS[S.level].xp}</span>` : ""}</span></div>
      <div class="stat"><span class="stat-label">Rate</span><span class="stat-val">${S.market.rate.toFixed(2)}%</span></div>
    </div>
    <button class="btn btn-red" id="endDayBtn">End day →</button>`;
  $("#endDayBtn").onclick = () => {
    if (S.choiceQueue.length) { toast("Handle the pending decisions first."); return; }
    endDay(); render();
  };
}

function renderNav() {
  const items = [["dashboard", "Desk"], ["clients", "Clients"], ["mls", "MLS Board"], ["mylistings", "My Listings"], ["office", "Office"], ["log", "Ledger"]];
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
      `<b>${esc(contentClient(rec).name)}</b> buying ${esc(l.address)} — ${fmtMoney(deal.price)} <span class="stamp stamp-sm">${deal.stage === "offerPending" ? "OFFER OUT" : "UNDER CONTRACT"}</span>`));
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
  if (c.type === "buyer") facts.push(`Budget: <b>${fmtMoney(rec.budget)}</b>`, `Wants: ${c.statedReqs.minBeds || "?"}+ beds${(c.statedReqs.mustFeatures || []).length ? ", " + c.statedReqs.mustFeatures.map(esc).join(", ") : ""}`, `Areas: ${(c.statedReqs.neighborhoods || []).map(n => esc(DB.neighborhoods[n].name)).join(", ") || "flexible"}`);
  facts.push(`<span class="${patCls}">Patience: ${rec.patience}</span>`, `Mood: ${rec.mood}`, `Satisfaction: ${rec.satisfaction}`);
  if (c.statedReqs.notes) facts.push(`<span class="muted">${esc(c.statedReqs.notes)}</span>`);
  d.appendChild(el("p", "facts", facts.join(" · ")));
  rec.revealed.forEach(i => d.appendChild(el("p", "reveal-line", "◈ " + esc(c.hiddenPrefs[i].desc))));
  const acts = el("div", "actions");
  if (c.type === "buyer" && !rec.dealId) {
    acts.appendChild(actionBtn("Find homes (MLS)", 0, false, () => { mlsFilterClient = rec.recId; setScreen("mls"); }));
  }
  if (c.type === "seller" && !rec.dealId) {
    acts.appendChild(actionBtn("Take the listing", 1, false, () => { if (!spendSlots()) return; const pl = Seller.takeListing(rec); flowPrepListing(pl); }));
  }
  acts.appendChild(actionBtn("Schmooze ($120)", 1, S.cash < 120, () => {
    if (!spendSlots()) return; addCash(-120, `lunch with ${c.name}`);
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
  const d = el("div", "flyer" + (tierOK ? "" : " locked"));
  const stampTxt = ls.dom <= 7 ? "NEW" : ls.dom >= 45 ? "STALE" : "";
  d.innerHTML = `
    ${stampTxt ? `<span class="stamp">${stampTxt}</span>` : ""}
    <div class="flyer-price">${fmtMoney(ls.price)}</div>
    <div class="flyer-addr">${esc(l.address)}</div>
    <div class="flyer-nb">${esc(nb.name)} · ${l.beds}bd/${l.baths}ba · ${l.sqft.toLocaleString()} sqft · DOM ${ls.dom}</div>
    <div class="flyer-blurb">${esc(l.blurb)}</div>
    <div class="flyer-feat">${l.features.map(f => `<span class="tag">${esc(f)}</span>`).join("")}</div>
    <div class="flyer-agent">Listed by ${esc(DB.agents[l.listingAgentId].name)}</div>
    ${rec ? `<div class="fitline">Fit for ${esc(contentClient(rec).name)}: <b class="${l._fit >= 65 ? "good" : l._fit >= 45 ? "" : "bad"}">${l._fit}</b>/100</div>` : ""}`;
  if (!tierOK) { d.appendChild(el("div", "lock-note", "Above your current tier — level up to work this listing.")); return d; }
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
    if (open.length) acts.appendChild(actionBtn(`Review offers (${open.length})`, 1, false, () => { if (!spendSlots()) return; flowOfferReview(pl); }));
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
function renderLog(main) { main.appendChild(card("Ledger", logPanel(80))); }
function logPanel(n) {
  const d = el("div", "logpanel");
  S.log.slice(0, n).forEach(it => d.appendChild(el("div", "log-row log-" + (it.cls || "plain"),
    `<span class="log-day">D${it.day}</span> ${esc(it.text)}`)));
  return d;
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
  const body = el("div");
  const known = (rec.knownIssues[l.id] || []).reduce((s, i) => s + l.hiddenIssues[i].repairCost, 0);
  body.appendChild(el("p", "", `Ask: <b>${fmtMoney(ls.price)}</b> · est. value: <b>${fmtMoney(Math.round(trueValue(l)))}</b>${knowledgeEdge(l.neighborhood) >= 0.4 ? " (your read, sharpened by local knowledge)" : " (rough guess — you don't know this area well yet)"} · known issue costs: ${fmtMoney(known)} · client budget: <b>${fmtMoney(rec.budget)}</b>`));
  const priceIn = el("input"); priceIn.type = "number"; priceIn.value = Math.round(ls.price * 0.97 / 500) * 500; priceIn.step = 500; priceIn.className = "input-lg";
  body.appendChild(labelWrap("Offer price", priceIn));
  const waiveIns = checkbox("Waive inspection (stronger offer, riskier)"), waiveApp = checkbox("Waive appraisal contingency");
  const closeSel = el("select"); [21, 28, 35].forEach(d => closeSel.appendChild(el("option", "", d + " days")));
  closeSel.selectedIndex = 1;
  body.append(waiveIns.wrap, waiveApp.wrap, labelWrap("Close in", closeSel));
  const agent = DB.agents[l.listingAgentId];
  body.appendChild(el("p", "muted", `${esc(agent.name)} — ${esc(agent.bio)}`));
  modal(`Offer — ${esc(l.address)}`, body, [
    ["Submit offer", () => {
      const price = parseInt(priceIn.value, 10) || ls.price;
      if (price > rec.budget * 1.1) { toast("Your client laughs, not warmly. That's beyond even their stretch."); return; }
      const deal = Deals.writeOffer(rec, l, price, { waiveInspection: waiveIns.input.checked, waiveAppraisal: waiveApp.input.checked, closeDays: [21, 28, 35][closeSel.selectedIndex] });
      if (price > rec.budget) Clients.satisfactionDelta(rec, -4, "you pushing past their stated budget");
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
  const counterIn = el("input"); counterIn.type = "number"; counterIn.value = Math.round((price + resp.counter) / 2 / 500) * 500; counterIn.step = 500; counterIn.className = "input-lg";
  body.appendChild(labelWrap("Counter back at", counterIn));
  modal(`Negotiation, round ${deal.round} — ${esc(l.address)}`, body, [
    ["Accept their counter", () => { deal.price = resp.counter; if (resp.counter > rec.budget) Clients.satisfactionDelta(rec, -6, "accepting a number past their budget"); Deals.acceptDeal(deal); closeModal(); render(); }],
    ["Counter back", () => { const p = parseInt(counterIn.value, 10) || price; closeModal(); flowNegotiate(deal, p); }],
    ["Walk away", () => { deal.stage = "dead"; rec.dealId = null; log(`You walk from ${l.address}. ${agent.name} pretends not to care.`, ""); Clients.satisfactionDelta(rec, 2, "you refusing to overpay"); closeModal(); render(); }],
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
    insBtn.onclick = () => { addCash(-450, "pre-listing inspection"); pl.preInspected = true; flowRefresh(() => flowPrepListing(pl)); };
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
      if (stageCost + photoCost > 0) addCash(-(stageCost + photoCost), "listing prep at " + pl.listing.address);
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
    if (p < pl.price) { Clients.satisfactionDelta(getClientRec(pl.clientRecId), -3, "the price cut"); log(`Price improved (the polite term): ${pl.listing.address} → ${fmtMoney(p)}.`, ""); }
    pl.price = p; closeModal(); render();
  }], ["Cancel", () => { S.slotsLeft++; closeModal(); render(); }]]);
}

function flowOfferReview(pl) {
  const rec = getClientRec(pl.clientRecId);
  const open = pl.offers.filter(o => o.status === "open");
  const body = el("div");
  if (open.length > 1) body.appendChild(el("p", "hint", "Multiple offers. You may leverage them against each other — carefully."));
  open.forEach(o => {
    const a = DB.agents[o.agentId];
    const reaction = Seller.sellerReaction(pl, o);
    const row = el("div", "card offer-row");
    row.innerHTML = `<b>${fmtMoney(o.price)}</b> — ${esc(a.name)} (${a.negotiationStyle}) · ${o.financing}${o.inspection ? "" : " · inspection waived"} · close ${o.closeDays}d
      ${o.escalation ? `<div class="hint">Fine print: escalation clause to ${fmtMoney(o.escalation)}. You noticed. Chuck taught you that much.</div>` : ""}
      <div class="muted">Seller's read: ${reaction.notes.map(esc).join(" ") || (reaction.inclination > 0 ? "Warm-ish." : "Unimpressed.")}</div>`;
    const acts = el("div", "actions");
    const counterIn = el("input"); counterIn.type = "number"; counterIn.value = Math.min(pl.price, Math.round(o.price * 1.03 / 500) * 500); counterIn.step = 500;
    acts.appendChild(btn("Advise accept", () => { Seller.respondToOffer(pl, o, "accept"); closeModal(); render(); }));
    acts.append(counterIn, btn("Counter", () => { const r = Seller.respondToOffer(pl, o, "counter", parseInt(counterIn.value, 10)); closeModal(); if (r.recounter) flowOfferReview(pl); else render(); }));
    acts.appendChild(btn("Reject", () => { Seller.respondToOffer(pl, o, "reject"); flowRefresh(() => pl.offers.some(x => x.status === "open") ? flowOfferReview(pl) : (closeModal(), render())); }));
    row.appendChild(acts);
    body.appendChild(row);
  });
  if (!open.length) body.appendChild(el("p", "muted", "No open offers."));
  modal(`Offers — ${esc(pl.listing.address)}`, body, [["Close folder", () => { closeModal(); render(); }]], true);
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
        log(`Verbal lowball formalized: ${fmtMoney(price)} cash on ${pl.listing.address}.`, "deal");
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
    appraisalGap: () => modal("Appraisal gap", body, [
      ["Buyer covers the gap in cash", () => { Deals.appraisalDecision(deal, "cover", ch.gap); done(); }],
      ["Push seller down to appraisal", () => { Deals.appraisalDecision(deal, "renegotiate", ch.gap); done(); }],
      ["Let it die", () => { Deals.appraisalDecision(deal, "die", ch.gap); done(); }]]),
    competingOffer: () => modal("Competing offer", body, [
      ["Raise your offer", () => { deal.price = Math.round(deal.price * (1 + ch.bumpPct) / 500) * 500; log(`You raise to ${fmtMoney(deal.price)} to hold position.`, "deal"); done(); }],
      ["Stand pat", () => { if (rand() < 0.4) Deals.killDeal(deal, "the other offer won."); else log("You stand pat. The other offer blinks first.", "deal"); done(); }],
      ["Withdraw", () => { Deals.killDeal(deal, "you withdrew rather than bid up."); done(); }]]),
    coldFeet: () => modal("Cold feet", body, [
      ["Talk them through it (schmooze on the house)", () => { addCash(-120, "emergency reassurance dinner"); log("Two hours, one dessert, zero cancelled contracts.", ""); done(); }],
      ["Give them space", () => { if (rand() < ch.walkChance) Deals.killDeal(deal, "the buyer walked after a long night of doubt."); else log("They call back at 8am: 'Ignore me. We're good.'", ""); done(); }]]),
    coldFeetSeller: () => modal("Seller cold feet", body, [
      ["Sit with them at the kitchen table", () => { addCash(-120, "a long talk over coffee"); log("The house stays sold. The kitchen table did its job.", ""); done(); }],
      ["Give them space", () => { if (rand() < ch.walkChance) Seller.failSellerDeal(pl, "the seller pulled out"); else log("They come around by morning.", ""); done(); }]]),
    sellerInspectionHit: () => modal("Buyer's inspection findings", body, [
      ["Offer a credit (~70% of cost)", () => { Seller.sellerInspectionDecision(pl, "credit", ch.cost); if (ch.undisclosedRequired) addRep(-6, "an undisclosed required issue surfaced under contract"); done(); }],
      ["Refuse — dare them to walk", () => { Seller.sellerInspectionDecision(pl, "refuse", ch.cost); if (ch.undisclosedRequired) addRep(-6, "an undisclosed required issue surfaced under contract"); done(); }]]),
    poach: () => { const rec2 = getClientRec(ch.recId); const a = DB.agents[ch.agentId];
      modal("Poaching attempt", body, [
        ["Counter-schmooze immediately ($200)", () => { addCash(-200, "damage-control dinner"); log(`${contentClient(rec2).name} stays. ${a.name} sends a winking emoji.`, ""); done(); }],
        ["Trust the relationship", () => {
          const stay = ch.resistBase + rec2.satisfaction / 200 + (rec2.referredBy ? 0.15 : 0);
          if (rand() < stay) log(`${contentClient(rec2).name} laughs it off. Loyalty: earned.`, "");
          else { rec2.status = "walked"; rec2.dealId = null; log(`${contentClient(rec2).name} signs with ${a.name}. It stings exactly as much as you'd think.`, "bad"); }
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
