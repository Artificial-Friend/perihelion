# PERIHELION

A hard science-fiction MMO set in a simulated 2060 solar system that runs in real time for every player. You start as a small company on the ground and grow through orbit and interplanetary hauling to a state of your own.

It runs in the browser: a deterministic physics core in WebAssembly, rendering with three.js on WebGPU (WebGL2 fallback), and TypeScript for game logic and the interface.

## Run it

```sh
npm install
npm run build        # writes dist/ (index.html, game.js, textures)
npm run serve        # http://127.0.0.1:8766  (add ?dev for the dev tray, ?webgl to force WebGL2)
```

`npm run typecheck` type-checks the project. `npm run dev` builds without minifying.

## Layout

| Path | What it is |
| --- | --- |
| `src/sim/` | Typed wrapper over the physics core (`core.ts`) and the shared world clock (`clock.ts`) |
| `assets/core.wasm` | The compiled physics core (Kepler, Lambert, ephemerides, passes, heat, radiation) |
| `src/render/` | Renderer, Earth atmosphere, stars, materials, ships, hangar, Stage 3–4 craft |
| `src/world/` | Floating-origin scene and the free camera |
| `src/game/` | Stage logic: `ground` (1), `ops` + `orbit` (2), `haul` (3), `sovereign` (4), `game` (save, objectives, rendering glue) |
| `src/net/` | Shared-world backend (claude.ai artifact storage, or local fallback) |
| `src/ui/` | Interface, infographic overlay, SVG charts, DOM morphing, styles, page shell |
| `test/` | Headless WebGPU screenshot runs per stage, economy simulation |

## Status

Development build v3: all four designed stages are playable, with a stage selector on the title screen. See the design spec and roadmap documents for the plan.

**Known gap:** the C++ source of the physics core was lost in a workspace reset. `assets/core.wasm` is the last compiled build and is embedded at build time. Rewriting `core/*.cpp` (and checking it bit-for-bit against this module) is the first roadmap task; `build.mjs` compiles `core/` automatically once `core/build.sh` exists.
