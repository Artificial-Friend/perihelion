// Earth: physical single-scattering atmosphere (Rayleigh + Mie), day/night/city lights,
// ocean glint, clouds with shadows, airglow and procedural close-up detail. All TSL.
import * as THREE from 'three/webgpu';
import {
  Fn, uniform, vec2, vec3, vec4, float, dot, sqrt, max, select, smoothstep, Loop, exp, pow, length, normalize,
  positionLocal, texture, uv, cross, mix, fract, atan, acos, clamp, luminance, If, Discard, mx_fractal_noise_float,
} from 'three/tsl';

const R = 6371, RA = R + 100, HR = 8, HM = 1.2;
const BETA_R = vec3(0.005802, 0.013558, 0.0331);
const BETA_MS = 0.003996, BETA_ME = 0.00444, G = 0.8;

export interface EarthTex { day: THREE.Texture; night: THREE.Texture; clouds: THREE.Texture; water: THREE.Texture; topo: THREE.Texture }

export class Earth {
  group = new THREE.Group();
  surface: THREE.Mesh;
  clouds: THREE.Mesh;
  atmo: THREE.Mesh;
  uSun = uniform(new THREE.Vector3(1, 0, 0));
  uCam = uniform(new THREE.Vector3(0, 0, 2e4));
  uSunI = uniform(10);
  uSunE = uniform(3.2);
  uCloudShift = uniform(0);
  uDetail = uniform(0);
  tex: EarthTex;

  constructor(tex: EarthTex, scale: number, seg = 192) {
    this.tex = tex;
    const { uSun: sun, uCam: cam, uSunI: sunI, uSunE: sunE, uCloudShift: cshift, uDetail: detail } = this;

    const raySphere = (ro: any, rd: any, rad: number) => {
      const b = dot(ro, rd), c = dot(ro, ro).sub(rad * rad), disc = b.mul(b).sub(c), s = sqrt(max(disc, 0));
      return { t0: b.negate().sub(s), t1: b.negate().add(s), hit: disc.greaterThan(0) };
    };
    // Soft Earth shadow on a point (for sunlight reaching the atmosphere).
    const sunVisible = (p: any) => {
      const cs = dot(p, sun), perp = sqrt(max(dot(p, p).sub(cs.mul(cs)), 0));
      return select(cs.greaterThan(0), float(1), smoothstep(R - 2, R + 6, perp));
    };
    const lightDepth = (p: any, n: number) => {
      const segL = raySphere(p, sun, RA).t1.div(n), oR = float(0).toVar(), oM = float(0).toVar();
      (Loop as any)({ start: 0, end: n, type: 'int', condition: '<', name: 'j' }, ({ j }: any) => {
        const x = p.add(sun.mul(segL.mul(float(j).add(0.5)))), h = length(x).sub(R);
        oR.addAssign(exp(h.negate().div(HR)).mul(segL));
        oM.addAssign(exp(h.negate().div(HM)).mul(segL));
      });
      return { oR, oM };
    };
    const phase = (mu: any) => {
      const pR = float(3 / (16 * Math.PI)).mul(mu.mul(mu).add(1)), g2 = G * G;
      const pM = float((3 / (8 * Math.PI)) * (1 - g2) / (2 + g2)).mul(mu.mul(mu).add(1)).div(pow(max(float(1 + g2).sub(mu.mul(2 * G)), 1e-4), 1.5));
      return { pR, pM };
    };
    const integrate = (ro: any, rd: any, tA: any, tB: any, n: number, nl: number) => {
      const segV = max(tB.sub(tA), 0).div(n), accR = vec3(0).toVar(), accM = vec3(0).toVar(), odR = float(0).toVar(), odM = float(0).toVar();
      Loop(n, ({ i }: any) => {
        const x = ro.add(rd.mul(tA.add(segV.mul(float(i).add(0.5))))).toVar();
        const h = length(x).sub(R).toVar();
        const dR = exp(h.negate().div(HR)).mul(segV).toVar(), dM = exp(h.negate().div(HM)).mul(segV).toVar();
        odR.addAssign(dR); odM.addAssign(dM);
        const l = lightDepth(x, nl);
        const tau = BETA_R.mul(odR.add(l.oR)).add(vec3(BETA_ME).mul(odM.add(l.oM)));
        const att = exp(tau.negate()).mul(sunVisible(x));
        accR.addAssign(att.mul(dR)); accM.addAssign(att.mul(dM));
      });
      const ph = phase(dot(rd, sun));
      const inscatter = accR.mul(BETA_R).mul(ph.pR).add(accM.mul(BETA_MS).mul(ph.pM)).mul(sunI);
      const trans = exp(BETA_R.mul(odR).add(vec3(BETA_ME).mul(odM)).negate());
      return { inscatter, trans };
    };
    const sunTrans = (p: any, n: number) => {
      const l = lightDepth(p, n);
      return exp(BETA_R.mul(l.oR).add(vec3(BETA_ME).mul(l.oM)).negate()).mul(sunVisible(p));
    };

    // Surface
    const sm = new THREE.MeshBasicNodeMaterial();
    sm.colorNode = Fn(() => {
      const p = positionLocal.div(scale), n = normalize(p), view = normalize(p.sub(cam)), st = uv();
      const px = 1 / 2048;
      const h0 = texture(tex.topo, st).r, hx = texture(tex.topo, st.add(vec2(px, 0))).r, hy = texture(tex.topo, st.add(vec2(0, px))).r;
      const east = normalize(cross(vec3(0, 1, 0), n)), north = cross(n, east), k = float(5);
      const nb = normalize(n.sub(east.mul(hx.sub(h0).mul(k))).sub(north.mul(hy.sub(h0).mul(k))));
      const water = texture(tex.water, st).r;
      let albedo: any = texture(tex.day, st).rgb;
      const n1 = mx_fractal_noise_float(n.mul(2400), 4, 2, 0.5, 1), n2 = mx_fractal_noise_float(n.mul(9000), 3, 2, 0.5, 1);
      const land = float(1).sub(water);
      albedo = albedo.mul(float(1).add(n1.mul(0.35).add(n2.mul(0.2)).mul(detail).mul(land)));
      const deep = vec3(0.012, 0.035, 0.07);
      albedo = mix(albedo, mix(albedo, deep, 0.35), water);
      const ndl = dot(nb, sun), tr = sunTrans(p.mul(1.0002), 4);
      // Cloud shadow: sample the cloud layer along the sun direction.
      const cp = normalize(p.add(sun.mul(float(8).div(max(dot(n, sun), 0.15)))));
      const cu = fract(atan(cp.z, cp.x.negate()).div(2 * Math.PI).add(1).add(cshift));
      const cv = float(1).sub(acos(clamp(cp.y, -1, 1)).div(Math.PI));
      const cshadow = float(1).sub(smoothstep(0.15, 0.85, texture(tex.clouds, vec2(cu, cv)).r).mul(0.65));
      const diffuse = albedo.mul(max(ndl, 0)).mul(tr).mul(sunE).mul(cshadow);
      // Ocean glint (GGX-ish)
      const vv = view.negate(), hv = normalize(sun.add(vv)), nh = max(dot(n, hv), 0), a = 0.09, a2 = a * a;
      const dd = nh.mul(nh).mul(a2 - 1).add(1), D = float(a2).div(dd.mul(dd).mul(Math.PI));
      const F = float(0.02).add(pow(float(1).sub(max(dot(vv, hv), 0)), 5).mul(0.98));
      const glint = D.mul(F).mul(max(dot(n, sun), 0)).mul(water).mul(tr).mul(sunE).mul(0.25).mul(cshadow);
      const city = texture(tex.night, st).rgb, cl = luminance(city);
      const lights = vec3(1, 0.62, 0.32).mul(pow(max(cl.sub(0.02), 0), 1.4)).mul(2.2).mul(float(1).sub(smoothstep(-0.15, 0.05, dot(n, sun))));
      const hit = raySphere(cam, view, RA), tA = max(hit.t0, 0), tB = length(p.sub(cam));
      const air = integrate(cam, view, tA, tB, 10, 4);
      return diffuse.add(glint).add(lights).mul(air.trans).add(air.inscatter);
    })();
    this.surface = new THREE.Mesh(new THREE.SphereGeometry(R * scale, seg, seg / 2), sm);

    // Clouds
    const cmat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    const cnode = Fn(() => {
      const p = positionLocal.div(scale), n = normalize(p), st = uv();
      const c = texture(tex.clouds, vec2(fract(st.x.add(cshift)), st.y)).r;
      const nz = mx_fractal_noise_float(n.mul(1800), 4, 2, 0.55, 1);
      const dens = smoothstep(0.12, 0.9, c.add(nz.mul(0.18).mul(detail).mul(c.add(0.2))));
      const tr = sunTrans(p, 3), mu = dot(n, sun);
      const lit = vec3(1).mul(max(mu.mul(0.85).add(0.15), 0)).mul(tr).mul(sunE).mul(0.95);
      const view = normalize(p.sub(cam)), hit = raySphere(cam, view, RA);
      const air = integrate(cam, view, max(hit.t0, 0), length(p.sub(cam)), 6, 3);
      return vec4(lit.mul(air.trans).add(air.inscatter.mul(0.6)), dens.mul(0.92));
    })();
    cmat.colorNode = cnode.rgb;
    cmat.opacityNode = cnode.a;
    this.clouds = new THREE.Mesh(new THREE.SphereGeometry((R + 6) * scale, seg, seg / 2), cmat);
    this.clouds.renderOrder = 1;

    // Atmosphere shell (limb + airglow)
    const amat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending });
    amat.colorNode = Fn(() => {
      const p = positionLocal.div(scale), view = normalize(p.sub(cam));
      const top = raySphere(cam, view, RA), ground = raySphere(cam, view, R);
      If(ground.hit.and(ground.t0.greaterThan(0)), () => { Discard(); });
      const air = integrate(cam, view, max(top.t0, 0), top.t1, 16, 6);
      const tc = dot(cam, view).negate(), alt = length(cam.add(view.mul(tc))).sub(R + 95);
      const nn = normalize(cam.add(view.mul(tc)));
      const night = float(1).sub(smoothstep(-0.2, 0.1, dot(nn, sun)));
      const glow = vec3(0.25, 1, 0.45).mul(exp(alt.mul(alt).negate().div(60))).mul(0.008).mul(night);
      return air.inscatter.add(glow);
    })();
    this.atmo = new THREE.Mesh(new THREE.SphereGeometry(RA * scale, seg, seg / 2), amat);
    this.atmo.renderOrder = 2;
    this.group.add(this.surface, this.clouds, this.atmo);
  }
}
