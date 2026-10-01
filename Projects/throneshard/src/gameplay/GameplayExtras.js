import { Runes } from './runes/Runes.js';
import { Talents } from './talents/Talents.js';
import { WardVisuals } from './items/WardVisuals.js';

// Groups the gameplay subsystems added after the initial build so Game.js needs a single registration:
//   game.runes (power/bounty runes), game.talents (talent trees), ward vision rings.
export class GameplayExtras {
  constructor(game) {
    this.game = game;
    this.runes = game.runes = new Runes(game);
    this.talents = game.talents = new Talents(game);
    this.wardVisuals = new WardVisuals(game);
    this.parts = [this.runes, this.talents, this.wardVisuals];
  }

  async init() {
    for (const p of this.parts) {
      try { await p.init?.(); } catch (e) { console.error('[extras] init', p.constructor.name, e); }
    }
  }

  onMatchStart() {
    for (const p of this.parts) {
      try { p.onMatchStart?.(); } catch (e) { console.error('[extras] onMatchStart', p.constructor.name, e); }
    }
  }

  update(dt, rawDt) {
    for (const p of this.parts) {
      try { p.update?.(dt, rawDt); } catch (e) {
        if (!p._errLogged) { console.error('[extras] update', p.constructor.name, e); p._errLogged = true; }
      }
    }
  }
}
