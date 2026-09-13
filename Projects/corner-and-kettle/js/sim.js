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
    wagesPaid:0, bestTip:0, bestTipName:'', worstMiss:null, events:[], repDelta:0 };
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
    regulars: {}, // name -> persistent favorite order content
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
    BARISTA_TRAIN_COST, BARISTA_NAMES, SHIELD_BASE_COST, SHIELD_COST_STEP,
    SHIELD_MAX_HELD, EQUIPMENT_UPGRADES, AMBIANCE_UPGRADES, BUSINESS_UPGRADES,
    MARKETING_COST, MARKETING_DURATION_MS, PRESTIGE_MIN_DAY,
  } = content;

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
  function baristaCanHandle(barista, order){
    if(barista.spec==='bar' && order.isFood) return false;
    if(barista.spec==='kitchen' && !order.isFood) return false;
    if(barista.level>=2) return true;
    return orderComplexity(order)==='simple';
  }
  // Baristas tire out over the course of a shift: up to 35% slower by the end.
  function baristaFatigueFactor(){
    return 1 + 0.35 * Math.min(1, state.shiftElapsed/SHIFT_MS);
  }

  // ---- Reputation (0-100, shown as 1-5 stars) ----
  function reputationStars(){ return Math.max(1, Math.min(5, Math.round(state.reputation/20))); }
  function adjustReputation(delta){ state.reputation = Math.max(0, Math.min(100, Math.round((state.reputation+delta)*10)/10)); }

  // ---- Upgrade effect helpers ----
  function hasUpgrade(id){ return state.upgrades.has(id); }
  function queueMax(){ return QUEUE_MAX + (hasUpgrade('seating') ? 1 : 0); }
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
  function mistakeReduceFactor(barista){
    let f = 1;
    if(hasUpgrade('grinder')) f *= 0.7;
    if(barista && barista.trained) f *= 0.7;
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
    return m;
  }

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
      const names = Object.keys(state.regulars);
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
    return RECIPES.filter(r=>state.unlockedRecipes.has(r.id));
  }
  function getUnlockedFoodList(){
    return FOODS.filter(f=>state.unlockedFoods.has(f.id));
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
      const food = rand(getUnlockedFoodList());
      return { isFood:true, foodId: food.id, price: food.price };
    }

    let pool = getUnlockedRecipeList();
    let simplePool = pool.filter(r=>!r.requiredSyrup && !r.blended);
    let specialtyPool = pool.filter(r=>r.requiredSyrup || r.blended);
    let recipe;
    if(kind==='specialty' && specialtyPool.length>0) recipe = rand(specialtyPool);
    else recipe = rand(simplePool.length? simplePool : pool);

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

  function generateOrder(){
    const phase = PHASES[currentPhaseIndex()];

    const dm0 = getActiveDailyModifier();
    const regularChance = REGULAR_CHANCE * (dm0 && dm0.regularChanceMult ? dm0.regularChanceMult : 1);
    let isRegular = false, regularName = null, content;
    if(rng() < regularChance){
      regularName = rand(REGULAR_NAMES);
      isRegular = true;
      if(!state.regulars[regularName]){
        state.regulars[regularName] = generateOrderContent(phase);
      }
      content = cloneOrderContent(state.regulars[regularName]);
    } else {
      content = generateOrderContent(phase);
    }

    const pf = patienceFactor();
    let pMax = content.isFood
      ? Math.round(randInt(28,40) * pf)
      : Math.round(randInt(35,55) * pf);
    if(isRegular && state.loyaltyLevel>0){
      pMax = Math.round(pMax * (1 + LOYALTY_UPGRADES[state.loyaltyLevel-1].patienceBonus));
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
    } else {
      const recipe = RECIPES.find(r=>r.id===order.recipeId);
      title = recipe.name;
      const reqs = getOrderRequirements(order);
      const doneCount = reqs.filter(req=>req.check(slot)).length;
      ratio = reqs.length? doneCount/reqs.length : 1;
      happy = ratio>=0.999;
      base = Math.round(recipe.price * (0.35 + 0.65*ratio));
      state.dayStats.drinksServed++;
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

  // One tick of work for a single barista: keep working the claimed slot,
  // or claim a new one. Leaves the finished cup for a human to serve.
  function runBaristaTick(barista){
    // Validate current claim
    if(barista.targetSlot!==null){
      const slot = state.slots[barista.targetSlot];
      if(!slot || slot.serving){ barista.targetSlot = null; }
    }
    // Claim a slot if idle: pick the unclaimed active order with least patience left
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
      if(best===-1) return false;
      barista.targetSlot = best;
    }
    const idx = barista.targetSlot;
    const slot = state.slots[idx];
    if(!slot){ barista.targetSlot=null; return false; }

    // Work exactly one step on this cup only
    const worked = autoAssistStep(slot);

    // Prep is done — leave the cup for a human to serve instead of auto-serving.
    if(orderIsComplete(slot)){
      barista.targetSlot = null;
      const tier = BARISTA_TIERS[barista.level];
      const effMistakeChance = tier.mistakeChance * mistakeReduceFactor(barista) * (slot.food && hasUpgrade('foodprep') ? 0.8 : 1);
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
      b.acc = (b.acc||0) + dt;
      const outageMult = outageActive() ? (hasUpgrade('generator') ? 1.15 : 1.6) : 1;
      const iv = BARISTA_TIERS[b.level].intervalMs * baristaFatigueFactor() * outageMult;
      if(b.acc > iv){
        b.acc = 0;
        runBaristaTick(b);
      }
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

  /* ---------- the day ---------- */
  function endShift(){
    state.shiftRunning = false;
    const ds = state.dayStats;
    const avgAccuracy = ds.accuracyCount ? Math.round((ds.accuracySum/ds.accuracyCount)*100) : 100;

    const wages = state.baristas.reduce((sum,b)=> sum + BARISTA_TIERS[b.level].wage, 0);
    ds.wagesPaid = wages;
    state.money -= wages;

    const summary = {
      day: state.day, money: state.money, avgAccuracy, wages,
      drinksServed: ds.drinksServed, foodServed: ds.foodServed, totalTips: ds.totalTips,
      bestCombo: state.bestCombo, bestTip: ds.bestTip, bestTipName: ds.bestTipName,
      worstMiss: ds.worstMiss, reputation: state.reputation, repDelta: ds.repDelta,
      events: [...ds.events],
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

  function prestige(){
    state.prestigeLevel++;
    state.day = 1;
    state.money = 60 + state.prestigeLevel*20;
    state.combo = 0; state.bestCombo = 0;
    state.shiftElapsed = 0; state.shiftRunning = true;
    state.queue = [];
    state.slots = [null, null];
    state.unlockedRecipes = new Set(STARTING_UNLOCKS.recipes);
    state.unlockedSyrups = new Set(STARTING_UNLOCKS.syrups);
    state.unlockedToppings = new Set(STARTING_UNLOCKS.toppings);
    state.unlockedFoods = new Set(STARTING_UNLOCKS.foods);
    // Regulars survive a reopen but their standing orders don't: a favourite
    // built from syrups and toppings the reopened shop no longer stocks is an
    // order the player has no button to make. They re-roll a new favourite on
    // their next visit, off the day-one menu.
    state.regulars = {};
    state.baristas = [];
    state.loyaltyLevel = 0;
    state.comboShields = 0;
    state.shieldsPurchased = 0;
    state.upgrades = new Set();
    state.reputation = 50;
    state.marketingRemaining = 0;
    state.activeEvent = null;
    state.eventFiredThisShift = false;
    scheduleEvent();
    rollDailyModifier();
    state.dayStats = freshDayStats();
    resetClock();
    toast(`Reopened with prestige level ${state.prestigeLevel}! Permanent income boost active. 🔁`);
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
  const need = cost => state.money < cost ? `Not enough money: $${cost} needed.` : null;
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
        if(state.unlockedRecipes.has(id)) return `${r.name} is already on the menu.`;
        if(r.requires && !state.unlockedRecipes.has(r.requires)) return `Unlock ${byId(RECIPES, r.requires).name} first.`;
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
        state.baristas.push({ id:'b'+n, name, level:1, targetSlot:null, acc:0, spec:null, trained:false, working:true });
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
    trainBarista: {
      cost: () => BARISTA_TRAIN_COST,
      refuse(id){
        const b = baristaById(id);
        if(!b) return 'No such barista.';
        if(b.trained) return `${b.name} is already trained.`;
        return need(BARISTA_TRAIN_COST);
      },
      apply(id){ const b = baristaById(id); b.trained = true; return `${b.name} completed training! 🎓`; },
    },
    specBarista: {
      cost: () => 0,
      refuse(id, extra){
        const b = baristaById(id);
        if(!b) return 'No such barista.';
        if((b.spec || null) === (extra || null)) return `${b.name} already works that way.`;
        return null;
      },
      apply(id, extra){ const b = baristaById(id); b.spec = extra || null; return `${b.name} is now ${extra ? `a ${extra} specialist` : 'a generalist'}`; },
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
        state.upgrades.add(id);
        if(id==='espresso2') state.unlockedRecipes.add('ristretto');
        if(id==='espresso3') state.unlockedRecipes.add('doppio');
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
    // Asking first is the page's job; prestige() toasts for itself.
    prestige: {
      cost: () => 0,
      refuse(){ return state.day >= PRESTIGE_MIN_DAY ? null : `Reopening is available from day ${PRESTIGE_MIN_DAY}.`; },
      apply(){ prestige(); return null; },
    },
  };

  /** Whether a chalkboard purchase can happen now: {ok, cost, reason}. */
  function canBuy(type, id, extra){
    const kind = PURCHASES[type];
    if(!kind) throw new Error(`canBuy: unknown purchase type "${type}"`);
    const reason = kind.refuse(id, extra);
    return { ok: !reason, cost: kind.cost(id, extra), reason };
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
    state.money -= c.cost;
    const text = PURCHASES[type].apply(id, extra);
    return { ok:true, cost:c.cost, text };
  }

  // A state that has never had a day's event scheduled — freshState() leaves
  // it at 0, and so did the page's old literal, which only worked because
  // repairSave rolled one on the way in — would fire it on the first frame.
  if(!(state.eventTriggerAt > 0)) scheduleEvent();

  return {
    state, content,
    rand, randInt,
    spawnFactor, patienceFactor, orderComplexity, baristaCanHandle, baristaFatigueFactor,
    reputationStars, adjustReputation,
    hasUpgrade, queueMax, espressoDurationMs, outageActive, stationDurationMult,
    mistakeReduceFactor, shopPatienceMult, shopTipMult, shopSpawnFactorMult,
    getActiveDailyModifier, rollDailyModifier, fireRandomEvent,
    getUnlockedRecipeList, getUnlockedFoodList,
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
