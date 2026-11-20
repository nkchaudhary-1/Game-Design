import * as THREE from 'three';
import { DEVICE, DEVICE_DEFS, type DeviceKind } from '../shared/game/rules';
import { ITEM_BY_ID, RARITY_COLORS, type ItemDef } from '../shared/game/items';
import type { HomePub, HouseView } from '../shared/game/types';
import type { MapDef } from '../shared/map';

const lam = (c: number) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
const glowMat = (c: number) => new THREE.MeshBasicMaterial({ color: c });
function box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = true; return o;
}

/** Low-poly security devices. Origin at the floor (or ceiling mount point), facing +z. */
export function buildDeviceMesh(kind: DeviceKind, asleep = false): THREE.Group {
  const g = new THREE.Group();
  switch (kind) {
    case 'camera': {
      const body = lam(0xe9e6dc), dark = lam(0x2f3236);
      g.add(box(0.14, 0.14, 0.12, body, 0, 0, 0), box(0.1, 0.1, 0.22, body, 0, -0.02, 0.15));
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.05, 10), dark); lens.rotation.x = Math.PI / 2; lens.position.set(0, -0.02, 0.28); g.add(lens);
      g.add(box(0.03, 0.03, 0.03, glowMat(0xff4a3d), 0.05, 0.06, 0.06));
      break;
    }
    case 'motion': {
      const puck = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.05, 12), lam(0xf3ede0)); g.add(puck);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), lam(0x2f3236)); dome.position.y = -0.03; dome.rotation.x = Math.PI; g.add(dome);
      g.add(box(0.025, 0.025, 0.025, glowMat(0xff4a3d), 0.07, -0.03, 0));
      break;
    }
    case 'alarm': {
      g.add(box(0.22, 0.16, 0.1, lam(0xc7714e)), box(0.1, 0.1, 0.1, lam(0xf3ede0), 0, -0.1, 0.02));
      g.add(box(0.05, 0.05, 0.02, glowMat(0xf0c04a), 0, 0.02, 0.06));
      break;
    }
    case 'dog': {
      const fur = lam(0xb98f63), dark = lam(0x5b4630);
      g.add(box(0.2, 0.2, 0.5, fur, 0, 0.14, 0), box(0.46, 0.05, 0.62, lam(0x9aa1a6), 0, 0.025, 0));   // body + bed
      const head = box(0.18, 0.17, 0.2, fur, 0, asleep ? 0.12 : 0.3, 0.34); g.add(head);
      g.add(box(0.1, 0.07, 0.09, dark, 0, asleep ? 0.1 : 0.27, 0.46), box(0.05, 0.1, 0.04, dark, 0.09, asleep ? 0.14 : 0.4, 0.3), box(0.05, 0.1, 0.04, dark, -0.09, asleep ? 0.14 : 0.4, 0.3));
      g.add(box(0.05, 0.05, 0.22, fur, 0, 0.2, -0.34));
      break;
    }
    case 'safe': {
      const steel = lam(0x4a5157);
      g.add(box(0.7, 0.8, 0.6, steel, 0, 0.4, 0), box(0.58, 0.68, 0.04, lam(0x5d666d), 0, 0.4, 0.31));
      const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.04, 14), lam(0xf0c04a)); dial.rotation.x = Math.PI / 2; dial.position.set(0.05, 0.45, 0.34); g.add(dial);
      g.add(box(0.12, 0.04, 0.04, lam(0xf0c04a), -0.18, 0.3, 0.34));
      break;
    }
    case 'decoy': {
      g.add(box(0.34, 0.14, 0.24, lam(0x7b2d3a), 0, 0.07, 0), box(0.34, 0.03, 0.24, lam(0x5e1f2b), 0, 0.15, 0));
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.07), new THREE.MeshLambertMaterial({ color: 0x8be0ff, emissive: 0x2a6f8a, flatShading: true })); gem.position.y = 0.26; g.add(gem);
      break;
    }
  }
  return g;
}

/** A small, readable model per item category, with a rarity-coloured gem on top. */
export function buildItemMesh(def: ItemDef): THREE.Group {
  const g = new THREE.Group();
  const gold = lam(0xf0c04a), steel = lam(0xc9cdd0), dark = lam(0x2f3236);
  switch (def.cat) {
    case 'jewelry': { const r = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.025, 6, 14), def.rarity >= 2 ? gold : steel); r.rotation.x = Math.PI / 2; r.position.y = 0.04; g.add(r, box(0.18, 0.04, 0.18, lam(0x3a4252), 0, 0.01, 0)); break; }
    case 'electronics': g.add(box(0.22, 0.12, 0.16, dark, 0, 0.06, 0), box(0.16, 0.07, 0.01, glowMat(0x8ec5ff), 0, 0.07, 0.085)); break;
    case 'art': g.add(box(0.3, 0.24, 0.03, lam(0x8c6a47), 0, 0.13, 0), box(0.24, 0.18, 0.035, lam(0xc7714e), 0, 0.13, 0.002), box(0.28, 0.03, 0.12, lam(0x5b4630), 0, 0.015, -0.03)); break;
    case 'luxury': { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 14), def.rarity >= 3 ? gold : steel); c.position.y = 0.05; g.add(c, box(0.04, 0.16, 0.02, dark, 0, 0.04, 0)); break; }
    case 'currency': for (let i = 0; i < 3; i++) g.add(box(0.2, 0.035, 0.1, lam(0x6fa27a), 0, 0.02 + i * 0.037, 0, )); break;
    case 'rare': g.add(box(0.2, 0.04, 0.27, lam(0x4f7392), 0, 0.03, 0), box(0.18, 0.02, 0.25, lam(0xf3ede0), 0, 0.055, 0)); break;
    case 'collectible': { const b = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.14, 8), lam(0xc7714e)); b.position.y = 0.09; g.add(b, new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), lam(0xf3ede0))); g.children[1].position.y = 0.2; break; }
    default: { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.05, 0.16, 10), gold); c.position.y = 0.13; g.add(c, box(0.14, 0.04, 0.14, gold, 0, 0.02, 0)); }
  }
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.035), new THREE.MeshBasicMaterial({ color: RARITY_COLORS[def.rarity] }));
  gem.position.y = def.cat === 'art' ? 0.34 : 0.3; gem.name = 'gem'; g.add(gem);
  g.traverse((o) => { (o as THREE.Mesh).castShadow = true; });
  return g;
}

export function tintGhost(g: THREE.Object3D, color: number) {
  g.traverse((o) => {
    const m = o as THREE.Mesh; if (!m.isMesh) return;
    m.material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false });
    m.castShadow = false;
  });
}

/** Everything the game layer adds to the 3D world: signs, displayed items, placed devices, telegraphed detection zones, the alarm. */
export class HouseVisuals {
  readonly root = new THREE.Group();
  private signs: { mesh: THREE.Mesh; ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; last: string }[] = [];
  private slotMeshes: (THREE.Group | null)[][] = [];
  private slotKey: string[][] = [];
  private devMeshes = new Map<string, { g: THREE.Group; zone: THREE.Object3D | null; kind: DeviceKind; asleep: boolean }>();
  private beacon: { a: THREE.Mesh; b: THREE.Mesh; light: THREE.PointLight; until: number } | null = null;
  private alarmOn = false;
  private t = 0;
  private dogAsleep = false;

  constructor(private map: MapDef) {
    for (const h of map.houses) {
      const c = document.createElement('canvas'); c.width = 512; c.height = 160;
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.47), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
      sign.position.set(h.sign.x, 0.95, h.sign.z); sign.rotation.y = h.sign.ry;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.75, 0.07), lam(0x8c6a47)); post.position.set(h.sign.x, 0.38, h.sign.z);
      this.root.add(sign, post);
      this.signs.push({ mesh: sign, ctx: c.getContext('2d')!, tex, last: '' });
      this.slotMeshes.push(Array(5).fill(null)); this.slotKey.push(Array(5).fill(''));
    }
    // alarm beacon (red/blue) — one, moved to whichever house is ringing
    const a = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff3b30 }));
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshBasicMaterial({ color: 0x3b7bff }));
    const light = new THREE.PointLight(0xff3b30, 0, 22, 2);
    const grp = new THREE.Group(); grp.add(a, b, light); grp.visible = false; (grp as THREE.Group).name = 'beacon';
    this.root.add(grp);
    this.beacon = { a, b, light, until: 0 };
    this.beaconGroup = grp;
  }
  private beaconGroup!: THREE.Group;

  setHomes(homes: HomePub[]) {
    homes.forEach((h, i) => {
      const s = this.signs[i]; if (!s) return;
      const text = h.owner === 'vacant' ? `FOR SALE  $${h.price.toLocaleString()}` : h.mine ? 'YOUR HOME' : h.ownerName;
      const key = text + (h.robbed ? '!' : '');
      if (s.last === key) return;
      s.last = key;
      const bg = h.owner === 'vacant' ? '#c7714e' : h.mine ? '#7c9678' : '#e6d9bd', fg = h.owner === 'vacant' || h.mine ? '#ffffff' : '#2f3236';
      const ctx = s.ctx; ctx.fillStyle = bg; ctx.fillRect(0, 0, 512, 160);
      ctx.fillStyle = fg; ctx.font = '700 56px "Outfit Variable", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      let size = 56; while (ctx.measureText(text).width > 470 && size > 20) { size -= 3; ctx.font = `700 ${size}px "Outfit Variable", system-ui, sans-serif`; }
      ctx.fillText(text, 256, h.robbed ? 62 : 82);
      if (h.robbed) { ctx.font = '600 30px "Outfit Variable", system-ui, sans-serif'; ctx.fillText('recently burgled', 256, 122); }
      s.tex.needsUpdate = true;
    });
  }

  /** Called whenever the server tells us which house we are inside (or none). */
  setView(view: HouseView | null) {
    const id = view?.id ?? -1;
    // items
    this.map.houses.forEach((h) => {
      for (let k = 0; k < 5; k++) {
        const it = id === h.id ? view!.slots[k] : null;
        const key = it ? it.def : '';
        if (this.slotKey[h.id][k] === key) continue;
        this.slotKey[h.id][k] = key;
        const old = this.slotMeshes[h.id][k]; if (old) { this.root.remove(old); this.slotMeshes[h.id][k] = null; }
        if (it) {
          const m = buildItemMesh(ITEM_BY_ID[it.def]); const s = h.slots[k];
          m.position.set(s.x, s.y, s.z); this.root.add(m); this.slotMeshes[h.id][k] = m;
        }
      }
    });
    // devices
    const want = new Set<string>();
    if (view) for (const d of view.devices) {
      const key = `${view.id}:${d.id}`; want.add(key);
      if (this.devMeshes.has(key)) continue;
      const floor = this.map.houses[view.id].floorY, ceiling = DEVICE_DEFS[d.kind].mount === 'ceiling';
      const g = buildDeviceMesh(d.kind, false);
      g.position.set(d.x, ceiling ? floor + 2.55 : floor, d.z); g.rotation.y = d.yaw;
      if (d.kind === 'camera') g.rotation.x = 0.35;
      this.root.add(g);
      let zone: THREE.Object3D | null = null;
      if (d.kind === 'camera') {
        const L = DEVICE.cameraRange, half = Math.acos(DEVICE.cameraCos);
        const geo = new THREE.CircleGeometry(L, 24, -half, half * 2); geo.rotateX(-Math.PI / 2);   // sector centred on +x, flat on the floor
        const fan = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xff4a3d, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide }));
        fan.rotation.y = d.yaw - Math.PI / 2; fan.position.set(d.x, floor + 0.04, d.z);   // +x → (sin yaw, cos yaw)
        zone = fan;
      } else if (d.kind === 'motion') {
        const disc = new THREE.Mesh(new THREE.CircleGeometry(DEVICE.motionRadius, 28), new THREE.MeshBasicMaterial({ color: 0xff4a3d, transparent: true, opacity: 0.09, depthWrite: false }));
        disc.rotation.x = -Math.PI / 2; disc.position.set(d.x, floor + 0.04, d.z); zone = disc;
      }
      if (zone) this.root.add(zone);
      this.devMeshes.set(key, { g, zone, kind: d.kind, asleep: false });
    }
    for (const [key, v] of this.devMeshes) if (!want.has(key)) { this.root.remove(v.g); if (v.zone) this.root.remove(v.zone); this.devMeshes.delete(key); }
  }
  setDogAsleep(asleep: boolean) {
    if (asleep === this.dogAsleep) return;
    this.dogAsleep = asleep;
    for (const [key, v] of this.devMeshes) if (v.kind === 'dog') {
      const pos = v.g.position.clone(), rot = v.g.rotation.y; this.root.remove(v.g);
      const g = buildDeviceMesh('dog', asleep); g.position.copy(pos); g.rotation.y = rot; this.root.add(g); this.devMeshes.set(key, { ...v, g });
    }
  }

  /** Alarm ringing at a house: red/blue beacon over the porch. */
  setAlarm(on: boolean, x = 0, y = 0, z = 0) {
    this.alarmOn = on; this.beaconGroup.visible = on;
    if (on) this.beaconGroup.position.set(x, y + 3.2, z);
    else if (this.beacon) this.beacon.light.intensity = 0;
  }
  get ringing() { return this.alarmOn; }

  update(dt: number, night: number) {
    this.t += dt;
    for (const [, v] of this.devMeshes) {
      if (v.kind === 'motion' && v.zone) (((v.zone as THREE.Mesh).material) as THREE.MeshBasicMaterial).opacity = 0.07 + 0.05 * (0.5 + 0.5 * Math.sin(this.t * 3));
    }
    for (let i = 0; i < this.slotMeshes.length; i++) for (const m of this.slotMeshes[i]) if (m) { const gem = m.getObjectByName('gem'); if (gem) { gem.rotation.y = this.t * 2; gem.position.y += Math.sin(this.t * 3) * 0.0005; } }
    if (this.alarmOn && this.beacon) {
      const flip = Math.floor(this.t * 4) % 2 === 0;
      this.beacon.a.visible = flip; this.beacon.b.visible = !flip;
      this.beacon.light.color.setHex(flip ? 0xff3b30 : 0x3b7bff); this.beacon.light.intensity = 40 + night * 20;
    }
    void night;
  }
}
