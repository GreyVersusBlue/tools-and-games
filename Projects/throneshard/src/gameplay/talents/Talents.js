import { TALENT_TIERS, talentTree } from './TalentDefs.js';

// Talent tree logic (game.talents). A hero may pick one of two talents per tier once its level reaches the tier and it
// has an unspent ability point; the pick costs that point. Effects are data-driven (see TalentDefs.js) and read by
// Hero.bonusFromSources (hero.talentBonus) and Ability.v/getCooldown/... (hero.talentMods).
// API: tree(hero) -> {tier: [opt, opt]}, canChoose(hero, tier, idx) -> {ok, reason}, choose(hero, tier, idx),
//      available(hero) -> tiers that can be picked now, notesFor(ability) -> tooltip text, botChoose(hero).
// Events: talent:chosen {hero, tier, index, talent}.
export class Talents {
  constructor(game) {
    this.game = game;
    this.tiers = TALENT_TIERS;
  }

  tree(hero) { return talentTree(hero?.heroId); }

  canChoose(hero, tier, idx) {
    if (!hero || hero.kind !== 'hero') return { ok: false, reason: 'No hero' };
    const opts = this.tree(hero)[tier];
    if (!opts?.[idx]) return { ok: false, reason: 'Unknown talent' };
    if (hero.talents?.[tier] != null) return { ok: false, reason: 'Talent already chosen' };
    if (hero.level < tier) return { ok: false, reason: `Requires level ${tier}` };
    if (!(hero.abilityPoints > 0)) return { ok: false, reason: 'No ability points' };
    return { ok: true };
  }

  available(hero) {
    if (!hero || !(hero.abilityPoints > 0)) return [];
    return this.tiers.filter((t) => hero.level >= t && hero.talents?.[t] == null);
  }

  choose(hero, tier, idx) {
    const chk = this.canChoose(hero, tier, idx);
    if (!chk.ok) return chk;
    const talent = this.tree(hero)[tier][idx];
    hero.talents[tier] = idx;
    hero.abilityPoints--;
    this.apply(hero, talent);
    this.game.bus.emit('talent:chosen', { hero, tier, index: idx, talent });
    if (hero === this.game.player?.hero) this.game.audio?.play?.('learn');
    return { ok: true, talent };
  }

  apply(hero, t) {
    hero.talentBonus ??= {};
    hero.talentMods ??= {};
    for (const [k, v] of Object.entries(t.bonus ?? {})) hero.talentBonus[k] = (hero.talentBonus[k] ?? 0) + v;
    if (t.ability) {
      const m = (hero.talentMods[t.ability] ??= {});
      for (const [k, v] of Object.entries(t.values ?? {})) m[k] = (m[k] ?? 0) + v;
      for (const k of ['cooldown', 'manaCost', 'castRange', 'radius']) if (t[k]) m[k] = (m[k] ?? 0) + t[k];
    }
    // Passive modifiers may have captured values at creation — rebuild them.
    for (const ab of hero.abilities ?? []) { try { ab?.refreshPassive?.(true); } catch { /* ignore */ } }
    if (hero.talentBonus.maxHp || hero.talentBonus.str) hero.hp = Math.min(hero.hp, hero.getStat('maxHp'));
  }

  // Human-readable list of the learned talents that modify this ability (for tooltips).
  notesFor(ab) {
    const h = ab?.hero;
    if (!h?.talents) return '';
    const tree = this.tree(h);
    const out = [];
    for (const tier of this.tiers) {
      const i = h.talents[tier];
      if (i == null) continue;
      const t = tree[tier]?.[i];
      if (t?.ability === ab.def.id) out.push(t.name);
    }
    return out.join(', ');
  }

  // Bot choice: prefer talents that boost the hero's ultimate / damage abilities, then stats; small random factor.
  botChoose(hero) {
    for (const tier of this.available(hero)) {
      const opts = this.tree(hero)[tier];
      const score = (t) => {
        let s = Math.random() * 0.6;
        if (t.ability) {
          const ab = hero.abilities?.find((a) => a?.def.id === t.ability);
          if (ab?.def.ultimate) s += 1;
          if (ab && ab.def.targetType !== 'passive') s += 0.3;
          if (t.values?.damage || t.values?.dps) s += 0.4;
        }
        if (t.bonus?.damage || t.bonus?.attackSpeed || t.bonus?.agi || t.bonus?.str) s += hero.def?.primary === 'int' ? 0 : 0.5;
        return s;
      };
      const idx = score(opts[0]) >= score(opts[1]) ? 0 : 1;
      if (this.choose(hero, tier, idx).ok) return true;
    }
    return false;
  }
}
