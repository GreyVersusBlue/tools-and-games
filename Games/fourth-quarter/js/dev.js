// dev.js — a debug/cheat menu for the developer, not part of normal play.
// Toggle with the ` (backquote) key from any phase. Add cash, jump the
// calendar, warp straight to any venue tier (free, no dark nights), top off
// stock, or wipe progress entirely — all the things you don't want a player
// to see but you want one keystroke away while testing.

import * as C from "./campaign.js";

const $ = s => document.querySelector(s);

export class DevPanel {
  /** @param cb { save(), flash(msg, good), rebuild(), resetProgress() } */
  constructor(getC, cb) {
    this.getC = getC;
    this.cb = cb;
    $("#devClose").addEventListener("click", () => this.close());
    $("#devBody").addEventListener("click", e => this.click(e));
    document.addEventListener("keydown", e => {
      if (e.code === "Backquote") { e.preventDefault(); this.toggle(); }
      else if (e.code === "Escape" && this.isOpen()) this.close();
    });
  }

  isOpen() { return $("#devOverlay").style.display === "flex"; }
  toggle() { this.isOpen() ? this.close() : this.open(); }
  open() {
    document.exitPointerLock();
    $("#devOverlay").style.display = "flex";
    this.render();
  }
  close() { $("#devOverlay").style.display = "none"; }

  render() {
    const c = this.getC();
    const v = C.venueDef(c);
    const venueBtns = C.VENUE_ORDER.map(id => {
      const on = id === c.venue;
      return `<button class="btn small ${on ? "" : "ghost"}" data-warp="${id}" ${on ? "disabled" : ""}>${C.VENUES[id].name}</button>`;
    }).join(" ");
    $("#devBody").innerHTML = `
      <p class="hint">Debug-only tools — none of this reflects normal play. Backquote (\`) toggles this menu; Esc closes it.</p>

      <div class="sec">Cash — currently <b class="money">$${Math.round(c.cash)}</b></div>
      <div class="row" style="gap:8px;flex-wrap:wrap">
        <button class="btn small" data-cash="100">+$100</button>
        <button class="btn small" data-cash="1000">+$1,000</button>
        <button class="btn small" data-cash="10000">+$10,000</button>
        <button class="btn small" data-cash="100000">+$100,000</button>
        <button class="btn small ghost" data-cash="-1000">−$1,000</button>
      </div>

      <div class="sec">Day — currently ${c.day} (${C.weekday(c)})</div>
      <div class="row" style="gap:8px;flex-wrap:wrap">
        <button class="btn small" data-day="1">+1 day</button>
        <button class="btn small" data-day="7">+1 week</button>
        <button class="btn small ghost" data-day="-1">−1 day</button>
      </div>

      <div class="sec">Venue — currently ${v.name}${c.darkNightsLeft ? ` <span class="hint">(${c.darkNightsLeft} dark night${c.darkNightsLeft === 1 ? "" : "s"} left)</span>` : ""}</div>
      <div class="row" style="gap:8px;flex-wrap:wrap">${venueBtns}</div>
      ${c.darkNightsLeft ? `<button class="btn small ghost" style="margin-top:8px" data-cleardark="1">Clear dark nights</button>` : ""}

      <div class="sec">Stock</div>
      <button class="btn small" data-fillstock="1">Fill all stock to 500</button>

      <div class="sec">Danger zone</div>
      <button class="btn small ghost" data-resetall="1">Reset all progress</button>
    `;
  }

  click(e) {
    const t = e.target.closest("button");
    if (!t) return;
    const c = this.getC();

    if (t.dataset.cash) {
      const amt = +t.dataset.cash;
      C.devAddCash(c, amt);
      this.cb.save(); this.render();
      this.cb.flash(`Cash adjusted by ${amt > 0 ? "+" : ""}$${amt.toLocaleString()}`, amt > 0);
    }
    if (t.dataset.day) {
      C.devSetDay(c, c.day + +t.dataset.day);
      this.cb.save(); this.render();
    }
    if (t.dataset.warp) {
      const name = C.VENUES[t.dataset.warp].name;
      C.devWarpVenue(c, t.dataset.warp);
      this.cb.save();
      this.cb.rebuild();
      this.render();
      this.cb.flash(`Warped to ${name}.`, true);
    }
    if (t.dataset.cleardark) {
      C.devClearDarkNights(c);
      this.cb.save(); this.render();
    }
    if (t.dataset.fillstock) {
      C.devFillStock(c, 500);
      this.cb.save(); this.render();
      this.cb.flash("Shelves topped off.", true);
    }
    if (t.dataset.resetall) {
      if (!confirm("Wipe all progress and start over from Day 1?")) return;
      this.cb.resetProgress();
      this.close();
    }
  }
}
