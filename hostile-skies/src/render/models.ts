// Procedural ship models. Everything is built from primitives so the game ships with no art assets. Local axes match the
// sim: forward is -Z, up is +Y, right is +X. Geometry and materials are shared between instances.
//
// Colour language: the Sparrow is cool grey-blue with cyan trim; every alien system glows acid green; anything the
// pilot should shoot at is the brightest thing on the ship.

import {
  AdditiveBlending, BoxGeometry, CanvasTexture, Color, ConeGeometry, CylinderGeometry, DoubleSide, ExtrudeGeometry,
  Group, IcosahedronGeometry, InstancedMesh, LatheGeometry, Material, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  Object3D, Shape, Sprite, SpriteMaterial, SphereGeometry, ShaderMaterial, TorusGeometry, Vector2, Vector3,
} from 'three';
import { POD_DROP, POD_ORBIT, type Alien, type AlienKind } from '../sim/aliens';

const LIME = new Color(0xb6ff3c);
const hdr = (c: Color, k: number): Color => c.clone().multiplyScalar(k);

// ---- shared textures and materials ---------------------------------------------------------------------------------

let glowTex: CanvasTexture | null = null;
export function glowTexture(): CanvasTexture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  glowTex = new CanvasTexture(c);
  return glowTex;
}

export function glowSprite(color: Color, size: number, opacity = 1): Sprite {
  const s = new Sprite(new SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false, fog: false }));
  s.scale.setScalar(size);
  s.renderOrder = 6;
  return s;
}

const M = {
  hull: new MeshStandardMaterial({ color: 0x9fb2c9, metalness: 0.35, roughness: 0.42 }),
  hullDark: new MeshStandardMaterial({ color: 0x2a3140, metalness: 0.5, roughness: 0.48 }),
  glass: new MeshStandardMaterial({ color: 0x0a1722, metalness: 0.95, roughness: 0.06, emissive: new Color(0x0a4d6e), emissiveIntensity: 0.9 }),
  cyan: new MeshBasicMaterial({ color: hdr(new Color(0x5ff1ff), 2.2) }),
  red: new MeshBasicMaterial({ color: hdr(new Color(0xff3030), 2.6) }),
  green: new MeshBasicMaterial({ color: hdr(new Color(0x30ff60), 2.6) }),
  white: new MeshBasicMaterial({ color: hdr(new Color(0xffffff), 3) }),
  alien: new MeshStandardMaterial({ color: 0x3a2d55, metalness: 0.55, roughness: 0.42 }),
  alienMid: new MeshStandardMaterial({ color: 0x4c3a6c, metalness: 0.5, roughness: 0.45 }),
  alienEdge: new MeshStandardMaterial({ color: 0x1e1630, metalness: 0.6, roughness: 0.4 }),
  lime: new MeshBasicMaterial({ color: hdr(LIME, 1.7) }),
  limeSoft: new MeshBasicMaterial({ color: hdr(LIME, 1.0) }),
  limeGlass: new MeshStandardMaterial({ color: 0x103018, metalness: 0.2, roughness: 0.1, emissive: LIME, emissiveIntensity: 0.9, transparent: true, opacity: 0.8 }),
  flameOuter: new MeshBasicMaterial({ color: new Color(2.6, 1.0, 0.25), transparent: true, opacity: 0.4, blending: AdditiveBlending, depthWrite: false, fog: false }),
  flameInner: new MeshBasicMaterial({ color: new Color(1.2, 1.7, 3.2), transparent: true, opacity: 0.7, blending: AdditiveBlending, depthWrite: false, fog: false }),
};

// ---- beams -----------------------------------------------------------------------------------------------------------

/** Free the GPU resources a removed model owns. The shared materials in `M` and the glow texture live for the session. */
export function disposeModel(root: Object3D): void {
  const shared = new Set<Material>(Object.values(M));
  root.traverse((o) => {
    const m = o as Mesh;
    if (!(o as Sprite).isSprite) m.geometry?.dispose(); // every Sprite shares one geometry
    const mat = m.material as Material | Material[] | undefined;
    if (mat) for (const x of Array.isArray(mat) ? mat : [mat]) if (!shared.has(x)) x.dispose();
  });
}

export const beamTime = { value: 0 };

export function makeBeamMaterial(color: Color, intensity = 1): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide, fog: false,
    uniforms: { time: beamTime, color: { value: color }, intensity: { value: intensity } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float time; uniform vec3 color; uniform float intensity; varying vec3 vN; varying vec3 vW;
      void main() {
        float rim = abs(dot(normalize(vN), normalize(cameraPosition - vW)));
        float band = 0.6 + 0.4 * sin(vW.y * 0.045 - time * 7.0);
        float a = (0.18 + 0.82 * pow(rim, 1.6)) * band * intensity;
        gl_FragColor = vec4(color * a, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/** A fresnel bubble used for shields. */
function bubbleMaterial(color: Color, power = 2.4): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide, fog: false,
    uniforms: { color: { value: color }, power: { value: power }, boost: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vW;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 color; uniform float power; uniform float boost; varying vec3 vN; varying vec3 vW;
      void main() {
        float rim = 1.0 - abs(dot(normalize(vN), normalize(cameraPosition - vW)));
        float a = (0.05 + pow(rim, power) * 0.95) * boost;
        gl_FragColor = vec4(color * a, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// ---- the Sparrow --------------------------------------------------------------------------------------------------

function flatShape(pts: [number, number][], thick: number): ExtrudeGeometry {
  const s = new Shape();
  s.moveTo(pts[0]![0], pts[0]![1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i]![0], pts[i]![1]);
  s.closePath();
  const g = new ExtrudeGeometry(s, { depth: thick, bevelEnabled: false });
  g.rotateX(Math.PI / 2); // shape y -> world z, thickness downwards
  g.translate(0, thick / 2, 0);
  return g;
}

export interface JetModel {
  root: Group;
  flame: Group;
  glow: Sprite;
  strobe: Mesh;
  parts: Object3D[];
}

export function buildJet(): JetModel {
  const root = new Group();
  const parts: Object3D[] = [];
  const add = (m: Object3D) => { root.add(m); parts.push(m); return m; };

  const prof = [
    [0.001, -8.6], [0.7, -8.4], [1.05, -7.0], [1.22, -4.0], [1.2, -1.0], [1.1, 2.0], [0.82, 4.6], [0.5, 6.6], [0.16, 7.8], [0.001, 8.3],
  ].map(([r, y]) => new Vector2(r, y));
  const fus = new Mesh(new LatheGeometry(prof, 22).rotateX(-Math.PI / 2).scale(0.95, 0.72, 1), M.hull);
  add(fus);
  // dark radome tip
  const nose = new Mesh(new ConeGeometry(0.42, 1.8, 14).rotateX(-Math.PI / 2).translate(0, 0, -8.3), M.hullDark);
  add(nose);

  const wingR = flatShape([[0.8, -2.4], [6.1, 3.7], [6.1, 5.1], [0.9, 5.4]], 0.2);
  const wr = new Mesh(wingR, M.hull);
  const wl = new Mesh(wingR, M.hull); wl.scale.x = -1;
  add(wr); add(wl);
  // wing trim
  const trimGeo = new BoxGeometry(0.1, 0.06, 7.6);
  for (const s of [1, -1]) {
    const t = new Mesh(trimGeo, M.cyan);
    t.position.set(3.35 * s, 0.14, 0.75); t.rotation.y = 0.72 * s;
    add(t);
  }

  // fins are cut in (forward, up) and stood on edge
  const fin = (() => {
    const s = new Shape();
    s.moveTo(0.6, 0); s.lineTo(-1.4, 3.1); s.lineTo(-3.2, 3.1); s.lineTo(-2.6, 0); s.closePath();
    const g = new ExtrudeGeometry(s, { depth: 0.18, bevelEnabled: false });
    g.translate(0, 0, -0.09).rotateY(Math.PI / 2);
    return g;
  })();
  for (const s of [1, -1]) {
    const f = new Mesh(fin, M.hull);
    f.position.set(1.15 * s, 0.35, 8.0); f.rotation.z = -0.24 * s;
    add(f);
  }
  const stab = flatShape([[0.6, 0], [3.4, 1.7], [3.4, 2.7], [0.7, 2.9]], 0.14);
  const sr = new Mesh(stab, M.hullDark), sl = new Mesh(stab, M.hullDark); sl.scale.x = -1;
  sr.position.set(0, 0.0, 5.6); sl.position.set(0, 0.0, 5.6);
  add(sr); add(sl);

  const intake = new BoxGeometry(0.9, 0.9, 3.0);
  for (const s of [1, -1]) {
    const i = new Mesh(intake, M.hullDark);
    i.position.set(1.15 * s, -0.25, -2.9);
    add(i);
  }

  const canopy = new Mesh(new SphereGeometry(1, 18, 12), M.glass);
  canopy.scale.set(0.62, 0.55, 2.4); canopy.position.set(0, 0.55, -3.7);
  add(canopy);

  const nozzle = new Mesh(new CylinderGeometry(0.95, 0.78, 1.5, 20, 1, true).rotateX(Math.PI / 2), M.hullDark);
  nozzle.position.z = 8.2;
  add(nozzle);

  const flame = new Group();
  const cone = (r: number, mat: Material) => new Mesh(new ConeGeometry(r, 1, 14, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2), mat);
  flame.add(cone(0.7, M.flameOuter), cone(0.4, M.flameInner));
  flame.position.z = 8.8;
  root.add(flame);
  const glow = glowSprite(new Color(2.2, 1.1, 0.5), 7, 0.8);
  glow.position.z = 9.2;
  root.add(glow);

  for (const [x, mat] of [[-6.05, M.red], [6.05, M.green]] as const) {
    const l = new Mesh(new SphereGeometry(0.16, 8, 6), mat);
    l.position.set(x, 0.12, 4.5);
    add(l);
  }
  const strobe = new Mesh(new SphereGeometry(0.2, 8, 6), M.white);
  strobe.position.set(0, 3.5, 9.4);
  add(strobe);

  return { root, flame, glow, strobe, parts };
}

export function buildMissile(): Group {
  const g = new Group();
  const body = new Mesh(new CylinderGeometry(0.28, 0.28, 3.6, 10).rotateX(Math.PI / 2), M.hull);
  const tip = new Mesh(new ConeGeometry(0.28, 0.9, 10).rotateX(-Math.PI / 2).translate(0, 0, -2.2), M.hullDark);
  g.add(body, tip);
  for (let i = 0; i < 4; i++) {
    const f = new Mesh(new BoxGeometry(0.04, 0.8, 0.7), M.hullDark);
    f.position.z = 1.4; f.rotation.z = (i * Math.PI) / 2;
    g.add(f);
  }
  const flame = glowSprite(new Color(2.6, 1.5, 0.6), 7, 1);
  flame.position.z = 2.2;
  g.add(flame);
  return g;
}

// ---- aliens ---------------------------------------------------------------------------------------------------------

export interface AlienModel {
  root: Group;
  flash: Mesh;
  /** Called every frame with the alien and the clock for kind-specific animation. */
  animate(a: Alien, t: number, dt: number): void;
  beam?: Mesh;
  bubbles?: Mesh[];
}

function makeFlash(radius: number): Mesh {
  const m = new Mesh(new SphereGeometry(radius, 14, 10), new MeshBasicMaterial({ color: new Color(2.4, 3, 1.8), transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, fog: false }));
  m.renderOrder = 6;
  return m;
}

function buildWisp(): AlienModel {
  const root = new Group();
  const core = new Mesh(new IcosahedronGeometry(4.6, 1), M.lime);
  const shell = new Mesh(new IcosahedronGeometry(7, 0), new MeshStandardMaterial({ color: 0x1b1430, metalness: 0.8, roughness: 0.3, transparent: true, opacity: 0.55, flatShading: true }));
  const ringA = new Mesh(new TorusGeometry(10.5, 0.8, 6, 24), M.alienMid);
  const ringB = new Mesh(new TorusGeometry(10.5, 0.8, 6, 24), M.alienMid);
  ringB.rotation.x = Math.PI / 2;
  const spin = new Group();
  spin.add(ringA, ringB);
  for (let i = 0; i < 6; i++) {
    const t = new Mesh(new ConeGeometry(0.9, 4.5, 5), M.lime);
    const a = (i / 6) * Math.PI * 2;
    t.position.set(Math.cos(a) * 10.5, Math.sin(a) * 10.5, 0);
    t.rotation.z = a - Math.PI / 2;
    spin.add(t);
  }
  const halo = glowSprite(hdr(LIME, 0.9), 34, 0.55);
  const trail = glowSprite(hdr(LIME, 0.8), 18, 0.6);
  trail.position.z = 9;
  const flash = makeFlash(13);
  root.add(core, shell, spin, halo, trail, flash);
  return {
    root, flash,
    animate(a, t) { spin.rotation.z = t * 6 + a.seed; spin.rotation.x = Math.sin(t * 2 + a.seed) * 0.4; core.scale.setScalar(1 + Math.sin(t * 9 + a.seed) * 0.12); },
  };
}

function lancerWingGeo(): ExtrudeGeometry {
  // half outline, nose at -z, swept wings, notched tail
  const half: [number, number][] = [[0, -19], [3.2, -9], [16, 5], [19, 11], [10, 9], [4.5, 13], [0, 9.5]];
  const s = new Shape();
  s.moveTo(0, -19);
  for (let i = 1; i < half.length; i++) s.lineTo(half[i]![0], half[i]![1]);
  for (let i = half.length - 2; i >= 1; i--) s.lineTo(-half[i]![0], half[i]![1]);
  s.closePath();
  const g = new ExtrudeGeometry(s, { depth: 1.6, bevelEnabled: true, bevelThickness: 0.8, bevelSize: 0.8, bevelSegments: 2 });
  g.rotateX(Math.PI / 2);
  g.translate(0, 0.8, 0);
  return g;
}

function buildLancer(): AlienModel {
  const root = new Group();
  const hull = new Mesh(lancerWingGeo(), M.alien);
  const spine = new Mesh(new SphereGeometry(1, 14, 10), M.alienMid);
  spine.scale.set(2.6, 1.8, 11); spine.position.set(0, 0.8, -1);
  // glowing leading edges
  const edge = new BoxGeometry(0.7, 0.5, 21);
  for (const s of [1, -1]) {
    const e = new Mesh(edge, M.lime);
    e.position.set(8.7 * s, 0.9, -2.2);
    e.rotation.y = Math.atan2(12.8, 14) * s;
    root.add(e);
  }
  const eye = new Mesh(new SphereGeometry(1.2, 12, 8), M.lime);
  eye.scale.set(1.2, 0.7, 2.4); eye.position.set(0, 2.1, -9);
  const engines = new Group();
  for (const s of [1, -1]) {
    const en = new Mesh(new SphereGeometry(1.5, 10, 8), M.lime);
    en.position.set(3.4 * s, 0.4, 10);
    const gl = glowSprite(hdr(LIME, 0.9), 14, 0.7);
    gl.position.copy(en.position); gl.position.z += 1;
    engines.add(en, gl);
  }
  const flash = makeFlash(22);
  const halo = glowSprite(hdr(LIME, 0.7), 64, 0.3);
  halo.position.y = 1;
  root.add(hull, spine, eye, engines, halo, flash);
  return {
    root, flash,
    animate(a, t) { eye.scale.x = 1.2 + Math.sin(t * 7 + a.seed) * 0.15; },
  };
}

function buildHarvester(): AlienModel {
  const root = new Group();
  const prof = [[0.001, -11], [13, -12.5], [26, -9], [42, -3], [46, -0.5], [44, 2], [30, 6.5], [14, 9.5], [0.001, 10]].map(([r, y]) => new Vector2(r, y));
  const disc = new Mesh(new LatheGeometry(prof, 36), M.alien);
  const rimBand = new Mesh(new TorusGeometry(44.2, 0.9, 6, 48).rotateX(Math.PI / 2), M.limeSoft);
  rimBand.position.y = -0.6;
  const dome = new Mesh(new SphereGeometry(15, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2), M.limeGlass);
  dome.position.y = 9.5;
  const inner = new Mesh(new IcosahedronGeometry(5, 1), M.lime);
  inner.position.y = 12;
  const emitter = new Mesh(new CylinderGeometry(11, 7, 5, 20), M.alienEdge);
  emitter.position.y = -14;
  const emitterRing = new Mesh(new TorusGeometry(8.5, 1, 8, 28).rotateX(Math.PI / 2), M.lime);
  emitterRing.position.y = -16.8;
  const lights = new Group();
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const l = new Mesh(new SphereGeometry(1.5, 8, 6), M.lime);
    l.position.set(Math.cos(a) * 38, -1.8, Math.sin(a) * 38);
    lights.add(l);
  }
  // tractor/burn beam, scaled to length each frame; origin at the emitter, hangs downward
  const beam = new Mesh(new CylinderGeometry(15, 26, 1, 20, 1, true).translate(0, -0.5, 0), makeBeamMaterial(hdr(LIME, 1.3), 1));
  beam.position.y = -17; beam.visible = false; beam.renderOrder = 4;
  const halo = glowSprite(hdr(LIME, 0.8), 150, 0.22);
  halo.position.y = -2;
  const flash = makeFlash(52);
  root.add(disc, rimBand, dome, inner, emitter, emitterRing, lights, beam, halo, flash);
  const glowDisk = glowSprite(hdr(LIME, 1.3), 40, 0.8);
  glowDisk.position.y = -19;
  root.add(glowDisk);
  return {
    root, flash, beam,
    animate(a, t) {
      lights.rotation.y = -t * 0.9;
      inner.rotation.y = t * 1.5;
      inner.scale.setScalar(1 + Math.sin(t * 5) * 0.1);
      glowDisk.visible = a.beam;
      glowDisk.scale.setScalar(a.beam ? 44 + Math.sin(t * 20) * 6 : 40);
    },
  };
}

function buildPod(): AlienModel {
  const root = new Group();
  // the weak point: a bright crystal in an open armour cradle, so it reads as a target and not as a bomb
  const crystal = new Mesh(new IcosahedronGeometry(21, 1), new MeshBasicMaterial({ color: hdr(LIME, 2.1) }));
  const cradle = new Group();
  for (let i = 0; i < 3; i++) {
    const r = new Mesh(new TorusGeometry(30, 2.6, 8, 40), M.alienMid);
    r.rotation.set(i * 1.05, i * 0.6, 0);
    cradle.add(r);
  }
  const crown = new Group();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const s = new Mesh(new ConeGeometry(3.4, 22, 6), M.alien);
    s.position.set(Math.cos(a) * 29, 12 * (i % 2 ? 1 : -1), Math.sin(a) * 29);
    s.rotation.set(Math.sin(a) * 1.2, 0, -Math.cos(a) * 1.2);
    crown.add(s);
  }
  const halo = glowSprite(hdr(LIME, 0.9), 110, 0.5);
  const flash = makeFlash(40);
  root.add(crystal, cradle, crown, halo, flash);
  return {
    root, flash,
    animate(a, t) {
      crystal.rotation.y = t * 1.2; crystal.scale.setScalar(1 + Math.sin(t * 4 + a.seed) * 0.08);
      cradle.rotation.y = -t * 0.5; cradle.rotation.x = t * 0.3; crown.rotation.y = t * 0.4;
      halo.material.opacity = 0.42 + Math.sin(t * 4) * 0.12;
    },
  };
}

function buildCore(): AlienModel {
  const root = new Group();
  const orb = new Mesh(new IcosahedronGeometry(40, 2), new MeshBasicMaterial({ color: new Color(1.9, 2.3, 1.2) }));
  const cage = new Group();
  for (let i = 0; i < 3; i++) {
    const r = new Mesh(new TorusGeometry(54, 2.6, 8, 48), M.alienMid);
    r.rotation.set((i * Math.PI) / 3, (i * Math.PI) / 5, 0);
    cage.add(r);
  }
  const bubble = new Mesh(new SphereGeometry(78, 28, 18), bubbleMaterial(new Color(0.4, 1.1, 2.6), 2.2));
  const halo = glowSprite(hdr(LIME, 1.2), 240, 0.6);
  const flash = makeFlash(70);
  root.add(orb, cage, bubble, halo, flash);
  return {
    root, flash, bubbles: [bubble],
    animate(a, t) {
      cage.rotation.y = t * 0.7; cage.rotation.x = t * 0.4;
      orb.scale.setScalar(1 + Math.sin(t * 3.2) * 0.06);
      bubble.visible = a.shielded;
      (bubble.material as ShaderMaterial).uniforms.boost!.value = 0.8 + Math.sin(t * 9) * 0.25;
      halo.material.opacity = a.shielded ? 0.3 : 0.75;
    },
  };
}

function buildMothership(): AlienModel {
  const root = new Group();
  const spin = new Group();
  const prof = [
    [0.001, -66], [80, -80], [190, -58], [310, -32], [392, -9], [408, 6], [364, 24], [250, 40], [130, 52], [60, 57], [0.001, 60],
  ].map(([r, y]) => new Vector2(r, y));
  const hull = new Mesh(new LatheGeometry(prof, 64), M.alien);
  spin.add(hull);
  const ringMat = M.limeSoft;
  const ring = new Mesh(new TorusGeometry(401, 3.5, 8, 96).rotateX(Math.PI / 2), ringMat);
  ring.position.y = -1;
  spin.add(ring);
  // rim lights
  const lights = new InstancedMesh(new SphereGeometry(4.2, 8, 6), M.lime, 72);
  const m4 = new Matrix4();
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    m4.makeTranslation(Math.cos(a) * 396, 7 + (i % 2) * -16, Math.sin(a) * 396);
    lights.setMatrixAt(i, m4);
  }
  spin.add(lights);
  // concentric panel rings on top and underneath
  for (const [r, y, k] of [[300, 36, 1], [210, 46, 1], [130, 52, 1], [300, -34, -1], [200, -54, -1]] as const) {
    const t = new Mesh(new TorusGeometry(r, 2.2, 6, 80).rotateX(Math.PI / 2), M.alienMid);
    t.position.y = y + k;
    spin.add(t);
  }
  const spire = new Mesh(new ConeGeometry(38, 260, 14), M.alienMid);
  spire.position.y = 170;
  const spireTip = new Mesh(new SphereGeometry(9, 10, 8), M.lime);
  spireTip.position.y = 302;
  spin.add(spire, spireTip, glowSprite(hdr(LIME, 1.4), 140, 0.7).translateY(302));
  // underside cradle for the core and struts out to the three shield nodes
  const cradle = new Mesh(new CylinderGeometry(125, 60, 40, 32, 1, true), M.alienEdge);
  cradle.position.y = -92;
  cradle.material = M.alienEdge;
  spin.add(cradle);
  const cradleRing = new Mesh(new TorusGeometry(118, 3, 6, 48).rotateX(Math.PI / 2), M.lime);
  cradleRing.position.y = -111;
  spin.add(cradleRing);
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI * 2) / 3;
    const from = new Vector3(Math.cos(a) * 330, -32, Math.sin(a) * 330);
    const to = new Vector3(Math.cos(a) * POD_ORBIT, POD_DROP + 20, Math.sin(a) * POD_ORBIT);
    const dir = to.clone().sub(from);
    const strut = new Mesh(new CylinderGeometry(7, 11, dir.length(), 8), M.alienMid);
    strut.position.copy(from).addScaledVector(dir, 0.5);
    strut.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize());
    spin.add(strut);
  }
  root.add(spin);

  // the city-killer beam, drawn between the belly and its target by the renderer
  const beam = new Mesh(new CylinderGeometry(1, 1, 1, 24, 1, true).translate(0, -0.5, 0), makeBeamMaterial(new Color(2.4, 0.5, 0.35), 1.1));
  beam.visible = false; beam.renderOrder = 4;
  const flash = makeFlash(1);
  flash.visible = false;
  root.add(beam);
  return {
    root, flash, beam,
    animate(a) { spin.rotation.y = -a.spin; },
  };
}

export function buildAlien(kind: AlienKind): AlienModel {
  switch (kind) {
    case 'wisp': return buildWisp();
    case 'lancer': return buildLancer();
    case 'harvester': return buildHarvester();
    case 'pod': return buildPod();
    case 'core': return buildCore();
    default: return buildMothership();
  }
}
