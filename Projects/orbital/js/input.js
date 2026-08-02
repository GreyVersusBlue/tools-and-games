/* Orbital — input. Delta-based aiming (the drag vector IS the launch vector,
   so your finger never covers the probe), keyboard control, and a portrait
   rotate prompt. initInput() is called by game.js once state exists. */

let dragging = false, dragStart = null, activeId = null;
const rotateEl = document.getElementById("rotate");
const coarseMQ = matchMedia("(pointer:coarse)");
const pointerAt = e => toWorld(e.clientX, e.clientY);

function beginAim(e) {
  if (mode !== "aim") return;
  activeId = e.pointerId; try { cv.setPointerCapture(e.pointerId); } catch (_) {}
  dragging = true; dragStart = pointerAt(e); aim = null; plan = [];
  e.preventDefault();
}
function moveAim(e) {
  if (!dragging || e.pointerId !== activeId || mode !== "aim") return;
  const w = pointerAt(e); aim = { dx: w.x - dragStart.x, dy: w.y - dragStart.y }; computePlan();
  e.preventDefault();
}
function endAim(fire) {
  if (!dragging) return;
  dragging = false; activeId = null;
  if (fire && aim && planPow >= 0.02) launch();
  else { aim = null; plan = []; }
}

// Portrait phones: levels are authored landscape, so prompt for a rotate.
function checkOrient() {
  const show = coarseMQ.matches && window.innerHeight > window.innerWidth;
  rotateEl.classList.toggle("show", show);
  rotateEl.setAttribute("aria-hidden", show ? "false" : "true");
  if (show) { dragging = false; activeId = null; aim = null; plan = []; }
}

function keyHandler(e) {
  if (e.key === "r" || e.key === "R") { if (mode !== "fly") { resetProbe(); mode = "aim"; } return; }
  if (e.key === "Escape") { toggleLevels(); return; }
  if (mode === "done" && won && (e.key === " " || e.key === "Enter" || e.key === "n" || e.key === "N")) {
    advance(); e.preventDefault(); return;
  }
  if (mode !== "aim") return;
  if (!aim) aim = { dx: 120, dy: 0 };
  let a = Math.atan2(aim.dy, aim.dx), len = Math.hypot(aim.dx, aim.dy) || 120;
  if (e.key === "ArrowLeft") a -= 0.06;
  else if (e.key === "ArrowRight") a += 0.06;
  else if (e.key === "ArrowUp") len = Math.min(MAXDRAG, len + 12);
  else if (e.key === "ArrowDown") len = Math.max(0, len - 12);
  else if (e.key === " ") { e.preventDefault(); launch(); return; }
  else return;
  e.preventDefault(); aim = { dx: Math.cos(a) * len, dy: Math.sin(a) * len }; computePlan();
}

function initInput() {
  cv.addEventListener("pointerdown", beginAim);
  cv.addEventListener("pointermove", moveAim);
  cv.addEventListener("pointerup", e => { if (e.pointerId === activeId) endAim(true); });
  cv.addEventListener("pointercancel", e => { if (e.pointerId === activeId) endAim(false); });
  window.addEventListener("pointerup", () => { if (dragging) endAim(true); }); // safety net
  window.addEventListener("contextmenu", e => { if (e.target === cv) e.preventDefault(); });
  window.addEventListener("keydown", keyHandler);
  window.addEventListener("orientationchange", () => setTimeout(checkOrient, 120));
  checkOrient();
}
