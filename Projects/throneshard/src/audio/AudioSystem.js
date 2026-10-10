// WebAudio engine: sample playback with procedural fallbacks, positional attenuation relative to the camera
// target, stereo panning, voice limiting, music / sfx / ambience / ui buses, and automatic game.bus hooks.
//
// API: play(name, {position, volume, pitchVar, rate, bus}) -> voice|null, setVolume(master), setBusVolume(bus, v),
//      setMuted(bool), getSettings(), unlock(), playMusic(), stopMusic(), SOUND_NAMES (list)
// Everything works without any files: every sound has a synthesized fallback.

const BASE = 'assets/audio/';
const range = (prefix, n, ext = 'ogg', from = 0) => Array.from({ length: n }, (_, i) => `sfx/${prefix}${i + from}.${ext}`);

// name -> { files, synth, vol, bus, pitchVar, max (concurrent voices), gap (min seconds between plays), prio }
const SOUNDS = {
  // combat
  swing: { files: [...range('slice_', 2), ...range('draw_', 3)], synth: 'swing', vol: 0.35, pitchVar: 0.15, max: 4, gap: 0.04 },
  hit_melee: { files: range('punch_', 5), synth: 'hit', vol: 0.45, pitchVar: 0.12, max: 5, gap: 0.03 },
  hit_armor: { files: [...range('plate_', 5), ...range('metal_', 5)], synth: 'hitMetal', vol: 0.35, pitchVar: 0.1, max: 4, gap: 0.04 },
  hit_ranged: { files: range('soft_', 5), synth: 'hitSoft', vol: 0.4, pitchVar: 0.12, max: 4, gap: 0.04 },
  hit_building: { files: range('wood_', 5), synth: 'hitWood', vol: 0.45, pitchVar: 0.1, max: 3, gap: 0.06 },
  crit: { files: ['sfx/chop.ogg'], synth: 'crit', vol: 0.8, pitchVar: 0.08, max: 2, gap: 0.08, prio: 2 },
  bow: { synth: 'bow', vol: 0.5, pitchVar: 0.12, max: 4, gap: 0.04 },
  magic_shot: { files: range('laser_small_', 5), synth: 'magicShot', vol: 0.22, pitchVar: 0.2, max: 4, gap: 0.05 },
  catapult: { synth: 'catapult', vol: 0.55, pitchVar: 0.1, max: 2, gap: 0.2 },
  tower_attack: { files: range('forcefield_', 5), synth: 'towerZap', vol: 0.5, pitchVar: 0.08, max: 3, gap: 0.1 },
  creep_death: { synth: 'creepDeath', vol: 0.4, pitchVar: 0.2, max: 3, gap: 0.08 },
  hero_death: { files: ['sfx/bell_0.ogg'], synth: 'heroDeath', vol: 0.8, max: 2, gap: 0.3, prio: 3 },
  building_destroyed: { files: range('big_explosion_', 2), synth: 'bigExplosion', vol: 1.0, max: 2, gap: 0.3, prio: 4 },
  explosion: { files: range('explosion_', 5), synth: 'explosion', vol: 0.7, pitchVar: 0.1, max: 3, gap: 0.08, prio: 2 },
  // abilities
  cast_fire: { files: range('fire_', 5), synth: 'fire', vol: 0.7, pitchVar: 0.1, max: 3, gap: 0.05, prio: 2 },
  cast_ice: { files: range('glass_', 5), synth: 'ice', vol: 0.6, pitchVar: 0.1, max: 3, gap: 0.05, prio: 2 },
  cast_lightning: { files: range('laser_large_', 5), synth: 'lightning', vol: 0.55, pitchVar: 0.1, max: 3, gap: 0.05, prio: 2 },
  cast_holy: { synth: 'holy', vol: 0.55, max: 3, gap: 0.05, prio: 2 },
  cast_poison: { synth: 'poison', vol: 0.55, pitchVar: 0.1, max: 3, gap: 0.05, prio: 2 },
  cast_dark: { synth: 'dark', vol: 0.6, pitchVar: 0.1, max: 3, gap: 0.05, prio: 2 },
  cast_earth: { files: range('explosion_', 5), synth: 'earth', vol: 0.6, pitchVar: 0.1, max: 3, gap: 0.05, prio: 2 },
  cast_generic: { synth: 'cast', vol: 0.5, pitchVar: 0.12, max: 3, gap: 0.05, prio: 2 },
  ult_boom: { synth: 'ultBoom', vol: 0.8, max: 2, gap: 0.2, prio: 3 },
  // economy / progression
  coin: { files: range('coins_', 2), synth: 'coin', vol: 0.55, pitchVar: 0.05, max: 3, gap: 0.05, bus: 'ui', prio: 2 },
  levelup: { synth: 'levelUp', vol: 0.7, max: 1, gap: 0.3, bus: 'ui', prio: 3 },
  learn: { files: ['sfx/confirm_1.ogg'], synth: 'learn', vol: 0.5, max: 2, gap: 0.05, bus: 'ui' },
  buy: { files: range('coins_', 2), synth: 'buy', vol: 0.6, max: 2, gap: 0.05, bus: 'ui', prio: 2 },
  sell: { files: ['sfx/drop.ogg'], synth: 'coin', vol: 0.5, max: 2, gap: 0.05, bus: 'ui' },
  item_use: { synth: 'itemUse', vol: 0.5, max: 2, gap: 0.05, prio: 2 },
  teleport: { synth: 'teleport', vol: 0.6, max: 2, gap: 0.2, prio: 2 },
  respawn: { synth: 'respawn', vol: 0.6, max: 1, gap: 0.5, bus: 'ui', prio: 2 },
  // ui
  ui_click: { files: range('click_', 3, 'ogg', 1), synth: 'click', vol: 0.4, max: 3, gap: 0.03, bus: 'ui' },
  select: { files: range('select_', 3, 'ogg', 1), synth: 'click', vol: 0.25, max: 2, gap: 0.05, bus: 'ui' },
  open: { files: ['sfx/open.ogg'], synth: 'click', vol: 0.4, max: 1, gap: 0.05, bus: 'ui' },
  close: { files: ['sfx/close.ogg'], synth: 'click', vol: 0.4, max: 1, gap: 0.05, bus: 'ui' },
  error: { files: range('error_', 3, 'ogg', 1), synth: 'error', vol: 0.45, max: 1, gap: 0.35, bus: 'ui' },
  ping: { files: ['sfx/bong.ogg'], synth: 'ping', vol: 0.55, max: 2, gap: 0.2, bus: 'ui' },
  order: { synth: 'order', vol: 0.12, max: 1, gap: 0.08, bus: 'ui' },
  // stings / announcer-ish
  horn: { synth: 'horn', vol: 0.9, max: 1, gap: 1, bus: 'ui', prio: 5 },
  chime: { files: ['sfx/bell_2.ogg'], synth: 'chime', vol: 0.6, max: 1, gap: 0.5, bus: 'ui', prio: 4 },
  first_blood: { synth: 'firstBlood', vol: 0.9, max: 1, gap: 1, bus: 'ui', prio: 5 },
  kill_sting: { files: ['sfx/jingle_pizzi_03.ogg'], synth: 'killSting', vol: 0.55, max: 1, gap: 0.8, bus: 'ui', prio: 4 },
  streak: { synth: 'streak', vol: 0.8, max: 1, gap: 1, bus: 'ui', prio: 5 },
  victory: { synth: 'victory', vol: 1, max: 1, gap: 2, bus: 'ui', prio: 6 },
  defeat: { synth: 'defeat', vol: 1, max: 1, gap: 2, bus: 'ui', prio: 6 },
  grimmaw: { files: range('big_explosion_', 2), synth: 'bigExplosion', vol: 0.9, max: 1, gap: 1, prio: 4 },
  grimmaw_roar: { files: ['creature/roar_0.ogg', 'creature/roar_2.ogg'], synth: 'roar', vol: 0.9, rate: 0.7, max: 1, gap: 0.8, prio: 4, reverb: true },
  // hero attack flavours (see HERO_AUDIO)
  atk_chop: { files: ['sfx/chop.ogg', ...range('slice_', 2)], synth: 'swing', vol: 0.4, rate: 0.8, pitchVar: 0.1, max: 3, gap: 0.05 },
  atk_slice: { files: range('slice_', 2), synth: 'swing', vol: 0.36, rate: 1.15, pitchVar: 0.12, max: 3, gap: 0.04 },
  atk_heavy: { files: [...range('slice_', 2), 'sfx/draw_0.ogg'], synth: 'swing', vol: 0.42, rate: 0.72, pitchVar: 0.08, max: 3, gap: 0.05 },
  atk_cleaver: { files: ['sfx/chop.ogg'], synth: 'swing', vol: 0.42, rate: 0.62, pitchVar: 0.1, max: 3, gap: 0.05 },
  atk_dagger: { files: range('draw_', 3), synth: 'swing', vol: 0.3, rate: 1.35, pitchVar: 0.15, max: 3, gap: 0.04 },
  atk_gun: { synth: 'gunshot', vol: 0.42, pitchVar: 0.06, max: 3, gap: 0.05 },
  atk_fire: { synth: 'fireBolt', vol: 0.4, pitchVar: 0.12, max: 3, gap: 0.05 },
  atk_ice: { synth: 'iceBolt', vol: 0.34, pitchVar: 0.12, max: 3, gap: 0.05 },
  atk_frost: { synth: 'iceBolt', vol: 0.36, rate: 0.7, pitchVar: 0.1, max: 3, gap: 0.05 },
  atk_zap: { synth: 'zap', vol: 0.34, pitchVar: 0.15, max: 3, gap: 0.05 },
  atk_dark: { synth: 'darkBolt', vol: 0.38, pitchVar: 0.12, max: 3, gap: 0.05 },
  // announcer (Kenney CC0 voice-overs; the kill-streak lines are recorded clips from tools/scripts/audio/build_announcer_lines.py)
  ann_first_blood: { files: ['announcer/first_blood_0.ogg'], vol: 0.95, bus: 'voice', max: 1, gap: 1, prio: 6 },
  ann_double_kill: { files: ['announcer/double_kill_0.ogg'], vol: 0.95, bus: 'voice', max: 1, gap: 1, prio: 6 },
  ann_triple_kill: { files: ['announcer/triple_kill_0.ogg'], vol: 0.95, bus: 'voice', max: 1, gap: 1, prio: 6 },
  ann_quad_kill: { files: ['announcer/quad_kill_0.ogg'], vol: 0.95, bus: 'voice', max: 1, gap: 1, prio: 6 },
  ann_massacre: { files: ['announcer/massacre_0.ogg'], vol: 0.95, bus: 'voice', max: 1, gap: 1, prio: 6 },
  ann_killing_spree: { files: ['announcer/killing_spree_0.ogg'], vol: 0.95, bus: 'voice', max: 1, gap: 1, prio: 6 },
  ann_dominating: { files: ['announcer/dominating_0.ogg'], vol: 0.95, bus: 'voice', max: 1, gap: 1, prio: 6 },
  ann_relentless: { files: ['announcer/relentless_0.ogg'], vol: 0.95, bus: 'voice', max: 1, gap: 1, prio: 6 },
  ann_unstoppable: { files: ['announcer/unstoppable_0.ogg'], vol: 0.95, bus: 'voice', max: 1, gap: 1, prio: 6 },
  ann_merciless: { files: ['announcer/merciless_0.ogg'], vol: 0.95, bus: 'voice', max: 1, gap: 1, prio: 6 },
  ann_ruthless: { files: ['announcer/ruthless_0.ogg'], vol: 0.95, bus: 'voice', max: 1, gap: 1, prio: 6 },
  ann_legendary: { files: ['announcer/legendary_0.ogg'], vol: 0.95, bus: 'voice', max: 1, gap: 1, prio: 6 },
  ann_mythic: { files: ['announcer/mythic_0.ogg'], vol: 0.95, bus: 'voice', max: 1, gap: 1, prio: 6 },
  ann_shutdown: { files: ['announcer/shutdown_0.ogg'], vol: 0.95, bus: 'voice', max: 1, gap: 1, prio: 6 },
  ann_prepare: { files: ['announcer/prepare_0.ogg'], vol: 0.85, bus: 'voice', max: 1, gap: 1, prio: 6 },
  ann_fight: { files: ['announcer/fight_0.ogg'], vol: 0.9, bus: 'voice', max: 1, gap: 1, prio: 6 },
  ann_multi: { files: ['announcer/multi_kill_0.ogg'], vol: 0.9, bus: 'voice', max: 1, gap: 1, prio: 6 },
  ann_win: { files: ['announcer/you_win_0.ogg'], vol: 1, bus: 'voice', max: 1, gap: 2, prio: 7 },
  ann_lose: { files: ['announcer/you_lose_0.ogg'], vol: 1, bus: 'voice', max: 1, gap: 2, prio: 7 },
  ann_destroyed: { files: ['announcer/target_destroyed_0.ogg'], vol: 0.8, bus: 'voice', max: 1, gap: 1, prio: 6 },
  ann_objective: { files: ['announcer/objective_0.ogg'], vol: 0.8, bus: 'voice', max: 1, gap: 1, prio: 6 },
  ann_lookout: { files: ['announcer/look_out_0.ogg'], vol: 0.8, bus: 'voice', max: 1, gap: 1, prio: 6 },
  tower_lost: { synth: 'towerLost', vol: 0.7, bus: 'ui', max: 1, gap: 1, prio: 5 },
  // ui aliases used by src/ui (ui.sfx(name) -> play('ui_' + name))
  ui_confirm: { files: ['sfx/confirm_2.ogg'], synth: 'learn', vol: 0.45, max: 1, gap: 0.05, bus: 'ui' },
  ui_learn: { files: ['sfx/confirm_1.ogg'], synth: 'learn', vol: 0.5, max: 2, gap: 0.05, bus: 'ui' },
  ui_levelup: { synth: 'levelUp', vol: 0.6, max: 1, gap: 0.3, bus: 'ui', prio: 3 },
  ui_error: { files: range('error_', 3, 'ogg', 1), synth: 'error', vol: 0.4, max: 1, gap: 0.35, bus: 'ui' },
  ui_announce: { synth: 'announce', vol: 0.4, max: 1, gap: 0.4, bus: 'ui', prio: 3 },
  ui_buy: { files: range('coins_', 2), synth: 'buy', vol: 0.6, max: 2, gap: 0.05, bus: 'ui', prio: 2 },
  ui_sell: { files: ['sfx/drop.ogg'], synth: 'coin', vol: 0.5, max: 2, gap: 0.05, bus: 'ui' },
  ui_open: { files: ['sfx/open.ogg'], synth: 'click', vol: 0.4, max: 1, gap: 0.05, bus: 'ui' },
  ui_close: { files: ['sfx/close.ogg'], synth: 'click', vol: 0.4, max: 1, gap: 0.05, bus: 'ui' },
};

// Hero voice sets built by scripts/audio/build_voice_assets.py: voice/<set>/<category>_<n>.ogg
const VOICE_SETS = {
  orc: { cast: 4, ult: 1, death: 2 }, brute: { cast: 3, ult: 1, death: 1 }, demon: { cast: 3, ult: 1, death: 1 },
  revenant: { cast: 3, ult: 1, death: 1 }, male0: { cast: 3, ult: 1, death: 2 }, male1: { cast: 4, death: 2 },
  male2: { cast: 3, death: 2 }, male3: { cast: 4, ult: 1, death: 1 },
  fem1: { cast: 3, ult: 1, grunt: 3, death: 2 }, fem2: { cast: 3, ult: 1, grunt: 2, death: 2 }, fem3: { cast: 3, ult: 1, grunt: 2, death: 2 },
};
for (const [set, cats] of Object.entries(VOICE_SETS)) {
  for (const [cat, n] of Object.entries(cats)) {
    SOUNDS[`v_${set}_${cat}`] = {
      files: Array.from({ length: n }, (_, i) => `voice/${set}/${cat}_${i}.ogg`),
      synth: cat === 'death' ? 'voiceDeath' : 'voiceGrunt', vol: cat === 'death' ? 0.75 : 0.6, bus: 'voice',
      pitchVar: 0.03, max: 2, gap: 0.25, prio: cat === 'death' ? 3 : 2,
    };
  }
}
// Per-hero audio identity. voice = VOICE_SETS key, castCat = category used for normal casts, rate = voice pitch,
// attack = SOUNDS key for the attack swing/launch. Unknown heroes get a deterministic fallback (heroAudio()).
const HERO_AUDIO = {
  brakka: { voice: 'orc', attack: 'atk_chop' },
  gorrow: { voice: 'brute', attack: 'atk_cleaver', rate: 0.9 },
  aldric: { voice: 'male3', attack: 'atk_heavy', rate: 0.95 },
  kenshar: { voice: 'male1', attack: 'atk_slice' },
  pell: { voice: 'male2', attack: 'atk_gun', rate: 1.05 },
  thalor: { voice: 'male0', attack: 'atk_zap', rate: 0.94 },
  vashkar: { voice: 'demon', attack: 'atk_dark' },
  morvane: { voice: 'revenant', attack: 'atk_frost', rate: 1.08 },
  isolde: { voice: 'fem1', attack: 'atk_ice' },
  sera: { voice: 'fem2', attack: 'atk_fire' },
  vesna: { voice: 'fem3', attack: 'bow' },
  sable: { voice: 'fem2', castCat: 'grunt', attack: 'atk_dagger', rate: 1.1 },
  ormund: { voice: 'male3', attack: 'atk_heavy', rate: 0.88 },
};
const MALE_FALLBACK = ['male0', 'male1', 'male2', 'male3', 'orc'];
const FEMALE_FALLBACK = ['fem1', 'fem2', 'fem3'];
const FEMALE_HINT = /isolde|sera|vesna|sable|liora|queen|witch|lady|priestess|archer|she\b|her\b/i;

// Length in seconds of each recorded kill-streak clip, so the announcer queue waits for it.
const ANNOUNCER_CLIP_SECS = { first_blood: 1.0, double_kill: 0.94, triple_kill: 1.28, quad_kill: 0.78, massacre: 1.08, killing_spree: 0.96, dominating: 1.31, relentless: 0.83, unstoppable: 1.54, merciless: 1.1, ruthless: 1.7, legendary: 1.61, mythic: 1.21, shutdown: 1.42 };

// Formant "announcer" lines (fallback only, used when a recorded clip has not loaded) (ARPAbet-ish phonemes, 1 = stressed vowel, | = word gap). See speak().
const ANNOUNCER_LINES = {
  first_blood: 'F ER1 S T | B L AH1 D',
  double_kill: 'D AH1 B AH L | K IH1 L',
  triple_kill: 'T R IH1 P AH L | K IH1 L',
  quad_kill: 'K W AA1 D | K IH1 L',
  massacre: 'M AE1 S AH K ER',
  killing_spree: 'K IH1 L IH NG | S P R IY1',
  dominating: 'D AA1 M IH N EY T IH NG',
  relentless: 'R IH L EH1 N T L AH S',
  unstoppable: 'AH N S T AA1 P AH B AH L',
  merciless: 'M ER1 S IH L AH S',
  ruthless: 'R UW1 TH L AH S',
  legendary: 'L EH1 JH AH N D EH R IY',
  mythic: 'M IH1 TH IH K',
  shutdown: 'SH AH1 T D AW N',
};
// Phoneme table for speak(): vowels {v, f:[F1,F2,F3], f2?(diphthong target), d}, sonorants {f, a, d},
// fricatives {type:'fric', nf (noise centre), nq, na (noise amp), voiced?, d}, stops {type:'stop', nf, na, voiced?}.
const V = (f, d = 0.11, f2) => ({ v: true, f, d, f2 });
const PHON = {
  IY: V([270, 2290, 3010]), IH: V([390, 1990, 2550], 0.09), EH: V([530, 1840, 2480]), AE: V([660, 1720, 2410], 0.13),
  AA: V([730, 1090, 2440], 0.13), AO: V([570, 840, 2410], 0.13), UH: V([440, 1020, 2240]), UW: V([300, 870, 2240]),
  AH: V([640, 1190, 2390], 0.09), ER: V([490, 1350, 1690], 0.13),
  AY: V([730, 1090, 2440], 0.2, [320, 2100, 2800]), EY: V([530, 1840, 2480], 0.17, [310, 2200, 2900]),
  AW: V([730, 1090, 2440], 0.2, [330, 900, 2300]), OW: V([570, 840, 2410], 0.18, [330, 870, 2240]),
  L: { f: [360, 1000, 2600], a: 0.5, d: 0.06 }, R: { f: [420, 1300, 1600], a: 0.55, d: 0.06 }, W: { f: [290, 610, 2150], a: 0.5, d: 0.05 },
  Y: { f: [260, 2070, 3020], a: 0.5, d: 0.05 }, M: { f: [280, 1000, 2200], a: 0.32, d: 0.07 }, N: { f: [280, 1600, 2600], a: 0.32, d: 0.06 },
  NG: { f: [280, 2200, 2700], a: 0.32, d: 0.07 },
  S: { type: 'fric', nf: 5500, nq: 2, na: 0.42, d: 0.1 }, SH: { type: 'fric', nf: 2700, nq: 2, na: 0.42, d: 0.1 },
  F: { type: 'fric', nf: 1800, nq: 0.6, na: 0.16, d: 0.09 }, TH: { type: 'fric', nf: 2800, nq: 0.6, na: 0.12, d: 0.08 },
  V: { type: 'fric', nf: 1800, nq: 0.6, na: 0.1, voiced: true, d: 0.06, f: [300, 1100, 2300] },
  Z: { type: 'fric', nf: 5000, nq: 2, na: 0.28, voiced: true, d: 0.08 }, ZH: { type: 'fric', nf: 2600, nq: 2, na: 0.3, voiced: true, d: 0.08 },
  JH: { type: 'fric', nf: 2600, nq: 2, na: 0.4, voiced: true, d: 0.12 }, HH: { type: 'fric', nf: 1400, nq: 0.5, na: 0.15, d: 0.06 },
  B: { type: 'stop', nf: 600, na: 0.45, voiced: true }, D: { type: 'stop', nf: 2800, na: 0.45, voiced: true }, G: { type: 'stop', nf: 1800, na: 0.45, voiced: true },
  P: { type: 'stop', nf: 800, na: 0.55 }, T: { type: 'stop', nf: 3600, na: 0.55 }, K: { type: 'stop', nf: 2000, na: 0.55 },
};
// announcer line -> sting played under the voice
const ANNOUNCER_STINGS = {
  first_blood: 'first_blood', double_kill: 'streak', triple_kill: 'streak', quad_kill: 'streak', massacre: 'streak',
  killing_spree: 'kill_sting', dominating: 'kill_sting', relentless: 'streak', unstoppable: 'streak', merciless: 'streak',
  ruthless: 'streak', legendary: 'streak', mythic: 'streak', shutdown: 'kill_sting',
};

const MUSIC_TRACKS = ['music/town_theme.mp3', 'music/battle_theme_a.mp3'];
const AMBIENCE = { forest: 'ambience/forest.mp3', river: 'ambience/river.mp3' };
const MAX_VOICES = 28;
const BUSES = ['music', 'sfx', 'ambience', 'ui', 'voice'];
const HEAR_FULL = 14; // world units: full volume inside this radius of the camera target
const HEAR_MAX = 55; // silent beyond

const ABILITY_KEYWORDS = [
  ['cast_fire', /fire|flame|burn|blaze|inferno|lava|magma|sun|meteor|ember|ignite|solar|heat|dragon|napalm/],
  ['cast_ice', /ice|frost|cold|freez|chill|snow|glaci|blizzard|crystal|winter|arctic|nova/],
  ['cast_lightning', /lightning|thunder|shock|storm|static|arc|volt|zap|spark|electr|bolt|tempest/],
  ['cast_holy', /heal|bless|grace|holy|light|purif|guardian|angel|divine|mend|restor|sigil|shield/],
  ['cast_poison', /poison|venom|toxic|plague|acid|disease|blight|miasma|viper|decay/],
  ['cast_dark', /blink|teleport|shadow|void|dark|night|curse|death|soul|shade|phantom|chrono|time|spirit|illusion/],
  ['cast_earth', /stun|slam|smash|quake|earth|stomp|rock|stone|boulder|avalanche|rift|toss|leap|charge|echo/],
];

export class AudioSystem {
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this.buffers = new Map(); // path -> AudioBuffer | null (failed) | Promise
    this.voices = []; // active voices {name, end, prio, gain, src}
    this.lastPlay = new Map();
    this.settings = { master: 0.8, music: 0.45, sfx: 0.9, ambience: 0.5, ui: 0.8, voice: 0.9, muted: false };
    try { Object.assign(this.settings, JSON.parse(localStorage.getItem('throneshard.audio') || '{}')); } catch {}
    this._pending = [];
    this.music = { src: null, gain: null, index: 0, nextAt: 0, pad: null };
    this.amb = {};
    this.SOUND_NAMES = Object.keys(SOUNDS);
    this._lastErr = 0;
    this._killFeedStreak = 0;
    this._voiceNext = new WeakMap();
    this._annQueue = [];
    this._annBusyUntil = 0;
  }

  async init() {
    const unlock = () => this.unlock();
    for (const ev of ['pointerdown', 'mousedown', 'keydown', 'touchstart']) window.addEventListener(ev, unlock, { capture: true });
    this._hookBus();
    this._hookUiClicks();
    // Fetch sample data in the background (don't block loading). Decoding happens after unlock.
    this._fetchAll();
  }

  // ------------------------------------------------------------------ context / buses
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { this.ctx = new AC({ latencyHint: 'interactive' }); } catch { return; }
    const c = this.ctx;
    this.master = c.createGain();
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.knee.value = 12; this.comp.ratio.value = 6;
    this.comp.attack.value = 0.004; this.comp.release.value = 0.2;
    this.master.connect(this.comp).connect(c.destination);
    this.buses = {};
    for (const b of BUSES) { this.buses[b] = c.createGain(); this.buses[b].connect(this.master); }
    // shared reverb send for big sounds
    this.reverb = c.createConvolver();
    this.reverb.buffer = this._impulse(2.2, 2.5);
    this.reverbSend = c.createGain(); this.reverbSend.gain.value = 0.22;
    this.reverbSend.connect(this.reverb).connect(this.master);
    this._applyVolumes();
    this._noise = this._makeNoise(2);
    this._decodeAll();
    if (this.game.running) this._startBeds();
    this.game.bus.emit('audio:unlocked', {});
  }

  _applyVolumes() {
    if (!this.ctx) return;
    const s = this.settings, t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.muted ? 0 : s.master, t, 0.05);
    for (const b of BUSES) this.buses[b].gain.setTargetAtTime(s[b] ?? 1, t, 0.05);
  }
  _save() { try { localStorage.setItem('throneshard.audio', JSON.stringify(this.settings)); } catch {} }
  setVolume(master) { this.settings.master = clamp01(master); this._applyVolumes(); this._save(); }
  setBusVolume(bus, v) { if (bus in this.settings) { this.settings[bus] = clamp01(v); this._applyVolumes(); this._save(); } }
  setMuted(m = !this.settings.muted) { this.settings.muted = !!m; this._applyVolumes(); this._save(); }
  setMusicVolume(v) { this.setBusVolume('music', v); }
  getSettings() { return { ...this.settings }; }

  // ------------------------------------------------------------------ loading
  _allFiles() {
    const s = new Set();
    for (const d of Object.values(SOUNDS)) for (const f of d.files ?? []) s.add(f);
    return [...s];
  }
  _fetchAll() {
    this._raw = new Map();
    const fetchOne = (p) => fetch(BASE + p).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null)
      .then((ab) => { this._raw.set(p, ab); if (this.ctx) this._decode(p); });
    for (const f of this._allFiles()) fetchOne(f);
  }
  _decodeAll() { for (const p of this._raw?.keys() ?? []) this._decode(p); }
  _decode(p) {
    if (!this.ctx || this.buffers.has(p)) return;
    const ab = this._raw.get(p);
    if (!ab) { this.buffers.set(p, null); return; }
    this.buffers.set(p, 'loading');
    this.ctx.decodeAudioData(ab.slice(0)).then((b) => this.buffers.set(p, b)).catch(() => this.buffers.set(p, null));
  }
  async _loadStream(path) {
    // long files (music/ambience) are fetched+decoded on demand after unlock
    if (this.buffers.get(path) instanceof AudioBuffer) return this.buffers.get(path);
    try {
      const r = await fetch(BASE + path);
      if (!r.ok) throw new Error('404');
      const b = await this.ctx.decodeAudioData(await r.arrayBuffer());
      this.buffers.set(path, b);
      return b;
    } catch { this.buffers.set(path, null); return null; }
  }

  // ------------------------------------------------------------------ playback
  listener() {
    return this.game.cameraCtl?.getTarget?.() ?? this.game.player?.hero?.position ?? null;
  }

  // Returns {gain, pan} for a world position, or null if inaudible.
  spatial(pos) {
    const l = this.listener();
    if (!pos || !l) return { gain: 1, pan: 0 };
    const dx = pos.x - l.x, dz = pos.z - l.z;
    const d = Math.hypot(dx, dz * 0.8);
    if (d >= HEAR_MAX) return null;
    const g = d <= HEAR_FULL ? 1 : Math.pow(1 - (d - HEAR_FULL) / (HEAR_MAX - HEAR_FULL), 2);
    return { gain: g, pan: Math.max(-0.85, Math.min(0.85, dx / 26)) };
  }

  play(name, opts = {}) {
    try { return this._play(name, opts); } catch (e) { return null; }
  }

  _play(name, opts) {
    const c = this.ctx;
    if (!c || c.state !== 'running' || this.settings.muted) return null;
    const def = SOUNDS[name] ?? (name in SYNTH ? { synth: name, vol: 0.5 } : /^ui_/.test(name) ? SOUNDS.ui_click : null);
    if (!def) return null;
    const now = c.currentTime;
    const sp = this.spatial(opts.position);
    if (!sp) return null;
    const vol = (opts.volume ?? 1) * (def.vol ?? 0.6) * sp.gain;
    if (vol < 0.02) return null;
    // throttle per-sound
    const last = this.lastPlay.get(name) ?? -1;
    if (now - last < (def.gap ?? 0.03)) return null;
    this.voices = this.voices.filter((v) => v.end > now);
    const same = this.voices.filter((v) => v.name === name);
    if (same.length >= (def.max ?? 4)) return null;
    const prio = (def.prio ?? 1) + vol;
    if (this.voices.length >= MAX_VOICES) {
      // steal the lowest-priority voice if we're more important
      let low = null;
      for (const v of this.voices) if (!low || v.prio < low.prio) low = v;
      if (!low || low.prio >= prio) return null;
      try { low.gain.gain.setTargetAtTime(0, now, 0.01); low.stop?.(now + 0.05); } catch {}
      this.voices.splice(this.voices.indexOf(low), 1);
    }
    this.lastPlay.set(name, now);

    const out = c.createGain();
    out.gain.value = vol;
    let node = out;
    if (sp.pan && c.createStereoPanner) {
      const p = c.createStereoPanner(); p.pan.value = sp.pan; out.connect(p); node = p;
    }
    node.connect(this.buses[opts.bus ?? def.bus ?? 'sfx']);
    if ((def.prio ?? 1) >= 3 || opts.reverb || def.reverb) out.connect(this.reverbSend);

    const pv = opts.pitchVar ?? def.pitchVar ?? 0;
    const rate = (opts.rate ?? 1) * (def.rate ?? 1) * (1 + (Math.random() * 2 - 1) * pv);
    const files = (def.files ?? []).filter((f) => this.buffers.get(f) instanceof AudioBuffer);
    let dur, stop;
    if (files.length && !opts.forceSynth) {
      const buf = this.buffers.get(files[(Math.random() * files.length) | 0]);
      const src = c.createBufferSource();
      src.buffer = buf; src.playbackRate.value = rate;
      src.connect(out); src.start(now);
      dur = buf.duration / rate;
      stop = (t) => { try { src.stop(t); } catch {} };
    } else {
      const fn = SYNTH[def.synth] ?? SYNTH.cast;
      const r = fn(this, out, now, rate, opts) ?? {};
      dur = r.dur ?? 1;
      stop = r.stop;
    }
    const voice = { name, end: now + dur + 0.1, prio, gain: out, stop };
    this.voices.push(voice);
    setTimeout(() => { try { out.disconnect(); node.disconnect(); } catch {} }, (dur + 0.6) * 1000);
    return voice;
  }

  // ------------------------------------------------------------------ helpers for synth
  _makeNoise(sec) {
    const c = this.ctx, len = (c.sampleRate * sec) | 0;
    const b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  _impulse(sec, decay) {
    const c = this.ctx, len = (c.sampleRate * sec) | 0;
    const b = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return b;
  }
  noise(dest, t, dur, { type = 'bandpass', f0 = 1000, f1 = f0, q = 1, gain = 1, attack = 0.005, loop = false } = {}) {
    const c = this.ctx;
    const src = c.createBufferSource(); src.buffer = this._noise; src.loop = true;
    const flt = c.createBiquadFilter(); flt.type = type; flt.Q.value = q;
    flt.frequency.setValueAtTime(f0, t); flt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    if (!loop) g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(flt).connect(g).connect(dest);
    src.start(t, Math.random()); if (!loop) src.stop(t + dur + 0.05);
    return { src, g, flt };
  }
  tone(dest, t, dur, { type = 'sine', f0 = 440, f1 = f0, gain = 0.5, attack = 0.005, release = null, detune = 0 } = {}) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = type; o.detune.value = detune;
    o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (release ?? dur));
    o.connect(g).connect(dest); o.start(t); o.stop(t + (release ?? dur) + 0.05);
    return { o, g };
  }
  // brass-ish chord (for horn/fanfares)
  brass(dest, t, dur, freqs, gain = 0.25, cutoff = 1800) {
    const c = this.ctx;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 2;
    f.frequency.setValueAtTime(300, t); f.frequency.linearRampToValueAtTime(cutoff, t + Math.min(0.4, dur * 0.4));
    f.frequency.linearRampToValueAtTime(cutoff * 0.5, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.12); g.gain.setValueAtTime(gain, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    f.connect(g).connect(dest);
    for (const fr of freqs) for (const dt of [-7, 6]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr; o.detune.value = dt;
      const vib = c.createOscillator(); vib.frequency.value = 5; const vg = c.createGain(); vg.gain.value = 3;
      vib.connect(vg).connect(o.detune); vib.start(t); vib.stop(t + dur + 0.1);
      o.connect(f); o.start(t); o.stop(t + dur + 0.1);
    }
  }

  // ------------------------------------------------------------------ music & ambience
  _startBeds() {
    if (!this.ctx || this._bedsStarted) return;
    this._bedsStarted = true;
    this._startAmbience();
    this.music.nextAt = this.ctx.currentTime + 4; // let the horn breathe
  }

  async _startAmbience() {
    const c = this.ctx;
    for (const [k, path] of Object.entries(AMBIENCE)) {
      const g = c.createGain(); g.gain.value = 0; g.connect(this.buses.ambience);
      this.amb[k] = { gain: g, src: null };
      const buf = await this._loadStream(path);
      if (buf) {
        const s = c.createBufferSource(); s.buffer = buf; s.loop = true; s.connect(g); s.start();
        this.amb[k].src = s;
      } else if (k === 'forest') {
        // synthesized wind bed
        const n = this.noise(g, c.currentTime, 1, { type: 'lowpass', f0: 500, q: 0.5, gain: 0.25, attack: 1, loop: true });
        const lfo = c.createOscillator(); lfo.frequency.value = 0.07; const lg = c.createGain(); lg.gain.value = 300;
        lfo.connect(lg).connect(n.flt.frequency); lfo.start();
        this.amb[k].synthBirds = true;
      } else {
        this.noise(g, c.currentTime, 1, { type: 'bandpass', f0: 900, q: 0.4, gain: 0.3, attack: 1, loop: true });
      }
    }
  }

  playMusic(index = this.music.index) {
    this.music.index = index;
    this.music.stopped = false;
    this.music.nextAt = 0;
  }
  stopMusic(fade = 2) {
    const m = this.music;
    const c = this.ctx;
    if (!c) return;
    m.stopped = true;
    if (m.gain) m.gain.gain.setTargetAtTime(0, c.currentTime, fade / 3);
    if (m.src) { const s = m.src; m.src = null; try { s.stop(c.currentTime + fade + 0.5); } catch {} }
    if (m.pad) { m.pad.stop(fade); m.pad = null; }
    m.nextAt = Infinity;
  }

  async _nextTrack() {
    const c = this.ctx, m = this.music;
    m.nextAt = Infinity; // busy
    const path = MUSIC_TRACKS[m.index % MUSIC_TRACKS.length];
    m.index++;
    const buf = await this._loadStream(path);
    if (m.stopped) return;
    if (!buf) {
      // procedural evolving pad instead
      if (!m.pad) m.pad = this._pad();
      m.nextAt = Infinity;
      return;
    }
    const g = c.createGain(); g.gain.setValueAtTime(0, c.currentTime);
    g.gain.linearRampToValueAtTime(0.55, c.currentTime + 3);
    g.connect(this.buses.music);
    const s = c.createBufferSource(); s.buffer = buf; s.connect(g); s.start();
    m.src = s; m.gain = g;
    // after the track ends: pad interlude for ~40-70s then the next track
    s.onended = () => {
      if (m.src !== s) return;
      m.pad = m.pad ?? this._pad(40 + Math.random() * 30);
      m.nextAt = c.currentTime + 45 + Math.random() * 30;
    };
  }

  // Slowly evolving ambient pad (chord progression with filtered detuned saws). Returns {stop(fade)}.
  _pad(lengthSec = Infinity) {
    const c = this.ctx;
    const out = c.createGain(); out.gain.value = 0; out.connect(this.buses.music); out.connect(this.reverbSend);
    out.gain.linearRampToValueAtTime(0.16, c.currentTime + 6);
    const flt = c.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = 700; flt.Q.value = 0.7; flt.connect(out);
    const lfo = c.createOscillator(); lfo.frequency.value = 0.05; const lg = c.createGain(); lg.gain.value = 350;
    lfo.connect(lg).connect(flt.frequency); lfo.start();
    const chords = [[57, 60, 64, 69], [53, 57, 60, 65], [55, 59, 62, 67], [52, 55, 59, 64], [50, 57, 62, 65], [53, 60, 65, 69]];
    const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
    const oscs = [];
    for (let i = 0; i < 4; i++) for (const d of [-8, 8]) {
      const o = c.createOscillator(); o.type = i === 0 ? 'triangle' : 'sawtooth'; o.detune.value = d;
      const g = c.createGain(); g.gain.value = i === 0 ? 0.3 : 0.09;
      o.connect(g).connect(flt); o.start(); oscs.push({ o, i });
    }
    let ci = 0, stopped = false;
    const step = () => {
      if (stopped) return;
      const ch = chords[ci++ % chords.length];
      const t = c.currentTime;
      for (const { o, i } of oscs) o.frequency.setTargetAtTime(midi(ch[i] - (i === 0 ? 12 : 0)), t, 1.2);
      // occasional soft bell melody note
      if (Math.random() < 0.7) {
        const n = ch[1 + ((Math.random() * 3) | 0)] + 12;
        this.tone(out, t + Math.random() * 2, 3, { type: 'sine', f0: midi(n), gain: 0.18, attack: 0.02 });
      }
      timer = setTimeout(step, 7000);
    };
    let timer = setTimeout(step, 10);
    const pad = {
      stop: (fade = 4) => {
        if (stopped) return; stopped = true; clearTimeout(timer);
        out.gain.setTargetAtTime(0, c.currentTime, fade / 3);
        setTimeout(() => { for (const { o } of oscs) try { o.stop(); } catch {} try { lfo.stop(); } catch {} out.disconnect(); }, fade * 1000 + 500);
      },
    };
    if (Number.isFinite(lengthSec)) setTimeout(() => { pad.stop(6); if (this.music.pad === pad) this.music.pad = null; }, lengthSec * 1000);
    return pad;
  }

  // ------------------------------------------------------------------ per frame
  update(dt) {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    const g = this.game;
    if (!g.running) return;
    if (!this._bedsStarted) this._startBeds();
    // the horn sounds at 0:00: war horn + "Fight!"
    if (!this._hornDone && g.time >= 0) {
      this._hornDone = true;
      if (g.time < 3) {
        this.play('horn');
        setTimeout(() => this.play('ann_fight'), 1500);
      }
    }
    this._pumpAnnouncer();
    // music scheduler
    if (c.currentTime >= this.music.nextAt && !g.matchOver) this._nextTrack();
    // ambience mix: river near x == z
    const l = this.listener();
    if (l) {
      const riverDist = Math.abs(l.x - l.z) / Math.SQRT2;
      const riverMix = Math.max(0, 1 - riverDist / 22);
      const t = c.currentTime;
      this.amb.river?.gain.gain.setTargetAtTime(0.1 + riverMix * 0.6, t, 0.5);
      this.amb.forest?.gain.gain.setTargetAtTime(0.55 - riverMix * 0.2, t, 0.5);
      // synthesized birds if forest file missing
      if (this.amb.forest?.synthBirds && Math.random() < dt * 0.35) this._bird(this.amb.forest.gain);
    }
  }

  _bird(dest) {
    const c = this.ctx, t = c.currentTime;
    const base = 2200 + Math.random() * 1800;
    const n = 2 + ((Math.random() * 4) | 0);
    for (let i = 0; i < n; i++) {
      const tt = t + i * (0.09 + Math.random() * 0.05);
      this.tone(dest, tt, 0.08, { type: 'sine', f0: base * (1 + Math.random() * 0.2), f1: base * (0.7 + Math.random() * 0.6), gain: 0.05, attack: 0.01 });
    }
  }

  // ------------------------------------------------------------------ bus hooks
  _hookBus() {
    const g = this.game, bus = g.bus;
    const isPlayer = (u) => u && u === g.player?.hero;
    const pos = (u) => u?.position;

    bus.on('match:start', () => {
      this._hornDone = !(g.time < 0);
      if (g.time < 0) {
        this.play('chime');
        setTimeout(() => this.play('ann_prepare'), 900);
      } else this.play('horn');
      this._startBeds();
    });
    bus.on('match:end', ({ playerWon }) => {
      this.stopMusic(1.5);
      setTimeout(() => this.play(playerWon ? 'victory' : 'defeat'), 1200);
      setTimeout(() => this.play(playerWon ? 'ann_win' : 'ann_lose'), 2600);
    });
    bus.on('announcer', (e) => this.announce(typeof e === 'string' ? e : e?.line));

    bus.on('unit:attack', ({ unit, target }) => {
      if (!unit) return;
      const k = unit.kind;
      if (k === 'tower' || (k === 'building' && unit.subtype === 'fountain')) return this.play('tower_attack', { position: pos(unit) });
      const melee = !(unit.getStat?.('projectileSpeed') > 0);
      const heroish = k === 'hero' || k === 'grimmaw';
      const v = heroish ? 1 : 0.55;
      if (k === 'hero' || unit.kind === 'illusion') {
        const ha = this.heroAudio(unit);
        if (ha.attack) return this.play(ha.attack, { position: pos(unit), volume: isPlayer(unit) ? 1 : 0.85 });
      }
      if (melee) return this.play('swing', { position: pos(unit), volume: v });
      if (unit.subtype === 'siege') return this.play('catapult', { position: pos(unit) });
      const pk = String(unit.data?.projectileKind ?? unit.def?.projectile ?? unit.modelKind ?? '');
      const bowish = /arrow|bow|ranger|archer|wind|vesna|pell|final_round|gun|bullet/i.test(pk) || (unit.def?.primary === 'agi');
      this.play(bowish ? 'bow' : 'magic_shot', { position: pos(unit), volume: v });
    });

    bus.on('unit:attackLanded', ({ unit, target, crit }) => {
      if (!unit || !target) return;
      const p = pos(target);
      const melee = !(unit.getStat?.('projectileSpeed') > 0);
      const heroish = unit.kind === 'hero' || target.kind === 'hero' || unit.kind === 'grimmaw';
      const v = heroish ? 1 : 0.5;
      if (crit) this.play('crit', { position: p });
      if (target.isStructure) this.play('hit_building', { position: p, volume: v });
      else if (melee) this.play(target.kind === 'hero' && Math.random() < 0.5 ? 'hit_armor' : 'hit_melee', { position: p, volume: v });
      else this.play('hit_ranged', { position: p, volume: v });
    });

    bus.on('unit:died', ({ unit, killer }) => {
      if (!unit) return;
      if (unit.kind === 'hero') {
        if (isPlayer(unit)) { this.play('hero_death', { volume: 1 }); this._duck(0.4, 3); }
        else this.play('hero_death', { position: pos(unit), volume: 0.45 });
        this.voice(unit, 'death', { position: isPlayer(unit) ? null : pos(unit), volume: isPlayer(unit) ? 1 : 0.9 });
      } else if (unit.kind === 'grimmaw') {
        this.play('grimmaw_roar', { position: pos(unit) });
      } else if (!unit.isStructure) {
        this.play('creep_death', { position: pos(unit), volume: unit.kind === 'grimmaw' ? 1.5 : 0.8 });
      }
    });
    bus.on('building:destroyed', ({ unit }) => {
      this.play('building_destroyed', { position: pos(unit), volume: unit?.subtype === 'throneshard' ? 1.4 : 1 });
      this.play('explosion', { position: pos(unit) });
      if (!unit || unit.subtype === 'fountain' || unit.subtype === 'throneshard') return;
      if (unit.kind !== 'tower' && !/barracks/.test(unit.subtype ?? '')) return;
      this.announce(unit.team === g.player.team ? 'tower_lost' : 'tower_destroyed');
    });
    bus.on('grimmaw:killed', (e) => {
      this.play('grimmaw');
      const k = e?.killerHero ?? e?.killer;
      this.announce(k && k.team === g.player.team ? 'grimmaw_ours' : 'grimmaw');
    });

    bus.on('hero:levelUp', ({ hero }) => {
      if (isPlayer(hero)) this.play('levelup');
      else this.play('levelup', { position: pos(hero), volume: 0.3 });
    });
    bus.on('hero:gold', ({ hero, amount, reason }) => {
      if (!isPlayer(hero) || !(amount > 0)) return;
      if (/last|kill|windfall|assist|creep|deny|structure|grimmaw/i.test(reason ?? '')) this.play('coin', { volume: amount > 100 ? 1 : 0.8 });
    });
    bus.on('hero:respawn', ({ hero }) => { if (isPlayer(hero)) this.play('respawn'); });

    bus.on('ability:cast', ({ hero, ability }) => {
      const d = ability?.def ?? {};
      if (d.sound === false || ability?.isItem) return;
      const p = pos(hero);
      const name = d.sound && SOUNDS[d.sound] ? d.sound : classifyAbility(d);
      this.play(name, { position: p });
      if (d.ultimate) this.play('ult_boom', { position: p });
      // hero voice: always on ultimates, sometimes on regular spells, never spammy (per-hero cooldown)
      if (hero?.kind === 'hero' && !hero.data?.isIllusion) {
        const now = this.ctx?.currentTime ?? 0;
        const next = this._voiceNext.get(hero) ?? 0;
        const chance = d.ultimate ? 1 : isPlayer(hero) ? 0.6 : 0.4;
        if (now >= next && Math.random() < chance) {
          this._voiceNext.set(hero, now + (d.ultimate ? 2 : 3.5));
          this.voice(hero, d.ultimate ? 'ult' : 'cast', { position: isPlayer(hero) ? null : p, volume: isPlayer(hero) ? 0.9 : 0.8 });
        }
      }
    });
    bus.on('ability:learned', ({ hero }) => { if (isPlayer(hero)) this.play('learn'); });
    bus.on('item:bought', ({ hero }) => { if (isPlayer(hero)) this.play('buy'); });
    bus.on('item:sold', ({ hero }) => { if (isPlayer(hero)) this.play('sell'); });
    bus.on('item:used', ({ hero, item }) => {
      const id = String(item?.def?.id ?? '');
      if (/homeward|wayfarer|teleport|travel/.test(id)) this.play('teleport', { position: pos(hero) });
      else if (/flicker/.test(id)) this.play('cast_dark', { position: pos(hero) });
      else this.play('item_use', { position: pos(hero) });
    });

    bus.on('hero:killed', ({ victim, killerHero, firstBlood }) => {
      const mine = killerHero && killerHero.team === g.player.team;
      // First blood / multi-kills / streaks are voiced via the 'announcer' event (emitted by the UI in sync with the
      // on-screen banner). Fallback when no UI announcer exists: announce here.
      if (!g.ui?.notify) {
        if (firstBlood) return this.announce('first_blood');
      }
      if (firstBlood) return;
      if (isPlayer(killerHero) || isPlayer(victim) || mine) this.play('kill_sting', { volume: mine ? 1 : 0.6 });
    });

    bus.on('ui:error', ({ unit } = {}) => {
      if (unit && !isPlayer(unit)) return;
      this.play('error');
    });
    bus.on('ui:sound', (e) => { const n = typeof e === 'string' ? e : e?.name; if (n) this.play(n, typeof e === 'object' ? e : {}); });
    bus.on('ui:toggleShop', () => this.play('open'));
    bus.on('minimap:ping', ({ position } = {}) => this.play('ping'));
    bus.on('input:command', ({ type } = {}) => { if (type === 'move' || type === 'attack' || type === 'attackMove') this.play('order', { volume: 0.8 }); });
    bus.on('game:paused', ({ paused }) => {
      if (!this.ctx) return;
      this.buses.sfx.gain.setTargetAtTime(paused ? 0 : this.settings.sfx, this.ctx.currentTime, 0.05);
    });
    bus.on('settings:audio', (s) => { if (s) { Object.assign(this.settings, s); this._applyVolumes(); this._save(); } });
  }

  // Temporarily lower music/ambience (e.g. on player death)
  _duck(amount, sec) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const b of ['music', 'ambience']) {
      const gn = this.buses[b].gain;
      gn.cancelScheduledValues(t);
      gn.setTargetAtTime(this.settings[b] * amount, t, 0.1);
      gn.setTargetAtTime(this.settings[b], t + sec, 1);
    }
  }

  // ------------------------------------------------------------------ hero voices
  // {voice, castCat, rate, attack} for a hero (or illusion). Unknown heroes (new heroes added later) get a
  // deterministic voice from a fallback pool (female pool if def.gender === 'female' or the name hints at it) and an
  // attack flavour derived from attack type / projectile kind. def.audio = {voice, attack, rate, castCat} overrides.
  heroAudio(unit) {
    const def = unit?.def ?? {};
    const id = unit?.heroId ?? def.id ?? unit?.subtype ?? '';
    const cache = (this._heroAudio ??= new Map());
    if (cache.has(id)) return cache.get(id);
    let ha = HERO_AUDIO[id];
    if (!ha) {
      const female = def.gender ? /^f/i.test(def.gender) : FEMALE_HINT.test(`${id} ${def.name ?? ''} ${def.title ?? ''}`);
      const pool = female ? FEMALE_FALLBACK : MALE_FALLBACK;
      let h = 0;
      for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      const ranged = def.attackType === 'ranged' || (def.attackRange ?? 0) > 300;
      const pk = String(def.projectileKind ?? id).toLowerCase();
      let attack = 'atk_slice';
      if (ranged) {
        attack = 'magic_shot';
        for (const [k, re] of [['atk_fire', /fire|flame|lava|sun|ember/], ['atk_ice', /ice|frost|cold|crystal|snow/], ['atk_zap', /lightning|storm|zap|arc|volt|thunder/],
          ['atk_dark', /shadow|void|dark|demon|death|soul|curse/], ['atk_gun', /gun|rifle|bullet|shot|pell/], ['bow', /arrow|bow|ranger|archer|wind/]]) {
          if (re.test(pk)) { attack = k; break; }
        }
        if (attack === 'magic_shot' && def.primary === 'agi') attack = 'bow';
      } else attack = def.primary === 'str' ? 'atk_heavy' : def.primary === 'agi' ? 'atk_slice' : 'atk_chop';
      ha = { voice: pool[h % pool.length], castCat: female ? 'grunt' : 'cast', rate: 0.94 + ((h >> 4) % 13) / 100, attack };
    }
    ha = { castCat: 'cast', rate: 1, ...ha, ...(def.audio ?? {}) };
    cache.set(id, ha);
    return ha;
  }

  voice(unit, cat, opts = {}) {
    const ha = this.heroAudio(unit);
    const set = VOICE_SETS[ha.voice];
    if (!set) return null;
    let c = cat === 'cast' ? ha.castCat : cat;
    if (!set[c]) c = cat === 'ult' ? (ha.castCat in set ? ha.castCat : 'cast') : 'cast';
    if (!set[c]) return null;
    return this.play(`v_${ha.voice}_${c}`, { ...opts, rate: (opts.rate ?? 1) * (ha.rate ?? 1) });
  }

  // ------------------------------------------------------------------ announcer
  // Lines are queued so they never overlap. line: first_blood | double_kill | ... | killing_spree | ... |
  // tower_destroyed | tower_lost | grimmaw | grimmaw_ours | victory | defeat
  announce(line) {
    if (!line) return;
    if (this._annQueue.length > 3) this._annQueue.splice(1, 1);
    this._annQueue.push(line);
    this._pumpAnnouncer();
  }

  _pumpAnnouncer() {
    const c = this.ctx;
    if (!c || c.state !== 'running' || !this._annQueue.length) return;
    if (c.currentTime < this._annBusyUntil) return;
    const line = this._annQueue.shift();
    const t = c.currentTime;
    let dur = 1.2;
    try {
      if (line === 'tower_destroyed') { this.play('ann_destroyed'); dur = 1.6; }
      else if (line === 'tower_lost') { this.play('tower_lost'); setTimeout(() => this.play('ann_lookout'), 350); dur = 1.6; }
      else if (line === 'grimmaw' || line === 'grimmaw_ours') { this.play('grimmaw_roar'); if (line === 'grimmaw_ours') setTimeout(() => this.play('ann_objective'), 700); dur = 2.2; }
      else if (ANNOUNCER_LINES[line]) {
        const sting = ANNOUNCER_STINGS[line];
        if (sting) this.play(sting, { volume: 0.7 });
        // the recorded clip comes in just under the sting; the formant voice only speaks if the clip is not decoded yet
        const clip = SOUNDS['ann_' + line];
        if (clip && this.buffers.get(clip.files[0]) instanceof AudioBuffer) {
          setTimeout(() => this.play('ann_' + line), sting === 'first_blood' ? 250 : 120);
          dur = (ANNOUNCER_CLIP_SECS[line] ?? 1.2) + 0.6;
        } else {
          const v = this.speak(line, t + (sting === 'first_blood' ? 0.25 : 0.12));
          dur = (v?.dur ?? 1) + 0.5;
        }
      } else if (SOUNDS[line]) { this.play(line); }
    } catch { /* never throw from audio */ }
    this._annBusyUntil = t + dur;
  }

  // Procedural formant voice (Klatt-lite): glottal sawtooth -> 4 parallel formant band-passes, plus a noise branch
  // for fricatives / bursts. Deep, slightly distorted "arena announcer" delivery with a hall reverb send.
  speak(lineOrPhonemes, t0) {
    const c = this.ctx;
    if (!c || this.settings.muted) return null;
    const text = ANNOUNCER_LINES[lineOrPhonemes] ?? lineOrPhonemes;
    const seq = String(text).split(/\s+/).filter(Boolean);
    t0 = Math.max(c.currentTime + 0.02, t0 ?? c.currentTime);
    const out = c.createGain(); out.gain.value = 0.9;
    const shaper = c.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; curve[i] = Math.tanh(x * 1.3) / Math.tanh(1.3); }
    shaper.curve = curve;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 70;
    const pres = c.createBiquadFilter(); pres.type = 'peaking'; pres.frequency.value = 2500; pres.gain.value = 4; pres.Q.value = 0.8;
    out.connect(shaper).connect(hp).connect(pres).connect(this.buses.voice);
    const send = c.createGain(); send.gain.value = 0.8; pres.connect(send).connect(this.reverbSend);

    // glottal source (two slightly detuned saws = "bigger" voice)
    const src = c.createGain(); src.gain.value = 0.5;
    const oscs = [0, 7].map((det) => { const o = c.createOscillator(); o.type = 'sawtooth'; o.detune.value = det; o.connect(src); return o; });
    const tilt = c.createBiquadFilter(); tilt.type = 'lowpass'; tilt.frequency.value = 3200; tilt.Q.value = 0.5;
    src.connect(tilt);
    const voiceAmp = c.createGain(); voiceAmp.gain.value = 0;
    const F = [0, 1, 2, 3].map((i) => {
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = [6, 9, 12, 12][i]; f.frequency.value = [600, 1200, 2500, 3500][i];
      const g = c.createGain(); g.gain.value = [1.6, 1.0, 0.55, 0.25][i];
      tilt.connect(f).connect(g).connect(voiceAmp);
      return f;
    });
    voiceAmp.connect(out);
    const nsrc = c.createBufferSource(); nsrc.buffer = this._noise; nsrc.loop = true;
    const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.Q.value = 1.5; nf.frequency.value = 4000;
    const nAmp = c.createGain(); nAmp.gain.value = 0;
    nsrc.connect(nf).connect(nAmp).connect(out);

    // timeline
    let t = t0;
    const setF = (fs, at, glide = 0.035) => {
      for (let i = 0; i < 3; i++) { F[i].frequency.setTargetAtTime(fs[i], at, glide / 2.5); }
    };
    const amp = (param, v, at, k = 0.012) => param.setTargetAtTime(v, at, k);
    let stressT = t0;
    const syll = [];
    for (let i = 0; i < seq.length; i++) {
      const tok = seq[i];
      if (tok === '|') { amp(voiceAmp.gain, 0, t, 0.02); amp(nAmp.gain, 0, t); t += 0.06; continue; }
      const stress = /1$/.test(tok);
      const ph = PHON[tok.replace(/\d$/, '')];
      if (!ph) continue;
      const next = PHON[(seq[i + 1] ?? '').replace(/\d$/, '')];
      if (ph.v) {
        const d = ph.d * (stress ? 1.45 : 1);
        setF(ph.f, t);
        if (ph.f2) setF(ph.f2, t + d * 0.45, d * 0.5);
        amp(voiceAmp.gain, stress ? 1 : 0.8, t);
        amp(nAmp.gain, 0, t);
        syll.push({ t, d, stress });
        if (stress && stressT === t0) stressT = t;
        t += d;
      } else if (ph.type === 'fric') {
        if (ph.f) setF(ph.f, t);
        nf.frequency.setValueAtTime(ph.nf, t); nf.Q.setValueAtTime(ph.nq ?? 1.5, t);
        amp(voiceAmp.gain, ph.voiced ? 0.25 : 0, t, 0.01);
        amp(nAmp.gain, ph.na, t, 0.01);
        t += ph.d;
        amp(nAmp.gain, 0, t, 0.01);
      } else if (ph.type === 'stop') {
        // closure (voice bar for voiced stops), burst, optional aspiration
        amp(voiceAmp.gain, ph.voiced ? 0.12 : 0, t, 0.006);
        amp(nAmp.gain, 0, t, 0.006);
        if (next?.f) setF(ph.f ?? next.f, t, 0.02);
        t += ph.voiced ? 0.045 : 0.06;
        nf.frequency.setValueAtTime(ph.nf, t); nf.Q.setValueAtTime(1.2, t);
        nAmp.gain.setValueAtTime(ph.na, t);
        amp(nAmp.gain, 0, t + 0.012, 0.008);
        if (!ph.voiced && next?.v) {
          // aspiration shaped by the following vowel
          nf.frequency.setValueAtTime(next.f[1], t + 0.015); nf.Q.setValueAtTime(3, t + 0.015);
          nAmp.gain.setValueAtTime(0.22, t + 0.015);
          amp(nAmp.gain, 0, t + 0.045, 0.01);
          t += 0.05;
        } else t += 0.02;
      } else {
        // sonorants: liquids / nasals / glides
        setF(ph.f, t, 0.03);
        amp(voiceAmp.gain, ph.a ?? 0.5, t);
        amp(nAmp.gain, 0, t);
        t += ph.d;
      }
    }
    amp(voiceAmp.gain, 0, t, 0.04);
    amp(nAmp.gain, 0, t, 0.02);
    const end = t + 0.3;
    // intonation: rise into the first stressed syllable, emphatic fall at the end
    for (const o of oscs) {
      const fq = o.frequency;
      fq.setValueAtTime(105, t0);
      fq.linearRampToValueAtTime(138, Math.max(t0 + 0.05, stressT + 0.08));
      fq.linearRampToValueAtTime(118, Math.max(stressT + 0.1, t - 0.25));
      fq.linearRampToValueAtTime(82, t + 0.05);
      // light vibrato
      const vib = c.createOscillator(); vib.frequency.value = 5.2; const vg = c.createGain(); vg.gain.value = 9;
      vib.connect(vg).connect(o.detune); vib.start(t0); vib.stop(end);
      o.start(t0); o.stop(end);
    }
    nsrc.start(t0, Math.random()); nsrc.stop(end);
    setTimeout(() => { try { out.disconnect(); send.disconnect(); pres.disconnect(); } catch {} }, (end - c.currentTime + 2.5) * 1000);
    return { dur: end - t0 };
  }

  _hookUiClicks() {
    document.addEventListener('click', (e) => {
      const el = e.target?.closest?.('button, [data-sfx], .btn, .clickable, [role="button"], .shop-item, .item-slot, .ability-slot');
      if (!el || el.dataset?.sfx === 'none') return;
      if (el.closest?.('#game-canvas')) return;
      this.play(el.dataset?.sfx || 'ui_click');
    }, true);
  }
}

function clamp01(v) { return Math.max(0, Math.min(1, Number(v) || 0)); }

function classifyAbility(d) {
  const s = `${d.id ?? ''} ${d.name ?? ''} ${d.element ?? ''} ${d.vfx ?? ''}`.toLowerCase();
  for (const [name, re] of ABILITY_KEYWORDS) if (re.test(s)) return name;
  if (d.damageType === 'magical') return 'cast_generic';
  return 'cast_generic';
}

// ---------------------------------------------------------------------- procedural sound bank
// Each: (audioSystem, destinationNode, startTime, rate) -> {dur}
const SYNTH = {
  swing(a, d, t, r) {
    a.noise(d, t, 0.22, { type: 'bandpass', f0: 600 * r, f1: 2600 * r, q: 1.5, gain: 0.7, attack: 0.06 });
    return { dur: 0.25 };
  },
  hit(a, d, t, r) {
    a.tone(d, t, 0.15, { type: 'sine', f0: 160 * r, f1: 55, gain: 0.9 });
    a.noise(d, t, 0.1, { type: 'lowpass', f0: 2500 * r, f1: 400, gain: 0.6 });
    return { dur: 0.18 };
  },
  hitMetal(a, d, t, r) {
    a.noise(d, t, 0.08, { type: 'highpass', f0: 3000, gain: 0.5 });
    for (const f of [820, 1370, 2210]) a.tone(d, t, 0.35, { type: 'sine', f0: f * r, gain: 0.12 });
    a.tone(d, t, 0.12, { type: 'sine', f0: 140, f1: 60, gain: 0.5 });
    return { dur: 0.4 };
  },
  hitSoft(a, d, t, r) {
    a.noise(d, t, 0.12, { type: 'lowpass', f0: 1200 * r, f1: 200, gain: 0.7 });
    a.tone(d, t, 0.1, { type: 'sine', f0: 110 * r, f1: 50, gain: 0.5 });
    return { dur: 0.15 };
  },
  hitWood(a, d, t, r) {
    a.noise(d, t, 0.12, { type: 'bandpass', f0: 700 * r, q: 3, gain: 0.8 });
    a.tone(d, t, 0.2, { type: 'triangle', f0: 190 * r, f1: 120, gain: 0.6 });
    return { dur: 0.22 };
  },
  crit(a, d, t, r) {
    SYNTH.hit(a, d, t, r * 0.8);
    a.noise(d, t, 0.3, { type: 'bandpass', f0: 3000, f1: 900, q: 2, gain: 0.5 });
    a.tone(d, t, 0.3, { type: 'square', f0: 90, f1: 40, gain: 0.35 });
    return { dur: 0.35 };
  },
  bow(a, d, t, r) {
    a.tone(d, t, 0.18, { type: 'triangle', f0: 320 * r, f1: 180 * r, gain: 0.5 });
    a.noise(d, t + 0.01, 0.2, { type: 'bandpass', f0: 3000 * r, f1: 1200, q: 2, gain: 0.35, attack: 0.02 });
    return { dur: 0.22 };
  },
  magicShot(a, d, t, r) {
    a.tone(d, t, 0.25, { type: 'sine', f0: 900 * r, f1: 300 * r, gain: 0.4 });
    a.tone(d, t, 0.2, { type: 'triangle', f0: 1400 * r, f1: 700 * r, gain: 0.15, detune: 12 });
    a.noise(d, t, 0.2, { type: 'bandpass', f0: 4000, f1: 1500, q: 3, gain: 0.2 });
    return { dur: 0.28 };
  },
  catapult(a, d, t, r) {
    a.tone(d, t, 0.3, { type: 'sine', f0: 90 * r, f1: 40, gain: 0.8 });
    a.noise(d, t, 0.35, { type: 'lowpass', f0: 900, f1: 200, gain: 0.5 });
    return { dur: 0.4 };
  },
  towerZap(a, d, t, r) {
    a.tone(d, t, 0.35, { type: 'sawtooth', f0: 220 * r, f1: 80, gain: 0.3 });
    a.tone(d, t, 0.25, { type: 'sine', f0: 1200 * r, f1: 400, gain: 0.3 });
    a.noise(d, t, 0.3, { type: 'bandpass', f0: 2500, f1: 600, q: 2, gain: 0.35 });
    return { dur: 0.4 };
  },
  creepDeath(a, d, t, r) {
    a.tone(d, t, 0.45, { type: 'sawtooth', f0: 180 * r, f1: 70 * r, gain: 0.25, attack: 0.02 });
    a.noise(d, t, 0.3, { type: 'lowpass', f0: 800, f1: 150, gain: 0.35 });
    return { dur: 0.5 };
  },
  heroDeath(a, d, t) {
    for (const [f, g] of [[98, 0.5], [146.8, 0.3], [196, 0.25], [233, 0.15]]) a.tone(d, t, 2.5, { type: 'sine', f0: f, f1: f * 0.94, gain: g, attack: 0.01 });
    a.noise(d, t, 0.6, { type: 'lowpass', f0: 600, f1: 80, gain: 0.5 });
    return { dur: 2.6 };
  },
  explosion(a, d, t, r) {
    a.noise(d, t, 0.9, { type: 'lowpass', f0: 3000 * r, f1: 120, gain: 1 });
    a.tone(d, t, 0.6, { type: 'sine', f0: 80 * r, f1: 28, gain: 0.9 });
    return { dur: 1 };
  },
  bigExplosion(a, d, t, r) {
    a.noise(d, t, 2.4, { type: 'lowpass', f0: 2400 * r, f1: 60, gain: 1, attack: 0.01 });
    a.tone(d, t, 1.6, { type: 'sine', f0: 60, f1: 22, gain: 1 });
    a.noise(d, t + 0.25, 1.8, { type: 'bandpass', f0: 1200, f1: 300, q: 0.8, gain: 0.4, attack: 0.1 }); // rubble
    return { dur: 2.5 };
  },
  fire(a, d, t, r) {
    a.noise(d, t, 0.8, { type: 'bandpass', f0: 400 * r, f1: 1800 * r, q: 0.8, gain: 0.8, attack: 0.08 });
    for (let i = 0; i < 6; i++) a.noise(d, t + Math.random() * 0.6, 0.03, { type: 'highpass', f0: 3000, gain: 0.3 });
    return { dur: 0.9 };
  },
  ice(a, d, t, r) {
    for (const f of [1760, 2349, 2637, 3520]) a.tone(d, t + Math.random() * 0.08, 0.9, { type: 'sine', f0: f * r, gain: 0.12 });
    a.noise(d, t, 0.5, { type: 'highpass', f0: 5000, f1: 2500, gain: 0.35 });
    return { dur: 1 };
  },
  lightning(a, d, t, r) {
    a.noise(d, t, 0.5, { type: 'highpass', f0: 1500, gain: 0.8, attack: 0.002 });
    for (let i = 0; i < 5; i++) a.tone(d, t + i * 0.05, 0.05, { type: 'square', f0: (300 + Math.random() * 900) * r, gain: 0.2 });
    a.tone(d, t + 0.05, 0.8, { type: 'sine', f0: 70, f1: 35, gain: 0.6 });
    return { dur: 0.9 };
  },
  holy(a, d, t, r) {
    [523, 659, 784, 1047].forEach((f, i) => a.tone(d, t + i * 0.06, 1.1, { type: 'sine', f0: f * r, gain: 0.18, attack: 0.05 }));
    a.noise(d, t, 0.8, { type: 'highpass', f0: 6000, gain: 0.08, attack: 0.2 });
    return { dur: 1.3 };
  },
  poison(a, d, t, r) {
    for (let i = 0; i < 5; i++) a.tone(d, t + i * 0.07, 0.12, { type: 'sine', f0: (200 + Math.random() * 300) * r, f1: 600, gain: 0.25 });
    a.noise(d, t, 0.6, { type: 'bandpass', f0: 500, f1: 900, q: 3, gain: 0.35 });
    return { dur: 0.7 };
  },
  dark(a, d, t, r) {
    a.tone(d, t, 0.7, { type: 'sawtooth', f0: 110 * r, f1: 55, gain: 0.25, attack: 0.05 });
    a.noise(d, t, 0.6, { type: 'bandpass', f0: 3000, f1: 200, q: 2, gain: 0.5, attack: 0.1 });
    return { dur: 0.8 };
  },
  earth(a, d, t, r) {
    a.tone(d, t, 0.6, { type: 'sine', f0: 70 * r, f1: 30, gain: 1 });
    a.noise(d, t, 0.7, { type: 'lowpass', f0: 1500, f1: 100, gain: 0.8 });
    return { dur: 0.8 };
  },
  cast(a, d, t, r) {
    a.noise(d, t, 0.45, { type: 'bandpass', f0: 500 * r, f1: 3000 * r, q: 2, gain: 0.5, attack: 0.1 });
    a.tone(d, t, 0.5, { type: 'triangle', f0: 440 * r, f1: 880 * r, gain: 0.18, attack: 0.05 });
    return { dur: 0.55 };
  },
  ultBoom(a, d, t) {
    a.tone(d, t, 1.4, { type: 'sine', f0: 55, f1: 30, gain: 0.9 });
    a.noise(d, t, 1.2, { type: 'lowpass', f0: 1500, f1: 80, gain: 0.5, attack: 0.02 });
    a.brass(d, t, 1.2, [110, 164.8], 0.12, 900);
    return { dur: 1.5 };
  },
  coin(a, d, t, r) {
    a.tone(d, t, 0.12, { type: 'square', f0: 1318 * r, gain: 0.12 });
    a.tone(d, t + 0.07, 0.35, { type: 'square', f0: 1760 * r, gain: 0.12 });
    return { dur: 0.45 };
  },
  buy(a, d, t, r) {
    SYNTH.coin(a, d, t, r);
    a.tone(d, t + 0.12, 0.5, { type: 'sine', f0: 2093, gain: 0.15 });
    return { dur: 0.7 };
  },
  levelUp(a, d, t) {
    [523.3, 659.3, 784, 1046.5].forEach((f, i) => a.tone(d, t + i * 0.09, 0.9, { type: 'triangle', f0: f, gain: 0.28, attack: 0.01 }));
    a.noise(d, t, 1, { type: 'highpass', f0: 7000, gain: 0.08, attack: 0.3 });
    return { dur: 1.3 };
  },
  learn(a, d, t) {
    a.tone(d, t, 0.2, { type: 'triangle', f0: 880, gain: 0.25 });
    a.tone(d, t + 0.08, 0.3, { type: 'triangle', f0: 1318, gain: 0.25 });
    return { dur: 0.4 };
  },
  itemUse(a, d, t, r) {
    a.tone(d, t, 0.3, { type: 'sine', f0: 600 * r, f1: 1200 * r, gain: 0.25 });
    a.noise(d, t, 0.25, { type: 'bandpass', f0: 2000, q: 2, gain: 0.2 });
    return { dur: 0.35 };
  },
  teleport(a, d, t) {
    a.tone(d, t, 2.5, { type: 'sine', f0: 220, f1: 880, gain: 0.3, attack: 0.3 });
    a.tone(d, t, 2.5, { type: 'sine', f0: 330, f1: 1320, gain: 0.15, attack: 0.3, detune: 10 });
    a.noise(d, t, 2.5, { type: 'bandpass', f0: 500, f1: 5000, q: 3, gain: 0.2, attack: 0.5 });
    return { dur: 2.6 };
  },
  respawn(a, d, t) {
    [392, 523, 659].forEach((f, i) => a.tone(d, t + i * 0.12, 1, { type: 'sine', f0: f, gain: 0.25 }));
    return { dur: 1.3 };
  },
  click(a, d, t, r) {
    a.tone(d, t, 0.05, { type: 'square', f0: 1800 * r, f1: 900, gain: 0.15 });
    return { dur: 0.06 };
  },
  error(a, d, t) {
    a.tone(d, t, 0.12, { type: 'square', f0: 200, gain: 0.18 });
    a.tone(d, t + 0.13, 0.15, { type: 'square', f0: 160, gain: 0.18 });
    return { dur: 0.3 };
  },
  ping(a, d, t) {
    a.tone(d, t, 0.6, { type: 'sine', f0: 1046, gain: 0.35 });
    a.tone(d, t + 0.12, 0.7, { type: 'sine', f0: 1318, gain: 0.3 });
    return { dur: 0.9 };
  },
  order(a, d, t) {
    a.tone(d, t, 0.03, { type: 'sine', f0: 2400, f1: 1800, gain: 0.2 });
    return { dur: 0.04 };
  },
  roar(a, d, t, r) {
    a.tone(d, t, 1.2, { type: 'sawtooth', f0: 70 * r, f1: 45, gain: 0.5, attack: 0.08 });
    a.noise(d, t, 1.2, { type: 'bandpass', f0: 500, f1: 250, q: 1.2, gain: 0.8, attack: 0.1 });
    return { dur: 1.3 };
  },
  gunshot(a, d, t, r) {
    a.noise(d, t, 0.08, { type: 'highpass', f0: 1200 * r, gain: 1, attack: 0.001 });
    a.noise(d, t, 0.35, { type: 'lowpass', f0: 1800 * r, f1: 150, gain: 0.8, attack: 0.002 });
    a.tone(d, t, 0.18, { type: 'sine', f0: 140 * r, f1: 45, gain: 0.8, attack: 0.001 });
    return { dur: 0.4 };
  },
  fireBolt(a, d, t, r) {
    a.noise(d, t, 0.3, { type: 'bandpass', f0: 700 * r, f1: 2200 * r, q: 0.9, gain: 0.7, attack: 0.03 });
    a.tone(d, t, 0.25, { type: 'sawtooth', f0: 180 * r, f1: 90, gain: 0.12, attack: 0.02 });
    return { dur: 0.32 };
  },
  iceBolt(a, d, t, r) {
    a.tone(d, t, 0.3, { type: 'sine', f0: 2200 * r, f1: 1400 * r, gain: 0.18 });
    a.tone(d, t + 0.02, 0.25, { type: 'sine', f0: 3100 * r, f1: 2600 * r, gain: 0.1 });
    a.noise(d, t, 0.25, { type: 'highpass', f0: 4500, f1: 2500, gain: 0.3, attack: 0.02 });
    return { dur: 0.32 };
  },
  zap(a, d, t, r) {
    for (let i = 0; i < 3; i++) a.tone(d, t + i * 0.03, 0.05, { type: 'square', f0: (700 + Math.random() * 900) * r, gain: 0.16 });
    a.noise(d, t, 0.22, { type: 'highpass', f0: 2500, gain: 0.45, attack: 0.002 });
    return { dur: 0.25 };
  },
  darkBolt(a, d, t, r) {
    a.tone(d, t, 0.35, { type: 'sawtooth', f0: 160 * r, f1: 70, gain: 0.2, attack: 0.03 });
    a.noise(d, t, 0.3, { type: 'bandpass', f0: 1800, f1: 400, q: 2.5, gain: 0.45, attack: 0.04 });
    return { dur: 0.38 };
  },
  towerLost(a, d, t) {
    a.brass(d, t, 0.5, [196, 233, 293.7], 0.2, 1400);
    a.brass(d, t + 0.45, 1.2, [174.6, 207.6, 261.6], 0.2, 1100);
    return { dur: 1.7 };
  },
  announce(a, d, t) {
    a.tone(d, t, 0.8, { type: 'triangle', f0: 587, gain: 0.12, attack: 0.01 });
    a.tone(d, t + 0.08, 1, { type: 'triangle', f0: 880, gain: 0.1, attack: 0.01 });
    return { dur: 1.1 };
  },
  // Fallbacks for voice clips (only used if the ogg files are missing): formant-ish grunts
  voiceGrunt(a, d, t, r) {
    const c = a.ctx, o = c.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(150 * r, t); o.frequency.exponentialRampToValueAtTime(95 * r, t + 0.3);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    for (const [f, q] of [[700, 6], [1150, 8], [2500, 10]]) { const b = c.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f * r; b.Q.value = q; o.connect(b).connect(g); }
    g.connect(d); o.start(t); o.stop(t + 0.35);
    return { dur: 0.35 };
  },
  voiceDeath(a, d, t, r) {
    const c = a.ctx, o = c.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(170 * r, t); o.frequency.exponentialRampToValueAtTime(70 * r, t + 0.9);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.95);
    for (const [f, q] of [[750, 6], [1100, 8], [2450, 10]]) { const b = c.createBiquadFilter(); b.type = 'bandpass'; b.frequency.setValueAtTime(f * r, t); b.frequency.linearRampToValueAtTime(f * 0.7 * r, t + 0.9); b.Q.value = q; o.connect(b).connect(g); }
    g.connect(d); o.start(t); o.stop(t + 1);
    return { dur: 1 };
  },
  horn(a, d, t) {
    // war horn: low fifth swelling, then a higher call
    a.brass(d, t, 2.2, [87.3, 130.8, 174.6], 0.3, 1200);
    a.brass(d, t + 1.6, 2.0, [98, 146.8, 196], 0.28, 1500);
    a.tone(d, t, 3.6, { type: 'sine', f0: 43.6, gain: 0.4, attack: 0.4 });
    return { dur: 3.8 };
  },
  chime(a, d, t) {
    [659, 988, 1318].forEach((f, i) => a.tone(d, t + i * 0.15, 1.8, { type: 'sine', f0: f, gain: 0.2 }));
    return { dur: 2.2 };
  },
  firstBlood(a, d, t) {
    a.brass(d, t, 0.35, [146.8, 220, 293.7], 0.3, 2400);
    a.brass(d, t + 0.4, 1.6, [155.6, 233, 311], 0.32, 2600);
    a.tone(d, t, 1.8, { type: 'sine', f0: 49, gain: 0.6, attack: 0.02 });
    a.noise(d, t, 0.6, { type: 'lowpass', f0: 2000, f1: 100, gain: 0.5 });
    return { dur: 2.1 };
  },
  killSting(a, d, t) {
    a.brass(d, t, 0.8, [220, 277, 330], 0.2, 2200);
    return { dur: 0.9 };
  },
  streak(a, d, t) {
    [0, 0.18, 0.36].forEach((o, i) => a.brass(d, t + o, i === 2 ? 1.4 : 0.2, [196 * Math.pow(1.122, i), 293.7 * Math.pow(1.122, i)], 0.25, 2600));
    return { dur: 1.9 };
  },
  victory(a, d, t) {
    const seq = [[261.6, 329.6, 392], [293.7, 370, 440], [329.6, 415.3, 493.9], [392, 493.9, 587.3, 784]];
    seq.forEach((ch, i) => a.brass(d, t + i * 0.45, i === 3 ? 3.5 : 0.5, ch, 0.22, 2800));
    [523, 659, 784, 1047].forEach((f, i) => a.tone(d, t + 1.35 + i * 0.08, 3, { type: 'sine', f0: f, gain: 0.12 }));
    a.tone(d, t + 1.35, 3.5, { type: 'sine', f0: 65.4, gain: 0.5, attack: 0.05 });
    return { dur: 5 };
  },
  defeat(a, d, t) {
    const seq = [[220, 261.6, 329.6], [207.6, 246.9, 311], [174.6, 207.6, 261.6], [146.8, 174.6, 220]];
    seq.forEach((ch, i) => a.brass(d, t + i * 0.7, i === 3 ? 3.5 : 0.75, ch, 0.2, 1300));
    a.tone(d, t + 2.1, 3.5, { type: 'sine', f0: 36.7, gain: 0.5, attack: 0.3 });
    return { dur: 5.8 };
  },
};
