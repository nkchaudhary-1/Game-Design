// Image-based lighting. A small neutral "studio room" environment gives the faceted metal its sharp
// highlights without any texture files. Built once per WebGL context.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const cache = new WeakMap<THREE.WebGLRenderer, THREE.Texture>();

export function environment(renderer: THREE.WebGLRenderer): THREE.Texture {
  let t = cache.get(renderer);
  if (!t) {
    const pm = new THREE.PMREMGenerator(renderer);
    t = pm.fromScene(new RoomEnvironment(), 0.04).texture;
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
