// day.js — daytime at the bar. Empty room, four glowing stations:
//   KITCHEN PASS → stock order       BAR → the crew
//   CORKBOARD    → tonight's theme   DOOR → open up
// Walk into a ring, press E, manage in a panel, close, keep walking.

import * as THREE from "three";
import { stationRing, currentLayout } from "./world.js";
import { standPointsFor } from "./layout.js";
import { MENU } from "./engine.js";
import * as C from "./campaign.js";
import * as LG from "./league.js";
import * as RG from "./regulars.js";
import * as EV from "./events.js";
import * as SUP from "./supply.js";
import * as STF from "./staff.js";
import * as SHF from "./shelf.js";
import * as SNS from "./season.js";
import * as audio from "./audio.js";

/** The Tonight panel's one line on the regulars: how many of them there are,
 *  and how many of those the door expects. `regularsIn()` is deterministic on
 *  the day, so this number is the number the night actually gets. */
/** Season terms in one line of the Tonight panel: tonight's rent, the wage
 *  raise if there is one, and the next date either moves. */
function termsRow(o) {
  const next = o.off.in > 0 ? `off-season in ${o.off.in}` : `season ${o.next.season} in ${o.next.in}`;
  return `rent $${o.rent}${o.wagePct > 100 ? ` · wages at ${o.wagePct}%` : ""} · ${next}`;
}

function regularsLine(c) {
  if (!c.regulars.length) return "none yet";
  const n = C.regularsIn(c).length;
  return `${n} of ${c.regulars.length} expected tonight`;
}

const $ = s => document.querySelector(s);

export class DayPhase {
  /**
   * @param scene   three.js scene (rings live here)
   * @param getC    () => campaign object (always current)
   * @param cb      { save(), openDoors(), flash(), mountBar(el), onMove(), closedNight(), resolveMoment(idx), newRun() }
   *                mountBar is main.js's one-and-only save-bar mount, called by
   *                doorPanel()/darkNightPanel(); onMove() rebuilds the room after a
   *                signed lease (main.js's rebuildVenue()); closedNight() settles one
   *                dark night's bills with no patrons (main.js's closedNight()) — both
   *                were already wired into DayPhase before anything in here called them.
   */
  constructor(scene, getC, cb) {
    this.getC = getC;
    this.cb = cb;
    this.cart = {};
    // Ring positions come from the venue's description (layout.js), never from
    // literals here: the same numbers world.js built the room from, so a ring
    // cannot drift from the floor it marks. rebuildStations() re-reads them.
    this.stations = [
      { id: "stock", label: "Stock Order", key: "STOCK", color: 0xe8a33d, open: () => this.stockPanel() },
      { id: "crew", label: "The Crew", key: "CREW", color: 0x5aa7d6, open: () => this.crewPanel() },
      { id: "promo", label: "Tonight's Theme", key: "THEME", color: 0xff4e42, open: () => this.promoPanel() },
      { id: "door", label: "Open the Doors", key: "OPEN", color: 0x58b368, point: "doorRing", open: () => this.doorPanel() },
      { id: "upgrades", label: "Upgrades", key: "UPG", color: 0x9a6fb5, open: () => this.upgradePanel() },
      { id: "realestate", label: "Real Estate", key: "ESTATE", color: 0xd4af37, point: "realEstate", open: () => this.realEstatePanel() },
    ];
    for (const st of this.stations) st.pos = new THREE.Vector3();
    this.placeStations();
    this.group = new THREE.Group();
    for (const st of this.stations) {
      st.ring = stationRing(st.color);
      st.ring.position.set(st.pos.x, st.pos.y + 0.03, st.pos.z);
      this.group.add(st.ring);
    }
    this.scene = scene;   // rebuildStations() needs it if the group ever detaches
    scene.add(this.group);
    this.t = 0;
    this.momentOpen = false;   // the panel on screen is a night moment's, not a day station's

    $("#panelClose").addEventListener("click", () => this.closePanel());
    document.addEventListener("keydown", e => {
      if (e.code === "Escape" && this.panelOpen()) this.closePanel();
    });
    $("#panelBody").addEventListener("click", e => this.panelClick(e));
    $("#panelFoot").addEventListener("click", e => this.panelClick(e));
    // the par sheet is the one thing in a panel that is typed rather than clicked
    $("#panelBody").addEventListener("change", e => {
      const t = e.target;
      if (!t || !t.dataset || !t.dataset.par) return;
      if (C.setPar(this.getC(), t.dataset.par, t.value)) { this.cb.save(); this.renderStock(); }
    });
  }

  setVisible(v) { this.group.visible = v; }
  panelOpen() { return $("#panelOverlay").style.display === "flex"; }

  /** Read each station's stand-point off the room world.js last built — with
   *  the floor under it, so a ring on a raised floor sits on that floor. */
  placeStations() {
    const pts = standPointsFor(currentLayout());
    for (const st of this.stations) {
      const p = pts[st.point ?? st.id]; // `ring` is the mesh
      st.pos.set(p.x, p.y, p.z);
    }
  }

  /**
   * Re-seat the station rings after main.js tears the venue down and rebuilds it.
   *
   * main.js's rebuildVenue() has always called this; for a round the method did
   * not exist, so "New Game (wipe save)" and every venue move threw
   * `day.rebuildStations is not a function` and abandoned the rest of
   * rebuildVenue — which is why the camera never got reset on those paths.
   *
   * It re-reads the six positions from whatever description world.js just
   * built from. Every tier is still the Corner Tap's description until Phase 2
   * authors the others, so today the rings land where they were; the day a tier
   * gets its own floor plan, this is already the hook that moves them.
   * rebuildVenue() only removes worldGroup, so this.group survives on the scene.
   */
  rebuildStations() {
    this.placeStations();
    for (const st of this.stations) {
      st.ring.position.set(st.pos.x, st.pos.y + 0.03, st.pos.z);
    }
    if (!this.group.parent) this.scene.add(this.group);
  }

  update(dt) {
    this.t += dt;
    const s = 1 + Math.sin(this.t * 2.4) * 0.06;
    for (const st of this.stations) st.ring.scale.setScalar(s);
  }

  nearest(pos) {
    let best = null, bd = 1.6;
    for (const st of this.stations) {
      const d = Math.hypot(pos.x - st.pos.x, pos.z - st.pos.z);
      if (d < bd) { bd = d; best = st; }
    }
    return best;
  }

  prompt(pos) {
    const st = this.nearest(pos);
    if (!st) return "";
    // Moving in isn't "opening the doors" — the door ring's panel becomes the
    // dark-night settlement while a move is in progress, so the prompt says so.
    if (st.id === "door" && this.getC().failed) return "E — The Run";
    if (st.id === "door" && this.getC().darkNightsLeft > 0) return "E — Tonight";
    return `E — ${st.label}`;
  }

  interact(pos) {
    if (this.panelOpen()) return;
    const st = this.nearest(pos);
    if (st) { document.exitPointerLock(); st.open(); }
  }

  show(title, html, footer = "") {
    const wasOpen = this.panelOpen();
    this.momentOpen = false;
    $("#panelTitle").textContent = title;
    $("#panelBody").innerHTML = html;
    $("#panelFoot").innerHTML = footer;
    $("#panelOverlay").style.display = "flex";
    if (!wasOpen) audio.playSfx("uiOpen"); // re-renders of an already-open panel (e.g. after a hire) don't replay it
  }
  closePanel() {
    $("#panelOverlay").style.display = "none";
    this.momentOpen = false;
    audio.playSfx("uiClose");
  }

  /** A night moment's panel: the card's body and one button per choice, in
   *  the same panel the six day stations use. The sim is still running
   *  behind it; Esc closes it and the moment keeps waiting on the floor.
   *  `view` is the engine's view of the card, for the texts that name
   *  somebody. */
  momentPanel(card, view) {
    const buttons = card.choices.map((ch, i) => `
      <button class="btn wide" data-moment="${i}">${EV.text(ch.label, view)}${ch.sub ? `<span class="hint">${EV.text(ch.sub, view)}</span>` : ""}</button>`).join("");
    this.show(card.title,
      `<p>${EV.text(card.body, view)}</p>
       <p class="hint">The floor keeps moving while you decide. Esc walks away — it'll still be waiting, until last call decides for you.</p>`,
      `<div class="footStack moment">${buttons}</div>`);
    this.momentOpen = true;
  }

  // ---------------------------------------------------------------- panels
  stockPanel() {
    this.cart = {};
    for (const id in MENU) this.cart[id] = 0;
    this.houseArm = null;   // the house a second click would sign with, forfeiting loyalty
    this.shelfArm = false;  // dating the shelf is one way, so it takes a second click
    this.renderStock();
  }
  /** The three supply houses under the order sheet: what each gives and takes,
   *  which one is yours, and where the account stands. Signing away an
   *  account that has earned loyalty takes a second click. */
  housesHtml(c) {
    const cur = C.distDef(c), off = SUP.loyaltyOff(c.dist), spend = Math.round(c.dist.spend);
    const maxed = off >= SUP.LOYALTY_MAX;
    const toNext = (Math.floor(c.dist.spend / SUP.LOYALTY_STEP) + 1) * SUP.LOYALTY_STEP - spend;
    const standing = !cur.account ? `${cur.name} keeps no account: list price, every order.`
      : `House account with <b>${cur.name}</b>: $${spend.toLocaleString()} spent`
        + (off > 0 ? ` · <span class="good">−${Math.round(off * 100)}% loyalty</span>` : "")
        + (maxed ? ` <span class="hint">(maxed)</span>` : ` <span class="hint">($${toNext.toLocaleString()} to the next 1%)</span>`);
    const pct = x => Math.round(x * 100);
    const breaks = t => t.map(([n, x]) => `${n}+ −${pct(x)}%`).join(", ");
    const cards = SUP.HOUSE_ORDER.map(id => {
      const h = SUP.HOUSES[id], on = h.id === cur.id, armed = this.houseArm === h.id;
      return `<div class="promoCard house ${on ? "on" : ""}" data-housecard="${h.id}">
        <b>${h.name}</b>${on ? '<span class="pill">your house</span>' : ""}
        <div class="hint">+ ${h.pro}</div>
        <div class="hint">− ${h.con}</div>
        ${on ? "" : `<button class="btn small ${armed ? "" : "ghost"}" data-house="${h.id}" style="margin-top:6px">${armed ? "Confirm switch" : "Sign with them"}</button>`}
      </div>`;
    }).join("");
    return `<div class="sec">The Supply House</div>
      <p class="hint" id="houseStanding">${standing}</p>
      <p class="hint">An account's bulk breaks, by the line: food ${breaks(SUP.BULK_FOOD)}; beer and soda ${breaks(SUP.BULK_DRINK)}. Every $${SUP.LOYALTY_STEP.toLocaleString()} of stock bought from one house is another ${pct(SUP.LOYALTY_PER)}% off, to ${pct(SUP.LOYALTY_MAX)}%. Switch houses and the loyalty dies at the door.</p>
      ${cards}`;
  }
  /** The shelf under the supply houses: the card that dates it, or, once it
   *  is dated, every lot with the nights it has left and the walk-in's card.
   *  A lot on its last night is the one that goes at tonight's close. */
  shelfHtml(c) {
    const W = SHF.WALKIN;
    if (!C.hasDates(c)) {
      const armed = this.shelfArm;
      return `<div class="sec">The Shelf</div>
        <div class="promoCard house" id="shelfCard">
          <b>No dates</b><span class="pill">how it is now</span>
          <div class="hint">Food rots about ${Math.round(C.SPOILAGE_RATE * 100)}% of what's left on the shelf at every close, whatever its age. Beer and soda never go off.</div>
          <div class="hint">+ Date it and food stops rotting by the night: every delivery keeps whole until its date (${Object.keys(SHF.SHELF).filter(id => SHF.SHELF[id].cold).map(id => `${MENU[id].name.toLowerCase()} ${SHF.SHELF[id].nights} nights`).join(", ")}, the day it came in counted), and the oldest sells first. A shelf that turns over loses nothing. A ${W.name} ($${W.cost.toLocaleString()}, $${W.fee} a night) can then add ${W.nights} nights to the food.</div>
          <div class="hint">− At its date, all of what is left of a delivery goes at once. Beer gets a date too: ${SHF.SHELF.beer.nights} nights. The inspector reads the dates, and one plate of food on its last night is a fine. What is on the shelf now is dated today. And the dates do not come back off.</div>
          <button class="btn small ${armed ? "" : "ghost"}" data-dateshelf="1" style="margin-top:6px">${armed ? "Confirm: date it for good" : "Date the Shelf"}</button>
        </div>`;
    }
    const nights = n => `${n} night${n === 1 ? "" : "s"}`;
    const rows = Object.values(MENU).map(m => {
      const lots = C.lotsOf(c, m.id), keeps = C.keeps(c, m.id);
      const cells = !keeps ? `<span class="hint">never goes off</span>`
        : !lots.length ? `<span class="hint">none on the shelf</span>`
        : lots.map(l => `<span class="${l.left <= 1 ? "bad" : l.left === 2 ? "warn" : ""}" data-lot="${m.id}">${l.n} ${l.left <= 1 ? "go tonight" : `for ${nights(l.left)}`}</span>`).join(" · ");
      return `<tr data-shelfrow="${m.id}"><td>${m.name}</td><td class="num">${keeps ? nights(keeps) : "—"}</td><td>${cells}</td></tr>`;
    }).join("");
    const on = C.hasWalkin(c);
    return `<div class="sec">The Shelf</div>
      <p class="hint">Dated. Each delivery keeps whole until its date and the oldest sells first; whatever is left of a lot on its last night goes at tonight's close. The flat ${Math.round(C.SPOILAGE_RATE * 100)}% a night is not charged on a dated shelf.</p>
      <table id="shelfLots"><tr><th>Item</th><th class="num">Keeps</th><th>On the shelf, oldest first</th></tr>${rows}</table>
      <div class="promoCard house ${on ? "on" : ""}" id="walkinCard">
        <b>${W.name}</b>${on ? '<span class="pill">installed</span>' : `<span class="pill">$${W.cost.toLocaleString()}</span>`}
        <div class="hint">+ ${W.pro}</div>
        <div class="hint">− ${W.con}</div>
        ${on ? "" : `<button class="btn small" data-buywalkin="1" style="margin-top:6px" ${c.cash < W.cost ? "disabled" : ""}>Install</button>`}
      </div>`;
  }
  renderStock() {
    const c = this.getC();
    const q = C.orderQuote(c, this.cart);
    const house = C.distDef(c);
    const rows = Object.values(MENU).map(m => {
      const qty = this.cart[m.id], line = q.lines[m.id];
      const next = SUP.nextBreak(c.dist, m.kind, qty);
      const note = line && line.off ? ` <span class="good">−${Math.round(line.off * 100)}% bulk</span>`
        : next ? ` <span class="hint">${next[0]}+ for −${Math.round(next[1] * 100)}%</span>` : "";
      return `
      <tr><td>${m.name}<span class="hint"> $${C.unitPrice(c, m.id, qty).toFixed(2)}/serving</span>${note}</td>
      <td class="num">${c.stock[m.id] || 0}${C.lastNight(c, m.id) ? ` <span class="bad" data-lastnight="${m.id}">(${C.lastNight(c, m.id)} go tonight)</span>` : ""}</td>
      <td class="num"><input class="par" type="number" min="0" max="${SUP.PAR_MAX}" step="1" data-par="${m.id}" value="${c.pars[m.id] || ""}" aria-label="Par level for ${m.name}"></td>
      <td><span class="stepper">
        <button data-cart="${m.id}" data-d="-10">-10</button>
        <button data-cart="${m.id}" data-d="-1">-1</button>
        <span class="qty">${this.cart[m.id]}</span>
        <button data-cart="${m.id}" data-d="1">+1</button>
        <button data-cart="${m.id}" data-d="10">+10</button>
        <button data-cart="${m.id}" data-d="25">+25</button></span></td></tr>`; }).join("");
    const diff = Math.round((q.list - q.goods) * 100) / 100;
    const notes = [];
    if (diff >= 0.005) notes.push(`−$${diff.toFixed(2)} off list`);
    if (diff <= -0.005) notes.push(`+$${(-diff).toFixed(2)} premium`);
    if (q.drop) notes.push(`+$${q.drop} drop charge under $${house.minOrder}`);
    this.show("Stock Order",
      `<p class="hint">Delivered on the spot — the truck's out back. Sell out of something mid-rush and patrons order around it, or walk.</p>
       <p class="hint" id="rotRule">${C.hasDates(c)
         ? "The shelf is dated: a delivery keeps until its date and then all that is left of it goes. Order what you'll sell before the date, not a stockpile."
         : `Food rots about ${Math.round(C.SPOILAGE_RATE * 100)}% of what's left on the shelf every closed night — beer and soda don't. Order what you'll actually sell tonight, not a stockpile.`}</p>
       <table id="orderSheet"><tr><th>Item</th><th class="num">On hand</th><th class="num">Par</th><th>Add</th></tr>${rows}</table>
       <p class="hint">Par is what you want on the shelf at open. Fill to Par tops the cart up to it, counting what is on hand.</p>
       ${this.housesHtml(c)}
       ${this.shelfHtml(c)}`,
      `<span>Order total: <b class="money" id="orderTotal">$${q.total.toFixed(2)}</b>
        <span class="hint" id="orderNotes">${notes.length ? `(${notes.join(" · ")}) ` : ""}· Cash $${Math.round(c.cash)}</span></span>
       <span><button class="btn ghost" data-parfill="1">Fill to Par</button>
       <button class="btn" data-placeorder="1">Place Order</button></span>`);
  }

  /** The rota under the payroll: the card that posts it, or, once it is up,
   *  a line a staffer with tonight's standing, how tired they are, how they
   *  feel about the place, how far the next level is, and the week as seven
   *  buttons. A lit day is a day worked. */
  rotaHtml(c) {
    if (!C.hasRota(c)) {
      const armed = this.rotaArm;
      return `<div class="sec">The Rota</div>
        <div class="promoCard house" id="rotaCard">
          <b>No rota</b><span class="pill">how it is now</span>
          <div class="hint">Everyone on the payroll works every night and draws the wage every night. Nobody tires, nobody improves, nobody leaves unless somebody makes them an offer.</div>
          <div class="hint">+ Post one and a night off is a night's wage you keep, the payroll holds ${STF.ROSTER_ROTA} instead of ${STF.ROSTER_OPEN} (${STF.SHIFT_MAX} work a night, the rest are on call), and a staffer who works fresh earns a skill level every ${STF.XP_PER_SKILL} shifts per level they hold.</div>
          <div class="hint">− Every shift tires them and only a night off takes it back: five on and two off holds. Tired, they work a skill level down; burnt out, two, and some nights they do not show. A level is a $${STF.LEVEL_RAISE} raise. Morale that bottoms out walks, to the End Zone if it is hiring. And it does not come back down.</div>
          <button class="btn small ${armed ? "" : "ghost"}" data-postrota="1" style="margin-top:6px">${armed ? "Confirm: post it for good" : "Post the Rota"}</button>
        </div>`;
    }
    const d = C.duty(c), today = C.weekday(c);
    const where = n => d.on.includes(n) ? '<span class="pill">on tonight</span>' : d.out.includes(n) ? '<span class="pill bad">called out</span>'
      : d.call.includes(n) ? '<span class="pill">on call</span>' : '<span class="hint">off tonight</span>';
    const rows = c.staff.map(s => {
      const l = C.crewLine(c, s.name);
      const cond = { fresh: "fresh", tired: `<span class="warn">tired, skill ${l.skill} tonight</span>`, burnt: `<span class="bad">burnt out, skill ${l.skill} tonight</span>` }[l.condition];
      const mood = l.looking ? '<span class="bad">looking for the door</span>' : l.morale >= 75 ? '<span class="good">happy here</span>' : l.morale >= 45 ? "steady" : '<span class="warn">restless</span>';
      const lvl = l.toLevel ? `${l.xp} of ${l.toLevel} shifts to skill ${s.skill + 1}` : "top of the trade";
      const week = STF.WEEK.map(w => `<button class="rotaDay ${l.off.includes(w) ? "" : "on"} ${w === today ? "today" : ""}" data-rota="${s.name}" data-day="${w}" aria-pressed="${!l.off.includes(w)}" aria-label="${s.name} works ${w}">${w[0]}</button>`).join("");
      return `<tr data-rotarow="${s.name}"><td>${s.name.split(" ")[0]} ${where(s.name)}<div class="hint">${cond} · ${mood} · ${lvl}</div></td>
        <td><span class="rotaWeek">${week}</span><div class="hint">${7 - l.off.length} on, ${l.off.length} off</div></td></tr>`;
    }).join("") || `<tr><td colspan="2" class="hint">Nobody to schedule.</td></tr>`;
    return `<div class="sec">The Rota</div>
      <p class="hint">A lit day is a shift, Monday first; click one to give the night off. Five on and two off holds: a shift is ${STF.FATIGUE_SHIFT} of fatigue and a night off takes back ${STF.FATIGUE_REST}. The first ${STF.SHIFT_MAX} scheduled work, anyone past that is on call, unpaid, and in if somebody calls out.</p>
      <table id="rota"><tr><th>Tonight</th><th>The week</th></tr>${rows}</table>`;
  }

  crewPanel() {
    this.rotaArm = false;
    this.renderCrew();
  }
  renderCrew() {
    const c = this.getC();
    const cap = C.staffCap(c);
    const roleRow = s => `${C.ROLES[s.role].name}<span class="hint"> · skill ${s.skill}</span>`;
    const staff = c.staff.map(s => `
      <tr><td>${s.name}</td><td>${roleRow(s)}</td>
      <td class="num money">$${C.effWage(c, s)}/night</td>
      <td><button class="btn small ghost" data-fire="${s.name}">Let go</button></td></tr>`).join("")
      || `<tr><td colspan="4" class="hint">Nobody on the floor but you.</td></tr>`;
    const apps = c.applicants.map(a => `
      <tr><td>${a.name}</td><td>${roleRow(a)}</td>
      <td class="num money">$${C.termsWage(c, a.wage)}/night</td>
      <td><button class="btn small" data-hire="${a.name}" ${c.staff.length >= cap ? "disabled" : ""}>Hire</button></td></tr>`).join("")
      || `<tr><td colspan="4" class="hint">No applications today.</td></tr>`;
    const warn = [];
    if (!C.hasCook(c)) warn.push("No cook — the kitchen won't open tonight.");
    if (!C.hasBartender(c)) warn.push("No bartender — servers pour, badly.");
    const out = C.duty(c).out;
    if (out.length) warn.push(`${out.map(n => n.split(" ")[0]).join(", ")} called out tonight: burnt out.`);
    const terms = C.termsOutlook(c), raise = terms ? terms.wagePct : 100;
    this.show("The Crew",
      `<p class="hint">Cooks and bartenders push prep speed on their side of the ticket — no cook means no food sells at all. Servers walk the floor and fetch whatever's ready. Wages come out of the till at close — up to ${cap} on payroll. And the boss works free.</p>
       ${warn.map(w => `<div class="row bad">⚠ ${w}</div>`).join("")}
       <table id="payroll"><tr><th>On payroll</th><th>Role</th><th class="num">Wage</th><th></th></tr>${staff}</table>
       ${this.rotaHtml(c)}
       <div class="sec">Applicants</div>
       <table><tr><th>Name</th><th>Role</th><th class="num">Wage</th><th></th></tr>${apps}</table>`,
      `<span class="hint">Tonight's wage bill: <b class="money" id="wageBill">$${C.wageBill(c)}</b>${raise > 100 ? ` <span id="wageRaise">· season terms: every wage at ${raise}% of the staffer's own</span>` : ""}</span>`);
  }

  promoPanel() {
    const c = this.getC();
    const cards = Object.values(C.PROMOS).map(p => {
      const on = c.promoTonight === p.id;
      const dead = p.needsGame && !C.isGameNight(c);
      return `<div class="promoCard ${on ? "on" : ""}" data-promo="${p.id}">
        <b>${p.name}</b>${p.cost ? ` <span class="hint">$${p.cost}</span>` : ""}
        ${dead ? '<span class="pill">no game tonight</span>' : ""}
        <div class="hint">${p.desc}</div></div>`;
    }).join("");
    const tn = C.tonight(c);
    this.show("Tonight's Theme",
      `<p class="hint">One theme per night, pinned to the corkboard. ${tn.mules ? `${tn.label} — themes stack with the game crowd.` : `${tn.label}.`}</p>${cards}
       ${this.standingsHtml(c)}`,
      `<span class="hint">Forecast with this theme: <b>~${C.forecast(c)}</b> through the door</span>`);
  }

  /** The league table pinned under the theme cards — the 2D build's League
   *  tab, on the corkboard because that is where the schedules go up. Season,
   *  week and phase on top; eight rows, the Mules' lit; this week's four
   *  games under it with the results that are in. */
  standingsHtml(c) {
    const L = c.league, tn = C.tonight(c);
    const phase = { regular: `week ${tn.week + 1} of ${LG.REG_WEEKS}`, playoffs: tn.week === LG.REG_WEEKS ? "semifinals" : "the final", offseason: "off-season" }[tn.phase];
    const rows = LG.standings(L).map((r, i) => {
      const t = LG.teamDef(r.id);
      const streak = r.streak >= 2 ? `W${r.streak}` : r.streak <= -2 ? `L${-r.streak}` : "—";
      return `<tr class="${t.id === LG.MULES ? "us" : ""}"><td>${i + 1}.</td><td>${t.name}${t.rival ? ' <span class="pill">rival</span>' : ""}</td><td class="num">${r.w}</td><td class="num">${r.l}</td><td class="num">${streak}</td></tr>`;
    }).join("");
    const week = (L.weeks[tn.week] || []).map(g => {
      const h = LG.teamDef(g.home), a = LG.teamDef(g.away);
      const when = g.playoff === "final" ? "Final" : g.playoff ? "Semi" : g.day;
      const result = g.played ? `${LG.teamDef(g.winner).short} won` : LG.gameDate(L, tn.week, g) === c.day ? "<b>tonight</b>" : "";
      return `<tr><td>${when}</td><td>${a.short} at ${h.short}</td><td class="num">${result}</td></tr>`;
    }).join("");
    const champ = L.champion ? `<div class="hint">MAFA champions, season ${L.season}: <b>${LG.teamDef(L.champion).name}</b></div>` : "";
    const past = L.history.filter(h => h.season < L.season).map(h => `season ${h.season} — ${LG.teamDef(h.champion).short}`).join(", ");
    return `${this.regularsHtml(c)}<div class="sec">MAFA — season ${L.season}, ${phase}</div>
      ${champ}
      <table id="standings"><tr><th></th><th>Team</th><th class="num">W</th><th class="num">L</th><th class="num">Streak</th></tr>${rows}</table>
      ${week ? `<div class="sec">This week</div><table id="thisWeek">${week}</table>` : ""}
      ${past ? `<div class="hint">Past champions: ${past}</div>` : ""}`;
  }

  /** The regulars, on the corkboard next to the schedules — who they are, what
   *  they drink, whose games they turn up for, and how shaky they are. There is
   *  deliberately no rival panel to go with it: the End Zone is a number in the
   *  crowd and a line in the morning ticker, not a screen. */
  regularsHtml(c) {
    const cap = C.regularCap(c);
    if (!c.regulars.length) {
      return `<div class="sec">The Regulars — 0 of ${cap}</div>
        <div class="hint">Nobody yet. A busy night you run well can earn one; 86 their usual or run an ugly floor and they drift.</div>`;
    }
    const inTonight = new Set(C.regularsIn(c).map(r => r.id));
    const rows = c.regulars.map(r => {
      const t = LG.teamDef(r.team);
      const state = r.loyalty >= 70 ? "" : r.loyalty >= 35 ? "warn" : "bad";
      // no `tr.us` here: that rule paints the whole row amber and would bury the
      // loyalty colour, which is the number worth reading on this table
      return `<tr><td>${r.name}</td><td>${RG.usualName(r)}</td>` +
        `<td>${t.short}</td><td class="num ${state}">${Math.round(r.loyalty)}</td>` +
        `<td class="num">${inTonight.has(r.id) ? '<span class="pill">in tonight</span>' : ""}</td></tr>`;
    }).join("");
    return `<div class="sec">The Regulars — ${c.regulars.length} of ${cap}</div>
      <table id="regulars"><tr><th>Name</th><th>The usual</th><th>Team</th><th class="num">Loyalty</th><th class="num"></th></tr>${rows}</table>`;
  }

  doorPanel() {
    const c = this.getC();
    if (c.failed) return this.failedPanel();
    if (c.darkNightsLeft > 0) return this.darkNightPanel();
    const tn = C.tonight(c);
    const game = !!tn.mules;
    const warn = [];
    if (game && (c.stock.beer || 0) < C.forecast(c) * 1.3) warn.push("Beer's thin for a game night.");
    const onTonight = C.shiftCrew(c), duty = C.duty(c);
    if (!onTonight.length) warn.push("No servers — you're running every order yourself.");
    if (duty.out.length) warn.push(`${duty.out.map(n => n.split(" ")[0]).join(", ")} called out tonight: burnt out.`);
    if (!C.hasCook(c)) warn.push("No cook — the kitchen's closed tonight.");
    if (!C.hasBartender(c)) warn.push("No bartender — servers cover the taps, badly.");
    if (Object.values(c.stock).every(v => !v)) warn.push("The shelves are BARE. Nobody can order anything.");
    const going = Object.keys(MENU).reduce((n, id) => n + C.lastNight(c, id), 0);
    if (going) warn.push(`${going} serving${going === 1 ? " is" : "s are"} on the last night of the date. What doesn't sell tonight goes at the close.`);
    if (c.cash < C.billsFor(c).total) warn.push("Tonight's rent + wages + upkeep outrun the till. A bad night puts you in the red.");
    if (C.termsNotice(c)) warn.push(C.termsNoticeLine(c));
    // the standing notice, on the last screen before the night that could spend it
    if (c.strikes > 0) warn.push(c.strikes === C.LEASE_STRIKES - 1
      ? `LAST WARNING: ${c.strikes} nights in the red. Close tonight below $0 and the landlord takes the lease.`
      : `Notice on the door: ${c.strikes} of ${C.LEASE_STRIKES} nights in the red.`);
    const rows = [
      ["Day", `${c.day} · ${C.weekday(c)}`],
      ["Tonight", game ? `${tn.label} — kickoff 7 PM` : tn.label],
      ["Theme", C.promoDef(c).name + (C.promoDef(c).cost ? ` (−$${C.promoDef(c).cost})` : "")],
      ["Forecast", `~${C.forecast(c)} through the door`],
      ["Reputation", `${Math.round(c.rep)} / 100`],
      ["Regulars", regularsLine(c)],
      ["Crew", onTonight.length ? onTonight.map(s => s.name.split(" ")[0]).join(", ") : "just you"],
      ["Wages + rent", `$${C.wageBill(c)} + $${C.rent(c)}`],
      ["Upgrade upkeep", `$${C.upgradeFees(c)}`],
      ...(C.accountFee(c) ? [["Supply account", `$${C.accountFee(c)} · ${C.distDef(c).name}, billed tonight`]] : []),
      ...(C.walkinFee(c) ? [["Walk-in", `$${C.walkinFee(c)} · compressor power`]] : []),
      ...(C.onTerms(c) ? [["Season terms", termsRow(C.termsOutlook(c))]] : []),
      ["The lease", c.strikes ? `${c.strikes} of ${C.LEASE_STRIKES} nights in the red` : "in good standing"],
    ].map(r => `<div class="row"><span class="hint">${r[0]}</span><span>${r[1]}</span></div>`).join("");
    this.show("Tonight",
      rows + warn.map(w => `<div class="row bad">⚠ ${w}</div>`).join(""),
      `<div class="footStack">
         <button class="btn wide" data-opendoors="1">Open the Doors</button>
         <div id="doorSaveBar"></div>
       </div>`);
    // The day-phase home for the shared save bar. This is the one panel that
    // summarises the whole campaign rather than one desk's worth of it, and it is
    // the last screen before a night that can go badly — the moment a player who
    // wants a backup actually wants one.
    //
    // Mounted after show(), because show() replaces #panelFoot's innerHTML and the
    // container has to exist first. A fresh container every render means the
    // buttons are rebuilt rather than duplicated, so re-opening the panel is safe.
    if (this.cb.mountBar) this.cb.mountBar($("#doorSaveBar"));
  }

  /** The one dead end in the game. A run that lost the Corner Tap has no rung
   *  below it and no way to trade out of the hole, so the door stops being a
   *  door: the panel says what the run was and offers a fresh one. Reachable
   *  only by reloading into a failed save — the box score's own ending screen
   *  is what a player normally sees. */
  failedPanel() {
    const c = this.getC();
    const r = C.runSummary(c);
    const rows = [
      ["Nights survived", `${r.nights}`],
      ["Best night", `$${Math.round(r.bestNight)}`],
      ["Lifetime net", `${r.lifetimeNet >= 0 ? "+" : "−"}$${Math.abs(Math.round(r.lifetimeNet))}`],
      ["Furthest you got", r.tier],
      ["Evictions", `${r.evictions}`],
    ].map(x => `<div class="row"><span class="hint">${x[0]}</span><span>${x[1]}</span></div>`).join("");
    this.show("The Run",
      `<p class="hint">The landlord took the Corner Tap. There is no smaller room to fall into, and the doors do not open again.</p>${rows}`,
      `<div class="footStack">
         <button class="btn wide" data-newrun="1">Start a New Campaign</button>
         <div id="doorSaveBar"></div>
       </div>`);
    if (this.cb.mountBar) this.cb.mountBar($("#doorSaveBar"));
  }

  /** The door ring's panel while a venue move is settling in. Replaces the normal
   *  "Open the Doors" flow entirely — there's no night to run, just bills to pay
   *  and a countdown to clear, one closed night per click through cb.closedNight()
   *  (already wired in main.js, same as cb.openDoors() for a real night). */
  darkNightPanel() {
    const c = this.getC();
    const v = C.venueDef(c);
    const bill = Math.round(C.wageBill(c) + C.rent(c) + C.upgradeFees(c));
    const rows = [
      ["Day", `${c.day} · ${C.weekday(c)}`],
      ["Status", `Moving into ${v.name}`],
      ["Closed nights left", `${c.darkNightsLeft}`],
    ].map(r => `<div class="row"><span class="hint">${r[0]}</span><span>${r[1]}</span></div>`).join("");
    this.show("Tonight",
      rows + `<div class="row bad">⚠ No patrons tonight — the crew still draws wages and rent still comes due.</div>`,
      `<div class="footStack">
         <span class="hint">Tonight's bill: <b class="money">$${bill}</b></span>
         <button class="btn wide" data-closednight="1">Push Through the Night</button>
         <div id="doorSaveBar"></div>
       </div>`);
    if (this.cb.mountBar) this.cb.mountBar($("#doorSaveBar"));
  }

  /** The venue ladder's door into the game. moveVenue()/nextVenue()/canMoveVenue()
   *  are all campaign.js, tested there — this is only the UI: show the next rung,
   *  sign it through cb.onMove() (already wired to rebuildVenue() in main.js). */
  /** Season terms under the ladder: the offer and what it turns into, or,
   *  once signed, where the terms stand and the two dates they move on. */
  termsHtml(c) {
    const signed = C.onTerms(c);
    const o = signed ? C.termsOutlook(c) : C.termsOffer(c);
    const base = C.venueDef(c).rent;
    const nights = n => `${n} night${n === 1 ? "" : "s"}`;
    const wage = p => (p === 100 ? "wages as they are" : `wages at ${p}%`);
    const rows = `<table id="termsTable"><tr><th>When</th><th class="num">Rent</th><th>Wages</th></tr>
        <tr data-terms="now"><td>${signed ? "Tonight" : "From tonight"}${o.phase === "offseason" ? " (off-season)" : ""}</td><td class="num money">$${o.rent}</td><td>${wage(o.wagePct)}</td></tr>
        ${o.off.in > 0 ? `<tr data-terms="off"><td>Off-season, in ${nights(o.off.in)}</td><td class="num money">$${o.off.rent}</td><td>${wage(o.wagePct)}</td></tr>` : ""}
        <tr data-terms="next"><td>Season ${o.next.season}, in ${nights(o.next.in)}</td><td class="num money">$${o.next.rent}</td><td>${wage(o.next.wagePct)}</td></tr></table>`;
    if (signed) {
      return `<div class="sec">Season Terms</div>
        <div class="promoCard house on" id="termsCard">
          <b>On season terms</b> <span class="pill">signed in season ${c.terms.since}</span>
          <div class="hint">This room's own rent is $${base} a night. Each new season puts ${SNS.RENT_STEP} points on the rent (to ${100 + SNS.RENT_CAP}% of the room's) and ${SNS.WAGE_STEP} on every wage (to ${100 + SNS.WAGE_CAP}%); the off-season fortnight is ${SNS.OFF_RENT}% of the season's rent. The terms follow you to any room.</div>
          ${rows}
        </div>`;
    }
    const armed = this.termsArm;
    return `<div class="sec">Season Terms</div>
      <div class="promoCard house" id="termsCard">
        <b>Month to month</b> <span class="pill">as it has always been</span>
        <div class="hint">Rent is the room's number ($${base} a night here) and a wage is what you hired at, this season and every season.</div>
        <div class="hint">+ Sign season terms and rent is ${SNS.SIGN_BREAK}% under the room's for the rest of this season, and every off-season fortnight is billed at ${SNS.OFF_RENT}% of that season's rent.</div>
        <div class="hint">− Each season after this one puts ${SNS.RENT_STEP} points on the rent, to ${100 + SNS.RENT_CAP}% of the room's, and ${SNS.WAGE_STEP} on every wage, to ${100 + SNS.WAGE_CAP}%. The terms follow you to any room and cannot be torn up.</div>
        ${rows}
        <button class="btn small ${armed ? "" : "ghost"}" data-signterms="1" style="margin-top:6px">${armed ? "Confirm: sign for good" : "Sign Season Terms"}</button>
      </div>`;
  }

  realEstatePanel() {
    this.termsArm = false;  // season terms are one way, so they take a second click
    this.renderEstate();
  }
  renderEstate() {
    const c = this.getC();
    const cur = C.venueDef(c);
    if (c.darkNightsLeft > 0) {
      this.show("Real Estate",
        `<p class="hint">The move into ${cur.name} isn't finished — ${c.darkNightsLeft} closed night${c.darkNightsLeft === 1 ? "" : "s"} left before the doors reopen. Push through from the Tonight panel at the door.</p>`,
        `<span class="hint">Cash $${Math.round(c.cash)}</span>`);
      return;
    }
    const nv = C.nextVenue(c);
    if (!nv) {
      this.show("Real Estate",
        `<p class="hint">You're already at <b>${cur.name}</b> — the top of the ladder. Nowhere left to climb.</p>
         ${this.termsHtml(c)}`,
        `<span class="hint">Cash $${Math.round(c.cash)}</span>`);
      return;
    }
    const afford = c.cash >= nv.cost;
    const draw = Math.round((nv.buzzMult / cur.buzzMult - 1) * 100);
    this.show("Real Estate",
      `<p class="hint">Currently at <b>${cur.name}</b>. A lease is one-way and cash up front — the room stays shut ${nv.darkNights} night${nv.darkNights === 1 ? "" : "s"} while the crew moves in, and rent, wages and upkeep all still come due on a closed night.</p>
       <div class="promoCard">
         <b>${nv.name}</b> <span class="hint">$${nv.cost.toLocaleString()}</span>
         <div class="hint">${nv.desc}</div>
         <div class="hint">+${draw}% more of a draw · $${C.rentAt(c, nv.id)}/night rent (up from $${C.rent(c)}) · ${nv.darkNights} dark night${nv.darkNights === 1 ? "" : "s"} to move in</div>
         <button class="btn small" data-signlease="1" style="margin-top:6px" ${afford ? "" : "disabled"}>Sign the Lease</button>
       </div>
       ${this.termsHtml(c)}`,
      `<span class="hint">Cash $${Math.round(c.cash)}${afford ? "" : ` · need $${Math.round(nv.cost - c.cash).toLocaleString()} more`}</span>`);
  }

  upgradePanel() {
    const c = this.getC();
    const cards = Object.values(C.UPGRADES).map(u => {
      const on = C.owned(c, u.id);
      const gate = C.upgradeGate(c, u.id); // null, or the venue this needs
      return `<div class="promoCard ${on ? "on" : ""}">
        <b>${u.name}</b>${!on ? ` <span class="hint">$${u.cost}${u.fee ? ` + $${u.fee}/night` : ""}</span>` : ""}
        ${on ? '<span class="pill">installed</span>' : ""}
        ${gate && !on ? `<span class="pill">needs ${gate.name}</span>` : ""}
        <div class="hint">+ ${u.pro}</div>
        <div class="hint">− ${u.con}</div>
        ${gate && !on ? `<div class="hint">No room for it here — ${gate.name} or bigger.</div>` : ""}
        ${!on ? `<button class="btn small" data-buyupg="${u.id}" style="margin-top:6px" ${c.cash < u.cost || gate ? "disabled" : ""}>Install</button>` : ""}
      </div>`;
    }).join("");
    this.show("Upgrades",
      `<p class="hint">Permanent gear — once it's in, it stays in (upkeep and all). Two of these need a bigger room than the Corner Tap; the card says which.</p>${cards}`,
      `<span class="hint">Current nightly upkeep: <b class="money">$${C.upgradeFees(c)}</b> · Cash $${Math.round(c.cash)}</span>`);
  }

  // ---------------------------------------------------------------- clicks
  panelClick(e) {
    const t = e.target.closest("button, .promoCard");
    if (!t) return;
    audio.playSfx("uiClick");
    const c = this.getC();
    if (t.dataset.buyupg) {
      const r = C.buyUpgrade(c, t.dataset.buyupg);
      if (r.ok) { this.cb.save(); this.upgradePanel(); this.cb.flash(`${C.UPGRADES[t.dataset.buyupg].name} installed.`, true); }
      else this.cb.flash(r.err);
    }
    if (t.dataset.cart) {
      const id = t.dataset.cart;
      this.cart[id] = Math.max(0, this.cart[id] + +t.dataset.d);
      this.renderStock();
    }
    if (t.dataset.placeorder) {
      const r = C.placeOrder(c, this.cart);
      if (r.ok) { this.cb.save(); this.stockPanel(); this.cb.flash(`Delivery's in — $${r.cost.toFixed(2)}${r.drop ? `, $${r.drop} of it the drop charge` : ""}.`, true); }
      else this.cb.flash(r.err);
    }
    if (t.dataset.parfill) {
      const r = C.fillToPar(c, this.cart);
      this.cart = r.cart;
      this.renderStock();
      this.cb.flash(r.added ? `Par fill: +${r.added} serving${r.added === 1 ? "" : "s"} in the cart.` : "Everything's at par, counting the cart.", !!r.added);
    }
    if (t.dataset.house) {
      const id = t.dataset.house;
      // an account that has earned something is not signed away on one click
      if (SUP.loyaltyOff(c.dist) > 0 && this.houseArm !== id) {
        this.houseArm = id;
        this.renderStock();
        this.cb.flash(`Switching forfeits your −${Math.round(SUP.loyaltyOff(c.dist) * 100)}% loyalty. Click again to sign with ${SUP.HOUSES[id].name}.`);
      } else {
        const r = C.signHouse(c, id);
        this.houseArm = null;
        if (r.ok) { this.cb.save(); this.renderStock(); this.cb.flash(`${r.house.name} runs your deliveries now.`, true); }
        else this.cb.flash(r.err);
      }
    }
    if (t.dataset.dateshelf) {
      // one way, so not on one click
      if (!this.shelfArm) { this.shelfArm = true; this.renderStock(); this.cb.flash("A dated shelf stays dated. Click again to put the labels on."); }
      else {
        const r = C.dateShelf(c);
        this.shelfArm = false;
        if (r.ok) { this.cb.save(); this.renderStock(); this.cb.flash("The shelf's dated. Everything on it is dated today.", true); }
        else this.cb.flash(r.err);
      }
    }
    if (t.dataset.buywalkin) {
      const r = C.buyWalkin(c);
      if (r.ok) { this.cb.save(); this.renderStock(); this.cb.flash(`${SHF.WALKIN.name} installed. Food keeps ${SHF.WALKIN.nights} nights longer.`, true); }
      else this.cb.flash(r.err);
    }
    if (t.dataset.hire) { if (C.hire(c, t.dataset.hire)) { this.cb.save(); this.renderCrew(); } }
    if (t.dataset.fire) { if (C.fire(c, t.dataset.fire)) { this.cb.save(); this.renderCrew(); } }
    if (t.dataset.postrota) {
      // one way, so not on one click
      if (!this.rotaArm) { this.rotaArm = true; this.renderCrew(); this.cb.flash("A posted rota stays posted. Click again to put it on the wall."); }
      else {
        const r = C.postRota(c);
        this.rotaArm = false;
        if (r.ok) { this.cb.save(); this.renderCrew(); this.cb.flash("The rota's on the wall. Everyone's down for seven nights until you say otherwise.", true); }
        else this.cb.flash(r.err);
      }
    }
    if (t.dataset.rota) { if (C.toggleDayOff(c, t.dataset.rota, t.dataset.day)) { this.cb.save(); this.renderCrew(); } }
    if (t.dataset.promo !== undefined && t.classList.contains("promoCard")) {
      const p = C.PROMOS[t.dataset.promo];
      if (p.cost > c.cash) { this.cb.flash("Can't cover the theme's cost."); return; }
      c.promoTonight = p.id;
      this.cb.save(); this.promoPanel();
    }
    if (t.dataset.opendoors) { this.closePanel(); this.cb.openDoors(); }
    if (t.dataset.moment !== undefined) { this.closePanel(); if (this.cb.resolveMoment) this.cb.resolveMoment(+t.dataset.moment); }
    if (t.dataset.closednight) { this.closePanel(); this.cb.closedNight(); }
    if (t.dataset.newrun && this.cb.newRun) { this.closePanel(); this.cb.newRun(); }
    if (t.dataset.signterms) {
      // one way, so not on one click
      if (!this.termsArm) { this.termsArm = true; this.renderEstate(); this.cb.flash("Season terms cannot be torn up. Click again to sign."); }
      else {
        const r = C.signTerms(c);
        this.termsArm = false;
        if (r.ok) { this.cb.save(); this.renderEstate(); this.cb.flash(`Signed. Rent is $${C.rent(c)} a night from tonight.`, true); }
        else this.cb.flash(r.err);
      }
    }
    if (t.dataset.signlease) {
      const r = C.moveVenue(c);
      if (r.ok) {
        this.closePanel();
        this.cb.save();
        if (this.cb.onMove) this.cb.onMove();
        this.cb.flash(`Signed the lease on ${r.venue.name}. ${c.darkNightsLeft} closed night${c.darkNightsLeft === 1 ? "" : "s"} before you reopen.`, true);
      } else {
        this.cb.flash(r.err);
      }
    }
  }
}
