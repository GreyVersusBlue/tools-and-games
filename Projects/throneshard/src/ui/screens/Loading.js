import { el } from '../util.js';

const STAGES = {
  UI: 'Preparing the interface',
  AudioSystem: 'Tuning the war drums',
  ModelFactory: 'Summoning heroes',
  World: 'Carving the battlefield',
  VFX: 'Channeling arcane energies',
  AbilitySystem: 'Inscribing spellbooks',
  ItemSystem: 'Stocking the shops',
  AIDirector: 'Waking the thrones',
  CameraController: 'Positioning the watchers',
  Input: 'Binding the hotkeys',
};

const TIPS = [
  'Last-hitting enemy creeps grants gold. Denying your own creeps starves your opponent of experience.',
  'Hold <b>Tab</b> to view the scoreboard at any time.',
  'Press <b>F4</b> to open the shop. Right-click an item to purchase it instantly.',
  'Towers deal heavy damage to heroes that attack while in range. Let your creeps tank the tower.',
  'Your fountain rapidly restores health and mana.',
  'Use <b>Ctrl + Q/W/E/R</b> to learn abilities when you have points to spend.',
  'Press <b>Space</b> to center the camera on your hero.',
  'Alt-click the minimap to ping a location for your allies.',
  "Grimmaw lurks in his lair by the river. Slaying him is a team effort, and his Sigil of Second Dawn brings its holder back from death once.",
  'Night falls every five minutes, reducing the vision of most heroes.',
  'Buying back is expensive, but it can win a desperate teamfight.',
  'Destroying the enemy Throneshard wins the game.',
];

export class LoadingScreen {
  constructor(ui) {
    this.ui = ui;
    this.node = el('div', 'ui-screen scr-loading', `
      <div class="ld-bg"></div>
      <div class="ld-vignette"></div>
      <div class="ld-center">
        <div class="ld-emblem"><div class="emb-ring"></div><div class="emb-core">✦</div></div>
        <div class="ld-title"><span>THRONESHARD</span></div>
        <div class="ld-sub">Two thrones, three lanes, ten heroes</div>
      </div>
      <div class="ld-bottom">
        <div class="ld-tip"><span class="ld-tip-h">TIP</span><span class="ld-tip-t"></span></div>
        <div class="ld-bar"><div class="ld-fill"><div class="ld-glint"></div></div></div>
        <div class="ld-row"><span class="ld-stage">Initializing</span><span class="ld-pct">0%</span></div>
      </div>`);
    this.fill = this.node.querySelector('.ld-fill');
    this.stage = this.node.querySelector('.ld-stage');
    this.pct = this.node.querySelector('.ld-pct');
    this.tip = this.node.querySelector('.ld-tip-t');
    this.tipIdx = Math.floor(Math.random() * TIPS.length);
    this.tip.innerHTML = TIPS[this.tipIdx];
    this._tipTimer = setInterval(() => this.nextTip(), 4500);
    this.shown = 0;
  }

  nextTip() {
    this.tipIdx = (this.tipIdx + 1) % TIPS.length;
    this.tip.classList.add('fade');
    setTimeout(() => { this.tip.innerHTML = TIPS[this.tipIdx]; this.tip.classList.remove('fade'); }, 300);
  }

  set(p, stage) {
    p = Math.max(this.shown, Math.min(1, p || 0));
    this.shown = p;
    this.fill.style.width = (p * 100).toFixed(1) + '%';
    this.pct.textContent = Math.round(p * 100) + '%';
    if (stage) this.stage.textContent = (STAGES[stage] ?? stage) + '…';
  }

  hide() {
    clearInterval(this._tipTimer);
    this.set(1, null);
    this.stage.textContent = 'Ready';
    this.node.classList.add('out');
    setTimeout(() => this.node.remove(), 900);
  }
}

export { TIPS };
