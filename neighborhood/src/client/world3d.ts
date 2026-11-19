import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { liftNearest, type LiftState } from '../shared/lift';
import { PK, type DoorDef, type MapDef, type Piece } from '../shared/map';
import { damp } from '../shared/math';

const hash01 = (i: number) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

const FONT = '"Outfit Variable", system-ui, sans-serif';

function baseGeometry(k: number): THREE.BufferGeometry {
  let g: THREE.BufferGeometry;
  switch (k) {
    case PK.BOX: g = new THREE.BoxGeometry(1, 1, 1); break;
    case PK.CYL: g = new THREE.CylinderGeometry(0.5, 0.5, 1, 12); break;
    case PK.CONE: g = new THREE.ConeGeometry(0.5, 1, 8); break;
    case PK.ICO: g = new THREE.IcosahedronGeometry(0.5, 1); break;
    case PK.SPHERE: g = new THREE.SphereGeometry(0.5, 10, 8); break;
    default: { // gable roof prism: ridge along x, base across z
      const A = [-0.5, -0.5, -0.5], B = [0.5, -0.5, -0.5], Cc = [0.5, -0.5, 0.5], D = [-0.5, -0.5, 0.5], L = [-0.5, 0.5, 0], R = [0.5, 0.5, 0];
      const tris = [A, L, R, A, R, B, D, R, L, D, Cc, R, A, D, L, B, R, Cc, A, B, Cc, A, Cc, D];
      g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3));
      g.computeVertexNormals();
      return g;
    }
  }
  g = g.index ? g.toNonIndexed() : g;
  g.deleteAttribute('uv');
  return g;
}

export function labelTexture(text: string, bg: number, fg: number, aspect: number) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = Math.max(32, Math.round(512 / aspect));
  const ctx = c.getContext('2d')!;
  const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
  ctx.fillStyle = hex(bg);
  ctx.beginPath(); ctx.roundRect(0, 0, c.width, c.height, Math.min(c.height * 0.2, 28)); ctx.fill();
  let size = c.height * 0.62;
  ctx.font = `700 ${size}px ${FONT}`;
  while (ctx.measureText(text).width > c.width * 0.92 && size > 10) { size -= 2; ctx.font = `700 ${size}px ${FONT}`; }
  ctx.fillStyle = hex(fg); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, c.width / 2, c.height / 2 + size * 0.04);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

interface DoorObj { def: DoorDef; pivot: THREE.Group; base: number; sgn: number; angle: number }
interface LampObj { switchId: number; shade: THREE.Mesh; pos: THREE.Vector3; group: number }

export class World3D {
  readonly root = new THREE.Group();
  private groupObjs = new Map<number, THREE.Object3D[]>();
  private hidden = new Set<number>();
  private doors: DoorObj[] = [];
  private lamps: LampObj[] = [];
  private lampLights: THREE.PointLight[] = [];
  private lampOn = new Set<number>();
  private glowMats: THREE.MeshLambertMaterial[] = [];
  private timeU = { value: 0 };
  private pools: THREE.InstancedMesh | null = null;
  private streetPos: THREE.Vector3[] = [];
  private nightLevel = 0;
  private doorOpen = new Set<number>();
  private foundMeshes: { mesh: THREE.Group; id: number }[] = [];
  // lift
  private cabGroup = new THREE.Group();
  private cabLeaves: { m: THREE.Mesh; leaf: number }[] = [];
  private cabCeil: THREE.Mesh | null = null;
  private landingLeaves: { m: THREE.Mesh; leaf: number; floor: number }[] = [];
  private indicators: { mesh: THREE.Mesh; ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; last: string }[] = [];
  private t = 0;

  constructor(private map: MapDef) {
    this.buildPieces();
    this.buildLabels();
    this.buildDoors();
    this.buildLamps();
    this.buildFound();
    this.buildLift();
    this.buildLampPools();
    for (let i = 0; i < 8; i++) {
      const l = new THREE.PointLight(0xffd9a0, 0, 15, 2);
      this.lampLights.push(l); this.root.add(l);
    }
  }

  private register(obj: THREE.Object3D, group: number) {
    this.root.add(obj);
    if (group < 0) return;
    let a = this.groupObjs.get(group);
    if (!a) this.groupObjs.set(group, (a = []));
    a.push(obj);
  }

  // ───────────────────────── merged static geometry ─────────────────────────
  private buildPieces() {
    const bases = new Map<number, THREE.BufferGeometry>();
    const buckets = new Map<string, { group: number; alpha: number; cast: boolean; glow: boolean; wind: boolean; geos: THREE.BufferGeometry[] }>();
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3(), yAxis = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    let idx = 0;
    for (const p of this.map.pieces as Piece[]) {
      idx++;
      const key = `${p.group}|${p.alpha}|${p.cast ? 1 : 0}|${p.glow ? 1 : 0}|${p.wind ? 1 : 0}`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { group: p.group, alpha: p.alpha, cast: p.cast, glow: p.glow, wind: p.wind, geos: [] }));
      let base = bases.get(p.k);
      if (!base) bases.set(p.k, (base = baseGeometry(p.k)));
      const g = base.clone();
      q.setFromAxisAngle(yAxis, p.ry); pos.set(p.x, p.y, p.z); sc.set(p.sx, p.sy, p.sz);
      g.applyMatrix4(m4.compose(pos, q, sc));
      col.setHex(p.color);
      const posA = g.attributes.position, n = posA.count, arr = new Float32Array(n * 3);
      // a little per-piece variation, and darker where a box meets what is below it (contact shading baked into vertex colour)
      const plain = p.alpha < 1 || p.glow;
      const jit = plain ? 1 : 0.965 + hash01(idx) * 0.07;
      const useAO = p.k === PK.BOX && p.sy >= 0.5 && !plain;
      const yBase = p.y - p.sy / 2, band = Math.min(1.0, p.sy * 0.45);
      for (let i = 0; i < n; i++) {
        let f = jit;
        if (useAO) { const t = Math.min(1, Math.max(0, (posA.getY(i) - yBase) / band)); f *= 1 - 0.2 * (1 - t) * (1 - t); }
        arr[i * 3] = col.r * f; arr[i * 3 + 1] = col.g * f; arr[i * 3 + 2] = col.b * f;
      }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      b.geos.push(g);
    }
    for (const b of buckets.values()) {
      const merged = mergeGeometries(b.geos, false);
      for (const g of b.geos) g.dispose();
      if (!merged) continue;
      const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, transparent: b.alpha < 1, opacity: b.alpha, depthWrite: b.alpha >= 1 });
      if (b.glow) { material.emissive = new THREE.Color(0xffc772); material.emissiveIntensity = 0; material.userData.glowScale = b.alpha < 1 ? 2.6 : 1.1; this.glowMats.push(material); }
      if (b.wind) this.addSway(material);
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = b.cast; mesh.receiveShadow = true;
      this.register(mesh, b.group);
    }
  }

  /** Foliage moves in the wind: a vertex-shader sway that grows with height. Geometry is merged in world space, so `position` is world position. */
  private addSway(material: THREE.MeshLambertMaterial) {
    material.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.timeU;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `
        vec3 transformed = vec3( position );
        float hf = clamp((position.y - 1.0) / 3.0, 0.0, 1.0);
        float ph = position.x * 0.45 + position.z * 0.37;
        transformed.x += (sin(uTime * 1.3 + ph) * 0.07 + sin(uTime * 2.9 + ph * 1.9) * 0.025) * hf;
        transformed.z += sin(uTime * 1.1 + ph * 0.8) * 0.045 * hf;`);
    };
    material.customProgramCacheKey = () => 'sway';
  }

  /** Soft pools of warm light on the ground under each street lamp (additive, only visible at night). */
  private buildLampPools() {
    const lamps = this.map.streetLamps;
    this.streetPos = lamps.map((l) => new THREE.Vector3(l.x, l.y, l.z));
    if (!lamps.length) return;
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.45, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: 0xffd59a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const inst = new THREE.InstancedMesh(geo, mat, lamps.length);
    const m = new THREE.Matrix4();
    lamps.forEach((l, i) => { m.compose(new THREE.Vector3(l.x, 0.16, l.z), new THREE.Quaternion(), new THREE.Vector3(7.5, 1, 7.5)); inst.setMatrixAt(i, m); });
    inst.frustumCulled = false; inst.renderOrder = 2;
    this.pools = inst;
    this.root.add(inst);
  }

  /** 0 (day) … 1 (full night): windows and lamp heads glow, ground pools fade in. */
  private setNight(n: number) {
    if (Math.abs(n - this.nightLevel) < 0.003) return;
    this.nightLevel = n;
    for (const m of this.glowMats) m.emissiveIntensity = n * (m.userData.glowScale as number);
    if (this.pools) (this.pools.material as THREE.MeshBasicMaterial).opacity = n * 0.5;
  }

  private buildLabels() {
    for (const l of this.map.labels) {
      if (!l.text) continue;
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(l.w, l.h),
        new THREE.MeshBasicMaterial({ map: labelTexture(l.text, l.bg, l.fg, l.w / l.h), transparent: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      );
      mesh.position.set(l.x, l.y, l.z); mesh.rotation.y = l.ry;
      this.register(mesh, l.group);
    }
  }

  // ───────────────────────── doors ─────────────────────────
  private buildDoors() {
    const handle = new THREE.MeshLambertMaterial({ color: 0x2f3236 });
    for (const d of this.map.doors) {
      const pivot = new THREE.Group();
      pivot.position.set(d.hx, d.y0, d.hz);
      const base = Math.atan2(-d.dz, d.dx);
      const sgn = d.dz * d.nx - d.dx * d.nz > 0 ? 1 : -1;
      pivot.rotation.y = base;
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(d.width, d.height, d.thick), new THREE.MeshLambertMaterial({ color: d.color, flatShading: true }));
      leaf.position.set(d.width / 2, d.height / 2, 0);
      leaf.castShadow = true; leaf.receiveShadow = true;
      pivot.add(leaf);
      for (const s of [-1, 1]) {
        const h = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 0.07), handle);
        h.position.set(d.width - 0.14, d.height * 0.45, s * (d.thick / 2 + 0.03));
        pivot.add(h);
      }
      this.register(pivot, d.group);
      this.doors.push({ def: d, pivot, base, sgn, angle: 0 });
    }
  }
  setDoors(open: number[]) { this.doorOpen = new Set(open); }

  // ───────────────────────── lamps ─────────────────────────
  private buildLamps() {
    for (const l of this.map.lamps) {
      const grp = new THREE.Group();
      grp.position.set(l.x, l.y, l.z);
      const cord = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.4, 0.025), new THREE.MeshLambertMaterial({ color: 0x2f3236 }));
      cord.position.y = 0.2;
      const shade = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), new THREE.MeshBasicMaterial({ color: 0xa9a59c }));
      grp.add(cord, shade);
      this.register(grp, l.group);
      this.lamps.push({ switchId: l.switchId, shade, pos: new THREE.Vector3(l.x, l.y - 0.2, l.z), group: l.group });
    }
  }
  setSwitches(on: number[]) {
    this.lampOn = new Set(on);
    for (const l of this.lamps) (l.shade.material as THREE.MeshBasicMaterial).color.setHex(this.lampOn.has(l.switchId) ? 0xffe9a8 : 0xa9a59c);
  }

  // ───────────────────────── collectibles ─────────────────────────
  private buildFound() {
    const gold = new THREE.MeshLambertMaterial({ color: 0xf0c04a, emissive: 0x6b4a00, flatShading: true });
    for (const f of this.map.found) {
      const g = new THREE.Group();
      g.position.set(f.x, f.y, f.z);
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.08, 0.26, 8), gold); cup.position.y = 0.2;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 6), gold); stem.position.y = 0.06;
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.04, 0.2), gold);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.012, 6, 24), new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.6 }));
      ring.rotation.x = Math.PI / 2; ring.position.y = 0.2;
      g.add(cup, stem, base, ring);
      g.castShadow = true;
      this.register(g, f.group);
      this.foundMeshes.push({ mesh: g, id: f.id });
    }
  }
  setFound(ids: Set<number>) { for (const f of this.foundMeshes) f.mesh.visible = !ids.has(f.id); }

  // ───────────────────────── lift ─────────────────────────
  private indicator(w: number, h: number) {
    const c = document.createElement('canvas'); c.width = 128; c.height = 128 * (h / w);
    const ctx = c.getContext('2d')!;
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex }));
    const rec = { mesh, ctx, tex, last: '' };
    this.indicators.push(rec);
    return rec;
  }
  private drawIndicator(rec: { ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; last: string }, text: string, arrow: number) {
    const key = text + arrow;
    if (rec.last === key) return;
    rec.last = key;
    const { ctx } = rec, w = ctx.canvas.width, h = ctx.canvas.height;
    ctx.fillStyle = '#2f3236'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f0c04a'; ctx.font = `700 ${h * 0.78}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2 - (arrow ? h * 0.2 : 0), h / 2 + 4);
    if (arrow) {
      ctx.fillStyle = '#c7714e'; ctx.beginPath();
      const ax = w / 2 + h * 0.62, ay = h / 2, s = h * 0.22;
      if (arrow > 0) { ctx.moveTo(ax - s, ay + s * 0.6); ctx.lineTo(ax + s, ay + s * 0.6); ctx.lineTo(ax, ay - s * 0.8); } else { ctx.moveTo(ax - s, ay - s * 0.6); ctx.lineTo(ax + s, ay - s * 0.6); ctx.lineTo(ax, ay + s * 0.8); }
      ctx.fill();
    }
    rec.tex.needsUpdate = true;
  }
  private buildLift() {
    const def = this.map.lift;
    const box = (rel: number[], color: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(rel[3] - rel[0], rel[4] - rel[1], rel[5] - rel[2]), new THREE.MeshLambertMaterial({ color, flatShading: true }));
      m.position.set((rel[0] + rel[3]) / 2, (rel[1] + rel[4]) / 2, (rel[2] + rel[5]) / 2);
      m.castShadow = true; m.receiveShadow = true;
      return m;
    };
    for (const p of def.cab) {
      const m = box(p.rel, p.color);
      if (p.leaf) { m.userData.base = m.position.x; this.cabLeaves.push({ m, leaf: p.leaf }); }
      if (p.noCam) this.cabCeil = m;
      this.cabGroup.add(m);
    }
    const panel = box([def.hw - 0.07, 0.95, -def.hd + 0.35, def.hw - 0.02, 1.5, -def.hd + 0.75], 0x2f3236);
    this.cabGroup.add(panel);
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.08, 0.08), new THREE.MeshBasicMaterial({ color: 0xf0c04a }));
      b.position.set(def.hw - 0.09, 1.0 + i * 0.12, -def.hd + 0.55); this.cabGroup.add(b);
    }
    const cabInd = this.indicator(0.5, 0.32);
    cabInd.mesh.position.set(0, 2.35, -def.hd + 0.07);
    this.cabGroup.add(cabInd.mesh);
    this.root.add(this.cabGroup);

    for (const l of def.landings) {
      for (const p of l.parts) {
        const m = box(p.rel, p.color);
        this.register(m, l.group);
        this.landingLeaves.push({ m, leaf: p.leaf, floor: l.floor });
        m.userData.base = m.position.x;
      }
      const ind = this.indicator(0.5, 0.32);
      const ip = def.indicatorPos[l.floor];
      ind.mesh.position.set(ip.x, ip.y, ip.z); ind.mesh.rotation.y = Math.PI;
      this.register(ind.mesh, l.group);
      // call button
      const cp = def.callPos[l.floor];
      const btn = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.26, 0.04), new THREE.MeshLambertMaterial({ color: 0x2f3236 }));
      btn.position.set(cp.x, cp.y, cp.z);
      const dot = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.02), new THREE.MeshBasicMaterial({ color: 0xc7714e }));
      dot.position.set(cp.x, cp.y + 0.05, cp.z - 0.03);
      this.register(btn, l.group); this.register(dot, l.group);
    }
  }

  // ───────────────────────── per-frame ─────────────────────────
  setHiddenGroups(hidden: Set<number>) {
    if (hidden.size === this.hidden.size && [...hidden].every((g) => this.hidden.has(g))) return;
    this.hidden = new Set(hidden);
    for (const [g, objs] of this.groupObjs) for (const o of objs) o.visible = !hidden.has(g);
  }
  isHidden(g: number) { return g >= 0 && this.hidden.has(g); }

  /** `nearLamps`: lamps nearest the viewer get a real light (pool of 6; the count never changes, so no shader recompiles). */
  update(dt: number, lift: LiftState, viewer: THREE.Vector3, insideCab: boolean, night = 0) {
    this.t += dt;
    this.timeU.value += dt;
    this.setNight(night);
    const def = this.map.lift;
    for (const d of this.doors) {
      const target = this.doorOpen.has(d.def.id) ? d.sgn * 1.65 : 0;
      d.angle = damp(d.angle, target, 9, dt);
      d.pivot.rotation.y = d.base + d.angle;
    }
    // lift pose
    this.cabGroup.position.set(def.cx, lift.y, def.cz);
    for (const l of this.cabLeaves) l.m.position.x = l.m.userData.base + l.leaf * def.slide * lift.door;
    const at = Math.abs(def.floors[liftNearest(def, lift.y)] - lift.y) < 0.02 ? liftNearest(def, lift.y) : -1;
    for (const l of this.landingLeaves) l.m.position.x = l.m.userData.base + l.leaf * def.slide * (l.floor === at ? lift.door : 0);
    if (this.cabCeil) this.cabCeil.visible = !insideCab;
    const near = liftNearest(def, lift.y);
    const arrow = lift.mode === 2 ? Math.sign(def.floors[lift.target] - lift.y) : 0;
    for (const r of this.indicators) this.drawIndicator(r, def.names[near], arrow);
    // lamps → pool of real lights
    const cand: { pos: THREE.Vector3; d: number; i: number; color: number }[] = [];
    for (const l of this.lamps) if (this.lampOn.has(l.switchId) && !this.isHidden(l.group)) cand.push({ pos: l.pos, d: l.pos.distanceToSquared(viewer), i: 26, color: 0xffd9a0 });
    if (this.nightLevel > 0.12) for (const p of this.streetPos) { const d = p.distanceToSquared(viewer); if (d < 1400) cand.push({ pos: p, d, i: 20 * this.nightLevel, color: 0xffcf8a }); }
    cand.sort((a, b) => a.d - b.d);
    this.lampLights.forEach((light, i) => {
      const c = cand[i];
      if (c && c.d < 1400) { light.position.copy(c.pos); light.intensity = c.i; light.color.setHex(c.color); } else light.intensity = 0;
    });
    for (const f of this.foundMeshes) { f.mesh.rotation.y = this.t * 1.6; f.mesh.children[0].position.y = 0.2 + Math.sin(this.t * 2.2) * 0.04; }
  }
}
