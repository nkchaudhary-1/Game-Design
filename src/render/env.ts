// Image-based lighting. A custom "studio" environment: a dark room with a few large soft boxes (cool white from
// above-left, warm from the front, a red and a blue strip behind). Metal and clear-coat paint pick those up as long,
// contrasty highlights, which is what makes the blades read as real machined parts. Built once per WebGL context.

import * as THREE from 'three';

const cache = new WeakMap<THREE.WebGLRenderer, THREE.Texture>();

function studio(): THREE.Scene {
  const s = new THREE.Scene();
  s.background = new THREE.Color('#06080d');
  const box = (w: number, h: number, color: string, k: number, pos: [number, number, number]): void => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(...pos);
    m.lookAt(0, 0, 0);
    s.add(m);
  };
  box(14, 9, '#ffffff', 5.5, [-9, 14, 7]);       // key, high and to the left
  box(10, 6, '#ffeedd', 3.2, [3, 6, 16]);        // warm fill from the front
  box(18, 2.2, '#ff3b3b', 4.0, [14, 4, -10]);    // red strip behind-right
  box(18, 2.2, '#3b7bff', 3.4, [-15, 3, -9]);    // blue strip behind-left
  box(40, 40, '#1a2233', 0.6, [0, -14, 0]);      // dark floor bounce
  box(30, 4, '#ffffff', 2.4, [0, 18, -2]);       // overhead strip for top-surface glints
  return s;
}

export function environment(renderer: THREE.WebGLRenderer): THREE.Texture {
  let t = cache.get(renderer);
  if (!t) {
    const pm = new THREE.PMREMGenerator(renderer);
    t = pm.fromScene(studio(), 0.03).texture;
    pm.dispose();
    cache.set(renderer, t);
  }
  return t;
}

/** Give `scene` its reflections (idempotent). */
export function lit(scene: THREE.Scene, renderer: THREE.WebGLRenderer, intensity = 0.8): void {
  if (!scene.environment) {
    scene.environment = environment(renderer);
    scene.environmentIntensity = intensity;
  }
}
