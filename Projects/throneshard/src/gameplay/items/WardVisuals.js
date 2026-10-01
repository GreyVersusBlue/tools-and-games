import * as THREE from 'three';

// Vision-range rings for wards placed by the local player's team (observer = gold vision radius,
// sentry = blue true-sight radius). Bright for a few seconds after placement, then a faint persistent ring;
// all allied ward rings brighten again while the player is targeting a ward item (to plan coverage).
export class WardVisuals {
  constructor(game) {
    this.game = game;
    this.rings = new Map(); // ward -> { mesh, born }
    this.wardTargeting = false;
    this.preview = null;
  }

  init() {
    const bus = this.game.bus;
    bus.on('ward:placed', ({ ward }) => this.add(ward));
    bus.on('unit:died', ({ unit }) => { if (unit?.kind === 'ward') this.removeFor(unit); });
    bus.on('unit:removed', ({ unit }) => { if (unit?.kind === 'ward') this.removeFor(unit); });
    bus.on('input:targeting', ({ targeting }) => {
      const id = targeting?.ability?.def?.id;
      this.wardTargeting = id === 'lookout_ward' || id === 'seeker_ward';
    });
  }

  add(ward) {
    const g = this.game;
    if (!ward || ward.team !== g.player?.team || this.rings.has(ward)) return;
    const obs = ward.subtype === 'observer';
    const r = obs ? ward.getStat('vision') : (ward.data?.trueSightRadius || ward.data?.trueSight || 22);
    const col = obs ? 0xffd060 : 0x5ab0ff;
    const grp = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.25, r, 96).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.6, depthWrite: false, depthTest: false, side: THREE.DoubleSide }));
    const fill = new THREE.Mesh(new THREE.CircleGeometry(r, 64).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.07, depthWrite: false, depthTest: false, side: THREE.DoubleSide }));
    grp.add(fill, ring);
    grp.position.set(ward.position.x, Math.max(g.world?.getHeight?.(ward.position.x, ward.position.z) ?? 0, 0) + 0.15, ward.position.z);
    grp.traverse((o) => { o.renderOrder = 4; o.userData.noPick = true; o.frustumCulled = false; o.raycast = () => {}; });
    g.scene?.add(grp);
    this.rings.set(ward, { mesh: grp, ring, fill, born: g.realTime ?? 0 });
  }

  removeFor(ward) {
    const e = this.rings.get(ward);
    if (!e) return;
    e.mesh.parent?.remove(e.mesh);
    e.mesh.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
    this.rings.delete(ward);
  }

  update() {
    const t = this.game.realTime ?? 0;
    for (const [ward, e] of this.rings) {
      if (!ward.alive) { this.removeFor(ward); continue; }
      const age = t - e.born;
      const k = this.wardTargeting ? 1 : Math.max(0, 1 - Math.max(0, age - 3) / 2);
      e.ring.material.opacity = 0.18 + 0.45 * k;
      e.fill.material.opacity = 0.02 + 0.06 * k;
    }
  }
}
