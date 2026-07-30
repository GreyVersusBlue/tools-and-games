// main.js — boot. Fetch the content pack, load a save if there is one, wire the
// engine to the renderer and the UI, and start autosaving.

import { fetchPack } from "./content.js";
import { createGame } from "./game.js";
import { createRenderer } from "./render.js";
import { mountUI } from "./ui.js";
import { makeSaveSlot, SAVE_KEY } from "./save.js";

const boot = async () => {
  const status = document.getElementById("hint");

  let content;
  try {
    // Relative, so the page works from any path GitHub Pages serves it at.
    content = await fetchPack(new URL("../content/vault.json", import.meta.url));
  } catch (e) {
    status.textContent = "The vault's records are unreadable: " + e.message;
    console.error(e);
    return;
  }

  const slot = makeSaveSlot(content);
  const loaded = slot.load();

  const game = createGame({ content, rng: Math.random, state: loaded || undefined });
  const renderer = createRenderer(document.getElementById("game"), game);

  // Coalesced writes with a flush on tab hide, straight from the shared module.
  const autosave = slot.autosave(() => game.snapshot(), 1500);

  const ui = mountUI({
    game, renderer, slot,
    /**
     * Called after anything that changed the world.
     *
     * With no argument it is an autosave tick. With a state — an imported file,
     * or "Start over" — the run being played is no longer the run on screen, and
     * the honest way to take up a state from any point in an adventure is to
     * boot on it. gvb-save has already written it to storage by the time this
     * runs, so the reload is lossless.
     */
    onAdopt(state) {
      if (state) { slot.save(state); location.reload(); return; }
      autosave.mark();
    },
    onReset() {
      slot.reset();
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
  window.__absalom = { game, renderer, slot, content, SAVE_KEY };
};

boot();
