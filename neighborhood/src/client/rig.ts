import * as THREE from 'three';

/** Renderer, lights, sky and clouds. Flat colour, soft shadows, warm light. */
export class Rig {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  clouds: THREE.Group;
  shadows = true;
  private sunOffset = new THREE.Vector3(-20, 58, 16);
  private viewShift = 0;

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
    c.left = -36; c.right = 36; c.top = 36; c.bottom = -36; c.near = 1; c.far = 140;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target);

    this.scene.add(this.makeSky());
    this.clouds = this.makeClouds();
    this.scene.add(this.clouds);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private makeSky() {
    const g = new THREE.SphereGeometry(420, 24, 16);
    const pos = g.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const top = new THREE.Color(0xa9c8de), mid = new THREE.Color(0xe6eef0), low = new THREE.Color(0xf1e9d8);
    const t = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const h = pos.getY(i) / 420;
      if (h > 0) t.copy(mid).lerp(top, Math.pow(h, 0.7)); else t.copy(mid).lerp(low, Math.min(1, -h * 3));
      col.set([t.r, t.g, t.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    m.renderOrder = -10;
    return m;
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
    this.sun.position.copy(focus).add(this.sunOffset);
    for (const c of this.clouds.children) { c.position.x += c.userData.speed * dt; if (c.position.x > 220) c.position.x = -220; }
  }
  render() { this.renderer.render(this.scene, this.camera); }
}
