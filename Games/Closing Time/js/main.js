// main.js — bootstrap: load content, resume or start a new career.
import { loadAll, DB } from "./data.js";
import { S, newGame, loadSave, wipeSave } from "./state.js";
import { render } from "./ui.js";

async function boot() {
  await loadAll();
  if (loadSave()) { render(); attachNewGame(); return; }
  showStartScreen();
}

function showStartScreen() {
  const root = document.getElementById("modal-root");
  root.innerHTML = `
    <div class="modal-back">
      <div class="modal modal-wide start-screen">
        <h2 class="modal-title">CLOSING TIME</h2>
        <p class="start-tag">Alder Falls, pop. 41,000. Six neighborhoods, five rival agents, one freshly printed real-estate license: yours.</p>
        <p>Where do you hang it?</p>
        <div class="start-choices">
          <button class="btn start-choice" data-bk="bk_hearthstone">
            <b>Hearthstone Realty</b><br><span class="muted">55% split, weekly office leads, a reputation floor, and Deb.</span>
          </button>
          <button class="btn start-choice" data-bk="bk_indep">
            <b>Go independent</b><br><span class="muted">100% commission. 0% safety net. Every client is one you found yourself.</span>
          </button>
        </div>
      </div>
    </div>`;
  root.querySelectorAll("[data-bk]").forEach(b => b.onclick = () => {
    newGame(b.dataset.bk);
    root.innerHTML = "";
    render(); attachNewGame();
  });
}

function attachNewGame() {
  document.getElementById("newGameBtn").onclick = () => {
    if (confirm("Abandon this career and start over? The save will be wiped.")) { wipeSave(); location.reload(); }
  };
}

boot().catch(err => {
  document.getElementById("main").innerHTML =
    `<div class="card"><h2 class="card-title">Failed to load</h2><p>${err.message}</p>
     <p class="muted">If you opened index.html from disk, run a local server instead (fetch needs http):<br><code>python3 -m http.server</code> in the repo folder, then open http://localhost:8000</p></div>`;
});
