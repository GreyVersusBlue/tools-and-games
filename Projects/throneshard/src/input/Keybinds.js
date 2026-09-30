// Rebindable hotkeys (persisted in localStorage 'throneshard.keybinds'). Values are KeyboardEvent.code strings.
// Used by Input (orders / casting), CameraController (center / lock) and the Settings screen (view + rebind).

export const KEYBIND_STORAGE = 'throneshard.keybinds';

// [action, default code, label, group]
export const KEYBIND_DEFS = [
  ['ability1', 'KeyQ', 'Ability 1', 'Abilities'],
  ['ability2', 'KeyW', 'Ability 2', 'Abilities'],
  ['ability3', 'KeyE', 'Ability 3', 'Abilities'],
  ['ability4', 'KeyR', 'Ultimate', 'Abilities'],
  ['ability5', 'KeyD', 'Ability 5 (extra)', 'Abilities'],
  ['ability6', 'KeyF', 'Ability 6 (extra)', 'Abilities'],
  ['item1', 'KeyZ', 'Item slot 1', 'Items'],
  ['item2', 'KeyX', 'Item slot 2', 'Items'],
  ['item3', 'KeyC', 'Item slot 3', 'Items'],
  ['item4', 'KeyV', 'Item slot 4', 'Items'],
  ['item5', 'KeyB', 'Item slot 5', 'Items'],
  ['item6', 'KeyN', 'Item slot 6', 'Items'],
  ['tp', 'KeyT', 'Teleport scroll', 'Items'],
  ['attack', 'KeyA', 'Attack-move', 'Unit orders'],
  ['stop', 'KeyS', 'Stop', 'Unit orders'],
  ['hold', 'KeyH', 'Hold position', 'Unit orders'],
  ['selectHero', 'F1', 'Select hero', 'Unit orders'],
  ['selectAll', 'F2', 'Select all units', 'Unit orders'],
  ['cameraCenter', 'Space', 'Center camera (hold to follow)', 'Camera'],
  ['cameraLock', 'KeyY', 'Toggle camera lock', 'Camera'],
];

// Keys the game reserves (not rebindable) — shown in the settings list for reference.
export const FIXED_KEYS = [
  ['Right click (hold)', 'Move / attack (hold to keep moving)'],
  ['Shift + order', 'Queue order'],
  ['Ctrl / Alt + ability key', 'Learn ability'],
  ['Alt + click', 'Ping'],
  ['Tab (hold)', 'Scoreboard'],
  ['F4', 'Shop'],
  ['F9', 'Pause'],
  ['F10 / Esc', 'Menu / cancel'],
  ['Arrows / screen edge / middle drag', 'Pan camera'],
];

const RESERVED = new Set(['Tab', 'F4', 'F9', 'F10', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
  'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight']);

export function keyLabel(code) {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  const map = { Space: 'Space', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', CapsLock: 'Caps', Enter: 'Enter', Backspace: 'Bksp' };
  return map[code] ?? code;
}

export class Keybinds {
  constructor() {
    this.defaults = Object.fromEntries(KEYBIND_DEFS.map(([a, c]) => [a, c]));
    this.map = { ...this.defaults };
    try {
      const saved = JSON.parse(localStorage.getItem(KEYBIND_STORAGE) || '{}');
      for (const [a, c] of Object.entries(saved)) if (a in this.defaults && typeof c === 'string') this.map[a] = c;
    } catch { /* ignore */ }
    this._rebuild();
    this.listeners = new Set();
  }
  _rebuild() {
    this.byCode = new Map();
    for (const [a, c] of Object.entries(this.map)) if (c) this.byCode.set(c, a);
  }
  _save() {
    const diff = {};
    for (const [a, c] of Object.entries(this.map)) if (c !== this.defaults[a]) diff[a] = c;
    try { localStorage.setItem(KEYBIND_STORAGE, JSON.stringify(diff)); } catch { /* ignore */ }
    this._rebuild();
    for (const fn of this.listeners) { try { fn(this.map); } catch { /* ignore */ } }
  }
  actionFor(code) { return this.byCode.get(code) ?? null; }
  codeFor(action) { return this.map[action] ?? null; }
  label(action) { return keyLabel(this.map[action]); }
  isReserved(code) { return RESERVED.has(code); }
  // Binds action to code. If another action used that code, it takes this action's old key (swap). Returns
  // {ok, swapped?: action, reason?}.
  set(action, code) {
    if (!(action in this.defaults)) return { ok: false, reason: 'Unknown action' };
    if (RESERVED.has(code)) return { ok: false, reason: `${keyLabel(code)} is reserved` };
    const prev = this.map[action];
    const other = this.byCode.get(code);
    this.map[action] = code;
    if (other && other !== action) this.map[other] = prev;
    this._save();
    return { ok: true, swapped: other && other !== action ? other : null };
  }
  reset(action) {
    if (action) return this.set(action, this.defaults[action]);
    this.map = { ...this.defaults };
    this._save();
    return { ok: true };
  }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
}
