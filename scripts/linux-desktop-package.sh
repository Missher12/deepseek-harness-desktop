#!/usr/bin/env bash
# Build x64 Linux artifacts natively; never infer Linux evidence from macOS.
set -euo pipefail
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]]
cd "$(dirname "$0")/.."
export CC="${CC:-clang-15}"
export CXX="${CXX:-clang++-15}"
"$CXX" --version
probe_root="$(mktemp -d)"
trap 'rm -rf -- "$probe_root"' EXIT
"$CXX" -std=c++20 scripts/linux-desktop-toolchain-probe.cc -o "$probe_root/probe"
"$probe_root/probe"
pnpm --filter @deepseek-ai/node-addon-system-workspace run build:native
node native/system/scripts/verify-launcher-binary.mjs packages/linux-x64
pnpm run desktop:stage
# Keep this standalone platform entry usable before shared staging integrates.
cp apps/desktop/electron-builder.linux.yml apps/desktop/.stage/electron-builder.linux.yml
pnpm --filter @deepseek-ai/dsh-desktop exec electron-builder \
  --projectDir .stage --config electron-builder.linux.yml \
  --linux deb AppImage --x64 --publish never
