// The last pass of the picture: a touch of lens and sensor character. Vignette (the corners fall off), a little radial
// colour fringing towards the edges, and fine film grain. All subtle; together they take the CG edge off.

import { ShaderMaterial } from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

const FILM = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    aspect: { value: 16 / 9 },
    grain: { value: 0.03 },
    vignette: { value: 0.3 },
    ca: { value: 0.0011 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float time; uniform float aspect; uniform float grain; uniform float vignette; uniform float ca;
    varying vec2 vUv;
    void main() {
      vec2 c = vUv - 0.5;
      vec2 ca2 = c * vec2(aspect, 1.0);
      float r2 = dot(ca2, ca2);
      vec2 off = c * ca * (0.4 + r2 * 7.0);
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      col *= 1.0 - vignette * smoothstep(0.12, 1.0, r2 * 1.7);
      float n = fract(sin(dot(vUv * vec2(1920.0, 1080.0) + fract(time) * 91.7, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
      col += n * grain * (1.1 - dot(col, vec3(0.5)));
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class FilmPass extends ShaderPass {
  constructor() { super(new ShaderMaterial({ uniforms: { ...FILM.uniforms }, vertexShader: FILM.vertexShader, fragmentShader: FILM.fragmentShader })); }

  setFrame(time: number, aspect: number): void {
    this.uniforms.time!.value = time;
    this.uniforms.aspect!.value = aspect;
  }
}
