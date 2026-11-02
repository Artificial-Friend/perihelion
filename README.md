# PERIHELION

A hard science-fiction MMO set in a simulated 2060 solar system that runs in real time for every player. You start as a small company on the ground and grow through orbit and interplanetary hauling to a state of your own.

It runs in the browser: a deterministic C++ physics core compiled to WebAssembly, rendering with three.js on WebGPU (WebGL2 fallback), and TypeScript for game logic and the interface.

## Run it

Needs Node 20+, `clang++` with the `wasm32` target and `wasm-ld` (Arch: `pacman -S clang lld`).

```sh
npm install
npm run build        # compiles core/ to wasm, writes dist/ (index.html, game.js, textures)
npm run serve        # http://127.0.0.1:8766  (add ?dev for the dev tray, ?webgl to force WebGL2)
```

`npm run typecheck` type-checks the project. `npm run dev` builds without minifying. `npm run test:parity` rebuilds the core and checks it bit for bit against the reference build, in WebAssembly and natively.

## Layout

| Path | What it is |
| --- | --- |
| `core/` | C++ physics core: deterministic math (`pmath.h`), orbits, rendezvous, ephemerides, environment (`sim.h`), the exported C ABI (`api.cpp`) |
| `src/sim/` | Typed wrapper over the core (`core.ts`) and the shared world clock (`clock.ts`) |
| `src/render/` | Renderer, Earth atmosphere, stars, materials, ships, hangar, Stage 3–4 craft |
| `src/world/` | Floating-origin scene and the free camera |
| `src/game/` | Stage logic: `ground` (1), `ops` + `orbit` (2), `haul` (3), `sovereign` (4), `game` (save, objectives, rendering glue) |
| `src/net/` | Shared-world backend (claude.ai artifact storage, or local fallback) |
| `src/ui/` | Interface, infographic overlay, SVG charts, DOM morphing, styles, page shell |
| `test/` | Core parity test against `test/core-v3.wasm`, headless WebGPU screenshot runs per stage, economy simulation |

## Status

Development build v3: all four designed stages are playable, with a stage selector on the title screen. See the design spec and roadmap documents for the plan.

**Physics core.** The C++ source was rebuilt from the v3 compiled module (its original source was lost in a workspace reset). The parity test proves the rebuild matches that module bit for bit on 180,000 random cases across all 18 exports, and that native builds match WebAssembly exactly. Any change to the core that alters results must update `test/core-v3.wasm` deliberately.
