# Working on PERIHELION

- Build with `node build.mjs` (add `--dev` for an unminified bundle); type-check with `npx tsc -p .`. Both must pass before committing.
- Test in headless Chromium with WebGPU on SwiftShader: serve `dist/` on 127.0.0.1:8766, then `node test/shots.js <outdir> test/s1.js` (Stage 1) or `test/s234.js` (Stages 2–4). Look at the screenshots; the only expected console error is the Google Fonts request failing offline.
- The physics core must stay deterministic: no `Math.random` in simulation code, seeded `rng(hash(...))` from `src/game/util.ts` for anything shared between players.
- One world clock, real time (1×), for every player. Never add time warp; use the dev tray (`?dev`) to skip waits while testing.
- Interface rules: blue-led infographic style, colours carry meaning (blue structure, teal done/yours, amber money, violet interplanetary, coral danger). Panels re-render through `morph()`; never replace panel HTML wholesale, or clicks get lost.
- The C++ core source is missing; `assets/core.wasm` is the compiled build. Don't change its IO layout without rewriting the source first.
- Commit and push to this repository after each meaningful step, so work can't be lost again.
