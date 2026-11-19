import * as THREE from 'three';
import { nightness, sunAngle, sunElevation } from '../shared/daycycle';

/** Lighting keyframes by sun elevation. Night uses the moon's values. Colours are sRGB hex. */
interface Key { e: number; top: number; mid: number; low: number; fog: number; hemiS: number; hemiG: number; hemiI: number; sun: number; sunI: number; exp: number; star: number; glow: number }
const KEYS: Key[] = [
  { e: -0.30, top: 0x070b1c, mid: 0x172241, low: 0x0b101e, fog: 0x131b30, hemiS: 0x5a70a8, hemiG: 0x232b3d, hemiI: 0.78, sun: 0xa9bdf0, sunI: 0.75, exp: 1.45, star: 1, glow: 0 },
  { e: -0.08, top: 0x2a3866, mid: 0xd9806a, low: 0x3a2f45, fog: 0xb88b88, hemiS: 0x8c98c4, hemiG: 0x5e4f5a, hemiI: 1.0, sun: 0xff8f5a, sunI: 1.1, exp: 1.25, star: 0.3, glow: 1 },
  { e: 0.10, top: 0x7ea0ca, mid: 0xf3c39c, low: 0xd9b99a, fog: 0xefd2b8, hemiS: 0xf6e0cc, hemiG: 0xb89d86, hemiI: 1.3, sun: 0xffc088, sunI: 1.9, exp: 1.15, star: 0, glow: 0.8 },
  { e: 0.42, top: 0xa9c8de, mid: 0xe6eef0, low: 0xf1e9d8, fog: 0xe9eeea, hemiS: 0xf7f9ff, hemiG: 0xd3c8b6, hemiI: 1.7, sun: 0xfff1dc, sunI: 2.3, exp: 1.12, star: 0, glow: 0.25 },
];
const smooth = (t: number) => t * t * (3 - 2 * t);
const tmpA = new THREE.Color(), tmpB = new THREE.Color();
const lerpHex = (out: THREE.Color, a: number, b: number, t: number) => out.setHex(a).lerp(tmpB.setHex(b), t);
void tmpA;

/** Renderer, lights, sky and clouds. Flat colour, soft shadows, light that follows the hour. */
export class Rig {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  clouds: THREE.Group;
  shadows = true;
  night = 0;
  private sky!: THREE.ShaderMaterial;
  private stars!: THREE.Points;
  private sunDisc!: THREE.Mesh;
  private moonDisc!: THREE.Mesh;
  private lightDir = new THREE.Vector3(-0.3, 0.8, 0.3).normalize();
  private viewShift = 0;
  private lastHour = -1;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: new URLSearchParams(location.search).has('shot') });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.scene.background = new THREE.Color(0xdfe9ee);
    this.scene.fog = new THREE.Fog(0xe9eeea, 75, 230);

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 600);

    this.hemi = new THREE.HemisphereLight(0xf7f9ff, 0xd3c8b6, 1.7);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const c = this.sun.shadow.camera;
    c.left = -38; c.right = 38; c.top = 38; c.bottom = -38; c.near = 1; c.far = 170;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target);

    this.buildSky();
    this.clouds = this.makeClouds();
    this.scene.add(this.clouds);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.setTime(18.2);
  }

  private buildSky() {
    this.sky = new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uLow: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color() }, uGlow: { value: 0 },
      },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uLow; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform float uGlow;
        varying vec3 vDir;
        void main(){
          float h = vDir.y;
          vec3 c = h > 0.0 ? mix(uMid, uTop, pow(h, 0.62)) : mix(uMid, uLow, min(1.0, -h * 3.0));
          float s = max(dot(normalize(vDir), normalize(uSunDir)), 0.0);
          c += uSunCol * (pow(s, 90.0) * 0.55 + pow(s, 5.0) * 0.22 * uGlow);
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(420, 32, 20), this.sky);
    dome.renderOrder = -10;
    this.scene.add(dome);

    // stars
    const n = 420, pos = new Float32Array(n * 3);
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) {
      const u = rnd() * Math.PI * 2, v = Math.acos(rnd() * 0.97 + 0.03);
      pos.set([Math.cos(u) * Math.sin(v) * 405, Math.cos(v) * 405, Math.sin(u) * Math.sin(v) * 405], i * 3);
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.stars.renderOrder = -9;
    this.scene.add(this.stars);

    this.sunDisc = new THREE.Mesh(new THREE.SphereGeometry(15, 20, 12), new THREE.MeshBasicMaterial({ color: 0xfff1c9, fog: false }));
    this.moonDisc = new THREE.Mesh(new THREE.SphereGeometry(9, 20, 12), new THREE.MeshBasicMaterial({ color: 0xe9eefc, fog: false }));
    this.sunDisc.renderOrder = this.moonDisc.renderOrder = -8;
    this.scene.add(this.sunDisc, this.moonDisc);
  }

  private makeClouds() {
    const grp = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, fog: false });
    const geo = new THREE.IcosahedronGeometry(1, 0);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 9; i++) {
      const c = new THREE.Group();
      const n = 3 + Math.floor(rnd() * 3);
      for (let j = 0; j < n; j++) {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(j * 5 - n * 2.5 + rnd() * 2, rnd() * 1.5, rnd() * 3);
        m.scale.set(4 + rnd() * 3, 2.2 + rnd(), 3 + rnd() * 2);
        c.add(m);
      }
      c.position.set(-200 + rnd() * 400, 70 + rnd() * 35, -150 + rnd() * 300);
      c.userData.speed = 1.2 + rnd() * 1.8;
      grp.add(c);
    }
    return grp;
  }

  /** Move the sun/moon, recolour sky, fog and lights for an hour of the day (0–24). Cheap; call every frame. */
  setTime(hour: number) {
    if (Math.abs(hour - this.lastHour) < 0.004) return;
    this.lastHour = hour;
    const e = sunElevation(hour), a = sunAngle(hour);
    this.night = nightness(hour);
    // sample keyframes
    let i = 0;
    while (i < KEYS.length - 2 && e > KEYS[i + 1].e) i++;
    const k0 = KEYS[i], k1 = KEYS[i + 1];
    const t = smooth(Math.min(1, Math.max(0, (e - k0.e) / (k1.e - k0.e))));
    const L = (x: number, y: number) => x + (y - x) * t;
    const u = this.sky.uniforms;
    lerpHex(u.uTop.value, k0.top, k1.top, t); lerpHex(u.uMid.value, k0.mid, k1.mid, t); lerpHex(u.uLow.value, k0.low, k1.low, t);
    lerpHex((this.scene.fog as THREE.Fog).color, k0.fog, k1.fog, t);
    (this.scene.background as THREE.Color).copy(u.uMid.value);
    lerpHex(this.hemi.color, k0.hemiS, k1.hemiS, t); lerpHex(this.hemi.groundColor, k0.hemiG, k1.hemiG, t);
    this.hemi.intensity = L(k0.hemiI, k1.hemiI);
    lerpHex(this.sun.color, k0.sun, k1.sun, t); this.sun.intensity = L(k0.sunI, k1.sunI);
    this.renderer.toneMappingExposure = L(k0.exp, k1.exp);
    (this.stars.material as THREE.PointsMaterial).opacity = L(k0.star, k1.star);
    u.uGlow.value = L(k0.glow, k1.glow);
    // directions: the sun by day, the moon (opposite side) by night, blended across the horizon
    const sunDir = new THREE.Vector3(Math.cos(a), Math.sin(a), 0.32).normalize();
    const moonDir = new THREE.Vector3(-sunDir.x, Math.max(0.35, -sunDir.y), -0.32).normalize();
    const w = smooth(Math.min(1, Math.max(0, (e + 0.12) / 0.12)));
    this.lightDir.copy(moonDir).lerp(sunDir, w);
    this.lightDir.y = Math.max(this.lightDir.y, 0.2);
    this.lightDir.normalize();
    u.uSunDir.value.copy(sunDir);
    lerpHex(u.uSunCol.value, 0xff9a60, 0xffd9a8, Math.min(1, Math.max(0, e * 2.5)));
    this.sunDisc.position.copy(sunDir).multiplyScalar(380); this.sunDisc.visible = sunDir.y > -0.06;
    this.moonDisc.position.copy(moonDir).multiplyScalar(380); this.moonDisc.visible = e < 0.05;
    (this.sunDisc.material as THREE.MeshBasicMaterial).color.setHex(e < 0.15 ? 0xffb070 : 0xfff1c9);
  }

  setQuality(shadows: boolean, pixelRatio: number) {
    this.shadows = shadows;
    this.sun.castShadow = shadows;
    this.renderer.shadowMap.enabled = shadows;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, pixelRatio));
    this.scene.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m) m.needsUpdate = true; });
    this.resize();
  }

  /** Shift the 3D image sideways (used on the menu so the avatar sits beside the form). */
  setViewShift(frac: number) { this.viewShift = frac; this.applyView(); }
  private applyView() {
    const w = this.renderer.domElement.clientWidth, h = this.renderer.domElement.clientHeight;
    if (this.viewShift) this.camera.setViewOffset(w, h, -w * this.viewShift, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.applyView();
  }

  update(dt: number, focus: THREE.Vector3) {
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).addScaledVector(this.lightDir, 68);
    for (const c of this.clouds.children) { c.position.x += c.userData.speed * dt; if (c.position.x > 220) c.position.x = -220; }
    this.stars.rotation.y += dt * 0.002;
  }
  render() { this.renderer.render(this.scene, this.camera); }
}
