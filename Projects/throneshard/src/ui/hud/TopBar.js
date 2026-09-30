import { el, esc, fmtTime, setText, setStyle, toggleClass } from '../util.js';
import { simpleTooltip } from '../Tooltip.js';

export class TopBar {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.node = el('div', 'hud-top', `
      <div class="tb-side tb-sunward"><div class="tb-heroes"></div></div>
      <div class="tb-center">
        <div class="tb-score rad"><b>0</b></div>
        <div class="tb-clock">
          <div class="tb-daynight"><i class="dn-sun"></i><i class="dn-moon"></i></div>
          <div class="tb-time">0:00</div>
          <div class="tb-dn-bar"><i></i></div>
        </div>
        <div class="tb-score duskward"><b>0</b></div>
      </div>
      <div class="tb-side tb-duskward"><div class="tb-heroes"></div></div>`);
    this.time = this.node.querySelector('.tb-time');
    this.clock = this.node.querySelector('.tb-clock');
    this.dnBar = this.node.querySelector('.tb-dn-bar i');
    this.scoreR = this.node.querySelector('.tb-score.rad b');
    this.scoreD = this.node.querySelector('.tb-score.duskward b');
    this.slots = [];
    ui.tooltip.attach(this.clock, () => {
      const night = ui.isNight();
      return simpleTooltip(night ? 'Night' : 'Day', `${night ? 'Night' : 'Day'} ends in ${fmtTime(ui.dayNightRemaining())}. Most heroes have reduced vision at night.`);
    }, 'bottom');
  }

  build() {
    const g = this.game;
    this.slots = [];
    for (const team of ['sunward', 'duskward']) {
      const wrap = this.node.querySelector(`.tb-${team} .tb-heroes`);
      wrap.innerHTML = '';
      const heroes = g.heroes.filter((h) => h.team === team).slice(0, 5);
      heroes.forEach((h) => {
        const s = el('div', `tb-hero ${h === g.player.hero ? 'me' : ''}`, `
          ${this.ui.portraits.html(h.heroId, 'tb-pt')}
          <div class="tb-dead"><span></span></div>
          <div class="tb-lvl">1</div>
          <div class="tb-hp"><i></i></div>
          <div class="tb-ult"></div>`);
        s.addEventListener('click', () => {
          if (h.alive) this.game.cameraCtl?.focus?.(h.position.x, h.position.z);
        });
        this.ui.tooltip.attach(s, () => simpleTooltip(h.name, `Level ${h.level} · ${h.kills}/${h.deaths}/${h.assists}${h.isBot ? ' · Bot' : ' · You'}`), 'bottom');
        wrap.appendChild(s);
        this.slots.push({ h, s, dead: s.querySelector('.tb-dead'), deadT: s.querySelector('.tb-dead span'), lvl: s.querySelector('.tb-lvl'), hp: s.querySelector('.tb-hp i'), ult: s.querySelector('.tb-ult') });
      });
    }
  }

  update() {
    const g = this.game, ui = this.ui;
    setText(this.time, fmtTime(g.time));
    const night = ui.isNight();
    toggleClass(this.clock, 'night', night);
    toggleClass(this.clock, 'pre', g.time < 0);
    setStyle(this.dnBar, 'width', (100 * (1 - ui.dayNightRemaining() / ui.dayLength())).toFixed(1) + '%');
    const sc = g.rules?.score ?? { sunward: 0, duskward: 0 };
    setText(this.scoreR, String(sc.sunward ?? 0));
    setText(this.scoreD, String(sc.duskward ?? 0));
    const team = g.player.team;
    for (const sl of this.slots) {
      const h = sl.h;
      toggleClass(sl.s, 'is-dead', !h.alive);
      if (!h.alive) setText(sl.deadT, String(Math.max(0, Math.ceil(h.respawnTimer))));
      setText(sl.lvl, String(h.level));
      const visible = h.team === team || g.canSee(team, h);
      setStyle(sl.hp, 'width', (h.alive && visible ? h.healthPct * 100 : 0).toFixed(0) + '%');
      toggleClass(sl.s, 'fogged', !visible && h.alive);
      const ult = h.abilities?.[3];
      const ultReady = h.team === team && ult && ult.level > 0 && !(ult.cooldownRemaining > 0);
      toggleClass(sl.ult, 'on', !!ultReady);
    }
  }
}

