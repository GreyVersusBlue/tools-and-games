// pf1-schema.js: the shape of a parsed PF1e creature.
//
// parse-pf1.js produces this from a pasted stat block, the form edits it, and
// convert.js reads it. Every field is optional except name and cr; a missing
// number is null, never 0, so the converter can tell "not given" from "zero".

export function emptyCreature() {
  return {
    name: '',
    cr: null,            // number; "1/2" -> 0.5, "1/3" -> 1/3
    mr: null,            // mythic rank from "CR 10/MR 4"; null when not mythic
    source: '',          // "Pathfinder RPG Bestiary pg. 156" (AoN's Source line)
    classLine: '',       // the line between XP and alignment: "Goblin warrior 1", "Female human vampire sorcerer 8"
    ageCategory: '',     // dragons only, from the name: "young", "very old", "great wyrm"
    xp: null,
    alignment: '',       // "CE"
    size: 'Medium',      // Fine..Colossal
    type: '',            // "magical beast"
    subtypes: [],        // ["fire", "extraplanar"]
    init: null,
    senses: [],          // [{ name: "darkvision", range: 60 }, { name: "scent", range: null }]
    perception: null,
    aura: [],            // [{ name: "frightful presence", range: 30, dc: 18, text: "" }]

    // components: the AC breakdown keyed by lowercased type,
    // "(+3 Dex, +6 natural, -1 size)" -> { dex: 3, natural: 6, size: -1 }
    // notes: anything after the breakdown, "+4 dodge vs. giants" (situational,
    // so it is kept out of components where a sum would count it)
    ac: { total: null, touch: null, flatFooted: null, components: {}, notes: '' },
    // hd: "6d10+12"; hitDice: total dice count (6); each: true for "hp 45 each";
    // notes: what followed the dice inside the parentheses ("15 false life")
    hp: { total: null, hd: '', hitDice: null, each: false, notes: '' },
    // notes: what follows Will after a semicolon, "+2 vs. poison"
    saves: { fort: null, ref: null, will: null, notes: '' },
    defensive: {
      dr: [],            // [{ amount: 10, bypass: "magic" }]  bypass "-" for DR x/-
      resist: [],        // [{ type: "fire", amount: 10 }]
      immune: [],        // ["fire", "mind-affecting effects", "poison"]
      sr: null,
      weaknesses: [],    // ["vulnerability to cold", "light sensitivity"]
      other: [],         // ["ferocity", "regeneration 5 (acid or fire)", "fast healing 2"]
    },

    // other: any speed entry that is not land/fly/swim/climb/burrow ("earth glide")
    // notes: the land speed's parenthetical, "40 ft. base" from "30 ft. (40 ft. base)"
    speed: { land: null, fly: null, flyManeuver: '', swim: null, climb: null, burrow: null, other: [], notes: '' },
    // One entry per attack. A full-attack line "2 claws +8 (1d6+4)" is
    // { name: "claw", count: 2, bonus: [8], damage: "1d6+4", extra: "" }.
    // Iteratives "+12/+7" are bonus: [12, 7].
    // group: which "or" alternative the attack belongs to. "longsword +10/+5
    // (1d8+3) or bite +4 (1d4)" is longsword group 0, bite group 1; attacks
    // joined by commas share a group. touch: true for "rope +15 touch (entangle)"
    // and for an attack named "touch" ("touch +5 (1d8+5 plus paralyzing touch)").
    // crit: "19-20", "x3", "19-20/x3" or "". extra: rider text after the dice,
    // "plus" stripped: "grab", "1d6 fire and entangle".
    melee: [],           // [{ name, count, bonus: [], damage, damageAvg, crit, extra, touch, group }]
    ranged: [],          // same shape, plus range (feet) when the line gives one, inside
                         // the parentheses or as a trailing ', range 30 ft.'
    space: 5,            // feet; "2-1/2 ft." -> 2.5
    reach: 5,
    reachNotes: '',      // "15 ft. with bite"
    specialAttacks: [],  // ["breath weapon (30-ft. cone, 6d6 fire, DC 17)", "grab"]

    // "Spell-Like Abilities (CL 7th; concentration +10)". source is the word
    // before "Spell-Like" when there is one ("Domain", "Bloodline"). Both kinds
    // of block carry notes when the header says more than CL and concentration:
    // "+7 touch" from the vampire's "(CL 8th, +7 touch)".
    spellLikeAbilities: [],  // [{ cl, concentration, source?, notes?, entries: [{ freq: "at will"|"constant"|"3/day"|"1/day"|..., spells: [{ name, dc, count, note }] }] }]
    // "Sorcerer Spells Known (CL 6th; concentration +9)" / "Cleric Spells Prepared".
    // className is "" when the block has none ("Spells Known (CL 1st)" on a dragon).
    // perDay: a number for "(5/day)", "at will" for "(at will)", null when not given.
    // A spell's note is its parenthetical minus DC and count ("already cast",
    // "electricity"), keeping the original separators ("level 9, any 1 CR 19 ..."). Superscript markers: domain: true for "true strikeD",
    // school: true for "S", bloodline: true for "B".
    // Trailer lines attach to the block above them: domains: ["Chaos", "Destruction"],
    // opposition: ["illusion", "transmutation"], bloodline: "undead", mystery, patron.
    spellcasting: [],        // [{ kind: "prepared"|"known", className, cl, concentration, notes?, levels: [{ level, perDay, spells: [{ name, dc, count, note }] }] }]

    abilities: { str: null, dex: null, con: null, int: null, wis: null, cha: null }, // null for "—"
    bab: null, cmb: null, cmd: null,   // null for a swarm's "CMB —; CMD —"
    cmbNotes: '',        // "+14 grapple" from "CMB +10 (+14 grapple)"
    cmdNotes: '',        // "25 vs. trip", "can't be tripped"
    feats: [],
    skills: [],          // [{ name: "Knowledge (arcana)", bonus: 12, note?: "+14 in forests" }]
    racialMods: '',
    languages: [],
    languageSpecial: [], // what follows the semicolon: ["telepathy 100 ft.", "tongues"]
    sq: [],
    // dc: the first "DC 17" in the text, else a poison/disease "save Fort 19"
    specialAbilities: [], // [{ name, kind: "Ex"|"Su"|"Sp", text, dc }]
    gear: { combat: [], other: [] },  // "Combat Gear ...; Other Gear ..." ("Gear" alone goes to other)
    ecology: { environment: '', organization: '', treasure: '' },
    tactics: '',         // the TACTICS section as one string; cut out before parsing because it repeats labels
    raw: '',
  };
}
