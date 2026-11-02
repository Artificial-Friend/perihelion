#!/bin/sh
# Builds the simulation core for WebAssembly (build/core.wasm) and natively (build/core_test).
# -ffp-contract=off: no fused multiply-add, so wasm and native results are bit-identical.
set -e
cd "$(dirname "$0")/.."
mkdir -p build
FLAGS="-O2 -std=c++17 -ffp-contract=off -fno-exceptions -fno-rtti"
clang++ --target=wasm32 -nostdlib $FLAGS -fvisibility=hidden \
  -Wl,--no-entry -Wl,--export-dynamic -Wl,--initial-memory=196608 -Wl,-z,stack-size=65536 \
  -o build/core.wasm core/api.cpp core/memcpy.cpp
# Native build of the same code, used by test/parity.mjs --native to prove wasm == native.
clang++ $FLAGS -o build/core_native core/native_check.cpp
