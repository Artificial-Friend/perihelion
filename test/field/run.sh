#!/bin/sh
# Field operations logic tests (Node, no browser): recovery, flight physics, hopper.
set -e
out=$(mktemp -d)
for t in recovery flight hopper; do
  npx esbuild "test/field/$t.ts" --bundle --platform=node --outfile="$out/$t.cjs" --log-level=warning
  node "$out/$t.cjs" | grep -E "FAIL|passed"
done
