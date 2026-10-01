import { el } from '../util.js';
import { openSettings, openControls } from './Settings.js';

const DIFFS = [
  { id: 'easy', name: 'Easy', desc: 'Relaxed bots. Great for learning heroes.' },
  { id: 'normal', name: 'Normal', desc: 'Bots farm, fight and push as a team.' },
  { id: 'hard', name: 'Hard', desc: 'Aggressive, efficient bots that punish mistakes.' },
];

export class MainMenu {
  constructor(ui) {
    this.ui = ui;
    let diff = 'normal';
    try { diff = localStorage.getItem('throneshard-diff') || 'normal'; } catch { /* ignore */ }
    ui.difficulty = diff;
    this.node = el('div', 'ui-screen scr-menu', `
      <div class="mn-shade"></div>
      <div class="mn-left">
        <div class="mn-title">
          <div class="mn-t1">TWO THRONES · THREE LANES</div>
          <div class="mn-t2">THRONESHARD</div>
          <div class="mn-rule"><span></span><i>✦</i><span></span></div>
          <div class="mn-t3">Sunward &nbsp;·&nbsp; Duskward</div>
        </div>
        <div class="mn-card panel-frame">
          <button class="btn-play" data-act="play"><span>PLAY VS BOTS</span><em>5v5 · All Pick</em></button>
          <div class="mn-diff">
            <div class="mn-label">Bot Difficulty</div>
            <div class="seg big" data-k="diff">${DIFFS.map((d) => `<button data-v="${d.id}" class="${d.id === diff ? 'on' : ''}">${d.name}</button>`).join('')}</div>
            <div class="mn-diff-desc">${DIFFS.find((d) => d.id === diff)?.desc ?? ''}</div>
          </div>
          <div class="mn-links">
            <button class="btn-game dim" data-act="settings">Settings</button>
            <button class="btn-game dim" data-act="controls">Controls</button>
          </div>
        </div>
      </div>
      <div class="mn-foot">A three.js MOBA · Local build</div>`);
    this.node.querySelector('[data-act=play]').onclick = () => { ui.sfx('confirm'); ui.showHeroSelect(); };
    this.node.querySelector('[data-act=settings]').onclick = () => { ui.sfx('click'); openSettings(ui); };
    this.node.querySelector('[data-act=controls]').onclick = () => { ui.sfx('click'); openControls(ui); };
    const desc = this.node.querySelector('.mn-diff-desc');
    this.node.querySelectorAll('.seg button').forEach((b) => b.onclick = () => {
      this.node.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('on', x === b));
      ui.difficulty = b.dataset.v;
      desc.textContent = DIFFS.find((d) => d.id === b.dataset.v)?.desc ?? '';
      try { localStorage.setItem('throneshard-diff', b.dataset.v); } catch { /* ignore */ }
      ui.sfx('click');
    });
  }
  show() { this.ui.root.appendChild(this.node); requestAnimationFrame(() => this.node.classList.add('show')); }
  hide() { this.node.classList.remove('show'); setTimeout(() => this.node.remove(), 400); }
}
