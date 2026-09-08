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
import * as audio from "./audio.js";

/** The Tonight panel's one line on the regulars: how many of them there are,
 *  and how many of those the door expects. `regularsIn()` is deterministic on
 *  the day, so this number is the number the night actually gets. */
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
   * @param cb      { save(), openDoors(), flash(), mountBar(el), onMove(), closedNight() }
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

    $("#panelClose").addEventListener("click", () => this.closePanel());
    document.addEventListener("keydown", e => {
      if (e.code === "Escape" && this.panelOpen()) this.closePanel();
    });
    $("#panelBody").addEventListener("click", e => this.panelClick(e));
    $("#panelFoot").addEventListener("click", e => this.panelClick(e));
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
    $("#panelTitle").textContent = title;
    $("#panelBody").innerHTML = html;
    $("#panelFoot").innerHTML = footer;
    $("#panelOverlay").style.display = "flex";
    if (!wasOpen) audio.playSfx("uiOpen"); // re-renders of an already-open panel (e.g. after a hire) don't replay it
  }
  closePanel() {
    $("#panelOverlay").style.display = "none";
    audio.playSfx("uiClose");
  }

  // ---------------------------------------------------------------- panels
  stockPanel() {
    this.cart = {};
    for (const id in MENU) this.cart[id] = 0;
    this.renderStock();
  }
  renderStock() {
    const c = this.getC();
    const rows = Object.values(MENU).map(m => `
      <tr><td>${m.name}<span class="hint"> $${C.STOCK_COST[m.id].toFixed(2)}/serving</span></td>
      <td class="num">${c.stock[m.id] || 0}</td>
      <td><span class="stepper">
        <button data-cart="${m.id}" data-d="-10">-10</button>
        <button data-cart="${m.id}" data-d="-1">-1</button>
        <span class="qty">${this.cart[m.id]}</span>
        <button data-cart="${m.id}" data-d="1">+1</button>
        <button data-cart="${m.id}" data-d="10">+10</button>
        <button data-cart="${m.id}" data-d="25">+25</button></span></td></tr>`).join("");
    this.show("Stock Order",
      `<p class="hint">Delivered on the spot — the truck's out back. Sell out of something mid-rush and patrons order around it, or walk.</p>
       <p class="hint">Food rots about ${Math.round(C.SPOILAGE_RATE * 100)}% of what's left on the shelf every closed night — beer and soda don't. Order what you'll actually sell tonight, not a stockpile.</p>
       <table><tr><th>Item</th><th class="num">On hand</th><th>Add</th></tr>${rows}</table>`,
      `<span>Order total: <b class="money">$${C.orderCost(this.cart).toFixed(2)}</b>
        <span class="hint">· Cash $${Math.round(c.cash)}</span></span>
       <button class="btn" data-placeorder="1">Place Order</button>`);
  }

  crewPanel() {
    const c = this.getC();
    const roleRow = s => `${C.ROLES[s.role].name}<span class="hint"> · skill ${s.skill}</span>`;
    const staff = c.staff.map(s => `
      <tr><td>${s.name}</td><td>${roleRow(s)}</td>
      <td class="num money">$${C.effWage(c, s)}/night</td>
      <td><button class="btn small ghost" data-fire="${s.name}">Let go</button></td></tr>`).join("")
      || `<tr><td colspan="4" class="hint">Nobody on the floor but you.</td></tr>`;
    const apps = c.applicants.map(a => `
      <tr><td>${a.name}</td><td>${roleRow(a)}</td>
      <td class="num money">$${a.wage}/night</td>
      <td><button class="btn small" data-hire="${a.name}" ${c.staff.length >= C.MAX_STAFF ? "disabled" : ""}>Hire</button></td></tr>`).join("")
      || `<tr><td colspan="4" class="hint">No applications today.</td></tr>`;
    const warn = [];
    if (!C.hasCook(c)) warn.push("No cook — the kitchen won't open tonight.");
    if (!C.hasBartender(c)) warn.push("No bartender — servers pour, badly.");
    this.show("The Crew",
      `<p class="hint">Cooks and bartenders push prep speed on their side of the ticket — no cook means no food sells at all. Servers walk the floor and fetch whatever's ready. Wages come out of the till at close — up to ${C.MAX_STAFF} on payroll. And the boss works free.</p>
       ${warn.map(w => `<div class="row bad">⚠ ${w}</div>`).join("")}
       <table><tr><th>On payroll</th><th>Role</th><th class="num">Wage</th><th></th></tr>${staff}</table>
       <div class="sec">Applicants</div>
       <table><tr><th>Name</th><th>Role</th><th class="num">Wage</th><th></th></tr>${apps}</table>`,
      `<span class="hint">Tonight's wage bill: <b class="money">$${C.wageBill(c)}</b></span>`);
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
    if (c.darkNightsLeft > 0) return this.darkNightPanel();
    const tn = C.tonight(c);
    const game = !!tn.mules;
    const warn = [];
    if (game && (c.stock.beer || 0) < C.forecast(c) * 1.3) warn.push("Beer's thin for a game night.");
    if (!c.staff.length) warn.push("No servers — you're running every order yourself.");
    if (!C.hasCook(c)) warn.push("No cook — the kitchen's closed tonight.");
    if (!C.hasBartender(c)) warn.push("No bartender — servers cover the taps, badly.");
    if (Object.values(c.stock).every(v => !v)) warn.push("The shelves are BARE. Nobody can order anything.");
    if (c.cash < C.rent(c) + C.wageBill(c) + C.upgradeFees(c)) warn.push("Tonight's rent + wages + upkeep outrun the till. A bad night puts you in the red.");
    const rows = [
      ["Day", `${c.day} · ${C.weekday(c)}`],
      ["Tonight", game ? `${tn.label} — kickoff 7 PM` : tn.label],
      ["Theme", C.promoDef(c).name + (C.promoDef(c).cost ? ` (−$${C.promoDef(c).cost})` : "")],
      ["Forecast", `~${C.forecast(c)} through the door`],
      ["Reputation", `${Math.round(c.rep)} / 100`],
      ["Regulars", regularsLine(c)],
      ["Crew", c.staff.length ? c.staff.map(s => s.name.split(" ")[0]).join(", ") : "just you"],
      ["Wages + rent", `$${C.wageBill(c)} + $${C.rent(c)}`],
      ["Upgrade upkeep", `$${C.upgradeFees(c)}`],
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
  realEstatePanel() {
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
        `<p class="hint">You're already at <b>${cur.name}</b> — the top of the ladder. Nowhere left to climb.</p>`,
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
         <div class="hint">+${draw}% more of a draw · $${nv.rent}/night rent (up from $${cur.rent}) · ${nv.darkNights} dark night${nv.darkNights === 1 ? "" : "s"} to move in</div>
         <button class="btn small" data-signlease="1" style="margin-top:6px" ${afford ? "" : "disabled"}>Sign the Lease</button>
       </div>`,
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
      if (r.ok) { this.cb.save(); this.stockPanel(); this.cb.flash(`Delivery's in — $${r.cost.toFixed(2)}.`, true); }
      else this.cb.flash(r.err);
    }
    if (t.dataset.hire) { if (C.hire(c, t.dataset.hire)) { this.cb.save(); this.crewPanel(); } }
    if (t.dataset.fire) { if (C.fire(c, t.dataset.fire)) { this.cb.save(); this.crewPanel(); } }
    if (t.dataset.promo !== undefined && t.classList.contains("promoCard")) {
      const p = C.PROMOS[t.dataset.promo];
      if (p.cost > c.cash) { this.cb.flash("Can't cover the theme's cost."); return; }
      c.promoTonight = p.id;
      this.cb.save(); this.promoPanel();
    }
    if (t.dataset.opendoors) { this.closePanel(); this.cb.openDoors(); }
    if (t.dataset.closednight) { this.closePanel(); this.cb.closedNight(); }
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
