import * as THREE from 'three';
import { clamp } from '../shared/math';
import { LOOK_HAIR, LOOK_PANTS, LOOK_SHIRT, LOOK_SKIN, type Look } from '../shared/protocol';

export interface Pose { speed: number; grounded: boolean; seated: boolean; emote: number }

const BOX = new THREE.BoxGeometry(1, 1, 1);
const ICO = new THREE.IcosahedronGeometry(0.5, 1);
const CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 14);
const mat = (c: number) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
function mesh(g: THREE.BufferGeometry, m: THREE.Material, sx: number, sy: number, sz: number, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(g, m);
  o.scale.set(sx, sy, sz); o.position.set(x, y, z);
  o.castShadow = true;
  return o;
}

/** Low-poly flat-colour person, animated procedurally (no skeleton, no assets). */
export class Avatar {
  root = new THREE.Group();
  private body = new THREE.Group();
  private torso!: THREE.Mesh;
  private head = new THREE.Group();
  private thigh: THREE.Group[] = [];
  private shin: THREE.Group[] = [];
  private arm: THREE.Group[] = [];
  private fore: THREE.Group[] = [];
  private hairGroup = new THREE.Group();
  private eyes: THREE.Mesh[] = [];
  private blink = 2 + Math.random() * 3;
  private mats: Record<'skin' | 'shirt' | 'pants' | 'hair', THREE.MeshLambertMaterial>;
  private phase = 0;
  private t = Math.random() * 10;
  private nameSprite: THREE.Sprite;
  private bubble: THREE.Sprite | null = null;
  private bubbleLeft = 0;
  name: string;

  constructor(look: Look, name: string) {
    this.name = name;
    this.mats = { skin: mat(0xe0b48c), shirt: mat(0xc7714e), pants: mat(0x3a4252), hair: mat(0x5a3a22) };
    const shoe = mat(0x2f3236), dark = mat(0x2f3236);
    this.root.add(this.body);

    // legs (hip pivot at 0.86 m)
    for (const sx of [-1, 1]) {
      const hip = new THREE.Group(); hip.position.set(sx * 0.12, 0.86, 0);
      hip.add(mesh(BOX, this.mats.pants, 0.18, 0.45, 0.2, 0, -0.22, 0));
      const knee = new THREE.Group(); knee.position.set(0, -0.44, 0);
      knee.add(mesh(BOX, this.mats.pants, 0.16, 0.4, 0.18, 0, -0.2, 0));
      knee.add(mesh(BOX, shoe, 0.18, 0.1, 0.3, 0, -0.41, 0.05));
      hip.add(knee);
      this.body.add(hip);
      this.thigh.push(hip); this.shin.push(knee);
    }
    this.torso = mesh(BOX, this.mats.shirt, 0.46, 0.58, 0.26, 0, 1.15, 0);
    this.body.add(this.torso);
    this.body.add(mesh(BOX, this.mats.pants, 0.44, 0.16, 0.25, 0, 0.88, 0));
    // arms
    for (const sx of [-1, 1]) {
      const sh = new THREE.Group(); sh.position.set(sx * 0.32, 1.4, 0);
      sh.add(mesh(BOX, this.mats.shirt, 0.13, 0.3, 0.15, 0, -0.14, 0));
      const el = new THREE.Group(); el.position.set(0, -0.29, 0);
      el.add(mesh(BOX, this.mats.skin, 0.1, 0.27, 0.12, 0, -0.13, 0));
      el.add(mesh(ICO, this.mats.skin, 0.13, 0.13, 0.13, 0, -0.29, 0));
      sh.add(el);
      this.body.add(sh);
      this.arm.push(sh); this.fore.push(el);
    }
    // head
    this.head.position.set(0, 1.6, 0);
    this.head.add(mesh(ICO, this.mats.skin, 0.38, 0.4, 0.38));
    for (const sx of [-1, 1]) { const eye = mesh(BOX, dark, 0.045, 0.06, 0.03, sx * 0.075, 0.02, 0.185); this.eyes.push(eye); this.head.add(eye); }
    this.head.add(mesh(BOX, this.mats.skin, 0.05, 0.05, 0.04, 0, -0.03, 0.2));
    this.head.add(this.hairGroup);
    this.body.add(this.head);
    this.body.add(mesh(BOX, this.mats.skin, 0.1, 0.13, 0.1, 0, 1.5, 0));   // neck
    // soft blob under the feet: grounds the figure even where real shadows are off
    const blob = new THREE.Mesh(new THREE.CircleGeometry(0.42, 18), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.2, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2; blob.position.y = 0.025; blob.renderOrder = 1;
    this.root.add(blob);

    this.nameSprite = this.makeNameplate(name);
    this.root.add(this.nameSprite);
    this.setLook(look);
  }

  setLook(look: Look) {
    this.mats.skin.color.setHex(LOOK_SKIN[look.skin]);
    this.mats.shirt.color.setHex(LOOK_SHIRT[look.shirt]);
    this.mats.pants.color.setHex(LOOK_PANTS[look.pants]);
    this.mats.hair.color.setHex(LOOK_HAIR[look.hair]);
    for (const c of [...this.hairGroup.children]) { this.hairGroup.remove(c); }
    const h = this.mats.hair;
    const capCol = look.shirt === 5 ? 0xc7714e : 0x2f3236;
    switch (look.style) {
      case 0: // short
        this.hairGroup.add(mesh(ICO, h, 0.42, 0.3, 0.44, 0, 0.1, -0.02), mesh(BOX, h, 0.4, 0.2, 0.1, 0, 0.0, -0.17));
        break;
      case 1: // long
        this.hairGroup.add(mesh(ICO, h, 0.43, 0.3, 0.45, 0, 0.1, -0.02), mesh(BOX, h, 0.4, 0.5, 0.12, 0, -0.12, -0.17), mesh(BOX, h, 0.06, 0.34, 0.2, 0.2, -0.05, -0.06), mesh(BOX, h, 0.06, 0.34, 0.2, -0.2, -0.05, -0.06));
        break;
      case 2: // bun
        this.hairGroup.add(mesh(ICO, h, 0.42, 0.28, 0.44, 0, 0.1, -0.02), mesh(ICO, h, 0.18, 0.18, 0.18, 0, 0.3, -0.08));
        break;
      default: { // cap
        const m = mat(capCol);
        this.hairGroup.add(mesh(ICO, m, 0.44, 0.3, 0.46, 0, 0.11, -0.01), mesh(CYL, m, 0.3, 0.025, 0.2, 0, 0.1, 0.25), mesh(BOX, h, 0.4, 0.12, 0.1, 0, -0.02, -0.17));
      }
    }
  }

  private makeNameplate(text: string) {
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d')!;
    ctx.font = '700 34px "Outfit Variable", system-ui, sans-serif';
    const w = Math.ceil(ctx.measureText(text).width) + 40;
    c.width = w; c.height = 56;
    ctx.font = '700 34px "Outfit Variable", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(47,50,54,0.82)';
    ctx.beginPath(); ctx.roundRect(0, 0, w, 56, 28); ctx.fill();
    ctx.fillStyle = '#f3ede0'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    ctx.fillText(text, w / 2, 30);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
    s.scale.set((w / 56) * 0.26, 0.26, 1);
    s.position.y = 2.12;
    return s;
  }

  say(text: string) {
    if (this.bubble) { this.root.remove(this.bubble); (this.bubble.material as THREE.SpriteMaterial).map?.dispose(); }
    const words = text.split(' '); const lines: string[] = []; let cur = '';
    for (const w of words) { if ((cur + ' ' + w).trim().length > 26 && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
    if (cur) lines.push(cur);
    const shown = lines.slice(0, 4);
    const c = document.createElement('canvas'); const ctx = c.getContext('2d')!;
    ctx.font = '600 30px "Outfit Variable", system-ui, sans-serif';
    const w = Math.min(560, Math.max(...shown.map((l) => ctx.measureText(l).width)) + 44), h = shown.length * 38 + 30;
    c.width = w; c.height = h + 14;
    ctx.font = '600 30px "Outfit Variable", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(243,237,224,0.96)';
    ctx.beginPath(); ctx.roundRect(0, 0, w, h, 22); ctx.fill();
    ctx.beginPath(); ctx.moveTo(w / 2 - 12, h - 1); ctx.lineTo(w / 2, h + 13); ctx.lineTo(w / 2 + 12, h - 1); ctx.fill();
    ctx.fillStyle = '#2f3236'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    shown.forEach((l, i) => ctx.fillText(l, w / 2, 33 + i * 38));
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
    const k = 0.0062;
    s.scale.set(c.width * k, c.height * k, 1);
    s.position.y = 2.42 + (c.height * k) / 2;
    this.bubble = s; this.bubbleLeft = 6;
    this.root.add(s);
  }

  /** Fade plates with distance so a crowd stays readable. */
  setPlateAlpha(a: number) { (this.nameSprite.material as THREE.SpriteMaterial).opacity = a; this.nameSprite.visible = a > 0.02; }

  update(dt: number, p: Pose) {
    this.t += dt;
    const t = this.t;
    const { speed, grounded, seated, emote } = p;
    this.blink -= dt;
    const closed = this.blink < 0.12 && this.blink > 0;
    if (this.blink <= 0) this.blink = 2.4 + Math.random() * 3.6;
    for (const e of this.eyes) e.scale.y = closed ? 0.012 : 0.06;
    if (this.bubble) {
      this.bubbleLeft -= dt;
      (this.bubble.material as THREE.SpriteMaterial).opacity = clamp(this.bubbleLeft, 0, 1);
      if (this.bubbleLeft <= 0) { this.root.remove(this.bubble); (this.bubble.material as THREE.SpriteMaterial).map?.dispose(); this.bubble = null; }
    }
    // reset pose
    for (let i = 0; i < 2; i++) { this.thigh[i].rotation.set(0, 0, 0); this.shin[i].rotation.set(0, 0, 0); this.arm[i].rotation.set(0, 0, 0); this.fore[i].rotation.set(0, 0, 0); }
    this.body.position.set(0, 0, 0); this.body.rotation.set(0, 0, 0); this.torso.rotation.set(0, 0, 0); this.head.rotation.set(0, 0, 0);
    this.torso.scale.y = 0.58;

    if (seated) {
      this.body.position.y = -0.36;
      for (let i = 0; i < 2; i++) { this.thigh[i].rotation.x = -Math.PI / 2; this.shin[i].rotation.x = Math.PI / 2 - 0.05; this.arm[i].rotation.x = -0.55; this.fore[i].rotation.x = -0.7; }
      this.torso.scale.y = 0.58 * (1 + Math.sin(t * 2) * 0.012);
      this.head.rotation.y = Math.sin(t * 0.7) * 0.25;
      return;
    }
    if (!grounded) {
      this.thigh[0].rotation.x = -0.6; this.thigh[1].rotation.x = 0.35; this.shin[0].rotation.x = 0.9; this.shin[1].rotation.x = 0.4;
      this.arm[0].rotation.set(-2.2, 0, 0.2); this.arm[1].rotation.set(-2.2, 0, -0.2);
      return;
    }
    if (emote === 2) { // dance
      const b = Math.abs(Math.sin(t * 6));
      this.body.position.y = b * 0.09;
      this.body.rotation.y = Math.sin(t * 3) * 0.35; this.body.rotation.z = Math.sin(t * 3) * 0.06;
      this.thigh[0].rotation.x = Math.sin(t * 6) * 0.35; this.thigh[1].rotation.x = -Math.sin(t * 6) * 0.35;
      this.shin[0].rotation.x = Math.max(0, -Math.sin(t * 6)) * 0.7; this.shin[1].rotation.x = Math.max(0, Math.sin(t * 6)) * 0.7;
      this.arm[0].rotation.set(-2.4 + Math.sin(t * 6) * 0.5, 0, 0.4); this.arm[1].rotation.set(-2.4 - Math.sin(t * 6) * 0.5, 0, -0.4);
      this.fore[0].rotation.x = -0.6; this.fore[1].rotation.x = -0.6;
      this.head.rotation.z = Math.sin(t * 3) * 0.12;
      return;
    }
    if (speed > 0.35) {
      this.phase += dt * speed * 2.15;
      const amp = clamp(speed / 3.1, 0.2, 1.7), s = Math.sin(this.phase), c = Math.cos(this.phase);
      const run = clamp((speed - 3.1) / 2.5, 0, 1);
      this.thigh[0].rotation.x = -s * 0.62 * amp; this.thigh[1].rotation.x = s * 0.62 * amp;
      this.shin[0].rotation.x = Math.max(0, c) * 0.95 * amp; this.shin[1].rotation.x = Math.max(0, -c) * 0.95 * amp;
      this.arm[0].rotation.x = s * 0.55 * amp; this.arm[1].rotation.x = -s * 0.55 * amp;
      this.fore[0].rotation.x = -(0.25 + 0.7 * run); this.fore[1].rotation.x = -(0.25 + 0.7 * run);
      this.body.position.y = Math.abs(s) * 0.045 * amp;
      this.body.rotation.x = 0.04 + run * 0.14;
      this.torso.rotation.y = s * 0.12 * amp;
      return;
    }
    // idle (+ wave)
    this.torso.scale.y = 0.58 * (1 + Math.sin(t * 2) * 0.012);
    this.arm[0].rotation.set(Math.sin(t * 1.6) * 0.03, 0, 0.06); this.arm[1].rotation.set(-Math.sin(t * 1.6) * 0.03, 0, -0.06);
    this.head.rotation.y = Math.sin(t * 0.6) * 0.18;
    if (emote === 1) {
      this.arm[0].rotation.set(0, 0, -(2.65 + Math.sin(t * 2) * 0.05)); // raised
      this.fore[0].rotation.z = Math.sin(t * 10) * 0.55;
      this.head.rotation.z = 0.08;
    }
  }

  dispose() {
    this.root.traverse((o) => { const m = o as THREE.Mesh; if (m.material && !(m instanceof THREE.Sprite)) (m.material as THREE.Material).dispose?.(); });
  }
}
