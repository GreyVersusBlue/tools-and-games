// Minimal pub/sub. All cross-module notifications go through game.bus.
// Canonical events (payload shape in ARCHITECTURE.md):
//  match:start, match:end, unit:spawned, unit:damaged, unit:healed, unit:died, unit:attack, unit:attackLanded,
//  unit:order, hero:levelUp, hero:respawn, hero:gold, ability:cast, ability:learned, item:bought, item:sold,
//  item:used, projectile:launch, projectile:hit, building:destroyed, wave:spawn, ui:message, selection:changed
export class EventBus {
  constructor() {
    this.handlers = new Map();
  }
  on(event, fn) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event).add(fn);
    return () => this.off(event, fn);
  }
  once(event, fn) {
    const off = this.on(event, (p) => { off(); fn(p); });
    return off;
  }
  off(event, fn) {
    this.handlers.get(event)?.delete(fn);
  }
  emit(event, payload) {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const fn of [...set]) {
      try { fn(payload); } catch (e) { console.error(`[bus] handler for ${event} threw`, e); }
    }
  }
}
