#!/usr/bin/env bash
# Build the explicit base composition on native Linux x64; inputs are never inferred or deleted.
set -euo pipefail
cd "$(dirname "$0")/.."

# Resolve only the selected stage; retain the original literal argv for shared preparation.
stage="$(node --input-type=module - "$@" <<'NODE'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { parseArgs } from 'node:util'
const { values, tokens } = parseArgs({ args: process.argv.slice(2), tokens: true, options: {
  'official-source': { type: 'string' }, packages: { type: 'string' }, descriptor: { type: 'string' },
  'descriptor-sha256': { type: 'string' }, runtime: { type: 'string' }, stage: { type: 'string' },
  'work-dir': { type: 'string' }, 'build-official': { type: 'boolean' },
  'runtime-audit': { type: 'string' }, 'runtime-audit-sha256': { type: 'string' },
  'helper-runtime': { type: 'string' }, 'helper-cache': { type: 'string' },
} })
const seen = new Set()
for (const token of tokens) {
  if (token.kind !== 'option') continue
  if (seen.has(token.name)) throw new Error(`Duplicate option: --${token.name}`)
  seen.add(token.name)
}
for (const [name, value] of Object.entries(values)) {
  if (typeof value === 'string' && value.trim() === '') throw new Error(`Empty --${name}.`)
}
for (const name of ['official-source', 'packages', 'descriptor', 'runtime']) {
  if (values[name] === undefined) throw new Error(`Provide explicit --${name}.`)
}
if (Boolean(values['build-official']) === (values['descriptor-sha256'] !== undefined)) {
  throw new Error('Select exactly one of --build-official or --descriptor-sha256; no automatic build fallback.')
}
if (!statSync(values['official-source']).isDirectory()) throw new Error('--official-source must be a directory.')
function verifyReceipt(path, digest, label) {
  if (!/^[a-f0-9]{64}$/iu.test(digest)) throw new Error(`Invalid ${label} SHA-256.`)
  if (createHash('sha256').update(readFileSync(path)).digest('hex') !== digest.toLowerCase()) {
    throw new Error(`${label} SHA-256 mismatch.`)
  }
}
if (values['build-official']) {
  if (existsSync(values.packages) || existsSync(values.descriptor)) {
    throw new Error('Official build outputs already exist; reuse their trusted descriptor instead.')
  }
} else {
  if (!statSync(values.packages).isDirectory()) throw new Error('--packages must be a directory.')
  verifyReceipt(values.descriptor, values['descriptor-sha256'], 'Descriptor')
}
if ((values['runtime-audit'] !== undefined) !== (values['runtime-audit-sha256'] !== undefined)) {
  throw new Error('Provide both --runtime-audit and --runtime-audit-sha256 for audited reuse.')
}
if (values['runtime-audit'] !== undefined) {
  verifyReceipt(values['runtime-audit'], values['runtime-audit-sha256'], 'Runtime audit')
}
const stage = resolve(values.stage ?? 'apps/desktop/.stage')
if (stage !== resolve('apps/desktop/.stage') && basename(stage) !== 'dsh-desktop-stage') {
  throw new Error('A custom --stage directory must be named dsh-desktop-stage.')
}
if (existsSync(stage)) throw new Error('Desktop stage already exists; select a new --stage. Existing stages are never deleted.')
console.log(stage)
NODE
)"

[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || {
  echo 'Desktop Linux packaging requires a native Linux x64 host.' >&2
  exit 1
}
export CC="${CC:-clang-15}"
export CXX="${CXX:-clang++-15}"
"$CXX" --version
probe_root="$(mktemp -d)"
trap 'rm -rf -- "$probe_root"' EXIT
"$CXX" -std=c++20 scripts/linux-desktop-toolchain-probe.cc -o "$probe_root/probe"
"$probe_root/probe"
pnpm run desktop:stage "$@"

node --import tsx/esm --input-type=module - "$stage" <<'NODE'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { validateDesktopBaseSmokeDescriptor } from './scripts/desktop-base-contract.ts'
const stage = process.argv[2]
const smoke = validateDesktopBaseSmokeDescriptor(JSON.parse(readFileSync(join(stage, 'base-smoke.json'), 'utf8')))
const manifest = JSON.parse(readFileSync('apps/desktop/package.json', 'utf8'))
const stagedManifest = JSON.parse(readFileSync(join(stage, 'package.json'), 'utf8'))
if (smoke.platform !== 'linux' || smoke.arch !== 'x64'
  || smoke.desktopVersion !== manifest.version || smoke.desktopVersion !== stagedManifest.version) {
  throw new Error('Base smoke descriptor must match Linux x64 and the source/staged Desktop version.')
}
NODE

release="$PWD/apps/desktop/release"
builder="$(node -p "require.resolve('electron-builder/cli.js', { paths: ['./apps/desktop'] })")"
# Relative hooks resolve from cwd; use the prepared stage's config, hooks and resources together.
(
  cd "$stage"
  node "$builder" --projectDir "$stage" --config "$stage/electron-builder.linux.yml" \
    --config.directories.output="$release" --linux deb AppImage --x64 --publish never
)
mkdir -p "$release"
cp "$stage/base-smoke.json" "$release/base-smoke.json"
