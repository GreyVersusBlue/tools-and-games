// checks.js — SkyWings 64's in-page checks, injected by test/browser.mjs.
// Everything steps the game synchronously through window.__qa.sim (game.update polls the keyboard,
// gamepad and touch state), so no assertion depends on requestAnimationFrame or frame rate (#53).
// window.__swChecks() resolves to [{ok, label, detail}].
(function () {
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  const hdTo = (v, x, z) => Math.atan2(-(x - v.position.x), -(z - v.position.z));

  // Rocket-belt / gyro autopilot: steer at the open ring (offset along its normal so it crosses the
  // plane), hold altitude with throttle, then hover down onto the pad. Vehicle yaw +1 turns right,
  // i.e. decreases heading.
  function powered(kind) {
    const vmax = kind === 'gyro' ? 24 : 13;
    return (i, g) => {
      const v = g.vehicle, W = g.world, c = g.course;
      if (!v || g.state !== 'FLIGHT') return;
      const r = c.openRing();
      let a;
      if (r) {
        const s = (v.position.x - r.position.x) * r.normal.x + (v.position.y - r.position.y) * r.normal.y + (v.position.z - r.position.z) * r.normal.z;
        const k = clamp(s * 0.6, -45, 45);
        a = { x: r.position.x + r.normal.x * k, y: r.position.y + r.normal.y * k, z: r.position.z + r.normal.z * k, ring: r };
      } else { const t = c.getTarget(v); if (!t) return; a = { x: t.x, y: t.y, z: t.z, pad: true }; }
      const dist = Math.hypot(a.x - v.position.x, a.z - v.position.z);
      const herr = wrap(hdTo(v, a.x, a.z) - v.heading);
      const fwd = -Math.sin(v.heading) * v.velocity.x - Math.cos(v.heading) * v.velocity.z;
      const gy = Math.max(0, W.heightAt(v.position.x, v.position.z));
      let ahead = gy;
      for (const s of [0.5, 1, 2, 3, 4.5]) ahead = Math.max(ahead, W.heightAt(v.position.x + v.velocity.x * s, v.position.z + v.velocity.z * s));
      let ty, vdes;
      if (a.ring) { ty = a.ring.position.y; vdes = clamp(dist * 0.5, kind === 'gyro' ? 12 : 9, vmax); }
      else { ty = dist > 25 ? Math.max(a.y + 25, gy + 20) : a.y; vdes = clamp(dist * 0.3, 0, vmax); }
      ty = Math.max(ty, ahead + (a.pad && dist < 25 ? -100 : 14));
      i.yaw = clamp(-herr * 2.5, -1, 1);
      i.roll = kind === 'gyro' && fwd > 6 ? clamp(-herr * 1.2, -0.7, 0.7) : 0;
      i.pitch = clamp(((Math.abs(herr) > 0.8 ? 0 : vdes) - fwd) * (kind === 'gyro' ? 0.12 : 0.2), -0.8, 1);
      let vyDes = clamp((ty - v.position.y) * 0.5, -5, 8);
      if (a.pad && dist < 10 && Math.hypot(v.velocity.x, v.velocity.z) < 4) { vyDes = v.altitude > 6 ? -3 : -1.2; i.pitch = clamp(-fwd * 0.3, -0.5, 0.5); i.roll = 0; }
      i.throttle = clamp(0.5 + (vyDes - v.velocity.y) * 0.12, 0, 1);
    };
  }

  window.__swChecks = async function () {
    const out = [];
    const ok = (cond, label, detail) => out.push({ ok: !!cond, label, detail: detail === undefined ? '' : JSON.stringify(detail) });
    const q = window.__qa, g = q.game, W = g.world;
    const step = (sec) => q.sim(sec, null);
    try {
      // ---- models: the carved heads arrive as assets/models/heads.glb, where the fallback stood.
      // A load is not a frame, so waiting on it in real time is not a frame-rate assertion (#53).
      const L = W.meshes.landmarks, host = L.getObjectByName('headsHost');
      for (let n = 0; n < 150 && !L.getObjectByName('glb:heads'); n++) await new Promise((r) => setTimeout(r, 200));
      const hg = L.getObjectByName('glb:heads'), st = W.landmarks.statue.position;
      let tris = 0; const mats = [];
      if (hg) hg.traverse((o) => { if (o.isMesh) { tris += o.geometry.index.count / 3; mats.push(o.material.name + (o.material.vertexColors ? ':vc' : '') + (o.material.aoMap ? ':ao' : '')); } });
      ok(hg && hg.position.distanceTo(st) < 0.01 && hg.children[0].scale.x === 1 && host.children.every((c) => !c.visible),
        'heads.glb swaps in at the statue, unscaled, and hides the fallback', hg && { at: hg.position.toArray().map(Math.round), fallback: host.children.map((c) => c.visible) });
      ok(tris > 3000 && mats.join() === 'Heads_Rock:vc:ao,Heads_Gold:vc:ao,Heads_Helm:vc:ao', 'heads.glb draws as three meshes, vertex-coloured, with baked AO', { tris, mats });

      // ---- herds (src/world/herd.js, #931): the copies of one GLB are hidden and drawn as one
      // InstancedMesh per primitive, packed before each render from what the camera or the sun's
      // shadow box can see. Camera and aircraft are put by hand and one frame is rendered by hand,
      // so this is a count of what that frame packed, not of what a frame rate allowed (#53).
      const herd = (pre) => L.children.filter((c) => c.isInstancedMesh && c.name.startsWith(pre + ':'));
      for (let n = 0; n < 150 && !(herd('glb:windmill').length && herd('glb:cabin').length); n++) await new Promise((r) => setTimeout(r, 200));
      const wm = herd('glb:windmill'), cab = herd('glb:cabin'), wraps = L.children.filter((c) => c.name === 'glb:windmill');
      ok(wm.length === 9 && wm.every((m) => m.instanceMatrix.count === 4) && cab.length === 7 && cab.every((m) => m.instanceMatrix.count === 11)
        && wraps.length === 4 && wraps.every((w) => w.children[0].visible === false),
        'windmills and cabins are herds: one InstancedMesh per GLB primitive, the copies hidden', { windmill: wm.map((m) => m.instanceMatrix.count), cabin: cab.length, hidden: wraps.map((w) => !w.children[0].visible) });
      q.start('gc1');
      const sw = window.__sw, cam = g.camera, mills = W.landmarks.windmills;
      const look = (px, py, pz, tx, ty, tz) => { cam.position.set(px, py, pz); cam.lookAt(tx, ty, tz); cam.updateMatrixWorld(); sw.render(1 / 60); return wm.map((m) => (m.visible ? m.count : 0)); };
      g.vehicle.position.set(-1900, 600, 1900);                       // the shadow box follows the aircraft: park it over the far sea
      const none = look(-1900, 600, 1900, -3000, 600, 3000);         // and look out to sea
      ok(none.every((n) => n === 0), 'no windmill in the view or the shadow box: the herd draws nothing', none);
      const two = look(425, mills[0].y + 60, 540, 425, mills[0].y + 15, 420);   // 120 m south of the east pair
      const body = wm.find((m) => m.name === 'glb:windmill:Cone'), e = body ? body.instanceMatrix.array : [];
      const off = [0, 1].map((i) => Math.min(...mills.slice(0, 2).map((p) => Math.hypot(e[i * 16 + 12] - p.x, e[i * 16 + 14] - p.z))));
      ok(two.every((n) => n === 2) && off.every((d) => d < 3) && Math.hypot(e[12] - e[28], e[14] - e[30]) > 50,
        'two windmills in view: every primitive is packed twice, where those two mills stand', { packed: two, metresOff: off.map((d) => +d.toFixed(2)) });

      // ---- terrain (#932): chunks at a far level of detail are merged into their square's mesh.
      // Read from the triangles, not from a count: the 250 m cells the squares' ground triangles
      // (skirts and unfilled index slots left out) fall in must be the cells whose own chunk is hidden.
      q.sim(0.5, null);
      const T = W.meshes.terrain.children, cellOf = (x, z) => Math.floor((x + 2000) / 250) + 16 * Math.floor((z + 2000) / 250);
      const own = T.filter((m) => m.name !== 'far'), far = T.filter((m) => m.name === 'far' && m.visible);
      const hidden = new Set(own.filter((m) => !m.visible).map((m) => { m.geometry.computeBoundingSphere(); const c = m.geometry.boundingSphere.center; return cellOf(c.x, c.z); }));
      const covered = new Set();
      for (const m of far) {
        const p = m.geometry.attributes.position, ix = m.geometry.index;
        for (let i = 0; i < ix.count; i += 3) {
          const a = ix.getX(i), b = ix.getX(i + 1), c = ix.getX(i + 2), ax = p.getX(a), az = p.getZ(a), bx = p.getX(b), bz = p.getZ(b), cx = p.getX(c), cz = p.getZ(c);
          if (Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) > 1e-6) covered.add(cellOf((ax + bx + cx) / 3, (az + bz + cz) / 3));
        }
      }
      const holes = [...hidden].filter((k) => !covered.has(k)), twice = [...covered].filter((k) => !hidden.has(k));
      ok(own.length === 256 && hidden.size > 0 && hidden.size < 256 && holes.length === 0 && twice.length === 0,
        'terrain: every chunk is drawn once, in its own mesh or in its square\'s', { chunks: own.length, merged: hidden.size, squares: far.length, holes, twice });

      // A square casts only while the sun's shadow box reaches one of its merged chunks. The box
      // follows the aircraft, so park it over the merged chunk farthest from the camera and render.
      const squares = T.filter((m) => m.name === 'far'), flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
      const spot = own.filter((m) => !m.visible).map((m) => m.geometry.boundingSphere.center).sort((a, b) => flat(b, cam.position) - flat(a, cam.position))[0];
      g.vehicle.position.set(spot.x, spot.y + 50, spot.z); sw.render(1 / 60);
      const under = squares[(cellOf(spot.x, spot.z) >> 6) * 4 + ((cellOf(spot.x, spot.z) & 15) >> 2)];
      const away = squares.filter((m) => m.visible).sort((a, b) => flat(b.geometry.boundingSphere.center, spot) - flat(a.geometry.boundingSphere.center, spot))[0];
      ok(under.visible && under.castShadow === true && away !== under && away.castShadow === false,
        'terrain: the square under the shadow box casts, the one across the map does not', { under: under.castShadow, away: away.castShadow, metresApart: Math.round(flat(away.geometry.boundingSphere.center, spot)) });

      if (window.__swOnly === 'models') return out;                  // test/browser.mjs --models

      // ---- courses: every mission builds, and every ring can be flown through
      for (const m of q.MISSIONS) {
        q.start(m.id);
        const c = g.course;
        const low = c.rings.filter((r) => r.position.y - W.heightAt(r.position.x, r.position.z) < r.radius * 0.5);
        ok(g.state === 'FLIGHT' && low.length === 0, m.id + ': builds, no ring buried in terrain', { rings: c.ringsTotal, buried: low.length });
      }
      // Thermal Peak's first ring once sat 220 m above the launch, over a thermal on the mountain: unflyable.
      q.start('hg2');
      const pad = g.vehicle.position.y, first = g.course.rings[0];
      ok(first.position.y <= pad, 'hg2: first ring is below the launch height', { pad: Math.round(pad), ring1: Math.round(first.position.y) });
      q.start('rb1');
      ok(g.vehicle.fuelBurnScale === 0.55, 'rb1: mission fuel scale reaches the belt', g.vehicle.fuelBurnScale);

      // ---- flight: the rocket belt flies Hop Skip Jump start to finish on the autopilot
      q.start('rb1');
      q.sim(120, powered('belt'), { until: (gm) => gm.state !== 'FLIGHT' });
      step(4);
      ok(g.lastResult && g.lastResult.completed && g.course.hits === g.course.ringsTotal, 'rb1: autopilot collects every ring and lands on the pad',
        { outcome: g.outcome, rings: g.course.hits + '/' + g.course.ringsTotal, medal: g.lastResult && g.lastResult.medal });

      // ---- rules
      q.start('rb1');
      q.sim(3, (i) => { i.throttle = 1; });
      // hop sideways to flat ground 60 m off the pad and settle down gently (~1.5 m/s)
      const v = g.vehicle; v.position.x += 60; v.position.y = W.heightAt(v.position.x, v.position.z) + v.gearOffset + 8; v.velocity.set(0, 0, 0);
      q.sim(20, (i) => { i.throttle = 0.47; }, { until: (gm) => gm.vehicle.state !== 'flying' });
      step(0.5);
      ok(v.state === 'landed' && g.state === 'FLIGHT', 'powered craft landing off the pad keeps flying the mission', [v.state, g.state]);

      q.start('sandbox', 'hangGlider'); q.sim(1, (i) => { i.action = true; });
      g.hasFlown = true; g.vehicle.state = 'landed'; step(3.5);
      ok(g.state === 'FLIGHT' && g.vehicle.state === 'grounded', 'free flight: a landed glider respawns at the launch', [g.state, g.vehicle.state]);

      // ---- progression + results (fresh profile: three second missions locked)
      localStorage.removeItem('skywings64.bests.v1');
      g.enterSelect();
      ok(document.querySelectorAll('#ui .sw-card.locked').length === 3, 'fresh profile: three missions locked');
      g.sel = 1; g.act('confirm');
      ok(g.state === 'SELECT', 'a locked mission refuses to open', g.state);
      q.start('hg1'); q.sim(1.5, (i) => { i.action = true; });
      const hint = document.getElementById('sw-hint');
      ok(hint && hint.style.opacity === '1' && hint.textContent.length > 10, 'first flight shows a tutorial hint', hint && hint.textContent);
      step(18);
      g.input._pauseLatch = true; step(0.1);
      ok(g.state === 'PAUSED', 'P/Esc pauses', g.state);
      g.act('confirm'); step(0.5);
      ok(g.state === 'FLIGHT', 'confirm resumes', g.state);
      const c = g.course; c.hits = c.ringsTotal; c.last = c.ringsTotal - 1;
      g.landingInfo = { distance: 6, radius: c.landing.radius, quality: { verticalSpeed: 1.2 } };
      g.end('landed'); step(2.5);
      ok(g.state === 'RESULTS' && g.lastResult.medal !== 'none', 'a clean landing scores a medal', g.lastResult && [g.lastResult.total, g.lastResult.medal]);
      ok((g.lastUnlocked || []).includes('Thermal Peak') && /UNLOCKED/.test(document.getElementById('ui').textContent), 'the medal unlocks Thermal Peak, and results say so', g.lastUnlocked);
      const p0 = g.vehicle.mesh.position.clone(); step(2);
      ok(g.replay && g.vehicle.mesh.position.distanceTo(p0) > 1, 'results replay the flight', g.vehicle.mesh.position.distanceTo(p0).toFixed(1));
      g.act('retry');
      ok(g.state === 'COUNTDOWN' && g.course.hits === 0, 'retry rebuilds the course and counts down', g.state);
      step(3.2);
      ok(g.state === 'FLIGHT', 'countdown hands over to flight', g.state);
      g.input._pauseLatch = true; step(0.1); g.act('menu');
      ok(document.querySelectorAll('#ui .sw-card.locked').length === 2, 'back at the menu Thermal Peak is open');

      // ---- gamepad (standard mapping), stepped through game.update's own polling
      const padS = { id: 'test pad', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
      const realPads = navigator.getGamepads;
      navigator.getGamepads = () => [padS];
      const btn = (i) => { padS.buttons[i].pressed = true; padS.buttons[i].value = 1; step(0.1); padS.buttons[i].pressed = false; padS.buttons[i].value = 0; step(0.1); };
      g.enterTitle(); step(0.1);
      btn(0); ok(g.state === 'SELECT', 'pad A: title -> missions', g.state);
      g.sel = 0; g.refreshSelect();
      btn(15); ok(g.sel === 1, 'pad d-pad right moves the selection', g.sel);
      btn(14); btn(0); ok(g.state === 'BRIEFING', 'pad A opens the briefing', g.state);
      btn(1); ok(g.state === 'SELECT', 'pad B goes back', g.state);
      btn(0); btn(0); step(3.2);
      ok(g.state === 'FLIGHT', 'pad A twice starts the flight', g.state);
      padS.axes[1] = -1; padS.axes[0] = 0.8; step(0.2);
      ok(g.input.pitch > 0.5 && g.input.roll > 0.4, 'left stick drives pitch and roll', [g.input.pitch.toFixed(2), g.input.roll.toFixed(2)]);
      padS.axes[1] = 0; padS.axes[0] = 0; step(0.5);
      btn(9); ok(g.state === 'PAUSED', 'Start pauses', g.state);
      btn(9); step(0.2); ok(g.state === 'FLIGHT', 'Start again resumes', g.state);
      q.start('gc1');
      const t0 = g.input.throttle; padS.buttons[7].value = 1; step(0.3); padS.buttons[7].value = 0;
      ok(g.input.throttle > t0 + 0.02, 'right trigger raises throttle', [t0, g.input.throttle.toFixed(3)]);
      navigator.getGamepads = realPads;

      // ---- touch (page opened with ?touch=1)
      const tc = g.touch;
      ok(tc && tc.enabled && tc.visible, 'touch controls show during flight');
      if (tc && tc.root) {
        const pe = (type, el, x, y, id) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, clientX: x, clientY: y, pointerType: 'touch' }));
        const stick = tc.root.querySelector('.stick'), sr = stick.getBoundingClientRect();
        pe('pointerdown', stick, sr.left + sr.width / 2, sr.top + 2, 1); step(0.2);
        ok(g.input.pitch > 0.5, 'touch stick up pitches forward', g.input.pitch.toFixed(2));
        pe('pointerup', stick, sr.left + sr.width / 2, sr.top + 2, 1); step(0.2);
        ok(Math.abs(g.input.pitch) < 0.1, 'releasing the stick recentres', g.input.pitch.toFixed(2));
        const up = tc.root.querySelector('[data-k="thrUp"]'), ur = up.getBoundingClientRect(), th0 = g.input.throttle;
        pe('pointerdown', up, ur.left + 5, ur.top + 5, 2); step(0.3); pe('pointerup', up, ur.left + 5, ur.top + 5, 2);
        ok(g.input.throttle > th0 + 0.02, 'touch THR+ raises throttle', [th0.toFixed(3), g.input.throttle.toFixed(3)]);
        const pz = tc.root.querySelector('[data-k="pause"]'), pr = pz.getBoundingClientRect();
        pe('pointerdown', pz, pr.left + 5, pr.top + 5, 3); step(0.1); pe('pointerup', pz, pr.left + 5, pr.top + 5, 3);
        ok(g.state === 'PAUSED' && !tc.visible, 'touch pause pauses and hides the controls', [g.state, tc.visible]);
      }
    } catch (e) { out.push({ ok: false, label: 'exception', detail: String(e && e.stack || e) }); }
    return out;
  };
})();
