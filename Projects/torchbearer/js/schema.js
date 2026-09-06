// schema.js — the pack contract, once, in a form both ends read.
//
// Before Phase 8 the contract existed twice and agreed by hand. `Validator` in
// registry.js enforced it with hard-coded field lists; content-authoring-guide.md
// described it in 361 lines of prose; and the two had drifted before — five
// checks in registry.js are still marked "added session 8" because a scene with
// no `text` validated fine and then threw `sc.text.map is not a function` when a
// player walked into it.
//
// This file is the third thing, and it is meant to be the only one that has to
// change. `SCHEMA` is a JSON Schema 2020-12 document. `Validator` reads its
// `required` arrays instead of carrying its own copies, so a new required field
// lands here and the validator picks it up with no edit at all. It keeps its
// friendly per-field messages — a schema says `"required": ["text"]` and a
// player-facing error says which scene and why the engine will throw.
//
// `packs/schema.json` is this same document on disk, so an author, an editor or
// any other tool can point at a file rather than at a JS module. It is written
// by `tools/schema.mjs --write` and `test/smoke.mjs` fails if the two ever
// differ by one byte of meaning. That is the KNOWN_REACTIONS arrangement (two
// copies, one test) applied to a file that has to be servable JSON, and the
// generator makes the second copy derived rather than typed.
//
// Imports: `./downtime.js` only, which itself imports nothing. The vocabularies
// the engine actually consumes — the opener flag names and the exploration
// activity ids — come from the module that consumes them, so the schema cannot
// list an opener the engine has never heard of.

import { OPENER_FLAGS, EXPLORATION_IDS } from "./downtime.js";

/**
 * PF2e's six sizes, smallest first, and the vocabulary a monster's or an
 * ancestry's `"size"` field is checked against. It lives here because the
 * schema and the validator both need it and the schema is the lower file;
 * registry.js and rules.js re-export it so nothing outside has to know that.
 */
export const SIZES = ["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan"];

/**
 * Every reaction id a monster's `"reactions"` field may name.
 *
 * The source of truth is `REACTIONS` in js/combat.js; this is a copy, because
 * combat.js imports registry.js imports this file and the dependency cannot run
 * both ways. A copy that drifts is worse than no check at all, so `smoke.mjs`
 * asserts the two lists are identical and fails when either side grows without
 * the other.
 */
export const KNOWN_REACTIONS = ["reactive-strike", "shield-block", "nimble-dodge"];

/**
 * Every value a scene's `"kind"` may take. A scene without one is prose and
 * choices, which is what every scene was before Phase 7's second increment.
 *
 * It is a closed list because the failure is silent: `"kind": "stop"` renders a
 * perfectly ordinary scene, the shop never appears, and the only symptom is a
 * player standing in a market with no way to buy anything.
 */
export const SCENE_KINDS = ["shop", "explore"];

/** Proficiency ranks, and the one special value `attacks.martial` may take. */
export const PROF_RANKS = ["U", "T", "E", "M", "L"];

/** The six attribute keys, plus the string a free boost is written as. */
export const ABILITY_KEYS = ["str", "dex", "con", "int", "wis", "cha"];

/** The four collections whose ids the validator resolves across loaded packs. */
export const COLLECTIONS = [
  "ancestries", "backgrounds", "classes", "feats", "spells",
  "items", "monsters", "companions", "adventures", "campaigns"
];

/* ---------- small builders, so the document below reads as a table ---------- */

const str = d => ({ type: "string", description: d });
const int = (d, min) => (min === undefined ? { type: "integer", description: d } : { type: "integer", minimum: min, description: d });
const num = d => ({ type: "number", description: d });
const bool = d => ({ type: "boolean", description: d });
const arr = (items, d) => ({ type: "array", items, description: d });
const strs = d => arr({ type: "string" }, d);
const enums = (list, d) => ({ type: "string", enum: list.slice(), description: d });
const obj = (d, props, required, extra) => ({
  type: "object", description: d,
  ...(required && required.length ? { required: required.slice() } : {}),
  ...(props ? { properties: props } : {}),
  additionalProperties: extra === undefined ? true : extra
});
/* Every reusable shape is defined once under `$defs` and pointed at from
   everywhere it appears. Inlining them instead made a 193 KB file nobody would
   open; this one is a quarter of that and each shape has one place to read. */
const ref = name => ({ $ref: `#/$defs/${name}` });
const refs = (name, d) => ({ type: "array", items: ref(name), description: d });

/** The effects DSL of guide §6: one key per entry, and the engine reads one. */
const EFFECT = {
  type: "object",
  description: "One entry of the effects DSL (guide §6). Exactly one key per entry.",
  additionalProperties: true,
  properties: {
    bonus: obj("A flat numeric bonus applied at finalize.", {
      target: str("speed, hp, initiative, perception, or save.all."),
      value: int("How much."),
      type: str("status, circumstance, or untyped."),
      vs: str("What the bonus is against. Only speed keeps it off the flat number; every vs bonus is also collected as condBonuses.")
    }, ["target", "value"]),
    profUp: obj("Raise a proficiency if it is not already higher.", {
      target: str("perception, save.fort, save.ref or save.will. save.all parses and does nothing."),
      rank: enums(PROF_RANKS, "The rank to raise to."),
      ifSubclass: str("Substring-matched against the chosen subclass id.")
    }, ["target", "rank"]),
    attackProf: obj("Merged weapon proficiencies, e.g. {\"martial\":\"T\"}."),
    armorProf: obj("Merged armor proficiencies, e.g. {\"light\":\"T\"}."),
    trainSkill: { description: "A skill id, or \"choice\" for one more skill pick.", type: "string" },
    grantLore: str("A Lore name added to the sheet."),
    rank: enums(PROF_RANKS, "The rank a grantLore is added at."),
    grantCantrip: obj("One more cantrip pick. The tradition field is not read."),
    grantFeat: str("A feat id, or class-1 / general / skill for an extra slot of that kind."),
    sense: str("A sense added to the sheet. Cosmetic."),
    grantFocusSpell: str("A focus spell id — define it in spells with \"focus\": true."),
    grantFocusSpellChoice: strs("Focus spell ids; the feats step renders a chooser."),
    focusPoints: int("Grow the focus pool. Capped at 3."),
    resist: obj("Resistance. value is a number or the string halfLevel.", {
      type: str("The damage type resisted."), value: {}
    }, ["type", "value"]),
    tradition: str("Resolves a \"patron\" spellcasting tradition."),
    font: str("Cleric divine font: heal or harm."),
    special: str("An engine hook id from guide §8. Unknown ids display and do nothing."),
    skill: str("Which skill a {\"special\":\"assurance\"} floors. rules.js folds it into the hook id as assurance-<skill>."),
    note: str("Sheet note. Zero mechanics.")
  }
};

/** A condition bucket entry: `{"c":"frightened","v":2,"dur":3}`. */
const COND = obj("One condition applied by a spell, attack or power.", {
  c: str("The condition id. Guide §12 lists the ones the engine does math for."),
  v: int("The condition's value.", 0),
  dur: int("Rounds. Omit for the standard decrement; 99 lasts the whole fight.", 1)
}, ["c"]);

const DAMAGE = obj("One damage entry.", {
  formula: str("A dice formula, e.g. 2d6+3."),
  type: str("The damage type.")
}, ["formula"]);

/* ---------- the collections ---------- */

const HERITAGE = obj("One heritage of an ancestry.", {
  id: str("Global id."), name: str("Display name."),
  desc: str("Player-facing rules text."),
  effects: refs("effect", "Guide §6.")
}, ["id", "name"]);

const ANCESTRY = obj("An ancestry, with at least one heritage.", {
  id: str("Global id."), name: str("Display name."),
  hp: int("Ancestry hit points.", 0),
  speed: int("Speed in feet.", 0),
  size: enums(SIZES, "Defaults to Medium."),
  boosts: strs("Attribute keys, and/or \"free\"."),
  flaws: strs("Attribute keys."),
  traits: strs("Display traits."),
  languages: strs("Display languages."),
  senses: strs("darkvision and low-light vision display with an icon; others are text."),
  desc: str("One or two sentences of flavor."),
  heritages: refs("heritage", "At least one.")
}, ["id", "name", "hp", "speed", "boosts", "heritages"]);

const BACKGROUND = obj("A background.", {
  id: str("Global id."), name: str("Display name."),
  boosts: arr({}, "boosts[0] is the two-way choice; [\"free\"] in slot 1 is the free boost."),
  skills: strs("Skill ids trained."),
  lore: str("A Lore name."),
  feat: str("A skill feat id that exists once this pack loads."),
  desc: str("One sentence.")
}, ["id", "name", "boosts", "skills"]);

const SPELLCASTING = obj("Omit or null for a martial class.", {
  tradition: str("arcane, divine, occult, primal, or patron."),
  type: str("prepared or spontaneous."),
  ability: enums(ABILITY_KEYS, "The spellcasting attribute."),
  cantrips: int("Number of cantrip picks.", 0),
  slots: obj("Castable slots per rank at level 3. rules.js moves the row at other levels."),
  repertoire: obj("Spontaneous only: spells known per rank."),
  grantCantrips: strs("Auto-known cantrips, on top of the picks.")
});

const CLASS_FEATURE = obj("A class feature, live once the hero's level reaches its own.", {
  level: int("The level it arrives at.", 1),
  name: str("Display name."),
  desc: str("Player-facing text."),
  special: str("An engine hook id from guide §8."),
  effects: refs("effect", "Guide §6.")
}, ["level", "name"]);

const CLASS = obj("A class.", {
  id: str("Global id."), name: str("Display name."),
  hp: int("Hit points per level.", 0),
  keyAbility: strs("One or more attribute keys the player picks between."),
  perception: enums(PROF_RANKS, "Perception proficiency."),
  saves: obj("Ranks for fort, ref and will.", {
    fort: enums(PROF_RANKS, ""), ref: enums(PROF_RANKS, ""), will: enums(PROF_RANKS, "")
  }, ["fort", "ref", "will"]),
  attacks: obj("Weapon proficiency ranks. attacks.martial also takes \"partial\" — the rogueOk list."),
  defenses: obj("Armor proficiency ranks by category."),
  classDC: enums(PROF_RANKS, "Class DC proficiency."),
  skillCount: int("Base trained skills, before Int and extras.", 0),
  trainedSkills: arr({}, "A skill id, or an array of ids for a +1 pick."),
  desc: str("Player-facing text."),
  spellcasting: ref("spellcasting"),
  subclass: obj("The class's one choice.", {
    label: str("What the choice is called, e.g. Way or Doctrine."),
    options: arr(obj("One subclass.", {
      id: str("Global id."), name: str("Display name."),
      desc: str("Player-facing text."), effects: refs("effect", "Guide §6.")
    }, ["id", "name"]), "At least one.")
  }, ["label", "options"]),
  features: refs("classFeature", "Display-only unless they carry effects or a special."),
  featLevels: obj("Levels this class gains a feat of each kind, authoritative up to its highest entry."),
  skillIncreases: arr({ type: "integer" }, "Levels this class gains a skill increase. Defaults to the standard row.")
}, ["id", "name", "hp", "keyAbility", "perception", "saves", "attacks", "defenses", "skillCount"]);

const FEAT = obj("A feat.", {
  id: str("Global id."), name: str("Display name."),
  type: str("ancestry, class, skill or general."),
  ancestry: str("Required when type is ancestry."),
  classes: strs("Required when type is class. A shared feat lists several."),
  level: int("The level slot that can take it.", 1),
  actions: {},
  traits: strs("Display traits."),
  desc: str("Player-facing text."),
  effects: refs("effect", "Guide §6."),
  prereq: obj("prereq.skill is the only enforced form.", { skill: obj("Skill id to minimum rank.") })
}, ["id", "name", "type", "level"]);

const RANK_EFFECT = obj("What the spell does when cast at this rank.", {
  damage: refs("damage", "One entry per damage type."),
  heal: str("A dice formula."),
  tempHP: int("Temporary hit points.", 0),
  persistent: ref("damage"),
  critPersistent: ref("damage"),
  onCritFail: refs("condition", ""), onFail: refs("condition", ""), onSuccess: refs("condition", "")
});

const SPELL = obj("A spell. Exactly one resolution model per spell — see guide §7.", {
  id: str("Global id."), name: str("Display name."),
  rank: int("0 for a cantrip.", 0),
  traditions: strs("arcane, divine, occult, primal."),
  actions: {},
  range: int("Feet.", 0),
  traits: strs("Also read by save bonuses carrying a matching vs."),
  desc: str("Player-facing text."),
  focus: bool("Costs one focus point."),
  hex: bool("Free to cast, one per turn. Implies focus."),
  attackRoll: bool("Spell attack vs AC."),
  maxTargets: int("Extra nearest targets included, blazing-bolt style.", 1),
  save: str("reflex, fortitude or will, vs the caster DC."),
  basic: bool("Basic-save damage."),
  autoHit: bool("Damage just happens."),
  area: obj("burst/radius, cone/length, line/length, or emanation/radius.", {
    shape: str("burst, cone, line or emanation."),
    radius: int("Feet, for burst and emanation.", 0),
    length: int("Feet, for cone and line.", 0)
  }, ["shape"]),
  healOrHarmUndead: bool("The heal pattern: damages undead on a Fort save."),
  livingOnly: bool("The void pattern: only the living are damaged."),
  healsUndead: bool("The void pattern: undead in the area are healed."),
  selfBuff: obj("See core shield and false-life."),
  allyBuff: obj("See core guidance and runic-weapon."),
  partyBuff: obj("See core bless and courageous-anthem."),
  utility: bool("No mechanical resolution; the Chronicle prints the description."),
  special: str("stabilize is the one implemented odd duck."),
  rankEffects: { type: "object", description: "Keys are castable ranks. The engine uses the highest key ≤ the rank cast.", additionalProperties: ref("rankEffect") }
}, ["id", "name", "rank", "traditions", "actions", "rankEffects"]);

const ITEM = obj("A weapon, armor, shield or consumable.", {
  id: str("Global id."), name: str("Display name."),
  category: str("weapon, armor, shield, consumable or gear."),
  level: int("The item's level. Printed on the shop card.", 0),
  price: str("Written the way the Player Core prints it: \"12 gp\", \"1 gp, 5 sp\". A bare number is rejected — twelve gold and twelve copper differ by a hundred. No price means it cannot be bought or sold."),
  prof: str("simple, martial or unarmed for weapons; unarmored, light, medium or heavy for armor."),
  group: str("Weapon group. Display only."),
  hands: int("1 or 2.", 1),
  damage: str("A dice formula."),
  damageType: str("The damage type."),
  traits: strs("agile, finesse, deadly-dX, versatile-X, propulsive and two-hand-dX are read; the rest display."),
  range: int("Feet. Omit for melee.", 0),
  bulk: num("Bulk. Display only."),
  rogueOk: bool("Member of the \"partial martial\" list."),
  acBonus: int("Armor and shields.", 0),
  hardness: int("Shields only, and display only — Shield Block reduces a flat 5 whatever this says.", 0),
  dexCap: int("Armor only.", 0),
  speedPen: int("Armor only: 0, 5 or 10.", 0),
  heal: str("Consumable only. Drink Potion rolls this item's own formula."),
  desc: str("Player-facing text.")
}, ["id", "name", "category"]);

const MON_ATTACK = obj("One Strike.", {
  name: str("Display name."),
  bonus: int("Attack modifier."),
  damage: str("A dice formula."),
  damageType: str("The damage type."),
  range: int("Cells. 1 is melee.", 1),
  traits: strs("agile and deadly-dX are read."),
  sneak: str("Companions only: precision damage against off-guard targets."),
  onCrit: refs("condition", "Conditions applied on a critical hit.")
}, ["name", "bonus", "damage"]);

const MON_POWER = obj("A monster power. Used when off cooldown and at least two PCs are in radius.", {
  name: str("Display name."),
  cost: int("Actions.", 1),
  cooldown: int("Rounds before it can fire again.", 0),
  type: str("aoe is the implemented type."),
  save: str("will, reflex or fortitude."),
  dc: int("The save DC.", 1),
  radius: int("Cells.", 1),
  damage: str("A dice formula."),
  damageType: str("The damage type."),
  onCritFail: refs("condition", ""), onFail: refs("condition", ""), onSuccess: refs("condition", ""),
  flavor: str("The line the Chronicle prints when it fires.")
}, ["name"]);

const MONSTER = obj("A monster.", {
  id: str("Global id."), name: str("Display name."),
  level: int("Creature level.", -1),
  boss: bool("bossFlags in an encounter hit the first foe carrying this."),
  traits: strs("The first trait naming a skill decides which skill Recall Knowledge uses."),
  size: enums(SIZES, "Defaults to Medium. Decides which Athletics maneuvers reach it."),
  lore: str("The one line a critical Recall Knowledge prints."),
  ac: int("Armor class.", 1),
  hp: int("Hit points.", 1),
  speed: int("Feet.", 0),
  perception: int("Perception modifier."),
  reach: int("Cells. Defaults to 1.", 1),
  reactions: arr(enums(KNOWN_REACTIONS, ""), "Reaction ids the engine implements. Any other id is rejected — a reaction the engine does not have is a monster that silently never reacts."),
  saves: obj("Modifiers for fort, ref and will.", {
    fort: int(""), ref: int(""), will: int("")
  }, ["fort", "ref", "will"]),
  immunities: strs("mental blocks fear and hex-type conditions."),
  weaknesses: arr(obj("", { type: str(""), value: int("", 1) }, ["type", "value"]), ""),
  resistances: arr(obj("", { type: str(""), value: int("", 1) }, ["type", "value"]), ""),
  slowed: int("1 is zombie-style: two actions a turn.", 0),
  attacks: refs("monsterAttack", "At least one."),
  powers: refs("monsterPower", ""),
  desc: str("Player-facing text.")
}, ["id", "name", "ac", "hp", "attacks", "saves"]);

const COMP_ABILITY = obj("A companion ability. heal is the only implemented type.", {
  id: str("Global id."), name: str("Display name."),
  cost: int("Actions.", 1),
  type: str("heal."),
  heal: str("A dice formula."),
  range: int("Cells.", 1),
  uses: int("Uses per fight.", 1),
  flavor: str("The line the Chronicle prints.")
}, ["id", "name"]);

const COMPANION = obj("A pre-built ally: a flat stat block the player does not forge.", {
  id: str("Global id."), name: str("Display name."),
  subtitle: str("The line under the name on the card."),
  ac: int("Armor class.", 1),
  hp: int("Hit points.", 1),
  speed: int("Feet.", 0),
  perception: int("Perception modifier."),
  initSkill: int("The modifier the companion rolls initiative with."),
  saves: obj("Modifiers for fort, ref and will."),
  attacks: refs("monsterAttack", ""),
  abilities: refs("companionAbility", ""),
  desc: str("Player-facing text.")
}, ["id", "name"]);

const CHECK = obj("A one-shot skill check on a choice.", {
  skill: str("A skill id, or perception."),
  altSkill: str("The engine rolls whichever modifier is better."),
  dc: int("At level 3: easy 15, standard 17–18, hard 20, very hard 22.", 1),
  success: str("Scene id, or END."),
  failure: str("Scene id, or END. Branch somewhere interesting rather than dead-ending.")
}, ["skill", "dc"]);

const CHOICE = obj("One link out of a scene.", {
  text: str("The line on the button."),
  if: str("A flag expression. A leading ! negates; a name with a / reads the campaign record."),
  goto: str("Scene id, or END to return to the title screen."),
  check: ref("check"),
  once: bool("The choice disappears after it is taken."),
  flagOnce: str("A flag set the first time the choice is taken."),
  combat: str("An encounter id of this adventure."),
  victory: str("Where a won fight goes."),
  defeat: str("Where a lost fight goes. Defaults to a scene named \"gameover\"."),
  combatLabel: str("The label over the battle button.")
}, ["text"]);

const ON_ENTER = obj("What happens the first time the hero walks in.", {
  flag: str("A flag set on entry. An opener flag name here is read by the next fight."),
  gold: str("Treasure, as a price string: \"40 gp\"."),
  items: strs("Item ids put in the hero's hands. Every id has to exist.")
});

const EXPLORE = obj("The exploration block of a \"kind\": \"explore\" scene.", {
  dc: int("The DC every activity here is rolled against.", 1),
  goto: str("Where the hero goes once they have chosen, whatever the roll said."),
  activities: arr(enums(EXPLORATION_IDS, ""), "Narrows the offer, in the order written. Leave it out to offer all three.")
}, ["dc", "goto"]);

const SCENE = obj("One node of the narrative graph.", {
  kicker: str("The small line above the title."),
  title: str("The scene's heading."),
  text: arr({ type: "string" }, "Paragraphs. The first gets the illuminated drop cap. Light HTML like <em> is allowed."),
  kind: enums(SCENE_KINDS, "Leave it out for an ordinary scene of prose and choices."),
  onEnter: ref("onEnter"),
  companionChoice: bool("Offer the adventure's companions here."),
  ending: bool("An epilogue. Its flags fold into the campaign record."),
  gameover: bool("A death. Folds nothing and pays no XP."),
  shopTitle: str("Shop scenes: the heading over the buy side. Defaults to \"For Sale\"."),
  stock: strs("Shop scenes: item ids for sale. Every one needs a price."),
  exploreTitle: str("Explore scenes: the heading over the cards. Defaults to \"How You Go On\"."),
  explore: ref("explore"),
  choices: refs("choice", "Rendered under everything else. A shop or an explore scene still needs a way out.")
}, ["title", "text"]);

const FOE = obj("One monster placed on the map.", {
  monster: str("A monster id from this pack or already loaded."),
  x: int("0-indexed column.", 0),
  y: int("0-indexed row.", 0),
  minParty: int("Only spawns at this party size or larger.", 1),
  minLevel: int("Only spawns when the hero is at least this level.", 1),
  maxLevel: int("Only spawns when the hero is at most this level.", 1)
}, ["monster", "x", "y"]);

const ENCOUNTER = obj("One tactical map.", {
  name: str("Display name."),
  w: int("Cells wide. Keep it to about 16.", 1),
  h: int("Cells tall. Keep it to about 12.", 1),
  terrain: obj("Cell lists.", {
    walls: arr({}, "[x,y] pairs that block movement and line of sight."),
    diff: arr({}, "[x,y] pairs of difficult terrain.")
  }),
  pcStarts: arr({}, "At least four [x,y] pairs."),
  foes: refs("foe", "At least one."),
  bossFlags: obj("Story flag id to {applyToBoss, log}. Effects hit the first foe whose monster is a boss."),
  intro: str("One line of scene-setting printed at battle start.")
}, ["name", "w", "h", "foes"]);

const ADVENTURE = obj("One adventure: a scene graph, and the encounters its scenes point at.", {
  id: str("Global id."), name: str("Display name."),
  level: int("The level the DCs and the treasure budget are read against. No level means no budget check.", 1),
  start: str("The scene the adventure opens on. It has to exist."),
  blurb: str("Shown on the adventure picker."),
  companionsOffered: strs("Companion ids offered at a scene with companionChoice."),
  awards: obj("Encounter id or \"ending\" to whole XP. Leave it out and the ending is worth a level."),
  scenes: { type: "object", description: "Scene id to scene. Every one has to be reachable from start.", additionalProperties: ref("scene") },
  encounters: { type: "object", description: "Encounter id to encounter.", additionalProperties: ref("encounter") }
}, ["id", "name", "start", "scenes"]);

const CAMPAIGN_ENTRY = obj("One adventure in a campaign, in order. Always an object.", {
  adventure: str("An adventure id defined here or already loaded."),
  if: str("A scoped flag expression — \"earlier-adventure/some-flag\". It has to name an adventure listed earlier and a flag that adventure can actually set."),
  locked: str("The one line the board prints over a closed road.")
}, ["adventure"]);

const CAMPAIGN = obj("A run of adventures with gates on the flags the earlier ones set.", {
  id: str("Global id."), name: str("Display name."),
  level: int("The level the campaign is written for. Shown on its card; it sets nothing.", 1),
  blurb: str("Shown on the picker and at the top of the campaign board."),
  adventures: refs("campaignEntry", "In order. The same adventure twice is rejected.")
}, ["id", "name", "adventures"]);

const PACK_META = obj("Pack metadata. The only required top-level key.", {
  id: str("Global id. Loading a pack whose id is already loaded is allowed; ids inside it replace what they collide with."),
  name: str("Shown on the load confirmation and the Shelf."),
  version: str("Free text."),
  author: str("Free text."),
  type: str("\"content\" or \"adventure\". Informational; a pack may carry both kinds of material."),
  description: str("One line shown on the load confirmation and the Shelf.")
}, ["id", "name"]);

/* ---------- the document ---------- */

/**
 * The pack contract as one JSON Schema 2020-12 document.
 *
 * `Validator` reads `$defs.<thing>.required`; nothing else in the engine reads
 * this object, and nothing validates against it as a schema at runtime — the
 * validator's own messages are better than any schema library's, which is the
 * whole reason it keeps them. What the schema buys is that the required lists
 * exist once, that `authoring.html` can name every field the engine reads, and
 * that a JSON editor pointed at packs/schema.json completes the right keys.
 */
export const SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://greyversusblue.com/Projects/torchbearer/packs/schema.json",
  title: "Torchbearer content pack",
  description:
    "The contract every pack loaded by Projects/torchbearer.html is validated against. " +
    "Prose for all of it is in Projects/torchbearer/content-authoring-guide.md; the enforcement " +
    "is Validator in Projects/torchbearer/js/registry.js, which reads the required lists below. " +
    "Unknown fields are ignored by the engine rather than rejected, so this document is the only " +
    "place that says which keys are actually read.",
  type: "object",
  required: ["pack"],
  additionalProperties: true,
  properties: {
    pack: ref("packMeta"),
    ancestries: refs("ancestry", ""),
    backgrounds: refs("background", ""),
    classes: refs("class", ""),
    feats: refs("feat", ""),
    spells: refs("spell", ""),
    items: refs("item", ""),
    monsters: refs("monster", ""),
    companions: refs("companion", ""),
    adventures: refs("adventure", ""),
    campaigns: refs("campaign", "")
  },
  $defs: {
    packMeta: PACK_META,
    ancestry: ANCESTRY, heritage: HERITAGE,
    background: BACKGROUND,
    class: CLASS, spellcasting: SPELLCASTING, classFeature: CLASS_FEATURE,
    feat: FEAT,
    spell: SPELL, rankEffect: RANK_EFFECT,
    item: ITEM,
    monster: MONSTER, monsterAttack: MON_ATTACK, monsterPower: MON_POWER,
    companion: COMPANION, companionAbility: COMP_ABILITY,
    adventure: ADVENTURE, scene: SCENE, choice: CHOICE, check: CHECK,
    onEnter: ON_ENTER, explore: EXPLORE, encounter: ENCOUNTER, foe: FOE,
    campaign: CAMPAIGN, campaignEntry: CAMPAIGN_ENTRY,
    effect: EFFECT, condition: COND, damage: DAMAGE
  },
  $comment:
    "Written by Projects/torchbearer/tools/schema.mjs from js/schema.js. " +
    "Edit the module, run `node tools/schema.mjs --write`, and commit both; " +
    "test/smoke.mjs fails if they disagree."
};

/**
 * The `required` list of one `$defs` entry, or `[]` if it names nothing.
 * This is the function `Validator` calls instead of carrying its own copies.
 */
export function requiredOf(def) {
  const d = SCHEMA.$defs[def];
  return (d && Array.isArray(d.required)) ? d.required.slice() : [];
}

/**
 * The required fields of a collection beyond `id` and `name`, which every
 * object needs and which get their own messages. `checkIds` in the validator
 * takes exactly this list.
 */
export function extraRequired(def) {
  return requiredOf(def).filter(k => k !== "id" && k !== "name");
}

/** Every field name the engine reads on one `$defs` entry, in schema order. */
export function fieldsOf(def) {
  const d = SCHEMA.$defs[def];
  return (d && d.properties) ? Object.keys(d.properties) : [];
}
