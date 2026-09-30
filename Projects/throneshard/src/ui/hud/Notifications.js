import { el, esc, TEAM_NAME } from '../util.js';

const MULTI = { 2: 'Double Kill', 3: 'Triple Kill', 4: 'Quad Kill', 5: 'Massacre!' };
const STREAK = { 3: 'Killing Spree', 4: 'Dominating', 5: 'Relentless', 6: 'Unstoppable', 7: 'Merciless', 8: 'Ruthless', 9: 'Legendary', 10: 'Mythic' };

export class Notifications {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.feed = el('div', 'hud-killfeed');
    this.announcer = el('div', 'hud-announcer');
    this.errorEl = el('div', 'hud-error');
    this.msgs = el('div', 'hud-messages');
    this.chatEl = el('div', 'hud-chat');
    this.queue = [];
    this.current = null;
    this.streaks = new Map(); // hero -> kills since last death
    this.multi = new Map(); // hero -> { count, last }
    this.lastErr = { text: '', t: 0 };
  }

  mount(parent) {
    for (const n of [this.feed, this.announcer, this.errorEl, this.msgs, this.chatEl]) parent.appendChild(n);
  }

  // ---- announcer ----
  // voice: optional announcer line key (AudioSystem.announce) voiced when the banner appears
  announce(title, sub = '', cls = '', dur = 2.6, voice = null) {
    this.queue.push({ title, sub, cls, dur, voice });
    if (this.queue.length > 4) this.queue.splice(1, 1);
  }

  update(dt) {
    if (this.current) {
      this.current.t -= dt;
      if (this.current.t <= 0) {
        this.current.node.classList.add('out');
        const n = this.current.node;
        setTimeout(() => n.remove(), 450);
        this.current = null;
      }
    }
    if (!this.current && this.queue.length) {
      const a = this.queue.shift();
      const n = el('div', `ann ${a.cls}`, `<div class="ann-t">${esc(a.title)}</div>${a.sub ? `<div class="ann-s">${a.sub}</div>` : ''}`);
      this.announcer.appendChild(n);
      this.current = { node: n, t: a.dur };
      if (a.voice) this.game.bus.emit('announcer', { line: a.voice });
      else this.ui.sfx('announce');
    }
  }

  // ---- kill feed ----
  onHeroKilled({ victim, killer, killerHero, assists, firstBlood }) {
    const g = this.game, ui = this.ui;
    const t = g.time;
    // own streak bookkeeping (independent of Rules ordering)
    const victimStreak = this.streaks.get(victim) ?? 0;
    this.streaks.set(victim, 0);
    const denied = killer && killer.team === victim.team;
    if (killerHero && !denied) {
      const s = (this.streaks.get(killerHero) ?? 0) + 1;
      this.streaks.set(killerHero, s);
      const m = this.multi.get(killerHero);
      const cnt = m && t - m.last < 18 ? m.count + 1 : 1;
      this.multi.set(killerHero, { count: cnt, last: t });
      const who = `<b class="t-${killerHero.team}">${esc(killerHero.name)}</b>`;
      const key = (t) => t.toLowerCase().replace(/[^a-z ]/g, '').trim().replace(/ /g, '_');
      if (firstBlood) this.announce('First Blood!', `${who} drew first blood on <b class="t-${victim.team}">${esc(victim.name)}</b>`, 'red big', 2.6, 'first_blood');
      else if (cnt >= 2) this.announce(MULTI[Math.min(5, cnt)], who, 'gold', 2.6, key(MULTI[Math.min(5, cnt)]));
      else if (s >= 3) this.announce(STREAK[Math.min(10, s)], who, 'purple', 2.6, key(STREAK[Math.min(10, s)]));
      if (victimStreak >= 3) this.announce('Shutdown!', `${who} ended <b class="t-${victim.team}">${esc(victim.name)}</b>'s streak`, 'gold', 2.6, 'shutdown');
    }
    const killerHTML = killerHero ? ui.portraits.html(killerHero.heroId, 'kf-pt')
      : `<div class="kf-unit t-${killer?.team ?? 'neutral'}">${killer?.kind === 'tower' ? '♜' : killer?.kind === 'grimmaw' ? '🐲' : killer?.kind === 'neutral' ? '🐾' : '⚔'}</div>`;
    const kTeam = killerHero?.team ?? killer?.team ?? 'neutral';
    const n = el('div', `kf ${victim.team === g.player.team ? 'bad' : 'good'} ${denied ? 'deny' : ''}`, `
      <div class="kf-side t-${kTeam}">${killerHTML}${assists?.length ? `<span class="kf-as">+${assists.length}</span>` : ''}</div>
      <div class="kf-mid">${denied ? '✖' : '⚔'}</div>
      <div class="kf-side t-${victim.team}">${ui.portraits.html(victim.heroId, 'kf-pt')}</div>`);
    this.feed.prepend(n);
    while (this.feed.children.length > 6) this.feed.lastElementChild.remove();
    setTimeout(() => { n.classList.add('out'); setTimeout(() => n.remove(), 500); }, 9000);
    if (victim === g.player.hero) this.message(`You were killed by ${killerHero?.name ?? killer?.name ?? 'the enemy'}`, '#ff8a70', 3);
    else if (killerHero === g.player.hero && !denied) this.message(`You killed ${victim.name}!`, '#9dff7a', 2.5);
  }

  onBuilding({ unit }) {
    const team = TEAM_NAME[unit.team] ?? unit.team;
    let what = 'Structure';
    if (unit.kind === 'tower') what = `Tower${unit.subtype ? ` (Tier ${unit.subtype})` : ''}`;
    else if (/barracks_melee/.test(unit.subtype)) what = 'Melee Barracks';
    else if (/barracks_ranged/.test(unit.subtype)) what = 'Ranged Barracks';
    else if (unit.subtype === 'throneshard') what = 'Throneshard';
    else if (unit.subtype) what = String(unit.subtype).replace(/_/g, ' ');
    const ours = unit.team === this.game.player.team;
    this.announce(`${team} ${what} Destroyed`, ours ? 'Your structure has fallen' : 'Your team destroyed an enemy structure', ours ? 'red' : 'green', 2.4);
  }

  // ---- red error text above HUD ----
  error(text) {
    if (!text) return;
    const now = performance.now();
    if (text === this.lastErr.text && now - this.lastErr.t < 700) return;
    this.lastErr = { text, t: now };
    this.errorEl.textContent = text;
    this.errorEl.classList.remove('show');
    void this.errorEl.offsetWidth;
    this.errorEl.classList.add('show');
    clearTimeout(this._errT);
    this._errT = setTimeout(() => this.errorEl.classList.remove('show'), 2200);
    this.ui.sfx('error');
  }

  // ---- center messages ----
  message(text, color = '#ffe08a', dur = 3) {
    const n = el('div', 'msg', esc(text));
    n.style.color = color;
    this.msgs.appendChild(n);
    while (this.msgs.children.length > 4) this.msgs.firstElementChild.remove();
    setTimeout(() => { n.classList.add('out'); setTimeout(() => n.remove(), 500); }, dur * 1000);
  }

  chat(text, who = null) {
    const g = this.game;
    const n = el('div', 'chat-line', `<b class="t-${g.player.team}">${esc(who ?? g.player.hero?.name ?? 'You')}:</b> ${esc(text)}`);
    this.chatEl.appendChild(n);
    while (this.chatEl.children.length > 6) this.chatEl.firstElementChild.remove();
    setTimeout(() => { n.classList.add('out'); setTimeout(() => n.remove(), 600); }, 7000);
  }
}
