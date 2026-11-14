// The six attendees of the evening sale: Pathfinder Lite, level 6 pregens,
// noir edition. index.html renders whatever is here; nothing about a character
// is written into the page itself.
//
// Shape of one entry (every field but slug and name is optional, and a missing
// one simply does not render):
//
//   slug       url-safe id, used in the address bar (#slug) so a phone can be
//              bookmarked straight to its sheet. Never rename one mid-campaign:
//              a player's bookmark is pointing at it.
//   name       as printed in the catalogue
//   epithet    one line under the name ("The Bruiser")
//   lineage    ancestry, shown beside the epithet on the sheet
//   lot        the catalogue number
//   portrait   path to the 4:5 bust image, relative to this folder, or null.
//              null (or a file that fails to load) shows a monogram plate.
//   thumb      path to the square face crop for the sheet's top bar; falls
//              back to portrait, then to the monogram.
//   blurb      the paragraph under the name
//   quote      their line, set as a pull quote
//   vitals     the big numbers: [{ label, value, note }]
//   saves, attributes, skills   [{ label, value }]  (pairs() builds these)
//   sections   [{ title, items: [{ name, roll, tag, text }] }]
//              roll is a big figure on the right (+17, DC 22);
//              tag is a small note under the name (2 actions, 3/day)

// "Athletics +14, Acrobatics +10" -> [{ label:'Athletics', value:'+14' }, ...]
const pairs = s => s.split(',').map(p => p.trim()).filter(Boolean).map(p => {
  const i = p.lastIndexOf(' ');
  return { label: p.slice(0, i), value: p.slice(i + 1) };
});

const POTION = 'healing potions, 2d8+5 each';

export const rules = [
  'All bonuses are final totals. Roll d20 + the number.',
  'Critical success: beat the DC by 10, or roll a natural 20.',
  'Critical failure: miss the DC by 10, or roll a natural 1.',
  'Shield: spend 1 action to Raise a Shield for the AC shown beside it.',
];

export const characters = [
  {
    slug: 'tiny',
    name: 'Dale "Tiny" Kowalski',
    epithet: 'The Bruiser',
    lot: 1,
    portrait: 'portraits/tiny.webp',
    thumb: 'portraits/tiny-thumb.webp',
    blurb: 'Ex-gym teacher turned bouncer at the Rusty Anchor. Never lost a tug-of-war. Flip phone, cracked screen, battery lasts nine days.',
    quote: "I don't ask questions. I just stand in the doorway.",
    vitals: [
      { label: 'HP', value: '100' },
      { label: 'AC', value: '25', note: '27 with shield' },
      { label: 'Perception', value: '+12' },
      { label: 'Speed', value: '20' },
    ],
    saves: pairs('Fort +14, Ref +12, Will +12'),
    attributes: pairs('Str +4, Dex +2, Con +4, Int +1, Wis +2, Cha -1'),
    skills: pairs('Athletics +14, Acrobatics +10, Survival +10, Intimidation +9, Society +9, Diplomacy +7, Medicine +2, Nature +2, Religion +2, Stealth +2, Thievery +2, Arcana +1, Crafting +1, Occultism +1, Deception -1, Performance -1'),
    sections: [
      { title: 'Attacks', items: [
        { name: 'Sledgehammer', roll: '+17', text: '2d8+4 damage. Crit: the target falls prone.' },
        { name: 'Tire iron', roll: '+12', tag: 'thrown, 30 ft, you have 4', text: '1d6+4 damage.' },
      ] },
      { title: 'Tricks', items: [
        { name: 'Shield Block', tag: 'reaction', text: 'While your shield is raised, reduce the damage from a hit by 5.' },
        { name: 'Reactive Strike', tag: 'reaction', text: 'An enemy next to you moves away or does something sneaky: you get a free attack.' },
        { name: 'Bravery', text: 'A success on a Will save against fear counts as a critical success.' },
      ] },
      { title: 'Gear', items: [
        { text: `Riot vest (heavy armor), battered riot shield, sledgehammer, 4 tire irons, flask of whiskey (2 ${POTION}).` },
      ] },
    ],
  },
  {
    slug: 'pip',
    name: 'Pip Nettleby',
    epithet: 'The Fixer',
    lineage: 'Halfling',
    lot: 2,
    portrait: 'portraits/pip.webp',
    thumb: 'portraits/pip-thumb.webp',
    blurb: 'Halfling con artist and part-time locksmith. Has a cousin in every town and a debt in half of them. Prepaid flip phone, three contacts, all saved under fake names.',
    quote: 'Locked doors are just opinions.',
    vitals: [
      { label: 'HP', value: '66' },
      { label: 'AC', value: '23' },
      { label: 'Perception', value: '+11' },
      { label: 'Speed', value: '25' },
    ],
    saves: pairs('Fort +10, Ref +14, Will +11'),
    attributes: pairs('Str -1, Dex +4, Con +2, Int +3, Wis +1, Cha +3'),
    skills: pairs('Acrobatics +14, Stealth +14, Thievery +14, Deception +13, Crafting +11, Diplomacy +11, Intimidation +11, Occultism +11, Performance +11, Society +11, Medicine +9, Nature +9, Survival +9, Athletics +7, Arcana +3, Religion +1'),
    sections: [
      { title: 'Attacks', items: [
        { name: 'Stiletto', roll: '+15', text: '2d6+4 damage.' },
        { name: 'Switchblade', roll: '+14', text: '1d6+4 damage.' },
        { name: 'Flare pistol', roll: '+14', tag: 'ranged, 60 ft', text: '1d6 damage.' },
        { name: 'Sneak Attack', text: '+2d6 extra damage when the target is off-guard: flanked, surprised, or otherwise distracted.' },
      ] },
      { title: 'Tricks', items: [
        { name: 'Halfling Luck', tag: '1/day', text: 'Reroll a failed check or save.' },
        { name: 'Nimble Dodge', tag: 'reaction', text: '+2 AC against one attack.' },
        { name: 'Unflappable', text: 'A success on a save against fear or charm counts as a critical success.' },
      ] },
      { title: 'Gear', items: [
        { text: `Dark pea coat, stiletto, switchblade, flare pistol, lockpick set, skeleton keys, marked deck of cards, 2 flasks of cheap rye (2 ${POTION}).` },
      ] },
    ],
  },
  {
    slug: 'mary-ann',
    name: 'Mary-Ann Hartley',
    epithet: 'The Nurse',
    lot: 3,
    portrait: 'portraits/mary-ann.webp',
    thumb: 'portraits/mary-ann-thumb.webp',
    blurb: 'School nurse for eleven years, and the only one the whole town trusts. Has seen every kind of injury and a few kinds of apology. Smartphone, 47 unread messages from the church group chat.',
    quote: 'Sit down. Let me look at that.',
    vitals: [
      { label: 'HP', value: '80' },
      { label: 'AC', value: '23', note: '25 with shield' },
      { label: 'Perception', value: '+14' },
      { label: 'Speed', value: '25' },
    ],
    saves: pairs('Fort +13, Ref +10, Will +14'),
    attributes: pairs('Str +1, Dex +2, Con +3, Int +1, Wis +4, Cha +1'),
    skills: pairs('Medicine +14, Religion +14, Nature +12, Diplomacy +11, Crafting +9, Occultism +9, Society +9, Survival +4, Acrobatics +2, Stealth +2, Thievery +2, Athletics +1, Arcana +1, Deception +1, Intimidation +1, Performance +1'),
    sections: [
      { title: 'Attacks', items: [
        { name: 'Walking cane', roll: '+10', text: '1d6+1 damage.' },
        { name: 'Divine Lance', roll: '+12', tag: 'spell, 60 ft, unlimited', text: '4d4 damage.' },
      ] },
      { title: 'Spells · DC 22', items: [
        { name: 'Heal', tag: '8 casts per day', text: '1 action: touch a creature, heals 3d10. 2 actions: range 30 ft, heals 3d10+8. 3 actions: everyone within 30 ft heals 3d10, and undead are hurt.' },
        { name: 'Bless', tag: '3/day', text: 'Allies near you get +1 to attacks for 1 minute.' },
        { name: 'Shield', tag: 'unlimited', text: '+1 AC. You may block a hit to cut its damage by 5.' },
      ] },
      { title: 'Gear', items: [
        { text: `Quilted trench coat (light armor), serving tray (use as a shield), cane, silver sun pendant, nurse's bag, 3 thermoses of black coffee (3 ${POTION}).` },
      ] },
    ],
  },
  {
    slug: 'felix',
    name: 'Felix Thistlewick',
    epithet: 'The Smooth Talker',
    lineage: 'Gnome',
    lot: 4,
    portrait: 'portraits/felix.webp',
    thumb: 'portraits/felix-thumb.webp',
    blurb: 'Gnome wedding DJ, karaoke host, and unofficial mayor of the diner. Knows everyone\'s business and sings about it. Smartphone, exactly 4% battery, three playlists.',
    quote: "Everybody's got a song. I just play it back to them.",
    vitals: [
      { label: 'HP', value: '80' },
      { label: 'AC', value: '22' },
      { label: 'Perception', value: '+11' },
      { label: 'Speed', value: '25' },
    ],
    saves: pairs('Fort +11, Ref +13, Will +11'),
    attributes: pairs('Str -1, Dex +3, Con +3, Int +2, Wis +1, Cha +4'),
    skills: pairs('Diplomacy +14, Performance +14, Deception +12, Intimidation +12, Stealth +11, Occultism +10, Society +10, Medicine +9, Religion +9, Thievery +3, Acrobatics +3, Arcana +2, Crafting +2, Nature +1, Survival +1, Athletics -1'),
    sections: [
      { title: 'Attacks', items: [
        { name: 'Cane sword', roll: '+11', text: '1d6-1 damage.' },
        { name: 'Snub revolver', roll: '+11', tag: 'ranged, 60 ft', text: '1d6 damage. Loaded with blanks and rock salt.' },
        { name: 'Daze', roll: 'DC 22', tag: 'Will save · spell, 60 ft, unlimited', text: '2d6+4 damage.' },
      ] },
      { title: 'Spells · DC 22 · attack +12', items: [
        { name: 'Courageous Anthem', tag: '1 action, unlimited', text: 'You and allies within 60 ft get +1 to attacks, damage, and saves against fear for a minute. Once started, you keep singing for free.' },
        { name: 'Fear', tag: '3/day', text: 'DC 22 Will. The enemy becomes frightened (-1 to everything).' },
        { name: 'Sleep', tag: '3/day', text: 'DC 22 Will. Enemies fall asleep.' },
        { name: 'Haste', tag: '3/day', text: 'An ally gets an extra action each turn for 1 minute.' },
      ] },
      { title: 'Gear', items: [
        { text: `Tailored pinstripe suit, cane sword, snub revolver, pocket flask with a harmonica taped inside, 2 flasks of top-shelf bourbon (2 ${POTION}).` },
      ] },
    ],
  },
  {
    slug: 'juniper',
    name: 'Juniper Ashworth',
    epithet: 'The Researcher',
    lineage: 'Elf',
    lot: 5,
    portrait: 'portraits/juniper.webp',
    thumb: 'portraits/juniper-thumb.webp',
    blurb: 'Elf grad student who never finished her thesis because the research kept turning into a different thesis. Smartphone at 6%, three spare chargers, a spellbook with sticky tabs.',
    quote: "I'm not saying it's cursed. I'm saying the data is.",
    vitals: [
      { label: 'HP', value: '54' },
      { label: 'AC', value: '22' },
      { label: 'Perception', value: '+11' },
      { label: 'Speed', value: '30' },
    ],
    saves: pairs('Fort +9, Ref +13, Will +13'),
    attributes: pairs('Str +0, Dex +3, Con +1, Int +4, Wis +3, Cha +1'),
    skills: pairs('Arcana +14, Crafting +14, Occultism +12, Society +12, Medicine +11, Nature +11, Religion +11, Stealth +11, Thievery +11, Diplomacy +9, Acrobatics +3, Survival +3, Deception +1, Intimidation +1, Performance +1, Athletics +0'),
    sections: [
      { title: 'Attacks', items: [
        { name: 'Umbrella', roll: '+8', text: '1d4 damage.' },
        { name: 'Electric Arc', roll: 'DC 22', tag: 'Reflex save · cantrip, unlimited', text: '3d4+4 damage to 2 targets within 30 ft.' },
        { name: 'Telekinetic Projectile', roll: '+12', tag: 'cantrip, 30 ft, unlimited', text: '3d6 damage.' },
      ] },
      { title: 'Spells · DC 22 · attack +12', items: [
        { name: 'Force Barrage', tag: '3/day', text: 'Never misses. 1 action = 1 missile of 1d4+1 force, 2 actions = 2 missiles, 3 actions = 3 missiles.' },
        { name: 'Fireball', tag: '3/day', text: '20 ft burst, 120 ft range. DC 22 Reflex, 6d6 fire.' },
        { name: 'Web', tag: '3/day', text: 'DC 22 Reflex. Creatures in a 10 ft area get stuck.' },
        { name: 'Haste', tag: '3/day', text: 'An ally gets an extra action each turn for 1 minute.' },
        { name: 'Shield', tag: 'unlimited', text: '+1 AC. You may block a hit to cut its damage by 5.' },
      ] },
      { title: 'Gear', items: [
        { text: `Long wool coat and a cardigan (light armor), umbrella (your bonded staff), battered spellbook, 2 thermoses of strong tea (2 ${POTION}).` },
      ] },
    ],
  },
  {
    slug: 'kara',
    name: 'Kara Brightwater',
    epithet: 'The Cop',
    lineage: 'Orc',
    lot: 6,
    portrait: 'portraits/kara.webp',
    thumb: 'portraits/kara-thumb.webp',
    blurb: 'Orc volunteer firefighter and youth soccer ref. Stays late to put the chairs away. Smartphone in a rugged case, bugle-call ringtone.',
    quote: 'Rules are rules. Even for the people who wrote them.',
    vitals: [
      { label: 'HP', value: '94' },
      { label: 'AC', value: '24', note: '26 with shield' },
      { label: 'Perception', value: '+9' },
      { label: 'Speed', value: '25' },
    ],
    saves: pairs('Fort +13, Ref +10, Will +11'),
    attributes: pairs('Str +4, Dex +2, Con +3, Int +1, Wis +1, Cha +1'),
    skills: pairs('Athletics +14, Religion +11, Diplomacy +9, Intimidation +9, Medicine +9, Society +9, Acrobatics +2, Stealth +2, Thievery +2, Arcana +1, Crafting +1, Deception +1, Nature +1, Occultism +1, Performance +1, Survival +1'),
    sections: [
      { title: 'Attacks', items: [
        { name: 'Fire axe', roll: '+15', text: '2d8+4 damage.' },
      ] },
      { title: 'Tricks', items: [
        { name: 'Shield Block', tag: 'reaction', text: 'While your shield is raised, reduce the damage from a hit by 5.' },
        { name: 'Glimpse of Redemption', tag: 'reaction', text: 'An enemy within 15 ft hits your ally. The enemy picks: the ally takes 0 damage, or the ally resists 8 damage and the enemy is weaker for a round.' },
        { name: 'Lay on Hands', tag: '1/day, touch', text: 'Heals 18 HP.' },
        { name: 'Orc Ferocity', tag: '1/day', text: 'When you would drop to 0 HP, stay at 1 HP instead.' },
      ] },
      { title: 'Gear', items: [
        { text: `Firefighter turnout coat and chest plate (medium armor), dented riot shield, fire axe, brass badge, whistle, 2 flasks of diner coffee (2 ${POTION}).` },
      ] },
    ],
  },
];
