// Recommended item builds per hero (used by the shop "Guides" tab and bot purchasing).
// starting: bought at 0:00 with 600 gold; early/core/late: targets in order.
export const RECOMMENDED = {
  brakka: {
    starting: ['bark_ration', 'healing_salve', 'ring_of_protection', 'oak_twig', 'oak_twig', 'gauntlets'],
    early: ['resonant_wand', 'surge_boots', 'ironbark_shield'],
    core: ['flicker_dagger', 'unbroken_standard', 'crimson_bulwark'],
    late: ['frostguard_mail', 'behemoth_heart', 'renewal_orb'],
  },
  kenshar: {
    starting: ['bark_ration', 'healing_salve', 'woodsmans_knife', 'slippers', 'oak_twig', 'oak_twig'],
    early: ['swift_band', 'resonant_wand', 'surge_boots', 'stormcoil'],
    core: ['harvest_glaive', 'mirror_mantle', 'twin_fangs'],
    late: ['swallowtail', 'chasm_blade', 'hungering_blade'],
  },
  isolde: {
    starting: ['bark_ration', 'bark_ration', 'clarity', 'lookout_ward', 'seeker_ward', 'oak_twig', 'oak_twig', 'wisp_ember'],
    early: ['resonant_wand', 'tidecall_boots', 'honeyed_plum'],
    core: ['shimmer_cloak', 'thrust_staff', 'flicker_dagger'],
    late: ['ascendant_scepter', 'unbroken_standard', 'renewal_orb'],
  },
  pell: {
    starting: ['bark_ration', 'healing_salve', 'slippers', 'slippers', 'oak_twig', 'wisp_ember'],
    early: ['swift_band', 'resonant_wand', 'shifting_treads', 'wyrmspear'],
    core: ['stormcoil', 'unbroken_standard', 'headsmans_blade'],
    late: ['unerring_staff', 'hungering_blade', 'swallowtail'],
  },
  sera: {
    starting: ['bark_ration', 'wisp_ember', 'mantle', 'circlet', 'oak_twig', 'oak_twig'],
    early: ['mind_talisman', 'flask', 'resonant_wand', 'tidecall_boots'],
    core: ['whirlwind_scepter', 'farsight_lens', 'flicker_dagger'],
    late: ['ascendant_scepter', 'morphing_scythe', 'renewal_orb'],
  },
  gorrow: {
    starting: ['bark_ration', 'healing_salve', 'lookout_ward', 'gauntlets', 'gauntlets', 'oak_twig'],
    early: ['bracer', 'resonant_wand', 'surge_boots', 'ironbark_shield'],
    core: ['flicker_dagger', 'ascendant_scepter', 'unbroken_standard'],
    late: ['behemoth_heart', 'frostguard_mail', 'renewal_orb'],
  },
  vesna: {
    starting: ['bark_ration', 'healing_salve', 'slippers', 'slippers', 'oak_twig', 'wisp_ember'],
    early: ['swift_band', 'resonant_wand', 'shifting_treads', 'wyrmspear'],
    core: ['frenzy_mask', 'mirror_mantle', 'headsmans_blade'],
    late: ['swallowtail', 'hungering_blade', 'unerring_staff'],
  },
  aldric: {
    starting: ['bark_ration', 'healing_salve', 'woodsmans_knife', 'gauntlets', 'oak_twig', 'oak_twig'],
    early: ['bracer', 'resonant_wand', 'shifting_treads', 'frenzy_mask'],
    core: ['twinstrike_sabre', 'unbroken_standard', 'flicker_dagger'],
    late: ['headsmans_blade', 'hungering_blade', 'siege_cuirass'],
  },
  morvane: {
    starting: ['bark_ration', 'bark_ration', 'clarity', 'lookout_ward', 'seeker_ward', 'oak_twig', 'oak_twig', 'honeyed_plum'],
    early: ['resonant_wand', 'tidecall_boots'],
    core: ['shimmer_cloak', 'thrust_staff', 'farsight_lens'],
    late: ['ascendant_scepter', 'keepers_greaves', 'frostguard_mail'],
  },
  sable: {
    starting: ['bark_ration', 'healing_salve', 'woodsmans_knife', 'slippers', 'oak_twig', 'oak_twig'],
    early: ['swift_band', 'resonant_wand', 'surge_boots', 'leech_mask'],
    core: ['harvest_glaive', 'unbroken_standard', 'armorbane'],
    late: ['hungering_blade', 'chasm_blade', 'swallowtail'],
  },
  thalor: {
    starting: ['bark_ration', 'wisp_ember', 'mantle', 'circlet', 'oak_twig', 'oak_twig'],
    early: ['mind_talisman', 'flask', 'resonant_wand', 'tidecall_boots'],
    core: ['farsight_lens', 'clearmind', 'ascendant_scepter'],
    late: ['windseer_blade', 'renewal_orb', 'morphing_scythe'],
  },
  vashkar: {
    starting: ['bark_ration', 'bark_ration', 'clarity', 'lookout_ward', 'seeker_ward', 'oak_twig', 'oak_twig', 'honeyed_plum'],
    early: ['resonant_wand', 'tidecall_boots'],
    core: ['flicker_dagger', 'thrust_staff', 'farsight_lens'],
    late: ['ascendant_scepter', 'shimmer_cloak', 'whirlwind_scepter'],
  },
  ondur: {
    starting: ['bark_ration', 'healing_salve', 'lookout_ward', 'clarity', 'oak_twig', 'oak_twig', 'gauntlets'],
    early: ['resonant_wand', 'tidecall_boots'],
    core: ['flicker_dagger', 'ascendant_scepter', 'thrust_staff'],
    late: ['unbroken_standard', 'renewal_orb', 'frostguard_mail'],
  },
  liora: {
    starting: ['bark_ration', 'wisp_ember', 'mantle', 'circlet', 'oak_twig', 'oak_twig'],
    early: ['mind_talisman', 'resonant_wand', 'shifting_treads'],
    core: ['stormcoil', 'unbroken_standard', 'ascendant_scepter'],
    late: ['headsmans_blade', 'unerring_staff', 'hungering_blade'],
  },
  ormund: {
    starting: ['bark_ration', 'healing_salve', 'ring_of_protection', 'gauntlets', 'oak_twig', 'oak_twig'],
    early: ['bracer', 'resonant_wand', 'surge_boots', 'ironbark_shield'],
    core: ['unbroken_standard', 'crimson_bulwark', 'flicker_dagger'],
    late: ['behemoth_heart', 'ascendant_scepter', 'frostguard_mail'],
  },
};

// Fallbacks by primary attribute / attack type for heroes not listed above.
export const GENERIC_BUILDS = {
  str: {
    starting: ['bark_ration', 'healing_salve', 'gauntlets', 'gauntlets', 'oak_twig', 'oak_twig'],
    early: ['bracer', 'resonant_wand', 'surge_boots'],
    core: ['ironbark_shield', 'flicker_dagger', 'unbroken_standard'],
    late: ['behemoth_heart', 'siege_cuirass', 'chasm_blade'],
  },
  agi: {
    starting: ['bark_ration', 'healing_salve', 'woodsmans_knife', 'slippers', 'oak_twig', 'oak_twig'],
    early: ['swift_band', 'resonant_wand', 'shifting_treads'],
    core: ['stormcoil', 'unbroken_standard', 'mirror_mantle'],
    late: ['headsmans_blade', 'swallowtail', 'hungering_blade'],
  },
  int: {
    starting: ['bark_ration', 'clarity', 'wisp_ember', 'mantle', 'circlet', 'oak_twig'],
    early: ['mind_talisman', 'resonant_wand', 'tidecall_boots'],
    core: ['thrust_staff', 'shimmer_cloak', 'flicker_dagger'],
    late: ['ascendant_scepter', 'morphing_scythe', 'frostguard_mail'],
  },
};
GENERIC_BUILDS.uni = GENERIC_BUILDS.str;
