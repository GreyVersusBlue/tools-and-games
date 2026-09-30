import { Game } from './core/Game.js';

const game = new Game(document.getElementById('app'));
window.game = game; // debug handle (used by automated tests)
game.init((p, stage) => game.ui?.setLoadingProgress?.(p, stage)).then(() => {
  game.ui?.onLoaded?.();
});
