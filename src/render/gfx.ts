// Renderer, lights, sun sprite and the post pipeline (MSAA pass -> bloom -> exposure).
import * as THREE from 'three/webgpu';
import { Fn, length, uv, smoothstep, exp, vec3, uniform, pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

export class Gfx {
  renderer!: THREE.WebGPURenderer;
  scene = new THREE.Scene();
  camera!: THREE.PerspectiveCamera;
  pipeline!: THREE.RenderPipeline;
  backend = 'WebGL2';
  sunLight!: THREE.DirectionalLight;
  earthLight!: THREE.DirectionalLight;
  ambient!: THREE.AmbientLight;
  sunSprite!: THREE.Mesh;
  uExposure = uniform(0.8);
  bloomNode: any;
  W = 1; H = 1;

  async init(canvas: HTMLCanvasElement, forceWebGL = false) {
    const r = new THREE.WebGPURenderer({ canvas, antialias: false, logarithmicDepthBuffer: true, forceWebGL, powerPreference: 'high-performance' });
    await r.init();
    this.renderer = r;
    this.backend = (r as any).backend && (r as any).backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2';
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.toneMapping = THREE.AgXToneMapping;
    r.toneMappingExposure = 1;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 1e13);
    this.sunLight = new THREE.DirectionalLight(0xfff5e6, 3.2);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.bias = -4e-4;
    this.sunLight.shadow.normalBias = 0.02;
    const sc = this.sunLight.shadow.camera;
    sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 400;
    this.scene.add(this.sunLight, this.sunLight.target);
    this.earthLight = new THREE.DirectionalLight(0x8fb4ff, 0);
    this.scene.add(this.earthLight, this.earthLight.target);
    this.ambient = new THREE.AmbientLight(0x2a3a52, 0.1);
    this.scene.add(this.ambient);

    const sm = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    sm.colorNode = Fn(() => {
      const d = length(uv().sub(0.5)).mul(2);
      const disc = smoothstep(0.04, 0.034, d).mul(60);
      const halo = exp(d.mul(-9)).mul(1.6).add(exp(d.mul(-2.5)).mul(0.25)).mul(smoothstep(1, 0.55, d));
      return vec3(1, 0.95, 0.86).mul(disc.add(halo));
    })();
    this.sunSprite = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), sm);
    this.sunSprite.renderOrder = -5;
    this.sunSprite.frustumCulled = false;
    this.scene.add(this.sunSprite);

    this.pipeline = new THREE.RenderPipeline(r);
    const out = pass(this.scene, this.camera, { samples: 4 } as any).getTextureNode('output');
    this.bloomNode = bloom(out, 0.28, 0.35, 0.9);
    this.pipeline.outputNode = out.add(this.bloomNode).mul(this.uExposure);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.W = w; this.H = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Sun drawn as a sprite far away along dir; shrinks with distance from the Sun. */
  placeSun(dir: THREE.Vector3, visible: number, distKm = 1.496e8) {
    const d = Math.max(1e9, this.camera.near * 50);
    this.sunSprite.position.copy(dir).multiplyScalar(d);
    this.sunSprite.quaternion.copy(this.camera.quaternion);
    this.sunSprite.scale.setScalar(d * Math.max(0.004, Math.min(0.6, 0.5 * Math.sqrt(1.496e8 / distKm))));
    this.sunSprite.visible = visible > 0.001;
  }

  ft = 16; scale = 1; lastAdj = 0; private lastFrame = 0;
  render() {
    this.pipeline.render();
    const t = performance.now();
    if (this.lastFrame) this.ft = this.ft * 0.95 + (t - this.lastFrame) * 0.05;
    this.lastFrame = t;
    if (t - this.lastAdj > 1500) {
      // Adaptive resolution: trade pixels for frame time.
      this.lastAdj = t;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (this.ft > 38 && this.scale > 0.5) this.scale = Math.max(0.5, this.scale - 0.15);
      else if (this.ft < 20 && this.scale < 1) this.scale = Math.min(1, this.scale + 0.1);
      const pr = dpr * this.scale;
      if (Math.abs(this.renderer.getPixelRatio() - pr) > 0.01) { this.renderer.setPixelRatio(pr); this.resize(); }
    }
  }
  get frameMs() { return this.ft; }
}
