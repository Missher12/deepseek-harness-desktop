#!/usr/bin/env bash
# Build x64 Linux artifacts natively; never infer Linux evidence from macOS.
set -euo pipefail
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]]
cd "$(dirname "$0")/.."
pnpm --filter @deepseek-ai/node-addon-landlock-run-workspace run build:native
node native/landlock-run/scripts/verify-launcher-binary.mjs packages/linux-x64
pnpm run desktop:stage
# Keep this standalone platform entry usable before shared staging integrates.
cp apps/desktop/electron-builder.linux.yml apps/desktop/.stage/electron-builder.linux.yml
pnpm --filter @deepseek-ai/dsh-desktop exec electron-builder \
  --projectDir .stage --config electron-builder.linux.yml \
  --linux deb AppImage --x64 --publish never
