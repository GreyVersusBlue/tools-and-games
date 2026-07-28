// main.js — bootstrap: load content, resume or start a new career.
import { loadAll } from "./data.js";
import { S, newGame, loadSave, wipeSave, careerSlot, adoptState } from "./state.js";
import { render, toast } from "./ui.js";
import { mountSaveBar } from "../../../assets/js/gvb-save.js";

async function boot() {
  await loadAll();
  mountSave();
  if (loadSave()) { render(); attachNewGame(); return; }
  showStartScreen();
}

/**
 * The save bar lives in the footer, which is on screen behind every desk screen
 * and every modal. v7 §9 flagged The Fourth Quarter's as start-screen-only, so
 * exporting mid-campaign there means reloading the page to get the overlay back.
 * There is no such moment here: six screens, one footer.
 *
 * `reset` is left out on purpose. The footer already has "New career", and this
 * game cannot start one without asking which brokerage first — two buttons that
 * erase a career, one of which would silently pick for you, is worse than one.
 */
function mountSave() {
  const slot = careerSlot();
  mountSaveBar(document.getElementById("save-bar"), slot, {
    buttons: ["export", "import"],
    getState: () => S,
    setState: c => {
      adoptState(c);
      document.getElementById("modal-root").innerHTML = "";
      render();
      attachNewGame();
    },
    onMessage: toast,
  });
  if (slot.memoryOnly) toast("This browser blocks storage — export before you close the tab.");
  // Nothing to export until a brokerage has been picked. mountSaveBar has no
  // hook for "this button isn't usable yet", so reach for the button by its
  // data-gvb attribute, which is what that attribute is for.
  exportBtn().disabled = true;
}

const exportBtn = () => document.querySelector('#save-bar [data-gvb="export"]');

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
        <p class="hint">Already have a career in a file? Import it from the footer.</p>
      </div>
    </div>`;
  root.querySelectorAll("[data-bk]").forEach(b => b.onclick = () => {
    newGame(b.dataset.bk);
    root.innerHTML = "";
    render(); attachNewGame();
  });
}

/** Every path that ends with a career on screen comes through here. */
function attachNewGame() {
  exportBtn().disabled = false;
  document.getElementById("newGameBtn").onclick = () => {
    if (confirm("Abandon this career and start over? The save will be wiped.")) { wipeSave(); location.reload(); }
  };
}

boot().catch(err => {
  document.getElementById("main").innerHTML =
    `<div class="card"><h2 class="card-title">Failed to load</h2><p>${err.message}</p>
     <p class="muted">If you opened index.html from disk, run a local server instead (fetch needs http):<br><code>python3 -m http.server</code> in the repo folder, then open http://localhost:8000</p></div>`;
});
