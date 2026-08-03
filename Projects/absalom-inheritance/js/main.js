// main.js — boot. Fetch the content pack, load a save if there is one (or run
// the character picker if there is not), wire the engine to the renderer and
// the UI, and start autosaving.

import { fetchPack, selectPc } from "./content.js";
import { createGame } from "./game.js";
import { createRenderer } from "./render.js";
import { mountUI, pickCharacter } from "./ui.js";
import { makeSaveSlot, SAVE_KEY } from "./save.js";

const boot = async () => {
  const status = document.getElementById("hint");

  // The pack as fetched: every build in `pcOptions`, unresolved onto any one
  // of them. save.js needs this whole shape to validate and repair a save's
  // `buildId`; only once a build is chosen (from a save, or from the picker)
  // does `selectPc` narrow it to the one PC the rest of the engine expects.
  let pack;
  try {
    // Relative, so the page works from any path GitHub Pages serves it at.
    pack = await fetchPack(new URL("../content/vault.json", import.meta.url));
  } catch (e) {
    status.textContent = "The vault's records are unreadable: " + e.message;
    console.error(e);
    return;
  }

  const slot = makeSaveSlot(pack);
  const loaded = slot.load();

  // No save means no chosen build yet. `slot.fresh(buildId)` forwards the pick
  // straight to save.js's freshRun() (gvb-save's fresh()/reset() pass their
  // arguments through to the `defaults` factory) — the state this run boots on
  // is real from the first frame, never a build-0 default silently adopted.
  const state = loaded || slot.fresh(await pickCharacter(pack));
  const content = selectPc(pack, state.buildId);

  const game = createGame({ content, rng: Math.random, state });
  const renderer = createRenderer(document.getElementById("game"), game);

  // Coalesced writes with a flush on tab hide, straight from the shared module.
  const autosave = slot.autosave(() => game.snapshot(), 1500);

  const ui = mountUI({
    game, renderer, slot,
    /**
     * Called after anything that changed the world.
     *
     * With no argument it is an autosave tick. With a state — an imported file
     * — the run being played is no longer the run on screen, and the honest
     * way to take up a state from any point in an adventure is to boot on it.
     * gvb-save has already written it to storage by the time this runs, so the
     * reload is lossless.
     */
    onAdopt(state) {
      if (state) { slot.save(state); location.reload(); return; }
      autosave.mark();
    },
    /**
     * "Start over" clears the save and reloads with nothing written — the
     * character picker above fires again on the next boot, exactly like a
     * player who has never saved. Writing a fresh state here instead (as
     * `slot.reset()` does with no arguments) would restart silently as
     * whichever build is `pcOptions[0]`, with no chance to pick again; this
     * is the one behaviour in this file that exists specifically so it does
     * not do that.
     */
    onReset() {
      slot.clear();
      location.reload();
    },
  });

  if (loaded) {
    ui.replayLog();
    ui.announce("Save loaded.");
    document.getElementById("save-msg").textContent = "Save loaded.";
  } else {
    if (content.intro.narrative) game.run.log.push({ kind: "narrative", text: content.intro.narrative });
    if (content.intro.goal) game.run.log.push({ kind: "info", text: content.intro.goal });
    ui.replayLog();
    game.setHint(content.intro.hint);
  }

  game.begin();
  ui.refresh();
  ui.buildInventory();
  renderer.start();

  if (game.mode === "over") ui.showEnd();
  if (slot.memoryOnly) {
    document.getElementById("save-msg").textContent =
      "This browser blocks storage — export before you close the tab.";
  }

  // Handy for a driver script, and for anyone poking at it in a console. Read
  // only: nothing in the game reads these back.
  window.__absalom = { game, renderer, slot, content, pack, SAVE_KEY };
};

boot();
