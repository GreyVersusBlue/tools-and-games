// engine.js — The Fourth Quarter 3D · night-sim engine
// Pure logic, no three.js. Drives arrivals, tickets, prep, revenue, mood,
// and the Mules game beats. The 3D layer consumes events; tests run in node.

export const MENU = {
  wings:  { id:"wings",  name:"Wing Basket",   price:9,  kind:"food",  prep:[14,22] },
  burger: { id:"burger", name:"Smash Burger",  price:11, kind:"food",  prep:[16,26] },
  nachos: { id:"nachos", name:"Loaded Nachos", price:8,  kind:"food",  prep:[10,18] },
  fries:  { id:"fries",  name:"Basket o' Fries", price:5, kind:"food", prep:[8,14]  },
  beer:   { id:"beer",   name:"Draft Beer",    price:6,  kind:"drink", prep:[4,7]   },
  soda:   { id:"soda",   name:"Soda",          price:3,  kind:"drink", prep:[3,5]   },
};
export const FOOD  = Object.values(MENU).filter(m => m.kind === "food").map(m => m.id);
export const DRINK = Object.values(MENU).filter(m => m.kind === "drink").map(m => m.id);

// share of the night's arrivals per hour, 5 PM → 1 AM
export const HOUR_W = [0.07, 0.11, 0.15, 0.17, 0.17, 0.15, 0.11, 0.07];

export const PATIENCE = 55;      // seconds a patron waits on a ticket before walking
export const BOSS_TIP = 2;       // flat extra tip when the owner delivers
export const BOSS_MOOD = 0.012;  // room-mood bump per boss delivery

export function hourName(h) {
  const hh = 17 + h;
  const d = ((hh - 1) % 12) + 1;
  return `${d} ${hh >= 24 || hh < 12 ? "AM" : "PM"}`;
}

let _seedState = null;
export function seed(n) { _seedState = n >>> 0; }
function rnd() {
  if (_seedState === null) return Math.random();
  // mulberry32 — deterministic runs for tests
  _seedState |= 0; _seedState = (_seedState + 0x6D2B79F5) | 0;
  let t = Math.imul(_seedState ^ (_seedState >>> 15), 1 | _seedState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = a => a[Math.floor(rnd() * a.length)];

let _tid = 0;

export class NightEngine {
  /**
   * @param {object} opts
   *  crowdTarget  — patrons expected over the whole night
   *  gameNight    — Mules game on the screens tonight
   *  hourLenSec   — real seconds per sim hour at 1× speed
   *  seats        — venue seat cap (spawns pause when full)
   *  stock        — {itemId: servings}; mutated as tickets fire. Omit for infinite.
   *  promo        — 'none'|'wingnight'|'happyhour'|'watchparty'
   */
  constructor(opts = {}) {
    this.crowdTarget = opts.crowdTarget ?? 46;
    this.gameNight   = opts.gameNight ?? true;
    this.hourLenSec  = opts.hourLenSec ?? 45;
    this.seats       = opts.seats ?? 30;
    this.stock       = opts.stock ?? null;
    this.promo       = opts.promo ?? "none";

    this.t = 0;                 // sim seconds elapsed
    this.hour = 0;              // 0..8
    this.done = false;
    this.mood = 0.7;            // 0..1 room mood
    this.revenue = 0; this.tips = 0;
    this.served = 0; this.walkouts = 0; this.bossServes = 0;
    this.inBar = 0;             // agents currently seated/entering (3D layer maintains)
    this.spawnDebt = 0;         // fractional arrivals accumulator
    this.tickets = [];          // {id, patronId, itemId, kind, placedAt, readyAt, state:'prep'|'ready'|'carried'|'done'|'dead', claimedBy}
    this.game = { started: false, finished: false, win: null, home: ri(0, 1) === 1 };
    this.log = [];
  }

  logLine(txt, cls) { this.log.push({ t: this.t, hour: Math.min(7, this.hour), txt, cls }); return { type: "log", txt, cls }; }

  /** Advance the sim by dt seconds. Returns an array of events for the 3D layer. */
  update(dt) {
    if (this.done) return [];
    const ev = [];
    const prevHour = this.hour;
    this.t += dt;
    this.hour = Math.min(8, Math.floor(this.t / this.hourLenSec));

    if (this.hour !== prevHour) {
      if (this.hour >= 8) {
        this.done = true;
        ev.push({ type: "lastCall" }, this.logLine("Last call. Lights up, tabs out.", "hl"));
        return ev;
      }
      ev.push({ type: "hour", hour: this.hour, label: hourName(this.hour) });
      // Mules game beats
      if (this.gameNight && this.hour === 2 && !this.game.started) {
        this.game.started = true;
        ev.push({ type: "kickoff" }, this.logLine("Kickoff! Every head turns to the screens.", "ev"));
      }
      if (this.gameNight && this.hour === 6 && !this.game.finished) {
        this.game.finished = true;
        this.game.win = rnd() < 0.55;
        this.mood = clamp(this.mood + (this.game.win ? 0.14 : -0.12));
        ev.push({ type: "final", win: this.game.win },
          this.logLine(this.game.win
            ? "FINAL: Mules win! The room ERUPTS."
            : "FINAL: Mules drop it. Tabs close early tonight.", this.game.win ? "g" : "b"));
      }
    }

    // arrivals — expected per second this hour, accrued into a debt counter
    if (this.hour < 8) {
      const perSec = (this.crowdTarget * HOUR_W[this.hour]) / this.hourLenSec;
      this.spawnDebt += perSec * dt * (0.85 + rnd() * 0.3);
      while (this.spawnDebt >= 1) {
        this.spawnDebt -= 1;
        if (this.inBar < this.seats) {
          this.inBar++;
          ev.push({ type: "spawn", mulesFan: this.gameNight && rnd() < 0.55 });
        } // full room: they see the line out the door and keep walking — no event
      }
    }

    // kitchen & bar prep
    for (const tk of this.tickets) {
      if (tk.state === "prep" && this.t >= tk.readyAt) {
        tk.state = "ready";
        ev.push({ type: "ready", ticket: tk });
      }
      if ((tk.state === "prep" || tk.state === "ready") && this.t - tk.placedAt > PATIENCE) {
        tk.state = "dead"; // patron gave up — 3D layer decides the walkout
        ev.push({ type: "impatient", ticket: tk });
      }
    }
    return ev;
  }

  inStock(itemId) { return !this.stock || (this.stock[itemId] || 0) > 0; }

  /** Tonight's shelf price for an item, given the promo and current hour. */
  price(itemId) {
    const item = MENU[itemId];
    let p = item.price;
    if (this.promo === "wingnight" && itemId === "wings") p *= 0.6;
    if (this.promo === "happyhour" && item.kind === "drink" && this.hour < 2) p *= 0.75;
    return Math.round(p * 100) / 100;
  }

  /** A seated patron decides what they want. Registers a prep ticket.
   *  Consumes a serving from stock; returns null if the item is 86'd. */
  placeTicket(patronId, itemId) {
    if (!this.inStock(itemId)) return null;
    if (this.stock) this.stock[itemId]--;
    const item = MENU[itemId];
    const tk = {
      id: ++_tid, patronId, itemId, kind: item.kind, price: this.price(itemId),
      placedAt: this.t, readyAt: this.t + ri(item.prep[0], item.prep[1]),
      state: "prep", claimedBy: null,
    };
    this.tickets.push(tk);
    return tk;
  }

  /** Pick a plausible in-stock order for a patron; null = nothing left to sell.
   *  Game nights skew beer-heavy; Wing Night skews wings. */
  chooseOrder(round) {
    const foods = FOOD.filter(id => this.inStock(id));
    const drinks = DRINK.filter(id => this.inStock(id));
    if (!foods.length && !drinks.length) return null;
    const pickFood = () => {
      if (this.promo === "wingnight" && foods.includes("wings") && rnd() < 0.6) return "wings";
      return pick(foods);
    };
    const pickDrink = () => {
      const beerP = this.gameNight ? 0.8 : 0.65;
      if (drinks.includes("beer") && rnd() < beerP) return "beer";
      return pick(drinks.filter(d => d !== "beer").length ? drinks.filter(d => d !== "beer") : drinks);
    };
    let wantFood = round === 0 ? rnd() < (this.promo === "wingnight" ? 0.62 : 0.55)
                               : !(rnd() < (this.gameNight ? 0.82 : 0.68)) && rnd() < 0.42;
    if (this.promo === "happyhour" && this.hour < 2) wantFood = wantFood && rnd() < 0.6;
    if (wantFood && foods.length) return pickFood();
    if (drinks.length) return pickDrink();
    return foods.length ? pickFood() : null;
  }

  claim(ticketId, carrierId) {
    const tk = this.tickets.find(t => t.id === ticketId);
    if (!tk || tk.state !== "ready" || tk.claimedBy) return null;
    tk.claimedBy = carrierId; tk.state = "carried";
    return tk;
  }

  /** Carrier hands the order to its patron. */
  deliver(ticketId, byBoss = false) {
    const tk = this.tickets.find(t => t.id === ticketId);
    if (!tk || tk.state !== "carried") return null;
    tk.state = "done";
    const item = MENU[tk.itemId];
    const shelfPrice = tk.price ?? this.price(tk.itemId);
    const waited = this.t - tk.placedAt;
    const speedFactor = clamp(1 - waited / (PATIENCE * 1.4), 0.1, 1); // fast service tips better
    let tip = Math.round(shelfPrice * (0.12 + 0.13 * speedFactor) * this.mood * 100) / 100;
    if (byBoss) { tip += BOSS_TIP; this.bossServes++; this.mood = clamp(this.mood + BOSS_MOOD); }
    this.revenue += shelfPrice; this.tips += tip; this.served++;
    this.mood = clamp(this.mood + 0.004);
    return { item, price: shelfPrice, tip, byBoss, waited };
  }

  /** Patron storms out (dead ticket, or no seat found). */
  walkout(patronId) {
    this.walkouts++; this.inBar = Math.max(0, this.inBar - 1);
    this.tickets.forEach(t => { if (t.patronId === patronId && (t.state === "prep" || t.state === "ready")) t.state = "dead"; });
    this.mood = clamp(this.mood - 0.03);
  }

  /** Patron finishes up and heads home happy. */
  depart() { this.inBar = Math.max(0, this.inBar - 1); }

  readyUnclaimed(kind) {
    return this.tickets.filter(t => t.state === "ready" && !t.claimedBy && (!kind || t.kind === kind));
  }

  summary() {
    const totalSeen = this.served + this.walkouts;
    return {
      revenue: Math.round(this.revenue), tips: Math.round(this.tips * 100) / 100,
      served: this.served, walkouts: this.walkouts, bossServes: this.bossServes,
      serviceRate: totalSeen ? Math.round(100 * this.served / (this.served + this.walkouts)) : 100,
      mood: this.mood, game: this.game,
      total: Math.round(this.revenue + this.tips),
    };
  }
}

export function clamp(v, lo = 0, hi = 1) { return Math.max(lo, Math.min(hi, v)); }
