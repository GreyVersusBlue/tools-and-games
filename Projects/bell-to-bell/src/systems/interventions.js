import { CFG } from '../config.js';
import { applyEffects } from '../state.js';

// Seeing is the setup. This is the game.
export function createInterventions({ data, students, tellSystem, toast, react }) {

  function optionsFor(type) {
    const byType = data.byType[type];
    return (byType && byType.options) || data.defaultOptions;
  }

  // Merge the base option with any per-tell-type override.
  function resolveSpec(type, key) {
    const base = data.options[key];
    const over = data.byType[type]?.overrides?.[key];
    return over ? { ...base, ...over } : base;
  }

  function buildMenu(t, camera) {
    const def = tellSystem.defs[t.type];
    const student = students[t.seat];
    const near = Math.hypot(
      camera.position.x - student.x,
      camera.position.z - student.z
    ) < CFG.proximityRange;

    const header = def.menuHeader || `Indicator ${def.indicator} — ${def.name}`;
    const items = optionsFor(t.type).map(key => {
      const spec = resolveSpec(t.type, key);
      const blocked = spec.requiresProximity && !near;
      return {
        key,
        label: spec.label,
        blurb: blocked
          ? (spec.blurbBlocked || '').replace('{range}', CFG.proximityRange)
          : spec.blurb,
        enabled: !blocked
      };
    });
    return { header, body: tellSystem.describe(t), items };
  }

  function apply(state, t, key) {
    const spec = resolveSpec(t.type, key);
    const student = students[t.seat];
    t.resolved = true;
    tellSystem.kill(t);
    state.caught++;
    let reaction = spec.reaction ?? null;
    let escalated = false;
    if (tellSystem.defs[t.type].curveball) state.sawCurveball = true;

    // coinflip options (Let It Go) branch into two outcomes
    let effects = spec.effects, msg = spec.toast;
    if (spec.coinflip != null && spec.elseEffects) {
      const hit = Math.random() < spec.coinflip;
      effects = hit ? spec.effects : spec.elseEffects;
      msg = hit ? spec.toast : spec.elseToast;
    }

    applyEffects(state, effects);

    // escalation: a public callout on a kid who is already at the edge
    const esc = spec.escalation;
    if (esc && student.tension > esc.tensionAbove) {
      applyEffects(state, esc.effects);
      msg = esc.toast;
      escalated = true;
      if (esc.reaction) reaction = esc.reaction;
    }

    // T1: the room does something visible about it.
    react?.({ seat: t.seat, seat2: t.seat2, reaction, reactRoom: !!spec.reactRoom,
              escalated, option: key, type: t.type });

    if (spec.leverage) {
      state.leverage.push(spec.leverage
        .replace('{name}', student.name)
        .replace('{descriptor}', tellSystem.defs[t.type].descriptor.toLowerCase()));
    }

    if (msg) toast(msg.kind, msg.title, (msg.body || '').replace('{name}', student.name));
  }

  return { buildMenu, apply };
}
