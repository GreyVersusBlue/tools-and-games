import * as THREE from 'three';
import { MAP_HALF, TEAM } from '../core/constants.js';
import { EXT, WATER_Y, elevationLevel, riverDist } from './layout.js';
import { TerrainData, buildSplat, buildTerrainGeometry, createTerrainMaterial, N, RES } from './Terrain.js';
import { loadTerrainLayers, makeNoiseTexture, LAYERS } from './Textures.js';
import { NavGrid } from './NavGrid.js';
import { FogOfWar } from './FogOfWar.js';
import { Foliage } from './Foliage.js';
import { createRiver } from './Water.js';
import { Props } from './Props.js';
import { Atmosphere } from './Atmosphere.js';
import { PostFX } from './PostFX.js';
import { TerrainTiles } from './TerrainTiles.js';
import { worldUniforms } from './shaderUtils.js';
import { smoothstep } from './noise.js';

const DAY_LENGTH = 300; // seconds of day, then the same of night

const TREE_REGROW = 300;

/**
 * World: terrain, vegetation, water, props, lighting, post-processing, navigation grid & fog of war.
 * Public API (see ARCHITECTURE.md): getHeight, isWalkable, findPath, isVisible, hasTrueSight,
 * nearestWalkable, blockCircle, unblockCircle, cutTrees, getTreesInRadius, getVisibilityGrid, getFogTexture,
 * getMinimapImage, setQuality, isNight, raycastGround.
 */
export class World {
  constructor(game) {
    this.game = game;
    this.td = null;
    this.nav = new NavGrid(MAP_HALF, 0.5);
    this.fog = new FogOfWar(MAP_HALF);
    this.dayLength = DAY_LENGTH;
    this.night = 0;
    this.quality = 'high';
    this.ready = false;
    this._fogTimer = 0;
    this._fogTeamToggle = 0;
    this._lightTimer = 0;
    this._target = new THREE.Vector3(-70, 0, 70);
    worldUniforms.uFowTex.value = this.fog.texture;
    try {
      const q = localStorage.getItem('throneshard.world.quality');
      if (['low', 'medium', 'high', 'ultra'].includes(q)) this.quality = q;
    } catch { /* ignore */ }
  }

  async init(onProgress = () => {}) {
    const g = this.game;
    const hq = this.quality !== 'low';
    g.scene.background = new THREE.Color(0x8fa9bd);
    const p = (a, b) => (x) => onProgress(a + (b - a) * x);

    // 1. heightfield + masks
    this.td = new TerrainData();
    await this.td.build(p(0, 0.35));
    this.nav.heightFn = (x, z) => this.getHeight(x, z);

    // 2. textures
    const [layers] = await Promise.all([loadTerrainLayers(hq ? 1024 : 512, p(0.35, 0.55))]);
    this.layerAvg = layers.avg;
    this.noiseTex = makeNoiseTexture(256);
    onProgress(0.6);

    // 3. terrain mesh
    this.splat = buildSplat(this.td);
    const geo = buildTerrainGeometry(this.td);
    this.terrainMat = createTerrainMaterial({ layers, splat: this.splat, noiseTex: this.noiseTex, hq });
    // 16x16 frustum-culled tiles sharing one vertex buffer, so the main and shadow passes draw only the ~5% of the
    // 460k-triangle heightfield that is actually in view; the visible tiles are packed into one draw per pass
    // (TerrainTiles, culled from the scene's onBeforeRender below).
    const terrain = new THREE.Group();
    terrain.name = 'ground';
    this.terrainTiles = new TerrainTiles(geo, this.terrainMat, N - 1, 16, null);
    terrain.add(this.terrainTiles.mesh);
    g.scene.add(terrain);
    this.ground = this.terrain = terrain;
    // dark scenic skirt beyond the terrain mesh so the map never floats in a void
    const outer = new THREE.Shape([new THREE.Vector2(-900, -900), new THREE.Vector2(900, -900), new THREE.Vector2(900, 900), new THREE.Vector2(-900, 900)]);
    const hole = EXT - 1.5;
    outer.holes.push(new THREE.Path([new THREE.Vector2(-hole, -hole), new THREE.Vector2(-hole, hole), new THREE.Vector2(hole, hole), new THREE.Vector2(hole, -hole)]));
    const skirt = new THREE.Mesh(new THREE.ShapeGeometry(outer), new THREE.MeshStandardMaterial({ color: 0x1b2616, roughness: 1 }));
    skirt.rotation.x = -Math.PI / 2;
    skirt.position.y = 3.2;
    skirt.receiveShadow = true;
    g.scene.add(skirt);
    onProgress(0.68);

    // 4. static navigation & vision levels
    this.buildStaticNav();
    onProgress(0.72);

    // 5. vegetation, water, props
    this.foliage = new Foliage(this);
    this.foliage.build(hq);
    g.scene.add(this.foliage.group);
    onProgress(0.84);
    this.river = createRiver(this, this.noiseTex);
    g.scene.add(this.river);
    this.props = new Props(this);
    try { this.props.build(); } catch (e) { console.error('[world] props failed', e); }
    g.scene.add(this.props.group);
    this.nav.rebuildCoarse();
    this.nav.labelComponents();
    onProgress(0.9);

    // 6. lighting & post
    this.atmo = new Atmosphere(this);
    await this.atmo.init(g.scene, g.renderer, hq);
    this.terrainTiles.sun = this.atmo.sun;
    // per-render tile culling for the packed terrain draw (any camera that renders this scene)
    const prevBefore = g.scene.onBeforeRender;
    g.scene.onBeforeRender = (renderer, scene, camera, rt) => {
      prevBefore?.call(scene, renderer, scene, camera, rt);
      const sm = renderer.shadowMap;
      this.terrainTiles.cull(camera, sm.enabled && (sm.autoUpdate || sm.needsUpdate));
    };
    try {
      this.post = new PostFX(g);
      g.composer = this.post.composer;
    } catch (e) { console.error('[world] postfx failed', e); }
    this.setQuality(this.quality);
    this.minimapCanvas = this.paintMinimap();
    this.fog.fillDisplay(1);
    this.ready = true;
    onProgress(1);
  }

  buildStaticNav() {
    const nav = this.nav, W = nav.W, c = nav.cell, h = nav.half;
    for (let j = 0; j < W; j++) {
      const z = -h + (j + 0.5) * c;
      for (let i = 0; i < W; i++) {
        const x = -h + (i + 0.5) * c;
        const edge = Math.max(Math.abs(x), Math.abs(z));
        const slope = this.td.sample(this.td.slope, x, z);
        if (edge > 98.5 || slope > 0.62) nav.stat[j * W + i] = 1;
      }
    }
    nav.rebuildCoarse();
    const F = this.fog;
    for (let j = 0; j < F.W; j++) for (let i = 0; i < F.W; i++) {
      const x = -F.half + i + 0.5, z = -F.half + j + 0.5;
      F.level[j * F.W + i] = elevationLevel(this.getHeight(x, z));
    }
  }

  onMatchStart() {
    worldUniforms.uFowOn.value = 1;
    this._fogTimer = 0;
    this.computeFog(TEAM.SUNWARD);
    this.computeFog(TEAM.DUSKWARD);
    const team = this.game.player?.team;
    if (this.fog.vis[team]) { this.fog.updateTexture(team, 1); }
  }

  // ------------------------------------------------------------------ queries
  getHeight(x, z) { return this.td ? this.td.height(x, z) : 0; }
  getNormal(x, z, out = new THREE.Vector3()) {
    const e = 0.5;
    return out.set(this.getHeight(x - e, z) - this.getHeight(x + e, z), 2 * e, this.getHeight(x, z - e) - this.getHeight(x, z + e)).normalize();
  }
  isWater(x, z) { return this.getHeight(x, z) < WATER_Y - 0.02; }
  get waterLevel() { return WATER_Y; }
  isWalkable(x, z) { return this.nav.isWalkable(x, z); }
  findPath(from, to) {
    if (!from || !to) return null;
    try { return this.nav.findPath(from, to); } catch (e) { console.error('[world] findPath', e); return null; }
  }
  nearestWalkable(x, z, maxR = 12) {
    if (x && typeof x === 'object') { maxR = typeof z === 'number' ? z : 12; z = x.z; x = x.x; }
    const r = this.nav.nearestWalkable(x, z, maxR);
    return r ? new THREE.Vector3(r.x, this.getHeight(r.x, r.z), r.z) : null;
  }
  blockCircle(x, z, r) { this.nav.blockCircle(x, z, r); }
  unblockCircle(x, z, r) { this.nav.unblockCircle(x, z, r); }

  isVisible(team, x, z) {
    if (team !== TEAM.SUNWARD && team !== TEAM.DUSKWARD) return true;
    if (!this.ready || !this.game.running) return true;
    return this.fog.isVisible(team, x, z);
  }
  hasTrueSight(team, x, z) {
    if (!this.isVisible(team, x, z)) return false;
    for (const u of this.game.units) {
      if (!u.alive || u.team !== team) continue;
      let r = 0;
      if (u.kind === 'tower') r = 17.5;
      else if (u.subtype === 'fountain') r = 30;
      if (u.data?.trueSight) r = Math.max(r, typeof u.data.trueSight === 'number' ? u.data.trueSight : u.getStat('vision'));
      for (const m of u.modifiers) if (m.trueSight) r = Math.max(r, typeof m.trueSight === 'number' ? m.trueSight : 10);
      if (r > 0 && (u.position.x - x) ** 2 + (u.position.z - z) ** 2 <= r * r) return true;
    }
    return false;
  }
  isNight() { return this.game.time >= 0 && Math.floor(this.game.time / DAY_LENGTH) % 2 === 1; }

  getVisibilityGrid(team) {
    const data = this.fog.vis[team];
    if (!data) return null;
    return { data, width: this.fog.W, height: this.fog.W, max: 1, cellSize: 1, origin: -MAP_HALF };
  }
  getFogTexture() { return this.fog.texture; }

  // Trees -----------------------------------------------------------------
  getTreesInRadius(x, z, r) { return this.foliage?.treesInRadius(x, z, r) ?? []; }
  cutTrees(x, z, r, { regrow = TREE_REGROW } = {}) {
    if (x && typeof x === 'object') { r = z; z = x.z; x = x.x; }
    if (!this.foliage) return 0;
    let n = 0;
    for (const t of this.foliage.treesInRadius(x, z, r)) {
      if (this.foliage.cutTree(t, regrow == null ? null : this.game.time + regrow)) {
        n++;
        this.game.vfx?.spawn?.('tree_fall', { position: new THREE.Vector3(t.x, t.y, t.z) });
      }
    }
    if (n) this.game.bus?.emit?.('trees:cut', { x, z, r, count: n });
    return n;
  }
  destroyTreesInRadius(x, z, r) { return this.cutTrees(x, z, r); }

  // Terrain picking: march a ray against the heightfield. Returns Vector3 or null.
  raycastGround(ray, maxDist = 600) {
    const o = ray.origin, d = ray.direction;
    let t = 0, prevT = 0, prevDiff = o.y - this.getHeight(o.x, o.z);
    const step = 0.5;
    while (t < maxDist) {
      t += step;
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      const diff = y - this.getHeight(x, z);
      if (diff <= 0) {
        const f = prevDiff / (prevDiff - diff);
        const tt = prevT + (t - prevT) * f;
        return new THREE.Vector3(o.x + d.x * tt, 0, o.z + d.z * tt).setY(this.getHeight(o.x + d.x * tt, o.z + d.z * tt));
      }
      prevT = t; prevDiff = diff;
    }
    return null;
  }

  // Quality -----------------------------------------------------------------
  // Quality levels (Settings menu): low | medium | high | ultra. 'high' is the tuned default for iGPUs;
  // 'ultra' restores the heaviest settings (all torch lights, full-res DPR, denser grass).
  setQuality(q) {
    q = ['low', 'medium', 'high', 'ultra'].includes(q) ? q : 'high';
    this.quality = q;
    try { localStorage.setItem('throneshard.world.quality', q); } catch { /* ignore */ }
    const hq = q === 'high' || q === 'ultra';
    const r = this.game.renderer;
    if (r) {
      const pr = hq ? Math.min(window.devicePixelRatio || 1, q === 'ultra' ? 2 : 1.5) : 1;
      if (r.getPixelRatio() !== pr) {
        r.setPixelRatio(pr);
        this.post?.composer.setPixelRatio(pr);
      }
      r.shadowMap.type = THREE.PCFShadowMap;
    }
    this.atmo?.setQuality(q !== 'low' && q !== 'medium', q);
    this._shadowDirty = true;
    this.post?.setQuality(q);
    this.foliage?.setGrassDensity({ low: 0.3, medium: 0.6, high: 0.85, ultra: 1 }[q]);
    if (this.terrainMat) this.terrainMat.userData.uniforms.uHQ.value = q === 'low' ? 0 : 1;
    this.props?.setLightCount?.({ low: 2, medium: 3, high: 4, ultra: 6 }[q]);
    this.props?.setPointScale?.(r ? r.getPixelRatio() : 1);
  }

  // ------------------------------------------------------------------ update
  cameraTarget() {
    const ct = this.game.cameraCtl?.target;
    if (ct && Number.isFinite(ct.x)) return this._target.set(ct.x, this.getHeight(ct.x, ct.z), ct.z);
    const cam = this.game.camera;
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    if (dir.y < -0.05) {
      const t = -cam.position.y / dir.y;
      this._target.set(cam.position.x + dir.x * t, 0, cam.position.z + dir.z * t);
    }
    return this._target;
  }

  computeFog(team) {
    const viewers = [];
    const nightF = 1 - this.night * 0.4;
    for (const u of this.game.units) {
      if (!u.alive || u.team !== team) continue;
      let r = u.getStat ? u.getStat('vision') : 20;
      if (u.data?.visionOverride != null) r = u.data.visionOverride;
      if (u.kind === 'hero' || u.kind === 'summon') r *= nightF;
      viewers.push({ x: u.position.x, z: u.position.z, r, flying: !!u.data?.flyingVision });
    }
    for (const v of this._tempVision ?? []) if (v.team === team && v.until > this.game.time) viewers.push(v);
    this.fog.compute(team, viewers);
  }

  // Temporary vision reveal (abilities / scans): addVision(team, x, z, r, duration, flying)
  addVision(team, x, z, r, duration = 3, flying = true) {
    this._tempVision = (this._tempVision ?? []).filter((v) => v.until > this.game.time);
    this._tempVision.push({ team, x, z, r, flying, until: this.game.time + duration });
  }

  update(dt, rawDt = dt) {
    if (!this.ready) return;
    const g = this.game;
    worldUniforms.uTime.value = g.realTime ?? 0;

    // day / night
    if (g.running) {
      const cyc = ((g.time % (DAY_LENGTH * 2)) + DAY_LENGTH * 2) % (DAY_LENGTH * 2);
      const target = g.time < 0 ? 0 : smoothstep(DAY_LENGTH - 6, DAY_LENGTH + 6, cyc) * (1 - smoothstep(DAY_LENGTH * 2 - 6, DAY_LENGTH * 2, cyc));
      this.night += (target - this.night) * Math.min(1, rawDt * 0.6);
    }
    this.atmo.applyTime(this.night, g.scene, g.renderer);
    this.post?.setNight(this.night);

    const target = this.cameraTarget();
    this.atmo.follow(target, g.camera);
    this._lightTimer -= rawDt;
    const resort = this._lightTimer <= 0;
    if (resort) this._lightTimer = 0.25;
    this.props?.updateLights(target, g.realTime, this.quality, resort);
    this.scheduleShadows(g.renderer);
    this.foliage?.updateView(g.camera);
    this._singlePassTimer = (this._singlePassTimer ?? 0) - rawDt;
    if (this._singlePassTimer <= 0) { this._singlePassTimer = 0.5; this.forceSinglePassTransparents(g.scene); }

    // fog of war (each team ~10Hz, alternating)
    if (g.running) {
      this._fogTimer -= rawDt;
      if (this._fogTimer <= 0) {
        this._fogTimer = 0.05;
        this._fogTeamToggle ^= 1;
        this.computeFog(this._fogTeamToggle ? TEAM.SUNWARD : TEAM.DUSKWARD);
      }
      const team = g.player?.team;
      if (this.fog.vis[team]) this.fog.updateTexture(team, rawDt);
      this.applyUnitVisibility(team);
      this.foliage?.update(g.time, g.units);
    }
  }

  // The sun's shadow map is re-rendered every 2nd frame (every frame on ultra): it is ~60 depth draws, and at 60 fps a
  // one-frame-old shadow for a moving unit is not visible. The shadow matrix is only updated together with the map, so
  // static shadows stay exact while the camera pans. Returns true if this frame re-renders the shadow map.
  scheduleShadows(renderer) {
    const sm = renderer?.shadowMap;
    if (!sm) return false;
    sm.autoUpdate = false;
    this._shadowFrame = (this._shadowFrame ?? 0) + 1;
    const every = this.quality === 'ultra' ? 1 : 2;
    if (this._shadowDirty || this._shadowFrame % every === 0) {
      this._shadowDirty = false;
      this._shadowFrame = 0;
      sm.needsUpdate = true;
    }
    this.shadowThisFrame = sm.needsUpdate;
    return sm.needsUpdate;
  }

  // three.js draws transparent DoubleSide materials twice (back faces, then front faces) and flips material.side +
  // needsUpdate around each pass, which re-resolves the shader program (getParameters/getProgramCacheKey) for every
  // such object on every frame. Decals, rings and VFX here never write depth, so a single pass looks the same.
  forceSinglePassTransparents(scene) {
    scene.traverseVisible((o) => {
      const m = o.material;
      if (!m) return;
      for (const mm of Array.isArray(m) ? m : [m]) {
        if (mm.transparent && mm.side === THREE.DoubleSide && !mm.forceSinglePass && !mm.depthWrite) mm.forceSinglePass = true;
      }
    });
  }

  applyUnitVisibility(team) {
    if (!this.fog.vis[team]) return;
    for (const u of this.game.units) {
      if (u.team === team || u.isStructure || !u.object) continue;
      const vis = this.game.canSee(team, u);
      if (!vis) {
        if (u.object.visible) { u.object.visible = false; u.data._fowHidden = true; }
      } else if (u.data._fowHidden) {
        u.object.visible = true; u.data._fowHidden = false;
      }
    }
  }

  // ------------------------------------------------------------------ minimap
  paintMinimap(S = 512) {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(S, S);
    const d = img.data, A = this.splat.A, B = this.splat.B, avg = this.layerAvg;
    const tint = [[0.95, 1.1, 0.8], [1.1, 1, 0.9], [0.72, 0.72, 0.72], [0.9, 0.9, 0.9], [1.0, 0.82, 0.78], [1, 1, 1]];
    const sun = new THREE.Vector3(-0.5, 0.8, -0.3).normalize();
    const nrm = new THREE.Vector3();
    for (let py = 0; py < S; py++) {
      const z = -MAP_HALF + ((py + 0.5) / S) * MAP_HALF * 2;
      for (let px = 0; px < S; px++) {
        const x = -MAP_HALF + ((px + 0.5) / S) * MAP_HALF * 2;
        const i = Math.round((x + EXT) / RES), j = Math.round((z + EXT) / RES);
        const k = (j * N + i) * 4;
        const w = [A[k], A[k + 1], A[k + 2], A[k + 3], B[k], B[k + 1]];
        let r = 0, gg = 0, b = 0, s = 0;
        for (let l = 0; l < 6; l++) {
          const wl = w[l] / 255;
          r += avg[l][0] * tint[l][0] * wl; gg += avg[l][1] * tint[l][1] * wl; b += avg[l][2] * tint[l][2] * wl; s += wl;
        }
        r /= s || 1; gg /= s || 1; b /= s || 1;
        const h = this.getHeight(x, z);
        this.getNormal(x, z, nrm);
        const shade = 0.65 + 0.55 * Math.max(0, nrm.dot(sun)) + h * 0.04;
        r *= shade; gg *= shade; b *= shade;
        const lava = B[k + 2] / 255;
        r += lava * 35; gg += lava * 6;
        if (h < WATER_Y - 0.03) {
          const dep = Math.min(1, (WATER_Y - h) / 0.6);
          r = r * 0.3 + 40 * (1 - dep) + 20; gg = gg * 0.3 + 110 - dep * 40; b = b * 0.3 + 120 - dep * 20;
        }
        const o = (py * S + px) * 4;
        d[o] = Math.min(255, r); d[o + 1] = Math.min(255, gg); d[o + 2] = Math.min(255, b); d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // trees
    const k = S / (MAP_HALF * 2);
    for (const t of this.foliage?.trees ?? []) {
      if (Math.abs(t.x) > MAP_HALF || Math.abs(t.z) > MAP_HALF) continue;
      const duskward = t.type >= 4;
      ctx.fillStyle = duskward ? 'rgba(38,26,26,0.85)' : 'rgba(22,52,20,0.85)';
      ctx.beginPath();
      ctx.arc((t.x + MAP_HALF) * k, (t.z + MAP_HALF) * k, 1.25 * k * t.scale, 0, Math.PI * 2);
      ctx.fill();
    }
    return c;
  }
  getMinimapImage() { return this.minimapCanvas ?? null; }
  getMinimapDataURL() { return this.minimapCanvas?.toDataURL('image/png') ?? null; }
}
