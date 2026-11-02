// Boot: simulation core, renderer, Earth textures, world, camera, game, interface, loop.
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { initCore, core, V } from './sim/core';
import { worldNow, setClockSkew } from './sim/clock';
import { Gfx } from './render/gfx';
import { WorldScene } from './world/scene';
import { FreeCamera } from './world/camera';
import { Game } from './game/game';
import { UI } from './ui/ui';

const P: any = ((window as any).P = { debug: {} });

async function loadTextures() {
  const L = new THREE.TextureLoader();
  const load = (f: string, srgb: boolean) => new Promise<THREE.Texture>((res, rej) => L.load('tex/' + f, t => {
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8; t.wrapS = THREE.RepeatWrapping; res(t);
  }, undefined, rej));
  const [day, night, clouds, water, topo] = await Promise.all([load('day.jpg', true), load('night.jpg', true), load('clouds.jpg', false), load('water.jpg', false), load('topo.jpg', false)]);
  return { day, night, clouds, water, topo };
}

async function boot() {
  const msg = (s: string) => { const e = document.getElementById('loadmsg'); if (e) e.textContent = s; };
  msg('Starting simulation core…');
  await initCore();
  msg('Starting renderer…');
  const gfx = new Gfx(), q = new URLSearchParams(location.search);
  await gfx.init(document.getElementById('gl') as HTMLCanvasElement, q.has('webgl'));
  msg('Loading Earth…');
  const tex = await loadTextures();
  const world = new WorldScene(gfx, tex), cam = new FreeCamera(), game = new Game(world, cam), ui = new UI(game, world, cam, gfx);
  world.buildOrbits(worldNow());
  P.debug = { gfx, world, cam, game, ui, core, V, THREE, TSL, setClockSkew };
  document.getElementById('loading')!.classList.add('out');
  let last = performance.now();
  const loop = (now: number) => {
    const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
    last = now; P.frames = (P.frames || 0) + 1;
    try {
      game.step(dt); cam.step(dt); game.render(dt); ui.tick(dt);
      if (ui.renderHangar) ui.hangar.render(); else gfx.render();
    } catch (e) { console.error(e); }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
boot().catch(e => {
  console.error(e);
  const el = document.getElementById('loadmsg');
  if (el) el.textContent = 'Could not start: ' + (e && e.message || e);
});
