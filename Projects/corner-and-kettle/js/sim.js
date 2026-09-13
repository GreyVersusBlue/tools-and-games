// sim.js — Corner & Kettle without the page.
//
// Everything about spawning, patience, barista work, scoring and the day
// economy, reading and writing one plain `state` object and touching no DOM.
// js/ui.js builds a sim, drives it from requestAnimationFrame with real frame
// deltas and draws whatever it did; test/smoke-sim.mjs builds the same sim
// with a seed and drives it with fixed steps that never wait.
//
// Three rules the split keeps:
//
// 1. One clock. advance(dtMs) is the only way time passes. It folds what used
//    to be gameLoop()'s body, the 1-second setInterval on patience and each
//    barista's own accumulator into fixed STEP_MS steps, so a 136,000 ms call
//    and 8,160 calls of one frame each do exactly the same thing.
// 2. One rng. Every random pick goes through rand()/randInt() over the
//    injected `rng`; the page passes Math.random, the tests pass makeRng(seed).
// 3. No DOM. Anything a player has to see — a toast, a redraw, the day-end
//    summary — leaves through `notify(event)`, and the sim does not care
//    whether anybody is listening.
//
// What stays in the page (ui.js, stations.js, chalkboard.js): drawing, the
// progress bars, sound, the save bar, and asking before a reopen. What a
// station button or a chalkboard button *does* is in here, as CUP_ACTIONS and
// PURCHASES, since Phase 4 (#344, #345). js/README.md is the map.

/**
 * Mulberry32, same shape as Projects/absalom-inheritance/js/rules.js. Returns
 * a function producing floats in [0, 1) — a drop-in for Math.random.
 */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The fixed simulation step. One frame at 60 Hz. */
export const STEP_MS = 1000 / 60;

/** How long a served cup sits on the counter before the station clears. */
export const SERVE_CLEAR_MS = 500;

// Today's scoreboard. Never persisted — a reload reopens the shop at Dawn on
// the same day, so the day's tally starts over with it.
export function freshDayStats() {
  return { drinksServed:0, foodServed:0, totalTips:0, accuracySum:0, accuracyCount:0,
    wagesPaid:0, bestTip:0, bestTipName:'', worstMiss:null, events:[], repDelta:0,
    newRegularNames:[], lostRegularNames:[] };
}

/** Day one, sixty dollars, two stations, nobody hired. The shape save.js writes into. */
export function freshState(content) {
  const S = content.STARTING_UNLOCKS;
  return {
    day:1,
    money:60,
    combo:0,
    bestCombo:0,
    shiftElapsed:0,
    shiftRunning:true,
    unlockedRecipes: new Set(S.recipes),
    unlockedSyrups: new Set(S.syrups),
    unlockedToppings: new Set(S.toppings),
    unlockedFoods: new Set(S.foods),
    queue: [], // waiting customers {id, recipeId, custom:{milk,syrup,toppings:[],ice}, isFood, patience, patienceMax, sprite}
    slots: [null, null], // active {customer, cup, food, foodPlated} — length grows via station upgrades
    focusedSlot: 0,
    nextCustomerId: 1,
    regulars: {}, // name -> {order, visits, lastDay, satisfaction, tolerance, stopped}
    salesHistory: [], // last HISTORY_WINDOW served {isFood, id} — what the shop has actually been selling
    muted: false,
    dayStats: freshDayStats(),
    baristas: [], // {id, name, level, targetSlot:null, acc:0, spec:null, trained:false, working:true}
    stationTab: 'base',
    loyaltyLevel: 0,
    comboShields: 0,
    shieldsPurchased: 0,
    presets: [], // {id, name, cup:{base,shots,milk,milkSteamed,syrup,toppings,ice,blended}}
    reputation: 50, // 0-100, shown as 1-5 stars
    upgrades: new Set(), // purchased equipment/ambiance/business upgrade ids
    marketingRemaining: 0,
    prestigeLevel: 0,
    // The permanent layer (Phase 7, #360). `meta` is the only part of the
    // state a reopening does not touch: beans earned and the tree they bought.
    // `layoutId` is the configuration this run opened in, picked at the last
    // reopening; day one is always the first layout.
    meta: { beans: 0, unlocks: new Set() },
    layoutId: content.SHOP_LAYOUTS[0].id,
    dailyModifierId: null,
    activeEvent: null, // {id, until}
    eventFiredThisShift: false,
    eventTriggerAt: 0,
  };
}

/** An empty cup. */
export function newCup() {
  return {
    base:null, // 'espresso','drip','tea','frappeBase'
    shots:0,
    milk:null,
    milkSteamed:false,
    syrup:null,
    toppings:[],
    ice:false,
    blended:false,
  };
}

/**
 * The shop. `state` is mutated in place and is the same object the page
 * renders from and save.js reads; `notify` receives
 *   {type:'toast', text}
 *   {type:'render', scope:'queue'|'all'}   something on screen changed
 *   {type:'shiftEnd', summary}             endShift() banked the day
 */
export function createSim({ content, rng = Math.random, state, notify = () => {} }) {
  const {
    MILKS, SYRUPS, TOPPINGS, RECIPES, FOODS, PHASES, SHIFT_MS, PHASE_MS,
    BARISTA_TIERS, LOYALTY_UPGRADES, REGULAR_NAMES, REGULAR_CHANCE,
    DAILY_MODIFIERS, RANDOM_EVENTS, STARTING_UNLOCKS, QUEUE_MAX,
    HAIR_COLORS, SKIN_COLORS, SHIRT_COLORS, PANTS_COLORS,
    STATION_UPGRADES, BARISTA_MAX, BARISTA_HIRE_COSTS, BARISTA_PROMOTE_COST,
    BARISTA_NAMES, SHIELD_BASE_COST, SHIELD_COST_STEP,
    SHIELD_MAX_HELD, EQUIPMENT_UPGRADES, AMBIANCE_UPGRADES, BUSINESS_UPGRADES,
    MARKETING_COST, MARKETING_DURATION_MS, PRESTIGE_MIN_DAY,
    STATION_GROUPS, TRAINING_GROUPS, TRAINING, TRAINING_SPEED_MULT, TRAINING_MISTAKE_MULT,
    SKILL_SPEED_MULT, SKILL_MISTAKE_MULT, REGISTER_SPEED_MULT, REGISTER_MISTAKE_MULT,
    MORALE_START, MORALE_MAX, MORALE_WORK_DROP, MORALE_OFF_GAIN, MORALE_RAISE_GAIN, MORALE_RAISE_COST,
    REGULAR_SATISFACTION_START, REGULAR_SATISFACTION_MAX, REGULAR_SATISFACTION_SERVE_GOOD,
    REGULAR_SATISFACTION_SERVE_BAD, REGULAR_STOP_THRESHOLD, REGULAR_STOP_MIN_VISITS,
    REGULAR_FRIEND_THRESHOLD, REGULAR_FRIEND_CHANCE, REGULAR_TOLERANCE_START,
    REGULAR_TOLERANCE_MIN, REGULAR_TOLERANCE_MAX, REGULAR_TOLERANCE_STEP,
    WORD_OF_MOUTH_MIN, WORD_OF_MOUTH_MAX, WORD_OF_MOUTH_REP_SPAN, WORD_OF_MOUTH_REGULAR_SPAN,
    HISTORY_WINDOW, HISTORY_WEIGHT,
    BEANS_PER_DAYS, BEANS_PER_REPUTATION, BEANS_MAX, META_UPGRADES, META_MENU,
    META_DISCOUNT, META_DISCOUNT_MAX, SHOP_LAYOUTS,
  } = content;
  const clampNum = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /* ---------- util ---------- */
  function rand(arr){ return arr[Math.floor(rng()*arr.length)]; }
  function randInt(a,b){ return Math.floor(rng()*(b-a+1))+a; }
  function toast(text){ notify({ type:'toast', text }); }
  function render(scope){ notify({ type:'render', scope }); }

  /* ---------- tuning that reads state ---------- */
  // Day 1 stays exactly at baseline tuning; each following day nudges spawn
  // rate up and patience down slightly, capped at a floor so it never becomes
  // impossible.
  function spawnFactor(){
    const floor = Math.max(0.30, 0.6 - 0.06*state.prestigeLevel);
    const base = Math.max(floor, 1 - (state.day-1)*0.05);
    return Math.max(0.25, base * shopSpawnFactorMult());
  }
  function patienceFactor(){
    const floor = Math.max(0.45, 0.75 - 0.06*state.prestigeLevel);
    const base = Math.max(floor, 1 - (state.day-1)*0.03);
    return base * shopPatienceMult();
  }

  // Juniors can only be trusted with straightforward drinks; Seniors handle anything.
  function orderComplexity(order){
    if(order.isFood) return 'food';
    const r = RECIPES.find(x=>x.id===order.recipeId);
    return (r.requiredSyrup || r.blended) ? 'specialty' : 'simple';
  }
  // `spec` used to be a switch the player set by hand; it is a reading of
  // skill now (Phase 5, #348). Trained on bar only, or kitchen only, makes a
  // specialist in that group; trained in both, or neither, is a generalist —
  // an untrained barista could always attempt either type, gated by level.
  function effectiveSpec(barista){
    const sk = barista.skill || { bar:0, kitchen:0, register:0 };
    if(sk.bar>0 && !(sk.kitchen>0)) return 'bar';
    if(sk.kitchen>0 && !(sk.bar>0)) return 'kitchen';
    return null;
  }
  function baristaCanHandle(barista, order){
    const spec = effectiveSpec(barista);
    if(spec==='bar' && order.isFood) return false;
    if(spec==='kitchen' && !order.isFood) return false;
    if(barista.level>=2) return true;
    return orderComplexity(order)==='simple';
  }
  // Baristas tire out over the course of a shift: up to 35% slower by the end.
  function baristaFatigueFactor(){
    return 1 + 0.35 * Math.min(1, state.shiftElapsed/SHIFT_MS);
  }
  // Morale (Phase 5, #348): neutral at MORALE_START, so a fresh hire moves
  // exactly like the old, morale-less barista did. It falls while working,
  // rises on a day off or a raise, and moves both speed and mistakes, so
  // wages become a lever with a downside instead of a fixed subtraction.
  function moraleOf(barista){ return Number.isFinite(barista.morale) ? barista.morale : MORALE_START; }
  function moraleSpeedMult(barista){ return 1 - (moraleOf(barista) - MORALE_START) * 0.003; }
  function moraleMistakeMult(barista){ return 1 - (moraleOf(barista) - MORALE_START) * 0.005; }

  // ---- Reputation (0-100, shown as 1-5 stars) ----
  function reputationStars(){ return Math.max(1, Math.min(5, Math.round(state.reputation/20))); }
  function adjustReputation(delta){ state.reputation = Math.max(0, Math.min(100, Math.round((state.reputation+delta)*10)/10)); }

  /* ---------- the permanent layer (Phase 7, #360) ---------- */
  // Everything a reopening carries across, derived rather than stored. That is
  // the whole trick: a prestige level or an owned bean unlock is a fact about
  // the save, and what it grants is read off it here every time it is asked
  // for. Writing the grants into state.unlockedRecipes instead would mean a
  // purchase, a reopening and repairSave() each had to remember to do it, and
  // the three would drift the way the affordability test did before #344.
  const metaById = id => META_UPGRADES.find(m => m.id === id);
  function metaUnlocks(){
    if(!state.meta || !(state.meta.unlocks instanceof Set)) state.meta = { beans: state.meta?.beans ?? 0, unlocks: new Set() };
    return state.meta.unlocks;
  }
  function metaOwned(id){ return metaUnlocks().has(id); }
  function beansHeld(){ return Math.max(0, Math.round(state.meta?.beans ?? 0)); }

  /** What a run that closed on this day at this reputation is worth in beans. */
  function beansFromRun(day = state.day, reputation = state.reputation){
    return Math.floor(Math.max(0, day - 1) / BEANS_PER_DAYS)
         + Math.floor(Math.max(0, reputation) / BEANS_PER_REPUTATION);
  }

  /** Every chalkboard price, times this. Bounded at META_DISCOUNT_MAX. */
  function metaDiscount(){
    let d = 0;
    for(const [id, cut] of Object.entries(META_DISCOUNT)) if(metaOwned(id)) d += cut;
    return Math.min(META_DISCOUNT_MAX, d);
  }
  function boardCost(cost){ return Math.max(0, Math.round(cost * (1 - metaDiscount()))); }

  /**
   * Is this recipe on the menu right now? Three ways in, and only the first
   * is stored: money bought it, the shop has reopened enough times, or a bean
   * unlock put it there for good.
   */
  function recipeAvailable(id){
    if(state.unlockedRecipes.has(id)) return true;
    const r = RECIPES.find(x => x.id === id);
    if(!r) return false;
    if(r.prestigeGated && state.prestigeLevel >= r.prestigeGated) return true;
    for(const [meta, recipeId] of Object.entries(META_MENU)) if(recipeId === id && metaOwned(meta)) return true;
    return false;
  }

  /** The layout this run opened in, falling back to day one's. */
  function currentLayout(){
    return SHOP_LAYOUTS.find(l => l.id === state.layoutId) || SHOP_LAYOUTS[0];
  }
  /** The layouts a reopening could pick, at the level it would reach. */
  function layoutsFor(level){
    return SHOP_LAYOUTS.filter(l => level >= l.minPrestige);
  }

  /**
   * What a reopening right now would cost and pay, as the three lists the
   * confirmation reads (Phase 7, #360). The page used to ask with one
   * window.confirm sentence that named "most upgrades" and nothing else.
   */
  function reopenPreview(){
    const gate = PURCHASES.prestige.refuse();
    const level = state.prestigeLevel + 1;
    const earned = beansFromRun();
    const layout = layoutsFor(level);
    return {
      ok: !gate, reason: gate,
      day: state.day, level, beansEarned: earned, beansHeld: beansHeld(),
      beansAfter: beansHeld() + earned,
      kept: [
        `Prestige level ${level} — a permanent +${5*level}% on every sale`,
        `${beansHeld() + earned} beans, and every Legacy unlock you have bought`,
        ...(Object.keys(state.regulars).filter(n=>!state.regulars[n].stopped).length
          ? [`${Object.keys(state.regulars).filter(n=>!state.regulars[n].stopped).length} regulars — the people, not their standing orders`]
          : []),
        ...(RECIPES.filter(r=>r.prestigeGated && r.prestigeGated <= level).length
          ? [`${RECIPES.filter(r=>r.prestigeGated && r.prestigeGated <= level).map(r=>r.name).join(', ')} on the menu, free, from now on`]
          : []),
      ],
      lost: [
        `$${Math.max(0, Math.round(state.money))} in the till, down to $${60 + level*20}`,
        `Day ${state.day} back to day 1`,
        ...(state.upgrades.size ? [`${state.upgrades.size} equipment, ambiance and business upgrade${state.upgrades.size>1?'s':''}`] : []),
        ...(state.baristas.length ? [`${state.baristas.length} barista${state.baristas.length>1?'s':''}, their training and their morale`] : []),
        ...(state.unlockedRecipes.size > STARTING_UNLOCKS.recipes.length
          ? [`${state.unlockedRecipes.size - STARTING_UNLOCKS.recipes.length} recipe unlock${state.unlockedRecipes.size - STARTING_UNLOCKS.recipes.length>1?'s':''} you paid money for`] : []),
        ...(state.loyaltyLevel ? ['the loyalty program'] : []),
        ...(state.comboShields ? [`${state.comboShields} streak shield${state.comboShields>1?'s':''}`] : []),
        `Reputation ${Math.round(state.reputation)} back to 50`,
      ],
      earnedList: [
        `+${earned} beans (${Math.floor(Math.max(0, state.day-1)/BEANS_PER_DAYS)} for ${state.day} days, ${Math.floor(Math.max(0, state.reputation)/BEANS_PER_REPUTATION)} for reputation ${Math.round(state.reputation)})`,
        ...(metaOwned('thirdCounter') ? ['A Third Counter: three stations from the first shift'] : []),
        ...(metaOwned('dayOneHire') ? ['A Hand on Day One: a Junior Barista already hired'] : []),
        ...(metaDiscount() ? [`${Math.round(metaDiscount()*100)}% off every chalkboard price`] : []),
      ],
      layouts: SHOP_LAYOUTS.map(l => ({
        id: l.id, name: l.name, desc: l.desc, minPrestige: l.minPrestige,
        available: level >= l.minPrestige,
      })),
      defaultLayout: layout[layout.length-1].id,
    };
  }

  // ---- Upgrade effect helpers ----
  function hasUpgrade(id){ return state.upgrades.has(id); }
  function queueMax(){ return QUEUE_MAX + (hasUpgrade('seating') ? 1 : 0) + currentLayout().queueBonus; }
  function espressoDurationMs(){
    if(hasUpgrade('espresso3')) return 220;
    if(hasUpgrade('espresso2')) return 320;
    return 500;
  }
  function outageActive(){ return !!(state.activeEvent && state.activeEvent.id==='outage'); }
  function stationDurationMult(){
    if(outageActive()) return hasUpgrade('generator') ? 1.2 : 1.8;
    return 1;
  }
  // `isFood` picks which trained group applies — bar for a drink, kitchen for
  // a plate. `register` training and morale apply either way (#348).
  function mistakeReduceFactor(barista, isFood){
    let f = 1;
    if(hasUpgrade('grinder')) f *= 0.7;
    if(!barista) return f;
    const sk = barista.skill || { bar:0, kitchen:0, register:0 };
    if(sk[isFood ? 'kitchen' : 'bar'] > 0) f *= SKILL_MISTAKE_MULT;
    if(sk.register > 0) f *= REGISTER_MISTAKE_MULT;
    if(barista.training) f *= TRAINING_MISTAKE_MULT;
    f *= moraleMistakeMult(barista);
    return f;
  }
  function shopPatienceMult(){
    let m = 1;
    if(hasUpgrade('pos2')) m *= 1.12;
    if(hasUpgrade('music')) m *= 1.10;
    return m;
  }
  function shopTipMult(){
    let m = 1;
    if(hasUpgrade('music')) m *= 1.05;
    if(hasUpgrade('decor')) m *= 1.08;
    if(hasUpgrade('foodprep')) m *= 1.03;
    if(hasUpgrade('franchise')) m *= 1.10;
    if(state.prestigeLevel) m *= (1 + 0.05*state.prestigeLevel);
    return m;
  }
  function shopSpawnFactorMult(){
    let m = 1;
    if(hasUpgrade('sign')) m *= 0.80;
    if(state.marketingRemaining>0) m *= 0.6;
    const dm = getActiveDailyModifier();
    if(dm && dm.spawnMult) m *= dm.spawnMult;
    if(state.activeEvent && state.activeEvent.id==='rush') m *= 0.45;
    if(state.activeEvent && state.activeEvent.id==='outage') m *= 1.25;
    m *= wordOfMouthSpawnMult();
    return m;
  }

  // ---- Word of mouth (Phase 6, #349) ----
  // Reputation and recent regular satisfaction blend into one signal in
  // [-1, 1] (0 at reputation 50 and no regulars yet), which nudges the door
  // and the regular-chance roll — the wishlist's own words: "the one number
  // that must not run away". Both multipliers stay inside
  // [WORD_OF_MOUTH_MIN, WORD_OF_MOUTH_MAX] on purpose; test/balance.mjs pins
  // both ends and the guard is verified by removing the clamp and watching
  // the spawn rate diverge (locked decision #34).
  function wordOfMouthSignal(){
    const repSignal = (state.reputation - 50) / 50;
    const regs = Object.values(state.regulars);
    const satAvg = regs.length ? regs.reduce((a,r)=>a+r.satisfaction,0)/regs.length : REGULAR_SATISFACTION_START;
    const satSignal = (satAvg - REGULAR_SATISFACTION_START) / (REGULAR_SATISFACTION_MAX - REGULAR_SATISFACTION_START);
    return Math.max(-1, Math.min(1, (repSignal + satSignal) / 2));
  }
  function wordOfMouthGoodness(span){
    const mult = 1 + wordOfMouthSignal() * span;
    return clampNum(mult, WORD_OF_MOUTH_MIN, WORD_OF_MOUTH_MAX);
  }
  // A spawn factor is an interval multiplier: smaller means more customers.
  // Goodness > 1 means the shop is doing well, so it takes the reciprocal.
  function wordOfMouthSpawnMult(){ return 1 / wordOfMouthGoodness(WORD_OF_MOUTH_REP_SPAN); }
  function wordOfMouthRegularMult(){ return wordOfMouthGoodness(WORD_OF_MOUTH_REGULAR_SPAN); }

  /* ---------- daily modifiers ---------- */
  function getActiveDailyModifier(){
    return DAILY_MODIFIERS.find(m=>m && m.id===state.dailyModifierId) || null;
  }
  function rollDailyModifier(){
    const m = rand(DAILY_MODIFIERS);
    state.dailyModifierId = m ? m.id : null;
  }

  /* ---------- random events ---------- */
  function fireRandomEvent(){
    state.eventFiredThisShift = true;
    const ev = rand(RANDOM_EVENTS);
    state.dayStats.events.push(ev.name);
    if(ev.id==='rush'){
      state.activeEvent = {id:'rush', until: state.shiftElapsed + 15000};
      toast(`📣 ${ev.name}: ${ev.desc}`);
    } else if(ev.id==='outage'){
      const mitigated = hasUpgrade('generator');
      state.activeEvent = {id:'outage', until: state.shiftElapsed + (mitigated ? 7000 : 13000)};
      toast(mitigated ? `⚡ ${ev.name} — the backup generator kept things mostly steady` : `⚡ ${ev.name}! ${ev.desc}`);
    } else if(ev.id==='critic'){
      const order = generateOrder();
      order.isCritic = true;
      order.patienceMax = Math.round(order.patienceMax*1.6);
      order.patience = order.patienceMax;
      state.queue.unshift(order);
      toast(`🎩 ${ev.name}! ${ev.desc}`);
    } else if(ev.id==='birthday'){
      const names = Object.keys(state.regulars).filter(n=>!state.regulars[n].stopped);
      const name = names.length ? rand(names) : null;
      const order = generateOrder();
      if(name){ order.isRegular = true; order.regularName = name; }
      order.isBirthday = true;
      order.patienceMax = Math.round(order.patienceMax*1.3);
      order.patience = order.patienceMax;
      state.queue.unshift(order);
      toast(`🎂 ${ev.name}! Make ${name||'them'} happy for a bonus.`);
    }
    render('all');
    return ev;
  }

  function getUnlockedRecipeList(){
    return RECIPES.filter(r=>recipeAvailable(r.id));
  }
  function getUnlockedFoodList(){
    return FOODS.filter(f=>state.unlockedFoods.has(f.id));
  }

  // ---- Order histories feed composition (Phase 6, #349) ----
  // The last HISTORY_WINDOW things the shop actually served, recorded by
  // scoreServe(). weightedPick nudges a pool toward whatever has recently sold
  // by HISTORY_WEIGHT, so a shop that has been selling iced drinks starts
  // seeing more of them without a daily modifier having to say so — every
  // item still has a floor weight of 1, so nothing unlocked is ever starved.
  function weightedPick(pool){
    if(pool.length<=1 || !state.salesHistory.length) return rand(pool);
    const counts = new Map();
    for(const s of state.salesHistory) counts.set(s.id, (counts.get(s.id)||0)+1);
    const total = state.salesHistory.length;
    const weights = pool.map(item => 1 + HISTORY_WEIGHT*pool.length*((counts.get(item.id)||0)/total));
    const sum = weights.reduce((a,b)=>a+b,0);
    let r = rng()*sum;
    for(let i=0;i<pool.length;i++){ r -= weights[i]; if(r<=0) return pool[i]; }
    return pool[pool.length-1];
  }
  function recordSale(isFood, id){
    state.salesHistory.push({ isFood, id });
    if(state.salesHistory.length > HISTORY_WINDOW) state.salesHistory.shift();
  }

  /* ---------- order generation ---------- */
  // Builds just the "what do they want" part of an order (no id/patience/sprite).
  // Extracted so it can be reused both for one-off orders and for generating
  // a named regular's persistent favorite the first time they appear.
  function generateOrderContent(phase){
    const dm = getActiveDailyModifier();
    const roll = rng();
    const w = phase.mixWeights;
    let foodWeight = w.food;
    if(dm && dm.id==='pastryRush') foodWeight = Math.min(0.7, w.food*1.7);
    let kind;
    if(roll < foodWeight) kind='food';
    else if(roll < foodWeight + w.specialty) kind='specialty';
    else kind='simple';

    let isFood = kind==='food' && getUnlockedFoodList().length>0;
    if(isFood){
      const food = weightedPick(getUnlockedFoodList());
      return { isFood:true, foodId: food.id, price: food.price };
    }

    let pool = getUnlockedRecipeList();
    let simplePool = pool.filter(r=>!r.requiredSyrup && !r.blended);
    let specialtyPool = pool.filter(r=>r.requiredSyrup || r.blended);
    let recipe;
    if(kind==='specialty' && specialtyPool.length>0) recipe = weightedPick(specialtyPool);
    else recipe = weightedPick(simplePool.length? simplePool : pool);

    const custom = {};
    if(recipe.needsMilk){
      custom.milk = rand(MILKS).id;
    }
    if(recipe.requiredSyrup){
      custom.syrup = recipe.requiredSyrup;
    } else if(rng()<0.35 && state.unlockedSyrups.size>0){
      custom.syrup = rand([...state.unlockedSyrups]);
    }
    custom.toppings = [];
    const toppingsAvail = [...state.unlockedToppings];
    if(rng()<0.4 && toppingsAvail.length>0){
      custom.toppings.push(rand(toppingsAvail));
    }
    custom.ice = !!recipe.ice;
    if(dm && dm.id==='icedMonday' && !recipe.blended && !custom.ice && rng()<0.55){
      custom.ice = true;
    }

    return { isFood:false, recipeId: recipe.id, custom, price: recipe.price };
  }

  function cloneOrderContent(content){
    if(content.isFood) return { isFood:true, foodId: content.foodId, price: content.price };
    return {
      isFood:false,
      recipeId: content.recipeId,
      price: content.price,
      custom: {
        milk: content.custom.milk,
        syrup: content.custom.syrup,
        toppings: [...content.custom.toppings],
        ice: content.custom.ice,
      }
    };
  }

  // The customer's look, picked here so it comes off the same rng as the
  // order. The page turns it into pixels.
  function pickSprite(){
    return { hair: rand(HAIR_COLORS), skin: rand(SKIN_COLORS), shirt: rand(SHIRT_COLORS), pants: rand(PANTS_COLORS) };
  }

  // A regular who has been served badly enough, often enough, stopped coming
  // (#349): excluded here, kept in state.regulars so the day-end modal can
  // still say who it was.
  function activeRegularNames(){
    return REGULAR_NAMES.filter(n => !(state.regulars[n] && state.regulars[n].stopped));
  }

  function generateOrder(){
    const phase = PHASES[currentPhaseIndex()];

    const dm0 = getActiveDailyModifier();
    const regularChance = REGULAR_CHANCE * (dm0 && dm0.regularChanceMult ? dm0.regularChanceMult : 1) * wordOfMouthRegularMult();
    const pool = activeRegularNames();
    let isRegular = false, regularName = null, content;
    if(pool.length && rng() < regularChance){
      regularName = rand(pool);
      isRegular = true;
      let rec = state.regulars[regularName];
      if(!rec){
        rec = { order: generateOrderContent(phase), visits:0, lastDay:0,
          satisfaction: REGULAR_SATISFACTION_START, tolerance: REGULAR_TOLERANCE_START, stopped:false };
        state.regulars[regularName] = rec;
      }
      rec.visits++;
      rec.lastDay = state.day;
      content = cloneOrderContent(rec.order);
    } else {
      content = generateOrderContent(phase);
    }

    const pf = patienceFactor();
    let pMax = content.isFood
      ? Math.round(randInt(28,40) * pf)
      : Math.round(randInt(35,55) * pf);
    if(isRegular){
      pMax = Math.round(pMax * state.regulars[regularName].tolerance);
      if(state.loyaltyLevel>0){
        pMax = Math.round(pMax * (1 + LOYALTY_UPGRADES[state.loyaltyLevel-1].patienceBonus));
      }
    }

    return {
      id: state.nextCustomerId++,
      ...content,
      patienceMax: pMax,
      patience: pMax,
      sprite: pickSprite(),
      isRegular,
      regularName,
    };
  }

  // Returns an ordered list of {label, station, check(slot)->bool, apply(slot)}
  // describing everything this order needs. The ticket checklist, the station
  // tabs' "still needed" dot, the Serve button's cue, the barista's work queue
  // and the scorer all read this one list (#342). `station` is the tab the
  // line is made at; `apply` is the one step a barista takes to satisfy it.
  function getOrderRequirements(order){
    if(order.isFood){
      const f = FOODS.find(x=>x.id===order.foodId);
      return [{label: f.name, station:'food',
        check: slot => slot.foodPlated === order.foodId,
        apply: slot => { slot.foodPlated = order.foodId; }}];
    }
    const r = RECIPES.find(x=>x.id===order.recipeId);
    const reqs = [];
    let baseLabel;
    if(r.base==='espresso') baseLabel = r.shots>0 ? `${r.shots} espresso shot${r.shots>1?'s':''}` : 'Espresso base';
    else if(r.base==='drip') baseLabel = 'Drip coffee';
    else if(r.base==='tea') baseLabel = 'Steeped tea';
    else if(r.base==='frappeBase') baseLabel = 'Blended base';
    else baseLabel = 'Base';
    reqs.push({label: baseLabel, station:'base',
      check: slot => slot.cup.base===r.base && (r.shots ? slot.cup.shots>=r.shots : true),
      apply: slot => {
        slot.cup.base = r.base;
        if(r.shots) slot.cup.shots = r.shots;
        if(r.base==='frappeBase') slot.cup.blended = true;
      }});

    if(r.needsMilk){
      const m = MILKS.find(x=>x.id===order.custom.milk);
      const needsSteamed = !order.custom.ice && !r.blended;
      reqs.push({
        label: `${m.name}${needsSteamed ? ', steamed' : ''}`, station:'milk',
        check: slot => slot.cup.milk===order.custom.milk && (needsSteamed ? slot.cup.milkSteamed : true),
        apply: slot => { slot.cup.milk = order.custom.milk; if(needsSteamed) slot.cup.milkSteamed = true; },
      });
    }
    if(order.custom.syrup){
      const s = SYRUPS.find(x=>x.id===order.custom.syrup);
      reqs.push({label: s.name+' syrup', station:'syrup',
        check: slot => slot.cup.syrup===order.custom.syrup,
        apply: slot => { slot.cup.syrup = order.custom.syrup; }});
    }
    order.custom.toppings.forEach(t=>{
      const top = TOPPINGS.find(x=>x.id===t);
      reqs.push({label: top.name, station:'toppings',
        check: slot => slot.cup.toppings.includes(t),
        apply: slot => { slot.cup.toppings.push(t); }});
    });
    if(order.custom.ice || r.blended){
      // Ice is added at the milk station, where its button is; blending has its own.
      reqs.push({label: r.blended? 'Blended':'Iced', station: r.blended ? 'blend' : 'milk',
        check: slot => r.blended ? slot.cup.blended : slot.cup.ice,
        apply: slot => { if(r.blended) slot.cup.blended = true; else slot.cup.ice = true; }});
    }
    return reqs;
  }

  function cupMatchesEnough(cup, order){
    if(!cup.base) return false;
    const recipe = RECIPES.find(r=>r.id===order.recipeId);
    if(recipe.needsMilk && !cup.milk) return false;
    return true; // partial credit handled in scoring; just need a real drink attempted
  }

  function orderIsComplete(slot){
    const reqs = getOrderRequirements(slot.customer);
    return reqs.every(req=>req.check(slot));
  }

  // The Serve button, decided (#341): it stays loose and says what it costs.
  //   canServe  something real was attempted — for a drink a base and, if the
  //             recipe wants milk, some milk (cupMatchesEnough); for food, a
  //             plate with anything on it. An empty plate used to be servable
  //             for 40% of the price, which no drink ever was (#342).
  //   done, total, missing   the ticket lines, straight off
  //             getOrderRequirements(), so the button's "Serve 3/5" and its
  //             "still missing" list are the scorer's own count.
  function serveReadiness(slot){
    const reqs = getOrderRequirements(slot.customer);
    const missing = reqs.filter(req=>!req.check(slot)).map(req=>req.label);
    const canServe = slot.food ? slot.foodPlated != null : cupMatchesEnough(slot.cup, slot.customer);
    return { canServe, done: reqs.length - missing.length, total: reqs.length, missing, complete: missing.length===0 };
  }

  // The station tabs whose ticket lines are still unmet, for the "still
  // needed" dot. The same list the ticket and the scorer read.
  function stationsNeedingWork(slot){
    return new Set(getOrderRequirements(slot.customer).filter(req=>!req.check(slot)).map(req=>req.station));
  }

  /* ---------- accept / release / serve ---------- */
  // Takes a waiting customer to the first empty station. Returns the station
  // index, or -1 with every station busy, or null when the customer is not in
  // the queue (already taken, or walked). Focus and the station tab are the
  // page's to set.
  function acceptCustomer(custId){
    const emptyIdx = state.slots.findIndex(s=>s===null);
    if(emptyIdx===-1) return -1;
    const custIdx = state.queue.findIndex(c=>c.id===custId);
    if(custIdx===-1) return null;
    const order = state.queue[custIdx];
    state.queue.splice(custIdx,1);
    state.slots[emptyIdx] = {
      customer: order,
      cup: newCup(),
      food: order.isFood || false,
      foodPlated: null,
    };
    return emptyIdx;
  }

  function releaseSlot(idx){
    const slot = state.slots[idx];
    if(!slot) return false;
    state.queue.unshift(slot.customer);
    state.slots[idx]=null;
    return true;
  }

  function discardCup(idx){
    const slot = state.slots[idx];
    if(!slot) return false;
    slot.cup = newCup();
    slot.foodPlated = null;
    return true;
  }

  // The economy in one function. Prices the cup against the ticket, banks the
  // money, moves combo, shields, reputation and the day's stats, marks the
  // slot as serving, and returns the receipt the page turns into a toast:
  //   base      what the cup itself was worth: price * (0.35 + 0.65*ratio)
  //   tip       patience tip + combo + regular bonus, times the shop's mults
  //   eventBonus  critic and birthday extras
  //   earned    everything credited to money: base + tip + eventBonus
  //   ratio, happy, repDelta, comboBonus, regularBonus, shieldUsed, title
  // Returns null when the station is empty or already serving.
  function scoreServe(slot){
    if(!slot || slot.serving) return null;
    const order = slot.customer;
    let base = 0;
    let happy = true;
    let ratio = 1;
    let title = '';

    if(slot.food){
      const f = FOODS.find(x=>x.id===order.foodId);
      title = f.name;
      const correct = slot.foodPlated === order.foodId;
      base = correct? order.price : Math.round(order.price*0.4);
      happy = correct;
      ratio = correct ? 1 : 0.4;
      state.dayStats.foodServed++;
      recordSale(true, order.foodId);
    } else {
      const recipe = RECIPES.find(r=>r.id===order.recipeId);
      title = recipe.name;
      const reqs = getOrderRequirements(order);
      const doneCount = reqs.filter(req=>req.check(slot)).length;
      ratio = reqs.length? doneCount/reqs.length : 1;
      happy = ratio>=0.999;
      base = Math.round(recipe.price * (0.35 + 0.65*ratio));
      state.dayStats.drinksServed++;
      recordSale(false, order.recipeId);
    }
    state.dayStats.accuracySum += ratio;
    state.dayStats.accuracyCount++;

    let shieldUsed = false;
    if(happy){ state.combo++; if(state.combo>state.bestCombo) state.bestCombo=state.combo; }
    else if(state.comboShields>0){ state.comboShields--; shieldUsed = true; }
    else state.combo = 0;

    const loyaltyTipBonus = state.loyaltyLevel>0 ? LOYALTY_UPGRADES[state.loyaltyLevel-1].tipBonus : 0;
    const patienceRatio = Math.max(0, order.patience/order.patienceMax);
    const tipBase = base * 0.25 * patienceRatio;
    const comboMult = Math.min(0.40, state.combo * 0.02);
    const comboBonus = Math.round(tipBase * comboMult);
    const regularBonus = (order.isRegular && happy) ? Math.round(tipBase * (0.25 + loyaltyTipBonus)) : 0;

    const dm = getActiveDailyModifier();
    let dmMult = 1;
    if(dm){
      if(dm.tipBonusAll) dmMult += dm.tipBonusAll;
      if(dm.tipBonusIced && !slot.food && order.custom && order.custom.ice) dmMult += dm.tipBonusIced;
      if(dm.tipBonusFood && slot.food) dmMult += dm.tipBonusFood;
    }
    const tip = Math.round((Math.round(tipBase) + comboBonus + regularBonus) * shopTipMult() * dmMult);

    let eventBonus = 0;
    const repBefore = state.reputation;
    if(happy && order.isCritic){ eventBonus = base; adjustReputation(8); }
    else if(order.isCritic){ adjustReputation(-5); }
    if(happy && order.isBirthday){ eventBonus += Math.round(base*0.5); }
    const earned = base + tip + eventBonus;

    adjustReputation(happy ? 0.4 : -0.8);
    state.dayStats.repDelta = Math.round((state.reputation-50)*10)/10;
    const repDelta = Math.round((state.reputation - repBefore)*10)/10;

    state.money += earned;
    state.dayStats.totalTips += tip + eventBonus;
    if(tip+eventBonus > state.dayStats.bestTip){ state.dayStats.bestTip = tip+eventBonus; state.dayStats.bestTipName = title; }
    if(!happy && (!state.dayStats.worstMiss || ratio < state.dayStats.worstMiss.ratio)){
      state.dayStats.worstMiss = { name: title, ratio };
    }

    // A regular is a record now, not just a drink (Phase 6, #349): satisfaction
    // and tolerance move with how the visit went. Served badly enough, often
    // enough, they stop coming; served well at a high satisfaction, they
    // sometimes bring a friend — a fresh regular, minted at the day-one menu.
    if(order.isRegular && state.regulars[order.regularName]){
      const rec = state.regulars[order.regularName];
      rec.satisfaction = clampNum(rec.satisfaction + (happy ? REGULAR_SATISFACTION_SERVE_GOOD : REGULAR_SATISFACTION_SERVE_BAD), 0, REGULAR_SATISFACTION_MAX);
      rec.tolerance = clampNum(rec.tolerance + (happy ? REGULAR_TOLERANCE_STEP : -REGULAR_TOLERANCE_STEP), REGULAR_TOLERANCE_MIN, REGULAR_TOLERANCE_MAX);
      if(!happy && !rec.stopped && rec.visits >= REGULAR_STOP_MIN_VISITS && rec.satisfaction <= REGULAR_STOP_THRESHOLD){
        rec.stopped = true;
        state.dayStats.lostRegularNames.push(order.regularName);
      }
      if(happy && rec.satisfaction >= REGULAR_FRIEND_THRESHOLD && rng() < REGULAR_FRIEND_CHANCE){
        const candidate = REGULAR_NAMES.find(n => !state.regulars[n]);
        if(candidate){
          state.regulars[candidate] = { order: generateOrderContent(PHASES[currentPhaseIndex()]), visits:0, lastDay: state.day,
            satisfaction: REGULAR_SATISFACTION_START, tolerance: REGULAR_TOLERANCE_START, stopped:false };
          state.dayStats.newRegularNames.push(candidate);
        }
      }
    }

    slot.serving = true;
    slot.servedAt = state.shiftElapsed;
    return { base, tip, eventBonus, earned, ratio, happy, repDelta, comboBonus, regularBonus, shieldUsed, title };
  }

  /* ---------- spawn / patience ---------- */
  function spawnCustomer(){
    if(!state.shiftRunning) return false;
    if(state.queue.length >= queueMax()) return false;
    state.queue.push(generateOrder());
    render('queue');
    return true;
  }

  function tickPatience(){
    state.queue.forEach(c=>{ c.patience = Math.max(0, c.patience - 0.5); });
    render('queue');
  }

  /* ---------- baristas ---------- */
  // Performs exactly one still-missing step of an order: the first unmet line
  // of the ticket, in the order the ticket shows them, by that line's own
  // apply(). It used to re-derive every check by hand beside
  // getOrderRequirements(), which is where a new recipe field went unchecked.
  function autoAssistStep(slot){
    const next = getOrderRequirements(slot.customer).find(req=>!req.check(slot));
    if(!next) return false;
    next.apply(slot);
    return true;
  }

  // A barista who fumbles gets one detail wrong right before serving —
  // they went through the motions but didn't double check the ticket.
  function baristaFumble(slot){
    const order = slot.customer;
    if(slot.food){
      const alts = getUnlockedFoodList().filter(f=>f.id!==order.foodId);
      if(!alts.length) return false;
      slot.foodPlated = rand(alts).id;
      return true;
    }
    const cup = slot.cup;
    const options = [];
    if(cup.syrup) options.push(()=>{ cup.syrup = null; });
    if(cup.toppings.length) options.push(()=>{ cup.toppings.pop(); });
    if(cup.milk){
      const alts = MILKS.filter(m=>m.id!==cup.milk);
      if(alts.length) options.push(()=>{ cup.milk = rand(alts).id; });
    }
    if(!options.length) return false;
    rand(options)();
    return true;
  }

  function claimedSlotIndexes(exceptBaristaId){
    return new Set(state.baristas
      .filter(b=>b.id!==exceptBaristaId && b.targetSlot!==null)
      .map(b=>b.targetSlot));
  }

  // A barista's step interval, per station group (Phase 5, #348): trained on
  // that group, or on register, speeds it up; training itself (mid-shift)
  // slows it down; morale and fatigue apply on top. `group` is 'bar' or
  // 'kitchen', off which station the claimed slot's next unmet line is made.
  function baristaIntervalMs(barista, group){
    const tier = BARISTA_TIERS[barista.level];
    const outageMult = outageActive() ? (hasUpgrade('generator') ? 1.15 : 1.6) : 1;
    let mult = baristaFatigueFactor() * outageMult * moraleSpeedMult(barista);
    const sk = barista.skill || { bar:0, kitchen:0, register:0 };
    if(group && sk[group] > 0) mult *= SKILL_SPEED_MULT;
    if(sk.register > 0) mult *= REGISTER_SPEED_MULT;
    if(barista.training) mult *= TRAINING_SPEED_MULT;
    return tier.intervalMs * mult;
  }

  // Claims an idle barista a slot to work, at no cost in time — the same
  // claim logic as before, just no longer bundled with the work step, so the
  // clock can know which group (and so which interval) applies before it
  // decides whether enough time has passed (#348).
  function ensureBaristaClaim(barista){
    if(barista.targetSlot!==null){
      const slot = state.slots[barista.targetSlot];
      if(!slot || slot.serving){ barista.targetSlot = null; }
    }
    if(barista.targetSlot===null){
      const claimed = claimedSlotIndexes(barista.id);
      let best = -1, bestPatience = Infinity;
      state.slots.forEach((slot, idx)=>{
        if(!slot || slot.serving || claimed.has(idx)) return;
        if(orderIsComplete(slot)) return; // already prepped, waiting on a human to serve
        if(!baristaCanHandle(barista, slot.customer)) return;
        const p = slot.customer.patience;
        if(p < bestPatience){ bestPatience = p; best = idx; }
      });
      if(best!==-1) barista.targetSlot = best;
    }
    return barista.targetSlot===null ? null : state.slots[barista.targetSlot];
  }

  // One dt's worth of a single barista: claim a slot if idle, accumulate
  // toward that slot's own interval, and take exactly one ticket-line step
  // once it trips. Leaves the finished cup for a human to serve.
  function runBaristaTick(barista, dt){
    const slot = ensureBaristaClaim(barista);
    if(!slot){ barista.acc = 0; return false; }
    const isFood = !!slot.food;
    const iv = baristaIntervalMs(barista, isFood ? 'kitchen' : 'bar');
    barista.acc = (barista.acc||0) + dt;
    if(barista.acc <= iv) return false;
    barista.acc = 0;

    // Work exactly one step on this cup only
    const worked = autoAssistStep(slot);

    // Prep is done — leave the cup for a human to serve instead of auto-serving.
    if(orderIsComplete(slot)){
      barista.targetSlot = null;
      const tier = BARISTA_TIERS[barista.level];
      const effMistakeChance = tier.mistakeChance * mistakeReduceFactor(barista, isFood) * (isFood && hasUpgrade('foodprep') ? 0.8 : 1);
      const fumbled = rng() < effMistakeChance && baristaFumble(slot);
      toast(fumbled ? `${barista.name} rushed the order, check it before serving 😬` : `${barista.name} finished the order — ready to serve ☕`);
      render('all');
      return true;
    }
    if(worked) render('all');
    return worked;
  }

  /* ---------- the clock ---------- */
  function currentPhaseIndex(){
    const idx = Math.floor(state.shiftElapsed / PHASE_MS);
    return Math.min(idx, PHASES.length-1);
  }

  let timeDebt = 0;
  let spawnAcc = 0;
  let patienceAcc = 0;
  function resetClock(){ timeDebt = 0; spawnAcc = 0; patienceAcc = 0; }

  // One fixed step. What gameLoop() did per frame, plus the patience interval
  // and the served-cup timeout that used to be their own timers.
  function step(dt){
    state.shiftElapsed += dt;
    spawnAcc += dt;
    const phase = PHASES[currentPhaseIndex()];
    const effectiveSpawnMs = phase.spawnMs * spawnFactor();
    if(spawnAcc > effectiveSpawnMs){
      spawnAcc = 0;
      spawnCustomer();
    }
    patienceAcc += dt;
    if(patienceAcc >= 1000){
      patienceAcc -= 1000;
      tickPatience();
    }
    state.baristas.forEach(b=>{
      if(b.working===false) return;
      runBaristaTick(b, dt);
    });
    if(state.marketingRemaining>0){
      state.marketingRemaining = Math.max(0, state.marketingRemaining - dt);
    }
    if(state.activeEvent && state.shiftElapsed >= state.activeEvent.until){
      state.activeEvent = null;
    }
    if(!state.eventFiredThisShift && state.shiftElapsed >= state.eventTriggerAt){
      fireRandomEvent();
    }
    let cleared = false;
    state.slots.forEach((slot, idx)=>{
      if(slot && slot.serving && state.shiftElapsed - slot.servedAt >= SERVE_CLEAR_MS){
        state.slots[idx] = null;
        cleared = true;
      }
    });
    if(cleared) render('all');
    if(state.shiftElapsed >= SHIFT_MS){
      endShift();
    }
  }

  // Time passes. dtMs is banked and paid out in STEP_MS steps, so the same
  // total always produces the same steps however it was split up. Returns the
  // number of steps taken. A shift that is not running takes none, and drops
  // the bank — a modal left open for ten minutes must not replay ten minutes
  // the instant the next day starts.
  //
  // The slack is float residue: 8,160 frames of 1000/60 sum to 136000.00000001,
  // so a bank of exactly 136000 is a hair short of the last step. A debt
  // within a nanosecond of a step is a step.
  const SLACK = 1e-6;
  function advance(dtMs){
    if(!state.shiftRunning){ timeDebt = 0; return 0; }
    timeDebt += dtMs;
    let steps = 0;
    while(timeDebt >= STEP_MS - SLACK && state.shiftRunning){
      timeDebt -= STEP_MS;
      step(STEP_MS);
      steps++;
    }
    if(!state.shiftRunning) timeDebt = 0;
    return steps;
  }

  // What today's wages actually cost — the one rule endShift() charges and
  // the chalkboard previews, so the two cannot drift apart (#348). A barista
  // given the day off (`working === false`) earns nothing that day; before
  // this both readers summed every barista with no `working` filter at all,
  // so Pip could be given the day off and still cost her full wage.
  function wagesDue(){
    return state.baristas.reduce((sum,b)=> b.working!==false ? sum + BARISTA_TIERS[b.level].wage : sum, 0);
  }

  /* ---------- the day ---------- */
  function endShift(){
    state.shiftRunning = false;
    const ds = state.dayStats;
    const avgAccuracy = ds.accuracyCount ? Math.round((ds.accuracySum/ds.accuracyCount)*100) : 100;

    const wages = wagesDue();
    ds.wagesPaid = wages;
    state.money -= wages;

    // Staff (#348): a barista who worked today resolves any training in
    // progress into skill and pays the day's toll on morale; a barista given
    // the day off rests instead. Both are additive to whatever `working` set.
    state.baristas.forEach(b=>{
      if(!Number.isFinite(b.morale)) b.morale = MORALE_START;
      if(b.working !== false){
        if(b.training){
          if(!b.skill) b.skill = { bar:0, kitchen:0, register:0 };
          b.skill[b.training] = 1;
          b.training = null;
        }
        b.morale = Math.max(0, b.morale - MORALE_WORK_DROP);
      } else {
        b.morale = Math.min(MORALE_MAX, b.morale + MORALE_OFF_GAIN);
      }
    });

    const summary = {
      day: state.day, money: state.money, avgAccuracy, wages,
      drinksServed: ds.drinksServed, foodServed: ds.foodServed, totalTips: ds.totalTips,
      bestCombo: state.bestCombo, bestTip: ds.bestTip, bestTipName: ds.bestTipName,
      worstMiss: ds.worstMiss, reputation: state.reputation, repDelta: ds.repDelta,
      events: [...ds.events],
      newRegulars: [...ds.newRegularNames], lostRegulars: [...ds.lostRegularNames],
    };
    notify({ type:'shiftEnd', summary });
    return summary;
  }

  function scheduleEvent(){
    state.eventTriggerAt = randInt(SHIFT_MS*0.2, SHIFT_MS*0.7);
  }

  // Shared by the modal's own button and by the page resuming a save captured
  // between endShift() banking the day and that button being clicked.
  function startNextDay(){
    state.day++;
    state.shiftElapsed = 0;
    state.combo = 0;
    state.bestCombo = 0;
    state.shiftRunning = true;
    state.queue = [];
    state.slots = state.slots.map(()=>null); // clear cups but keep station count
    state.baristas.forEach(b=>{ b.targetSlot = null; b.acc = 0; });
    state.marketingRemaining = 0;
    state.activeEvent = null;
    state.eventFiredThisShift = false;
    scheduleEvent();
    rollDailyModifier();
    state.dayStats = freshDayStats();
    resetClock();
  }

  /**
   * An upgrade the shop now owns, with the two side effects buying one has.
   * Shared by the equipment purchase and by a layout that opens with one
   * already installed (Phase 7, #360) — a layout granting 'espresso2' without
   * Ristretto would be an upgrade that does four fifths of its job.
   */
  function grantUpgrade(id){
    state.upgrades.add(id);
    if(id==='espresso2') state.unlockedRecipes.add('ristretto');
    if(id==='espresso3') state.unlockedRecipes.add('doppio');
  }

  /**
   * Reopen the shop. `layoutId` is the starting configuration (Phase 7, #360);
   * omitted means SHOP_LAYOUTS[0], day one exactly as it always was, so a
   * caller written before layouts existed gets the old reopening unchanged.
   *
   * The beans are counted first, before `day` goes to 1 and `reputation` to
   * 50, because they are earned by the run that is ending: beansFromRun()
   * reads exactly those two fields, so counting them after the resets pays a
   * day-30 shop what a day-1 one is worth. Verified by moving the two lines
   * below the resets and watching a day-10 close pay 2 beans instead of 8
   * (locked decision #34). The level's position in the order is not
   * load-bearing — beansFromRun() does not read it.
   */
  function prestige(layoutId){
    const layout = SHOP_LAYOUTS.find(l => l.id === layoutId) || SHOP_LAYOUTS[0];
    const beansEarned = beansFromRun();
    state.meta.beans = Math.min(BEANS_MAX, beansHeld() + beansEarned);
    state.prestigeLevel++;
    state.layoutId = layout.id;
    state.day = 1;
    state.money = 60 + state.prestigeLevel*20;
    state.combo = 0; state.bestCombo = 0;
    state.shiftElapsed = 0; state.shiftRunning = true;
    state.queue = [];
    // The layout's counter count, or the Legacy unlock's three, whichever is
    // more: two ways to the same slot should not cancel each other out.
    const stations = Math.max(layout.stations, metaOwned('thirdCounter') ? 3 : 2);
    state.slots = new Array(stations).fill(null);
    state.unlockedRecipes = new Set(STARTING_UNLOCKS.recipes);
    state.unlockedSyrups = new Set(STARTING_UNLOCKS.syrups);
    state.unlockedToppings = new Set(STARTING_UNLOCKS.toppings);
    state.unlockedFoods = new Set(STARTING_UNLOCKS.foods);
    // Regulars survive a reopen; their standing orders don't (Phase 6, #349).
    // A favourite built from syrups and toppings the reopened shop no longer
    // stocks is an order the player has no button to make, so it re-rolls off
    // the day-one menu (already reset above). The person survives: their
    // visit count and their tolerance. Satisfaction resets — the relationship
    // itself is starting over — and a regular who had already stopped coming
    // was not coming back anyway.
    const reopenedRegulars = {};
    for(const [name, rec] of Object.entries(state.regulars)){
      if(rec.stopped) continue;
      reopenedRegulars[name] = {
        order: generateOrderContent(PHASES[0]),
        visits: rec.visits, lastDay: 0,
        satisfaction: REGULAR_SATISFACTION_START, tolerance: rec.tolerance, stopped:false,
      };
    }
    state.regulars = reopenedRegulars;
    state.salesHistory = [];
    state.baristas = [];
    state.loyaltyLevel = 0;
    state.comboShields = 0;
    state.shieldsPurchased = 0;
    state.upgrades = new Set();
    if(layout.freeUpgrade) grantUpgrade(layout.freeUpgrade);
    // A Hand on Day One: the same hire the chalkboard makes, for free. Written
    // out rather than routed through purchase('hireBarista'), which would
    // charge $400 the reopened till does not have.
    if(metaOwned('dayOneHire')){
      state.baristas.push({ id:'b1', name: BARISTA_NAMES[0], level:1, targetSlot:null, acc:0,
        skill: { bar:0, kitchen:0, register:0 }, morale: MORALE_START, training:null, working:true });
    }
    state.reputation = 50;
    state.marketingRemaining = 0;
    state.activeEvent = null;
    state.eventFiredThisShift = false;
    scheduleEvent();
    rollDailyModifier();
    state.dayStats = freshDayStats();
    resetClock();
    toast(`Reopened as ${layout.name} at prestige level ${state.prestigeLevel}`
      + `${beansEarned ? `, +${beansEarned} bean${beansEarned>1?'s':''}` : ''}. 🔁`);
    render('all');
  }

  /* ---------- the station buttons: what each one does to a cup ---------- */
  // What a click at a station does, as a table: `ms` is how long its progress
  // bar runs (0 for an instant pick), `run(slot, cup, value)` makes the change
  // and returns the toast or null. The page draws the bar and plays the sound;
  // the rule is here, so a Frappe built by hand is a Node test (#343, #345).
  // `cup` is the cup the click started on — a bar that finishes after the cup
  // was dumped lands in the dumped cup, as it always has.
  const CUP_ACTIONS = {
    pullShot: { ms: () => espressoDurationMs()*stationDurationMult(), run(slot, cup){
      // A shot into a cup that is already blended stays a blended base, so a
      // Frappe can be built in either order (#343).
      cup.base = cup.blended ? 'frappeBase' : 'espresso'; cup.shots++; return 'Pulled a shot ☕'; } },
    brewDrip: { ms: () => 350*stationDurationMult(), run(slot, cup){ cup.base = 'drip'; return 'Brewed drip coffee'; } },
    steepTea: { ms: () => 400*stationDurationMult(), run(slot, cup){ cup.base = 'tea'; return 'Steeped tea 🍵'; } },
    pickMilk: { ms: () => 0, run(slot, cup, milk){ cup.milk = milk; cup.milkSteamed = false; return null; } },
    steamMilk: { ms: () => 900*stationDurationMult(), run(slot, cup){ cup.milkSteamed = true; return 'Steamed the milk 🔥'; } },
    pourCold: { ms: () => 0, run(slot, cup){ cup.milkSteamed = false; return 'Poured cold milk'; } },
    toggleIce: { ms: () => 0, run(slot, cup){ cup.ice = !cup.ice; return null; } },
    // Blending makes the base the blended base and keeps the shots. It was
    // `cup.base || 'frappeBase'`, so a shot pulled first stayed 'espresso' and
    // a hand-built Frappe could never tick its base line (#343).
    blend: { ms: () => 1100*stationDurationMult(), run(slot, cup){ cup.blended = true; cup.base = 'frappeBase'; return 'Blended! 🥤'; } },
    pickSyrup: { ms: () => 0, run(slot, cup, syrup){ cup.syrup = syrup; return null; } },
    clearSyrup: { ms: () => 0, run(slot, cup){ cup.syrup = null; return null; } },
    toggleTopping: { ms: () => 0, run(slot, cup, t){
      const i = cup.toppings.indexOf(t);
      if(i===-1){ cup.toppings.push(t); return 'Added topping ✨'; }
      cup.toppings.splice(i,1); return 'Removed topping'; } },
    plateFood: { ms: () => 0, run(slot, cup, foodId){ slot.food = true; slot.foodPlated = foodId; return 'Plated it!'; } },
  };
  /** How long a station button's bar runs before its action lands. */
  function cupActionMs(action){ return CUP_ACTIONS[action].ms(); }
  /** A station button's change, on `cup` (the slot's own by default). Returns the toast or null. */
  function cupAction(slot, action, value, cup = slot.cup){
    const a = CUP_ACTIONS[action];
    if(!a) throw new Error(`cupAction: unknown action "${action}"`);
    return a.run(slot, cup, value);
  }

  /* ---------- the chalkboard: one table of purchase kinds ---------- */
  // Every chalkboard button is one of these. Each row says what the purchase
  // takes from the till (`cost`), why it cannot happen right now (`refuse`,
  // null when it can) and what it does (`apply`, returning the toast). canBuy()
  // and purchase() are the only readers, so the chalkboard's disabled buttons
  // and the purchase itself read one rule (#344). It was the page's 145-line
  // doUnlock(), where every refusal fell through to toast('Unlocked!'), and a
  // hand-kept mirror of it in test/autopilot.mjs (#339).
  const byId = (table, id) => table.find(x => x.id === id);
  // The discount is applied here, once, so `refuse` and `cost` cannot disagree
  // about the price: every row's `need(x.cost)` asks whether the till covers
  // the *board* price, and canBuy() reports the same number purchase() takes.
  const need = cost => state.money < boardCost(cost) ? `Not enough money: $${boardCost(cost)} needed.` : null;
  const needBeans = cost => beansHeld() < cost ? `Not enough beans: ${cost} needed.` : null;
  const baristaById = id => state.baristas.find(b => b.id === id);
  const shieldCost = () => SHIELD_BASE_COST + state.shieldsPurchased*SHIELD_COST_STEP;
  function unlockRow(table, set, costKey, noun){
    return {
      cost: id => byId(table, id)?.[costKey] ?? 0,
      refuse(id){
        const x = byId(table, id);
        if(!x) return `No such ${noun}.`;
        if(state[set].has(id)) return `${x.name} is already unlocked.`;
        return need(x[costKey]);
      },
      apply(id){ state[set].add(id); return `${byId(table, id).name} unlocked!`; },
    };
  }
  const PURCHASES = {
    recipe: {
      cost: id => byId(RECIPES, id)?.unlockCost ?? 0,
      refuse(id){
        const r = byId(RECIPES, id);
        if(!r) return 'No such recipe.';
        if(r.equipmentGated) return 'This recipe unlocks automatically with the matching equipment.';
        if(r.prestigeGated) return `${r.name} comes with reopening ${r.prestigeGated}, not with money.`;
        if(recipeAvailable(id)) return `${r.name} is already on the menu.`;
        if(r.requires && !recipeAvailable(r.requires)) return `Unlock ${byId(RECIPES, r.requires).name} first.`;
        return need(r.unlockCost);
      },
      apply(id){ state.unlockedRecipes.add(id); return `${byId(RECIPES, id).name} is on the menu!`; },
    },
    food: unlockRow(FOODS, 'unlockedFoods', 'unlockCost', 'food'),
    syrup: unlockRow(SYRUPS, 'unlockedSyrups', 'cost', 'syrup'),
    topping: unlockRow(TOPPINGS, 'unlockedToppings', 'cost', 'topping'),
    station: {
      cost: id => STATION_UPGRADES.find(u => u.toSlots === Number(id))?.cost ?? 0,
      refuse(id){
        const u = STATION_UPGRADES.find(x => x.toSlots === Number(id));
        if(!u) return 'No such station.';
        if(state.slots.length >= u.toSlots) return `You already have ${state.slots.length} stations.`;
        return need(u.cost);
      },
      apply(id){ const n = Number(id); while(state.slots.length < n) state.slots.push(null); return `Station ${n} is open! 🛠️`; },
    },
    hireBarista: {
      cost: () => BARISTA_HIRE_COSTS[state.baristas.length] ?? 0,
      refuse(){
        if(state.baristas.length >= BARISTA_MAX) return `The staff is full (${BARISTA_MAX}).`;
        return need(BARISTA_HIRE_COSTS[state.baristas.length]);
      },
      apply(){
        const usedNames = new Set(state.baristas.map(b=>b.name));
        const name = BARISTA_NAMES.find(n=>!usedNames.has(n)) || 'Barista';
        // b<n>, the first one free: the page used b<Date.now()>, which a seeded
        // run cannot reproduce. Ids are only ever compared, never parsed.
        let n = state.baristas.length + 1;
        while(state.baristas.some(b=>b.id==='b'+n)) n++;
        state.baristas.push({ id:'b'+n, name, level:1, targetSlot:null, acc:0,
          skill: { bar:0, kitchen:0, register:0 }, morale: MORALE_START, training:null, working:true });
        return `${name} joined the team! 🧑‍🍳`;
      },
    },
    promoteBarista: {
      cost: () => BARISTA_PROMOTE_COST,
      refuse(id){
        const b = baristaById(id);
        if(!b) return 'No such barista.';
        if(b.level >= 2) return `${b.name} is already a Senior Barista.`;
        return need(BARISTA_PROMOTE_COST);
      },
      apply(id){ const b = baristaById(id); b.level = 2; return `${b.name} promoted to Senior Barista! 🎉`; },
    },
    // Training takes a shift, not a price tag (Phase 5, #348): a barista sent
    // to train works today at reduced speed and more mistakes and comes out
    // the other side (endShift()) with that group's skill trained. `spec` is
    // no longer a switch the player sets — effectiveSpec() reads it off which
    // groups are trained.
    train: {
      cost: () => 0,
      refuse(id, group){
        const b = baristaById(id);
        if(!b) return 'No such barista.';
        if(!TRAINING_GROUPS.includes(group)) return 'No such training.';
        if(b.working === false) return `${b.name} has the day off.`;
        if(b.training) return `${b.name} is already training today.`;
        if(b.skill && b.skill[group] > 0) return `${b.name} is already trained for ${TRAINING[group].name}.`;
        return null;
      },
      apply(id, group){
        const b = baristaById(id);
        b.training = group;
        return `${b.name} starts ${TRAINING[group].name.toLowerCase()} today — slower, but trained by close.`;
      },
    },
    // A raise costs money and buys back morale (Phase 5, #348) — the lever
    // that makes wages a downside worth managing rather than a fixed number.
    raiseBarista: {
      cost: id => MORALE_RAISE_COST[baristaById(id)?.level] ?? 0,
      refuse(id){
        const b = baristaById(id);
        if(!b) return 'No such barista.';
        if((b.morale ?? MORALE_START) >= MORALE_MAX) return `${b.name} couldn't be happier.`;
        return need(MORALE_RAISE_COST[b.level]);
      },
      apply(id){
        const b = baristaById(id);
        b.morale = Math.min(MORALE_MAX, (b.morale ?? MORALE_START) + MORALE_RAISE_GAIN);
        return `${b.name} got a raise — morale up! 💵`;
      },
    },
    scheduleBarista: {
      cost: () => 0,
      refuse(id){ return baristaById(id) ? null : 'No such barista.'; },
      apply(id){ const b = baristaById(id); b.working = b.working === false; return `${b.name} is ${b.working ? 'working' : 'off'} today`; },
    },
    loyalty: {
      cost: id => LOYALTY_UPGRADES.find(u => u.level === Number(id))?.cost ?? 0,
      refuse(id){
        const u = LOYALTY_UPGRADES.find(x => x.level === Number(id));
        if(!u) return 'No such loyalty tier.';
        if(state.loyaltyLevel >= u.level) return `${u.name} is already running.`;
        return need(u.cost);
      },
      apply(id){ const u = LOYALTY_UPGRADES.find(x => x.level === Number(id)); state.loyaltyLevel = u.level; return `${u.name} unlocked!`; },
    },
    shield: {
      cost: shieldCost,
      refuse(){
        if(state.comboShields >= SHIELD_MAX_HELD) return `You can hold ${SHIELD_MAX_HELD} shields at most.`;
        return need(shieldCost());
      },
      apply(){ state.comboShields++; state.shieldsPurchased++; return 'Streak shield purchased 🛡️'; },
    },
    equipment: {
      cost: id => byId(EQUIPMENT_UPGRADES, id)?.cost ?? 0,
      refuse(id){
        const u = byId(EQUIPMENT_UPGRADES, id);
        if(!u) return 'No such equipment.';
        if(hasUpgrade(id)) return `${u.name} is already installed.`;
        if(u.requires && !hasUpgrade(u.requires)) return `Install ${byId(EQUIPMENT_UPGRADES, u.requires).name} first.`;
        return need(u.cost);
      },
      apply(id){
        grantUpgrade(id);
        return `${byId(EQUIPMENT_UPGRADES, id).name} installed! ⚙️`;
      },
    },
    ambiance: {
      cost: id => byId(AMBIANCE_UPGRADES, id)?.cost ?? 0,
      refuse(id){
        const u = byId(AMBIANCE_UPGRADES, id);
        if(!u) return 'No such upgrade.';
        if(hasUpgrade(id)) return `${u.name} is already here.`;
        return need(u.cost);
      },
      apply(id){ state.upgrades.add(id); return `${byId(AMBIANCE_UPGRADES, id).name} added! 🎵`; },
    },
    business: {
      cost: id => byId(BUSINESS_UPGRADES, id)?.cost ?? 0,
      refuse(id){
        const u = byId(BUSINESS_UPGRADES, id);
        if(!u) return 'No such upgrade.';
        if(hasUpgrade(id)) return `${u.name} is already open.`;
        if(u.reqReputation && state.reputation < u.reqReputation) return `${u.name} needs ${u.reqReputation} reputation.`;
        return need(u.cost);
      },
      apply(id){ state.upgrades.add(id); return `${byId(BUSINESS_UPGRADES, id).name} opened! 🏪`; },
    },
    marketing: {
      cost: () => MARKETING_COST,
      refuse(){
        if(state.marketingRemaining > 0) return 'A campaign is already running.';
        if(!state.shiftRunning) return 'The shop is closed.';
        return need(MARKETING_COST);
      },
      apply(){ state.marketingRemaining = MARKETING_DURATION_MS; return 'Marketing campaign launched! 📣'; },
    },
    // The Legacy tree (Phase 7, #360). The one row that spends beans instead
    // of money, which is why `currency` exists: purchase() reads it to know
    // which pot the cost comes out of, and the discount never touches beans.
    meta: {
      currency: 'beans',
      cost: id => metaById(id)?.cost ?? 0,
      refuse(id){
        const m = metaById(id);
        if(!m) return 'No such Legacy unlock.';
        if(metaOwned(id)) return `${m.name} is already yours.`;
        if(m.requires && !metaOwned(m.requires)) return `Buy ${metaById(m.requires).name} first.`;
        return needBeans(m.cost);
      },
      apply(id){ metaUnlocks().add(id); return `${metaById(id).name} — yours for good. 🫘`; },
    },
    // Asking first is the page's job; prestige() toasts for itself. `id` is the
    // layout to reopen in; omitted means day one's, so a caller that has never
    // heard of layouts reopens exactly the way it always did.
    prestige: {
      cost: () => 0,
      refuse(id){
        if(state.day < PRESTIGE_MIN_DAY) return `Reopening is available from day ${PRESTIGE_MIN_DAY}.`;
        if(id == null) return null;
        const l = SHOP_LAYOUTS.find(x => x.id === id);
        if(!l) return 'No such layout.';
        if(state.prestigeLevel + 1 < l.minPrestige) return `${l.name} opens at reopening ${l.minPrestige}.`;
        return null;
      },
      apply(id){ prestige(id); return null; },
    },
  };

  /**
   * Whether a chalkboard purchase can happen now: {ok, cost, currency, reason}.
   * `cost` is what purchase() will actually take, discount included, so the
   * price a button prints is the price it charges (#344).
   */
  function canBuy(type, id, extra){
    const kind = PURCHASES[type];
    if(!kind) throw new Error(`canBuy: unknown purchase type "${type}"`);
    const reason = kind.refuse(id, extra);
    const currency = kind.currency || 'money';
    const raw = kind.cost(id, extra);
    return { ok: !reason, cost: currency === 'beans' ? raw : boardCost(raw), currency, reason };
  }

  /**
   * Make a chalkboard purchase. Refused: {ok:false, cost, reason} and nothing
   * changes. Made: the cost comes out of the till, the change is applied, and
   * {ok:true, cost, text} carries the toast (null when the purchase toasts for
   * itself).
   */
  function purchase(type, id, extra){
    const c = canBuy(type, id, extra);
    if(!c.ok) return c;
    if(c.currency === 'beans') state.meta.beans = beansHeld() - c.cost;
    else state.money -= c.cost;
    const text = PURCHASES[type].apply(id, extra);
    return { ok:true, cost:c.cost, currency:c.currency, text };
  }

  // A state that has never had a day's event scheduled — freshState() leaves
  // it at 0, and so did the page's old literal, which only worked because
  // repairSave rolled one on the way in — would fire it on the first frame.
  if(!(state.eventTriggerAt > 0)) scheduleEvent();

  return {
    state, content,
    rand, randInt,
    spawnFactor, patienceFactor, orderComplexity, baristaCanHandle, baristaFatigueFactor,
    effectiveSpec, moraleSpeedMult, moraleMistakeMult, baristaIntervalMs, wagesDue,
    reputationStars, adjustReputation,
    hasUpgrade, queueMax, espressoDurationMs, outageActive, stationDurationMult,
    metaOwned, beansHeld, beansFromRun, metaDiscount, boardCost, recipeAvailable,
    currentLayout, layoutsFor, reopenPreview, grantUpgrade,
    mistakeReduceFactor, shopPatienceMult, shopTipMult, shopSpawnFactorMult,
    wordOfMouthSignal, wordOfMouthSpawnMult, wordOfMouthRegularMult,
    getActiveDailyModifier, rollDailyModifier, fireRandomEvent,
    getUnlockedRecipeList, getUnlockedFoodList, activeRegularNames,
    generateOrderContent, cloneOrderContent, generateOrder,
    getOrderRequirements, cupMatchesEnough, orderIsComplete, serveReadiness, stationsNeedingWork,
    acceptCustomer, releaseSlot, discardCup, scoreServe,
    spawnCustomer, tickPatience,
    autoAssistStep, baristaFumble, runBaristaTick,
    currentPhaseIndex, advance, resetClock,
    endShift, startNextDay, scheduleEvent, prestige,
    canBuy, purchase, PURCHASE_TYPES: Object.keys(PURCHASES),
    cupAction, cupActionMs,
  };
}
