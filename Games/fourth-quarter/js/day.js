// day.js — daytime at the bar. Empty room, four glowing stations:
//   KITCHEN PASS → stock order       BAR → the crew
//   CORKBOARD    → tonight's theme   DOOR → open up
// Walk into a ring, press E, manage in a panel, close, keep walking.

import * as THREE from "three";
import { stationRing, ROOM, KITCHEN, DOOR, UPGRADES_STATION } from "./world.js";
import { MENU } from "./engine.js";
import * as C from "./campaign.js";

const $ = s => document.querySelector(s);

export class DayPhase {
  /**
   * @param scene   three.js scene (rings live here)
   * @param getC    () => campaign object (always current)
   * @param cb      { save(), openDoors() }
   */
  constructor(scene, getC, cb) {
    this.getC = getC;
    this.cb = cb;
    this.cart = {};
    this.stations = [
      { id: "stock", label: "Stock Order", key: "STOCK", color: 0xe8a33d,
        pos: new THREE.Vector3((KITCHEN.x0 + KITCHEN.x1) / 2, 0, -7.2), open: () => this.stockPanel() },
      { id: "crew", label: "The Crew", key: "CREW", color: 0x5aa7d6,
        pos: new THREE.Vector3(-2, 0, -2.1), open: () => this.crewPanel() },
      { id: "promo", label: "Tonight's Theme", key: "THEME", color: 0xff4e42,
        pos: new THREE.Vector3(-3.2, 0, ROOM.z - 1.2), open: () => this.promoPanel() },
      { id: "door", label: "Open the Doors", key: "OPEN", color: 0x58b368,
        pos: new THREE.Vector3(DOOR.x, 0, DOOR.z - 0.9), open: () => this.doorPanel() },
      { id: "upgrades", label: "Upgrades", key: "UPG", color: 0x9a6fb5,
        pos: UPGRADES_STATION.clone(), open: () => this.upgradePanel() },
    ];
    this.group = new THREE.Group();
    for (const st of this.stations) {
      st.ring = stationRing(st.color);
      st.ring.position.x = st.pos.x; st.ring.position.z = st.pos.z;
      this.group.add(st.ring);
    }
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
    return st ? `E — ${st.label}` : "";
  }

  interact(pos) {
    if (this.panelOpen()) return;
    const st = this.nearest(pos);
    if (st) { document.exitPointerLock(); st.open(); }
  }

  show(title, html, footer = "") {
    $("#panelTitle").textContent = title;
    $("#panelBody").innerHTML = html;
    $("#panelFoot").innerHTML = footer;
    $("#panelOverlay").style.display = "flex";
  }
  closePanel() { $("#panelOverlay").style.display = "none"; }

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
    this.show("Tonight's Theme",
      `<p class="hint">One theme per night, pinned to the corkboard. ${C.isGameNight(c) ? "Mules game tonight — themes stack with the game crowd." : "No game tonight."}</p>${cards}`,
      `<span class="hint">Forecast with this theme: <b>~${C.forecast(c)}</b> through the door</span>`);
  }

  doorPanel() {
    const c = this.getC();
    const game = C.isGameNight(c);
    const warn = [];
    if (game && (c.stock.beer || 0) < C.forecast(c) * 1.3) warn.push("Beer's thin for a game night.");
    if (!c.staff.length) warn.push("No servers — you're running every order yourself.");
    if (!C.hasCook(c)) warn.push("No cook — the kitchen's closed tonight.");
    if (!C.hasBartender(c)) warn.push("No bartender — servers cover the taps, badly.");
    if (Object.values(c.stock).every(v => !v)) warn.push("The shelves are BARE. Nobody can order anything.");
    if (c.cash < C.RENT + C.wageBill(c) + C.upgradeFees(c)) warn.push("Tonight's rent + wages + upkeep outrun the till. A bad night puts you in the red.");
    const rows = [
      ["Day", `${c.day} · ${C.weekday(c)}`],
      ["Tonight", game ? "Mules game — kickoff 7 PM" : "No game on the screens"],
      ["Theme", C.promoDef(c).name + (C.promoDef(c).cost ? ` (−$${C.promoDef(c).cost})` : "")],
      ["Forecast", `~${C.forecast(c)} through the door`],
      ["Crew", c.staff.length ? c.staff.map(s => s.name.split(" ")[0]).join(", ") : "just you"],
      ["Wages + rent", `$${C.wageBill(c)} + $${C.RENT}`],
      ["Upgrade upkeep", `$${C.upgradeFees(c)}`],
    ].map(r => `<div class="row"><span class="hint">${r[0]}</span><span>${r[1]}</span></div>`).join("");
    this.show("Tonight",
      rows + warn.map(w => `<div class="row bad">⚠ ${w}</div>`).join(""),
      `<button class="btn wide" data-opendoors="1">Open the Doors</button>`);
  }

  upgradePanel() {
    const c = this.getC();
    const cards = Object.values(C.UPGRADES).map(u => {
      const on = C.owned(c, u.id);
      return `<div class="promoCard ${on ? "on" : ""}">
        <b>${u.name}</b>${!on ? ` <span class="hint">$${u.cost}${u.fee ? ` + $${u.fee}/night` : ""}</span>` : ""}
        ${on ? '<span class="pill">installed</span>' : ""}
        <div class="hint">+ ${u.pro}</div>
        <div class="hint">− ${u.con}</div>
        ${!on ? `<button class="btn small" data-buyupg="${u.id}" style="margin-top:6px" ${c.cash < u.cost ? "disabled" : ""}>Install</button>` : ""}
      </div>`;
    }).join("");
    this.show("Upgrades",
      `<p class="hint">Permanent gear — once it's in, it stays in (upkeep and all). Nothing here is tier-locked yet; the whole shop's open.</p>${cards}`,
      `<span class="hint">Current nightly upkeep: <b class="money">$${C.upgradeFees(c)}</b> · Cash $${Math.round(c.cash)}</span>`);
  }

  // ---------------------------------------------------------------- clicks
  panelClick(e) {
    const t = e.target.closest("button, .promoCard");
    if (!t) return;
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
  }
}
