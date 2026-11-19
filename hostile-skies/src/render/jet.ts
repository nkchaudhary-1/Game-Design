// The Sparrow: a twin-engine air-superiority fighter, built from a lofted fuselage, swept wings with stores, canted tails,
// side intakes and twin afterburning nozzles, painted in two-tone grey with panel lines and lighter undersides.
// Plus the cockpit interior (canopy frame, glare shield, HUD glass, displays) used by the cockpit camera.
// Local axes match the sim: forward is -Z, up is +Y, right is +X. Length about 17 m, span about 12 m.

import {
  AdditiveBlending, BoxGeometry, BufferGeometry, CanvasTexture, CircleGeometry, Color, ConeGeometry, CylinderGeometry, DoubleSide,
  ExtrudeGeometry, Float32BufferAttribute, Group, Material, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, PlaneGeometry,
  RepeatWrapping, Shape, SphereGeometry, Sprite, SRGBColorSpace, TorusGeometry,
} from 'three';
import { makeRng } from '../sim/util';
import { glowSprite } from './models';

export interface JetModel {
  root: Group;
  flame: Group;
  glow: Sprite;
  strobe: Mesh;
  parts: Object3D[];
}

// ---- paint -----------------------------------------------------------------------------------------------------------

/** Panel lines, rivets and light weathering on a near-white base so vertex colours set the hue. */
function paintTexture(seed: number, repeat: [number, number]): CanvasTexture {
  const S = 512, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const rng = makeRng(seed);
  g.fillStyle = '#e8eaec'; g.fillRect(0, 0, S, S);
  // subtle mottling
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(${rng() < 0.5 ? '255,255,255' : '90,95,100'},${0.015 + rng() * 0.03})`;
    g.fillRect(rng() * S, rng() * S, 10 + rng() * 60, 4 + rng() * 26);
  }
  // panel lines
  g.strokeStyle = 'rgba(40,46,52,0.55)'; g.lineWidth = 1.4;
  let x = 0;
  while (x < S) { x += 52 + rng() * 70; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (rng() - 0.5) * 3, S); g.stroke(); }
  let y = 0;
  while (y < S) {
    y += 40 + rng() * 80;
    g.beginPath(); g.moveTo(0, y); g.lineTo(S, y + (rng() - 0.5) * 3); g.stroke();
  }
  // access panels: small rectangles with rivets
  for (let i = 0; i < 26; i++) {
    const w = 26 + rng() * 54, h = 14 + rng() * 30, px = rng() * (S - w), py = rng() * (S - h);
    g.strokeStyle = 'rgba(38,44,50,0.6)'; g.lineWidth = 1.2; g.strokeRect(px, py, w, h);
    g.fillStyle = 'rgba(38,44,50,0.5)';
    for (let k = 0; k < 4; k++) g.fillRect(px + 3 + ((w - 8) * (k % 2)), py + 3 + ((h - 8) * Math.floor(k / 2)), 1.6, 1.6);
  }
  // exhaust and hydraulic streaks
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(20,22,24,${0.03 + rng() * 0.05})`;
    const sx = rng() * S;
    g.fillRect(sx, rng() * S * 0.5, 1 + rng() * 3, 40 + rng() * 140);
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const PAINT = {
  fuselage: new MeshStandardMaterial({ vertexColors: true, map: paintTexture(7, [2, 3]), metalness: 0.28, roughness: 0.52 }),
  wing: new MeshStandardMaterial({ color: 0x77828f, map: paintTexture(9, [0.16, 0.16]), metalness: 0.28, roughness: 0.55 }),
  dark: new MeshStandardMaterial({ color: 0x262b33, metalness: 0.45, roughness: 0.5 }),
  nozzle: new MeshStandardMaterial({ color: 0x4b4540, metalness: 0.85, roughness: 0.38, emissive: new Color(0.22, 0.07, 0.02), emissiveIntensity: 0.6 }),
  glass: new MeshStandardMaterial({ color: 0x0b1620, metalness: 0.95, roughness: 0.04, emissive: new Color(0x0a3b55), emissiveIntensity: 0.25, envMapIntensity: 1.6 }),
  store: new MeshStandardMaterial({ color: 0xd9dbd8, metalness: 0.25, roughness: 0.45 }),
  storeTip: new MeshStandardMaterial({ color: 0x2f3236, metalness: 0.4, roughness: 0.5 }),
  band: new MeshStandardMaterial({ color: 0xc8a83a, metalness: 0.2, roughness: 0.6 }),
  red: new MeshBasicMaterial({ color: new Color(2.4, 0.15, 0.1) }),
  green: new MeshBasicMaterial({ color: new Color(0.1, 2.2, 0.35) }),
  white: new MeshBasicMaterial({ color: new Color(3, 3, 3) }),
  roundelBlue: new MeshStandardMaterial({ color: 0x1b3f7a, roughness: 0.6, metalness: 0.1 }),
  roundelWhite: new MeshStandardMaterial({ color: 0xe9ecef, roughness: 0.6, metalness: 0.1 }),
  flameOuter: new MeshBasicMaterial({ color: new Color(2.4, 0.95, 0.25), transparent: true, opacity: 0.4, blending: AdditiveBlending, depthWrite: false, fog: false }),
  flameInner: new MeshBasicMaterial({ color: new Color(1.2, 1.7, 3.0), transparent: true, opacity: 0.7, blending: AdditiveBlending, depthWrite: false, fog: false }),
};

// ---- geometry --------------------------------------------------------------------------------------------------------

interface Station { z: number; w: number; ht: number; hb: number }

/** A fuselage lofted through cross-sections (superellipses wider than tall), lighter underneath. */
function loft(stations: Station[], seg = 28, n = 2.5): BufferGeometry {
  const pos: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
  const rows = stations.length;
  const pw = (v: number): number => Math.sign(v) * Math.pow(Math.abs(v), 2 / n);
  for (let i = 0; i < rows; i++) {
    const st = stations[i]!;
    for (let j = 0; j <= seg; j++) {
      const t = (j / seg) * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
      const x = st.w * pw(c), y = s >= 0 ? st.ht * pw(s) : st.hb * pw(s);
      pos.push(x, y, st.z);
      uv.push(j / seg, i / (rows - 1));
      // countershading: darker blue-grey on top, pale grey below
      const k = Math.min(1, Math.max(0, (y / Math.max(st.ht, 0.1) + 1) / 2));
      col.push(0.5 + 0.2 * (1 - k) + 0.0, 0.55 + 0.19 * (1 - k), 0.6 + 0.16 * (1 - k));
    }
  }
  const ring = seg + 1;
  for (let i = 0; i < rows - 1; i++) for (let j = 0; j < seg; j++) {
    const a = i * ring + j, b = a + 1, c = a + ring, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A thin flat plate from an outline in (x, z), thickness downwards from y = 0, with a slight edge bevel. */
function plate(pts: [number, number][], thick: number): ExtrudeGeometry {
  const s = new Shape();
  s.moveTo(pts[0]![0], pts[0]![1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i]![0], pts[i]![1]);
  s.closePath();
  const g = new ExtrudeGeometry(s, { depth: thick, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.04, bevelSegments: 1 });
  g.rotateX(Math.PI / 2);
  g.translate(0, thick / 2, 0);
  return g;
}

/** An air-to-air missile: body, seeker, four fins, a coloured band. About `len` metres, pointing -Z. */
function missile(len: number, r: number): Group {
  const g = new Group();
  const body = new Mesh(new CylinderGeometry(r, r, len, 12).rotateX(Math.PI / 2), PAINT.store);
  const nose = new Mesh(new ConeGeometry(r, len * 0.16, 12).rotateX(-Math.PI / 2).translate(0, 0, -len * 0.58), PAINT.storeTip);
  const band = new Mesh(new CylinderGeometry(r * 1.02, r * 1.02, len * 0.04, 12).rotateX(Math.PI / 2).translate(0, 0, -len * 0.25), PAINT.band);
  g.add(body, nose, band);
  for (let i = 0; i < 4; i++) {
    for (const zf of [0.38, -0.2]) {
      const f = new Mesh(new BoxGeometry(0.03, r * 3.2, len * (zf > 0 ? 0.16 : 0.1)), PAINT.storeTip);
      f.position.z = len * zf; f.rotation.z = (i * Math.PI) / 2;
      g.add(f);
    }
  }
  return g;
}

export function buildJet(): JetModel {
  const root = new Group();
  const parts: Object3D[] = [];
  const add = (m: Object3D): Object3D => { root.add(m); parts.push(m); return m; };

  // fuselage
  const fus = new Mesh(loft([
    { z: -8.6, w: 0.04, ht: 0.04, hb: 0.04 }, { z: -8.0, w: 0.3, ht: 0.3, hb: 0.26 }, { z: -6.6, w: 0.75, ht: 0.62, hb: 0.5 },
    { z: -4.6, w: 1.2, ht: 0.84, hb: 0.68 }, { z: -2.2, w: 1.42, ht: 0.8, hb: 0.84 }, { z: 1.0, w: 1.5, ht: 0.74, hb: 0.9 },
    { z: 4.2, w: 1.42, ht: 0.7, hb: 0.84 }, { z: 6.8, w: 1.3, ht: 0.66, hb: 0.74 }, { z: 8.0, w: 1.22, ht: 0.62, hb: 0.68 },
  ]), PAINT.fuselage);
  add(fus);
  // radome and pitot
  add(new Mesh(new ConeGeometry(0.33, 1.7, 14).rotateX(-Math.PI / 2).translate(0, 0, -8.15), PAINT.dark));
  add(new Mesh(new CylinderGeometry(0.03, 0.03, 1.4, 6).rotateX(Math.PI / 2).translate(0, 0, -9.4), PAINT.dark));

  // wings (mirrored): clipped delta with a leading-edge extension
  const wing = plate([[1.2, -2.8], [6.0, 3.3], [6.0, 4.9], [1.3, 5.3]], 0.22);
  const lerx = plate([[0.9, -6.0], [1.35, -2.9], [1.3, -0.4], [1.0, -0.4]], 0.12);
  for (const s of [1, -1]) {
    const w = new Mesh(wing, PAINT.wing), l = new Mesh(lerx, PAINT.wing);
    w.position.y = 0.0; l.position.y = 0.12;
    if (s < 0) { w.scale.x = -1; l.scale.x = -1; }
    add(w); add(l);
    // leading-edge and trailing-edge flap lines
    const ledge = new Mesh(new BoxGeometry(0.05, 0.05, 7.3), PAINT.dark);
    ledge.position.set(3.55 * s, 0.1, 0.3); ledge.rotation.y = 0.7 * s;
    add(ledge);
    // roundel on the upper wing
    const rd = new Mesh(new CircleGeometry(0.62, 28).rotateX(-Math.PI / 2), PAINT.roundelBlue);
    rd.position.set(3.3 * s, 0.132, 2.7);
    const rw = new Mesh(new CircleGeometry(0.34, 24).rotateX(-Math.PI / 2), PAINT.roundelWhite);
    rw.position.set(3.3 * s, 0.136, 2.7);
    add(rd); add(rw);
    // wingtip rail and missile, underwing pylon and missile
    const tip = missile(2.9, 0.1); tip.position.set(6.12 * s, 0.0, 3.9);
    add(tip);
    const pylon = new Mesh(new BoxGeometry(0.16, 0.45, 1.6), PAINT.dark);
    pylon.position.set(3.1 * s, -0.4, 1.8); add(pylon);
    const amraam = missile(3.7, 0.13); amraam.position.set(3.1 * s, -0.78, 1.7);
    add(amraam);
  }

  // canted twin fins and all-moving tailplanes
  const fin = (() => {
    const s = new Shape();
    s.moveTo(0.6, 0); s.lineTo(-1.5, 3.1); s.lineTo(-3.3, 3.1); s.lineTo(-2.7, 0); s.closePath();
    const g = new ExtrudeGeometry(s, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.03, bevelSegments: 1 });
    g.translate(0, 0, -0.08).rotateY(Math.PI / 2);
    return g;
  })();
  const stab = plate([[0.9, 0], [3.6, 1.6], [3.6, 2.7], [1.0, 2.9]], 0.13);
  for (const s of [1, -1]) {
    const f = new Mesh(fin, PAINT.wing);
    f.position.set(1.05 * s, 0.4, 8.2); f.rotation.z = -0.3 * s;
    add(f);
    const tp = new Mesh(stab, PAINT.dark);
    tp.position.set(0, -0.12, 5.7);
    if (s < 0) tp.scale.x = -1;
    add(tp);
    // side intakes: dark mouth, sloped lip, splitter
    const intake = new Mesh(new BoxGeometry(0.95, 0.95, 3.3), PAINT.fuselage);
    intake.position.set(1.5 * s, -0.42, -2.8);
    const mouth = new Mesh(new PlaneGeometry(0.78, 0.78), PAINT.dark);
    mouth.position.set(1.5 * s, -0.42, -4.46); mouth.rotation.y = Math.PI;
    add(intake); add(mouth);
    // engine nozzle
    const nz = new Mesh(new CylinderGeometry(0.66, 0.54, 1.3, 20, 1, true).rotateX(Math.PI / 2), PAINT.nozzle);
    nz.position.set(0.74 * s, -0.02, 8.5);
    add(nz);
    const inner = new Mesh(new CylinderGeometry(0.5, 0.5, 0.4, 16).rotateX(Math.PI / 2), PAINT.dark);
    inner.position.set(0.74 * s, -0.02, 8.1);
    add(inner);
  }
  // a dorsal spine and a small ventral keel
  const spine = new Mesh(new BoxGeometry(0.5, 0.22, 5.4), PAINT.fuselage);
  spine.position.set(0, 0.8, 3.2); add(spine);

  // canopy: tinted glass bubble with a dark frame
  const canopy = new Mesh(new SphereGeometry(1, 24, 14), PAINT.glass);
  canopy.scale.set(0.68, 0.52, 2.5); canopy.position.set(0, 0.66, -3.5);
  add(canopy);
  for (const z of [-5.2, -3.4, -1.6]) {
    const bow = new Mesh(new TorusGeometry(0.66, 0.025, 6, 20, Math.PI), PAINT.dark);
    bow.position.set(0, 0.66, z * 0.95 - 0.2); bow.scale.set(1, 0.76, 1);
    add(bow);
  }

  // afterburner flames (two engines) and a glow
  const flame = new Group();
  const cone = (r: number, mat: Material) => new Mesh(new ConeGeometry(r, 1, 14, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2), mat);
  for (const s of [1, -1]) {
    const f = new Group();
    f.add(cone(0.55, PAINT.flameOuter), cone(0.3, PAINT.flameInner));
    f.position.x = 0.74 * s;
    flame.add(f);
  }
  flame.position.z = 9.1;
  root.add(flame);
  const glow = glowSprite(new Color(1.6, 0.9, 0.45), 6, 0.5);
  glow.position.z = 9.5;
  root.add(glow);

  // navigation and strobe lights
  for (const [x, mat] of [[-6.15, PAINT.red], [6.15, PAINT.green]] as const) {
    const l = new Mesh(new SphereGeometry(0.15, 8, 6), mat);
    l.position.set(x, 0.1, 4.7);
    add(l);
  }
  const strobe = new Mesh(new SphereGeometry(0.18, 8, 6), PAINT.white);
  strobe.position.set(0, 3.4, 9.7);
  add(strobe);

  return { root, flame, glow, strobe, parts };
}

// ---- cockpit ---------------------------------------------------------------------------------------------------------

/** A multi-function display face: a radar scope or a status page, drawn small and dim so it reads as a screen. */
function mfdTexture(kind: 'scope' | 'status'): CanvasTexture {
  const W = 256, H = 192, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const hue = kind === 'scope' ? '110,255,160' : '255,190,70';
  g.fillStyle = '#030705'; g.fillRect(0, 0, W, H);
  g.strokeStyle = `rgba(${hue},0.75)`; g.fillStyle = `rgba(${hue},0.85)`; g.lineWidth = 1.5;
  g.font = '12px monospace';
  if (kind === 'scope') {
    for (const r of [28, 56, 84]) { g.beginPath(); g.arc(W / 2, H - 14, r, Math.PI, 0); g.stroke(); }
    g.beginPath(); g.moveTo(W / 2, H - 14); g.lineTo(W / 2 - 70, 20); g.moveTo(W / 2, H - 14); g.lineTo(W / 2 + 70, 20); g.stroke();
    for (const [x, y] of [[96, 70], [150, 52], [170, 96], [118, 40]]) g.fillRect(x, y, 5, 5);
    g.fillText('A/A', 8, 16); g.fillText('RNG 10', W - 62, 16);
  } else {
    ['FUEL  3.2', 'HYD   OK', 'ENG L  96', 'ENG R  96', 'OXY   OK', 'FLAPS  UP'].forEach((t, i) => g.fillText(t, 14, 30 + i * 20));
    g.strokeRect(150, 30, 90, 110);
    for (let i = 0; i < 5; i++) g.fillRect(158, 40 + i * 20, 20 + ((i * 37) % 60), 8);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/**
 * The interior seen from the pilot's seat, in camera space (the camera looks down -Z). Add it as a child of the camera.
 * Everything sits within about a metre of the eye, so the camera's near plane must be small in cockpit view.
 */
export function buildCockpit(): Group {
  const g = new Group();
  const matte = new MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.85, metalness: 0.1 });
  const frame = new MeshStandardMaterial({ color: 0x2b3037, roughness: 0.6, metalness: 0.4 });
  const screen = new MeshBasicMaterial({ map: mfdTexture('scope'), color: new Color(0.9, 0.9, 0.9) });
  const amber = new MeshBasicMaterial({ map: mfdTexture('status'), color: new Color(0.9, 0.9, 0.9) });

  // instrument coaming and glare shield
  const shield = new Mesh(new BoxGeometry(1.5, 0.1, 0.62), matte);
  shield.position.set(0, -0.36, -0.95); shield.rotation.x = 0.28;
  const cowl = new Mesh(new BoxGeometry(1.9, 0.36, 1.4), matte);
  cowl.position.set(0, -0.62, -1.1);
  g.add(shield, cowl);
  // two displays on the panel, tilted up to the pilot
  for (const x of [-0.22, 0.22]) {
    const bezel = new Mesh(new BoxGeometry(0.34, 0.26, 0.03), frame);
    bezel.position.set(x, -0.43, -0.74); bezel.rotation.x = -0.9;
    const scr = new Mesh(new PlaneGeometry(0.29, 0.21), x < 0 ? screen : amber);
    scr.position.set(x, -0.425, -0.722); scr.rotation.x = -0.9;
    g.add(bezel, scr);
  }
  // HUD combiner glass: a faint green-tinted plate in a thin frame
  const glassMat = new MeshBasicMaterial({ color: new Color(0.3, 1.0, 0.55), transparent: true, opacity: 0.045, side: DoubleSide, depthWrite: false });
  const hud = new Mesh(new PlaneGeometry(0.4, 0.3), glassMat);
  hud.position.set(0, -0.12, -0.8); hud.rotation.x = -0.12;
  g.add(hud);
  for (const [x, y, w, h] of [[-0.2, -0.12, 0.012, 0.3], [0.2, -0.12, 0.012, 0.3], [0, 0.03, 0.4, 0.012]] as const) {
    const e = new Mesh(new BoxGeometry(w, h, 0.012), frame);
    e.position.set(x, y, -0.79); e.rotation.x = -0.12;
    g.add(e);
  }
  // windscreen arch and canopy rails
  const arch = new Mesh(new TorusGeometry(0.9, 0.022, 8, 40, Math.PI), frame);
  arch.position.set(0, -0.32, -1.3); arch.scale.set(1, 0.95, 1);
  g.add(arch);
  for (const s of [-1, 1]) {
    const rail = new Mesh(new BoxGeometry(0.05, 0.05, 2.4), frame);
    rail.position.set(0.84 * s, 0.2, 0.1); rail.rotation.y = 0.0;
    const sill = new Mesh(new BoxGeometry(0.34, 0.22, 2.2), matte);
    sill.position.set(0.9 * s, -0.5, 0.0);
    const strut = new Mesh(new BoxGeometry(0.05, 0.62, 0.05), frame);
    strut.position.set(0.86 * s, 0.0, -1.18); strut.rotation.z = -0.28 * s;
    g.add(rail, sill, strut);
  }
  // rear-view mirror
  const mirror = new Mesh(new BoxGeometry(0.2, 0.08, 0.02), frame);
  mirror.position.set(0, 0.46, -0.95);
  g.add(mirror);
  g.scale.setScalar(0.85);
  g.position.y = -0.02;
  return g;
}

