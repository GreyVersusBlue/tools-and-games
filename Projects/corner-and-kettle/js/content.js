// content.js — Corner & Kettle's tables: what the shop can sell, hire, buy and
// roll. Moved out of coffee_shop_sim.html verbatim (Phase 1) so the sim and
// the page read one copy, and a Node test can import it without a DOM.
//
// Nothing in here reads `state`. The tuning functions that do — spawnFactor,
// patienceFactor, the shop*Mult helpers — live in sim.js, which takes these
// tables as an argument. A new recipe is still one row; add it here and it
// joins the save catalog through buildCatalog in the page, not by hand.

export const MILKS = [
  {id:'whole', name:'Whole Milk', color:'#fff6e8'},
  {id:'oat', name:'Oat Milk', color:'#f0e2c4'},
  {id:'almond', name:'Almond Milk', color:'#f3ead6'},
  {id:'skim', name:'Skim Milk', color:'#fbfbf5'},
];

export const SYRUPS = [
  {id:'vanilla', name:'Vanilla', color:'#e8d9a8', cost:0},
  {id:'caramel', name:'Caramel', color:'#c98a3a', cost:0},
  {id:'mocha', name:'Mocha', color:'#4a2a1c', cost:35},
  {id:'hazelnut', name:'Hazelnut', color:'#a97449', cost:60},
  {id:'peppermint', name:'Peppermint', color:'#6fae87', cost:90},
];

export const TOPPINGS = [
  {id:'whip', name:'Whipped Cream', cost:0},
  {id:'cinnamon', name:'Cinnamon Dust', cost:0},
  {id:'caramelDrizzle', name:'Caramel Drizzle', cost:40},
  {id:'chocoDrizzle', name:'Chocolate Drizzle', cost:40},
  {id:'sprinkles', name:'Sprinkles', cost:75},
];

// base liquid colors
export const BASE_COLORS = {
  espresso:'#3b2418',
  drip:'#5a3a24',
  tea:'#8a6a2e',
  frappeBase:'#c7a679'
};

export const RECIPES = [
  {id:'drip', name:'House Drip', icon:'☕', category:'hot', base:'drip', shots:0, needsMilk:false, price:30, unlockCost:0},
  {id:'americano', name:'Americano', icon:'☕', category:'hot', base:'espresso', shots:2, needsMilk:false, price:38, unlockCost:0},
  {id:'latte', name:'Latte', icon:'🥛', category:'hot', base:'espresso', shots:1, needsMilk:true, price:45, unlockCost:0},
  {id:'cappuccino', name:'Cappuccino', icon:'🫧', category:'hot', base:'espresso', shots:1, needsMilk:true, price:45, unlockCost:0},
  {id:'icedcoffee', name:'Iced Coffee', icon:'🧊', category:'iced', base:'drip', shots:0, needsMilk:false, ice:true, price:38, unlockCost:0},
  {id:'mocha', name:'Mocha', icon:'🍫', category:'hot', base:'espresso', shots:1, needsMilk:true, requiredSyrup:'mocha', price:55, unlockCost:120},
  {id:'caramelmac', name:'Caramel Macchiato', icon:'🍮', category:'hot', base:'espresso', shots:1, needsMilk:true, requiredSyrup:'caramel', price:55, unlockCost:150},
  {id:'icedvanilla', name:'Iced Vanilla Latte', icon:'🥤', category:'iced', base:'espresso', shots:1, needsMilk:true, ice:true, requiredSyrup:'vanilla', price:58, unlockCost:180},
  {id:'frappe', name:'Frappe', icon:'🥶', category:'blended', base:'frappeBase', shots:1, needsMilk:true, blended:true, price:65, unlockCost:250},
  {id:'chai', name:'Chai Latte', icon:'🍂', category:'hot', base:'tea', shots:0, needsMilk:true, price:48, unlockCost:200},
  // ---- Menu R&D chain: each requires the previous to already be unlocked ----
  {id:'coldbrew', name:'Cold Brew', icon:'🧊', category:'iced', base:'drip', shots:0, needsMilk:false, ice:true, price:42, unlockCost:150},
  {id:'nitrocoldbrew', name:'Nitro Cold Brew', icon:'🌫️', category:'iced', base:'drip', shots:0, needsMilk:false, ice:true, price:54, unlockCost:220, requires:'coldbrew'},
  {id:'affogato', name:'Affogato', icon:'🍨', category:'hot', base:'espresso', shots:2, needsMilk:false, price:62, unlockCost:280, requires:'nitrocoldbrew'},
  // ---- Equipment-gated recipes: unlocked automatically by buying the matching machine tier ----
  {id:'ristretto', name:'Ristretto', icon:'🥃', category:'hot', base:'espresso', shots:1, needsMilk:false, price:42, unlockCost:0, equipmentGated:'espresso2'},
  {id:'doppio', name:'Doppio', icon:'🥃', category:'hot', base:'espresso', shots:2, needsMilk:false, price:58, unlockCost:0, equipmentGated:'espresso3'},
];

export const FOODS = [
  {id:'croissant', name:'Croissant', icon:'🥐', price:28, unlockCost:0},
  {id:'bagel', name:'Bagel', icon:'🥯', price:26, unlockCost:0},
  {id:'muffin', name:'Muffin', icon:'🧁', price:30, unlockCost:100},
  {id:'cookie', name:'Cookie', icon:'🍪', price:22, unlockCost:100},
];

export const PHASES = [
  {name:'Dawn', sky:['#2c2a4a','#a86a5b'], mixWeights:{simple:0.8,specialty:0.1,food:0.1}, spawnMs:6500},
  {name:'Morning Rush', sky:['#f7c98b','#fef3d8'], mixWeights:{simple:0.55,specialty:0.3,food:0.15}, spawnMs:4200},
  {name:'Afternoon', sky:['#9ec7e0','#e7f3f7'], mixWeights:{simple:0.35,specialty:0.45,food:0.2}, spawnMs:5200},
  {name:'Evening', sky:['#3a3760','#7a5a72'], mixWeights:{simple:0.4,specialty:0.25,food:0.35}, spawnMs:5800},
];
export const SHIFT_MS = PHASES.length * 34000; // total shift duration
export const PHASE_MS = SHIFT_MS / PHASES.length;


// ---- Station slot upgrades (chalkboard purchase) ----
export const STATION_UPGRADES = [
  {toSlots:3, cost:350},
  {toSlots:4, cost:800},
];

// ---- Barista Assistants (hireable staff) ----
// Each barista claims ONE station at a time, completes its steps one by one,
// and leaves the finished cup for a human to serve. Hire up to BARISTA_MAX;
// each hire costs more. Juniors can be promoted to Seniors (faster steps).
export const BARISTA_MAX = 3;
export const BARISTA_HIRE_COSTS = [400, 700, 1100]; // cost of 1st, 2nd, 3rd hire
export const BARISTA_PROMOTE_COST = 500;
export const BARISTA_TIERS = {
  1:{name:'Junior Barista', intervalMs:3200, mistakeChance:0.16, wage:35},
  2:{name:'Senior Barista', intervalMs:1800, mistakeChance:0.04, wage:70},
};
export const BARISTA_NAMES = ['Pip','Juno','Casey','Rowan','Sage','Milo'];

// ---- Per-station skill and training (Phase 5, #348) ----
// A barista's `skill` is {bar, kitchen, register} — 0 (untrained) or 1
// (trained) today, kept as small integers so a level 2 has somewhere to go.
// `bar` covers every drink station; `kitchen` is the food station; `register`
// has no station of its own and instead cuts across all of them, the way a
// fast, calm counter person helps everywhere. `spec` used to be a switch the
// player set by hand; sim.js's effectiveSpec() reads it off skill instead —
// bar-only or kitchen-only training makes a specialist, both (or neither)
// makes a generalist.
export const STATION_GROUPS = {
  bar: ['base','milk','blend','syrup','toppings'],
  kitchen: ['food'],
};
// Training takes the whole shift, not a price tag: a barista sent to train
// works it at SPEED/MISTAKE_MULT and comes out the other side with that
// group's skill at 1. Untrained-vs-trained keeps the old 0.7 mistake factor;
// speed is new (Phase 5 also asked training to raise speed, which it never did).
export const TRAINING_GROUPS = ['bar', 'kitchen', 'register'];
export const TRAINING = {
  bar: { name:'Bar Training', desc:'Faster and fewer mistakes on base, milk, blend, syrup and toppings.' },
  kitchen: { name:'Kitchen Training', desc:'Faster and fewer mistakes plating food.' },
  register: { name:'Register Training', desc:'Faster and fewer mistakes shop-wide.' },
};
export const TRAINING_SPEED_MULT = 1.6;
export const TRAINING_MISTAKE_MULT = 1.3;
export const SKILL_SPEED_MULT = 0.85;
export const SKILL_MISTAKE_MULT = 0.7;
export const REGISTER_SPEED_MULT = 0.92;
export const REGISTER_MISTAKE_MULT = 0.85;

// ---- Morale (Phase 5, #348) ----
// Neutral at MORALE_START — a fresh hire moves exactly like the old,
// morale-less barista did, so nothing about the timing or mistake numbers a
// prior round measured changes for a barista nobody has scheduled a day off
// or a raise for yet. It falls while working, rises on a day off or a raise,
// and moves speed and mistakes both, so wages become a lever with a downside
// instead of a fixed subtraction.
export const MORALE_START = 70;
export const MORALE_MAX = 100;
export const MORALE_WORK_DROP = 6;
export const MORALE_OFF_GAIN = 10;
export const MORALE_RAISE_GAIN = 25;
export const MORALE_RAISE_COST = { 1: 150, 2: 300 }; // by barista.level

// ---- Loyalty Program upgrades (bigger regular-customer bonuses) ----
export const LOYALTY_UPGRADES = [
  {level:1, name:'Loyalty Cards', cost:250, tipBonus:0.15, patienceBonus:0.15},
  {level:2, name:'VIP Program', cost:600, tipBonus:0.30, patienceBonus:0.30},
];

// ---- Streak Insurance (protects combo from one missed order) ----
export const SHIELD_BASE_COST = 150;
export const SHIELD_COST_STEP = 50;
export const SHIELD_MAX_HELD = 3;

export const PRESET_MAX = 6;

// ---- Named regulars (Phase 6, #349) ----
// A regular used to be a name and a standing order with no memory of ever
// having been served. Now they carry `visits`, `lastDay`, `satisfaction`
// (0-100, moved by how well each visit went) and `tolerance` (their own
// patience multiplier, moved the same way). Served badly enough, enough
// times, they stop coming; served well, they sometimes bring a friend.
export const REGULAR_NAMES = ['Nora','Gideon','Talia','Otis','Marisol','Beckett','Ivy','Desmond'];
export const REGULAR_CHANCE = 1/8;
export const REGULAR_SATISFACTION_START = 60;
export const REGULAR_SATISFACTION_MAX = 100;
export const REGULAR_SATISFACTION_SERVE_GOOD = 12;
export const REGULAR_SATISFACTION_SERVE_BAD = -20;
export const REGULAR_STOP_THRESHOLD = 20; // below this, and they've been in at least REGULAR_STOP_MIN_VISITS times, they stop coming
export const REGULAR_STOP_MIN_VISITS = 3;
export const REGULAR_FRIEND_THRESHOLD = 85; // at/above this satisfaction, a happy serve has a chance to mint a new regular
export const REGULAR_FRIEND_CHANCE = 0.25;
export const REGULAR_TOLERANCE_START = 1;
export const REGULAR_TOLERANCE_MIN = 0.7;
export const REGULAR_TOLERANCE_MAX = 1.5;
export const REGULAR_TOLERANCE_STEP = 0.08;

// ---- Word of mouth: reputation and recent satisfaction feed the door ----
// (Phase 6, #349). Deliberately bounded — this is the one number in the
// wishlist's own words "that must not run away". Both ends are pinned in
// test/balance.mjs, and the guard is verified by removing the bound and
// watching the spawn rate diverge (locked decision #34).
export const WORD_OF_MOUTH_MIN = 0.7;
export const WORD_OF_MOUTH_MAX = 1.4;
export const WORD_OF_MOUTH_REP_SPAN = 0.3; // +/- at reputation 100/0 versus 50
export const WORD_OF_MOUTH_REGULAR_SPAN = 0.5; // regular-chance multiplier span, same inputs

// ---- Order histories feed composition (Phase 6, #349) ----
// generateOrderContent() remembers the last HISTORY_WINDOW things the shop
// actually sold and nudges its own weights toward them by HISTORY_WEIGHT, so
// a shop that has been selling iced drinks starts seeing more of them without
// a daily modifier having to say so.
export const HISTORY_WINDOW = 40;
export const HISTORY_WEIGHT = 0.35;

/* ---------- SHOP UPGRADES (Equipment / Ambiance / Business) ---------- */
export const EQUIPMENT_UPGRADES = [
  {id:'espresso2', name:'Dual-Boiler Espresso Machine', cost:300, desc:'Pull shots faster & unlocks Ristretto'},
  {id:'espresso3', name:'Commercial Espresso Rig', cost:650, requires:'espresso2', desc:'Even faster shots & unlocks Doppio'},
  {id:'grinder', name:'Precision Grinder', cost:220, desc:'-30% barista mistake chance shop-wide'},
  {id:'pos2', name:'Second Register', cost:260, desc:'Customers hold onto patience better while queued'},
  {id:'generator', name:'Backup Generator', cost:200, desc:'Blunts Equipment Breakdown events'},
  {id:'foodprep', name:'Food Prep Upgrade', cost:240, desc:'Fewer food mistakes, +tips on food orders'},
];
export const AMBIANCE_UPGRADES = [
  {id:'seating', name:'Seating Expansion', cost:180, desc:'+1 max queue length'},
  {id:'music', name:'Music System', cost:150, desc:'Shop-wide +patience & +tips'},
  {id:'decor', name:'Cozy Décor', cost:200, desc:'Shop-wide +tips'},
  {id:'sign', name:'Storefront Sign', cost:150, desc:'Risk upgrade: more customers, faster pace'},
];
export const BUSINESS_UPGRADES = [
  {id:'franchise', name:'Second Location', cost:5000, reqReputation:80, desc:'Prestige goal — permanent +10% income'},
];
export const MARKETING_COST = 120;
export const MARKETING_DURATION_MS = 20000;
export const PRESTIGE_MIN_DAY = 6;

/* ---------- DAILY MODIFIERS ---------- */
export const DAILY_MODIFIERS = [
  {id:'icedMonday', name:'Iced Drink Day', desc:'More iced orders today, +10% tips on iced drinks', tipBonusIced:0.10},
  {id:'pastryRush', name:'Pastry Rush', desc:'More food orders today, +10% tips on food', tipBonusFood:0.10},
  {id:'quietDay', name:'Quiet Day', desc:'Fewer customers, but +15% tips', spawnMult:1.3, tipBonusAll:0.15},
  {id:'regularsDay', name:"Regulars' Day", desc:'More named regulars stopping by today', regularChanceMult:2},
  null, null, null,
];

/* ---------- RANDOM EVENTS ---------- */
export const RANDOM_EVENTS = [
  {id:'rush', name:'Rush Hour Surge', desc:'A wave of customers is coming through!'},
  {id:'critic', name:'Food Critic Visit', desc:'A critic slipped into the queue — nail their order!'},
  {id:'outage', name:'Equipment Breakdown', desc:'Power flickers — stations are running slow.'},
  {id:'birthday', name:"Regular's Birthday", desc:'One of your regulars is celebrating today.'},
];

// Day one's menu. One definition, read by the state initializer, doPrestige()
// and the save catalog — repairSave() unions a loaded save with this, so a
// save that somehow lost 'drip' can't leave the order generator picking from
// an empty pool.
export const STARTING_UNLOCKS = {
  recipes: ['drip','americano','latte','cappuccino','icedcoffee'],
  syrups: ['vanilla','caramel'],
  toppings: ['whip','cinnamon'],
  foods: ['croissant','bagel'],
};

export const QUEUE_MAX = 5;

// The customer sprite's palette. The sim picks a customer's colours when it
// generates the order (so the pick comes off the seeded rng); the page draws
// them. The pixel pattern itself stays with the drawing code.
export const HAIR_COLORS = ['#2b1c14','#5a3a22','#8a6a3d','#1a1a1a','#7a4a30','#c98a4a'];
export const SKIN_COLORS = ['#f0c9a0','#d9a066','#8a5a34','#c98a5a','#f5dcc0','#a8683c'];
export const SHIRT_COLORS = ['#7C9070','#B5651D','#5c7a9e','#a85a6b','#5f7256','#c2864a','#4a6a7a'];
export const PANTS_COLORS = ['#3b2418','#2c2c3a','#5a4a3a','#232323'];
