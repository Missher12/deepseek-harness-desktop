#!/usr/bin/env bash
# Installed-byte base acceptance on disposable GitHub Ubuntu runners only.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ "$#" == 0 ]]
[[ "${GITHUB_ACTIONS:-}" == true && "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]]
[[ "$EUID" != 0 && -n "${RUNNER_TEMP:-}" && "${CANDIDATE_SHA:-}" =~ ^[a-f0-9]{40}$ ]]
[[ "$(git rev-parse HEAD)" == "$CANDIDATE_SHA" ]]

# All descriptor/helper/input failures precede installation or authorization changes.
identity="$(node --import tsx/esm --input-type=module <<'NODE'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { validateDesktopBaseSmokeDescriptor } from './scripts/desktop-base-contract.ts'
if (process.env.DSH_DESKTOP_SMOKE_STAGE !== undefined) throw new Error('Formal Linux base acceptance forbids a development stage.')
const path = process.env.DSH_DESKTOP_SMOKE_DESCRIPTOR
if (path === undefined || resolve(path) !== resolve('apps/desktop/release/base-smoke.json')) throw new Error('The candidate base-smoke sidecar is required.')
const base = validateDesktopBaseSmokeDescriptor(JSON.parse(await readFile(path, 'utf8')))
const manifest = JSON.parse(await readFile('apps/desktop/package.json', 'utf8'))
if (base.platform !== 'linux' || base.arch !== 'x64' || base.desktopVersion !== manifest.version) throw new Error('Linux base identity mismatch.')
if (base.baseline.desktopVersion !== '0.5.7' || base.baseline.harnessVersion !== '0.1.3-alpha.1'
  || base.baseline.sourceSha !== '7f544cd31c43f239c09c3a209ae0d05fe677c710') throw new Error('The Linux 0.5.7 historical variant is required; Linux 0.5.5 cannot be fabricated.')
console.log([base.desktopVersion, base.coreRoot].join('\t'))
NODE
)"
IFS=$'\t' read -r version core_root <<< "$identity"
for helper in apps/desktop/tests/packaged-base-smoke.ts apps/desktop/tests/base-legacy-fixture.ts scripts/verify-desktop-base-smoke.ts; do
  [[ -f "$helper" ]] || { printf 'Required shared base helper is not committed: %s\n' "$helper" >&2; exit 1; }
done
release="$PWD/apps/desktop/release"
deb="$release/DeepSeek-Harness-$version-linux-x64.deb"
image="$release/DeepSeek-Harness-$version-linux-x64.AppImage"
(cd "$release" && sha256sum -c SHA256SUMS-linux)
legacy_assets="$RUNNER_TEMP/linux-legacy-assets"
old_deb="$legacy_assets/DeepSeek-Harness-0.5.7-linux-x64.deb"
old_image="$legacy_assets/DeepSeek-Harness-0.5.7-linux-x64.AppImage"
node --input-type=module - "$old_deb" "$old_image" <<'NODE'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
const expected = [
  [146340244, 'e9b432dd29dad775bae4a7b3ba7b056732a2637c64818d119211941d9a535cb7'],
  [190958299, '397008b717181c1f5231d3ba69158f1a5e8fcaf47be7f34e9494ce036e0bb01a'],
]
for (const [index, path] of process.argv.slice(2).entries()) {
  const [bytes, digest] = expected[index]
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  if ((await stat(path)).size !== bytes || hash.digest('hex') !== digest) throw new Error('Public 0.5.7 artifact differs from the reviewed bytes.')
}
NODE
ubuntu_version="$(. /etc/os-release; printf '%s' "$VERSION_ID")"
[[ "$ubuntu_version" == 22.04 || "$ubuntu_version" == 24.04 ]]
if [[ "$ubuntu_version" == 24.04 ]]; then
  [[ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns)" == 1 ]]
fi
if dpkg-query -W -f='${Status}' deepseek-harness 2>/dev/null | grep -q 'install ok installed'; then
  echo 'Refusing to replace a pre-existing Desktop installation on this runner.' >&2
  exit 1
fi
evidence="$RUNNER_TEMP/linux-native-evidence"
mkdir -p "$evidence"
owned="$(mktemp -d "$evidence/run-XXXXXX")"
mkdir -p "$owned/AppImage with spaces" "$owned/old-deb" "$owned/old-appimage"
appimage="$owned/AppImage with spaces/DeepSeek-Harness.AppImage"
policy_installed=false
deb_installed=false
cleanup() {
  local original_status=$? cleanup_status=0
  trap - EXIT
  if [[ "$policy_installed" == true ]]; then
    sudo bash scripts/linux-desktop-appimage-policy.sh remove "$appimage" || cleanup_status=1
  fi
  if [[ "$deb_installed" == true ]]; then sudo apt-get purge -y deepseek-harness || cleanup_status=1; fi
  if [[ "$original_status" == 0 ]]; then exit "$cleanup_status"; else exit "$original_status"; fi
}
trap cleanup EXIT
export DSH_TELEMETRY_DISABLED=1

prepare_legacy_fixture() {
  local format="$1" installation="$2" artifact="$3"
  export DSH_DESKTOP_SMOKE_ROOT="$owned/base-$format"
  export DSH_DESKTOP_SMOKE_DSH_HOME="$DSH_DESKTOP_SMOKE_ROOT/home/.dsh"
  export DSH_DESKTOP_SMOKE_USER_DATA="$DSH_DESKTOP_SMOKE_ROOT/electron-data"
  node --import tsx/esm --input-type=module - "$installation" "$artifact" "$DSH_DESKTOP_SMOKE_ROOT" <<'NODE'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readdir, realpath } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, sep } from 'node:path'
import { prepareBaseLegacyFixture } from './apps/desktop/tests/base-legacy-fixture.ts'
const [installation, artifactPath, isolationRoot] = process.argv.slice(2)
const extractedRoot = await realpath(installation), seen = new Set(), files = []
async function collect(path) {
  const physical = await realpath(path), local = relative(extractedRoot, physical)
  if (isAbsolute(local) || local === '..' || local.startsWith(`..${sep}`)) throw new Error('Old extracted package path escaped its owned root.')
  if (seen.has(physical)) return
  seen.add(physical)
  const info = await lstat(physical)
  if (info.isDirectory()) { for (const name of await readdir(physical)) await collect(join(physical, name)); return }
  if (!info.isFile()) throw new Error('Old extracted package has a non-regular input.')
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(physical)) hash.update(chunk)
  files.push({ path: physical, sha256: hash.digest('hex') })
}
await collect(extractedRoot)
const deb = artifactPath.endsWith('.deb')
const fixture = await prepareBaseLegacyFixture({ isolationRoot, legacy: {
  artifactPath, artifactSha256: deb ? 'e9b432dd29dad775bae4a7b3ba7b056732a2637c64818d119211941d9a535cb7'
    : '397008b717181c1f5231d3ba69158f1a5e8fcaf47be7f34e9494ce036e0bb01a',
  releaseUrl: `https://github.com/Missher12/deepseek-harness-desktop/releases/download/desktop-v0.5.7/${basename(artifactPath)}`,
  extractedRoot, modulesRoot: join(extractedRoot, 'resources/app.asar.unpacked/node_modules'),
  executablePath: join(extractedRoot, 'deepseek-harness-bin'), executableKind: 'electron',
  cliPath: join(extractedRoot, 'resources/app.asar.unpacked/node_modules/@deepseek-ai/dsh/lib/bin.js'),
  applicationAsarPath: join(extractedRoot, 'resources/app.asar'),
  sourceSha: '7f544cd31c43f239c09c3a209ae0d05fe677c710', desktopVersion: '0.5.7', harnessVersion: '0.1.3-alpha.1',
  platform: 'linux', arch: 'x64', files,
} })
if (fixture.fixtureReceiptPath !== join(isolationRoot, 'legacy-fixture.json')) throw new Error('Unexpected legacy fixture receipt location.')
NODE
  export DSH_DESKTOP_SMOKE_LEGACY_FIXTURE="$DSH_DESKTOP_SMOKE_ROOT/legacy-fixture.json"
}

retention_snapshot() {
  node --input-type=module - "$DSH_DESKTOP_SMOKE_DSH_HOME" "$DSH_DESKTOP_SMOKE_USER_DATA" <<'NODE'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readdir, readlink } from 'node:fs/promises'
import { join } from 'node:path'
const entries = []
async function visit(path) {
  const info = await lstat(path)
  if (info.isSymbolicLink()) { entries.push({ path, link: await readlink(path) }); return }
  if (info.isDirectory()) { entries.push({ path, directory: true }); for (const name of (await readdir(path)).sort()) await visit(join(path, name)); return }
  if (!info.isFile()) throw new Error('Unexpected retained user-data entry.')
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  entries.push({ path, bytes: info.size, sha256: hash.digest('hex') })
}
for (const root of process.argv.slice(2)) await visit(root)
console.log(JSON.stringify(entries))
NODE
}

run_legacy_native_start() {
  local target="$1" format="$2"
  DSH_LINUX_LEGACY_EXECUTABLE="$target" DSH_LINUX_EVIDENCE_ROOT="$evidence/$format" \
    env -u NODE_PATH -u NODE_OPTIONS node node_modules/vitest/vitest.mjs run \
      apps/desktop/tests/linux-existing-writer.spec.ts -t 'starts the verified old release' --config vitest.config.ts
}

run_linux_native_checks() {
  # These phases own different process trees; the writer must be reaped before the base UI smoke.
  for spec in linux-existing-writer.spec.ts linux-packaged-smoke.spec.ts; do
    env -u NODE_PATH -u NODE_OPTIONS node node_modules/vitest/vitest.mjs run \
      "apps/desktop/tests/$spec" --config vitest.config.ts
  done
  # Core requires native history readback; pause/recovery is explicitly unattempted.
  # Strict verification must finish while installed bytes still exist, before uninstall.
  node --import tsx/esm scripts/verify-desktop-base-smoke.ts \
    --receipt "$DSH_DESKTOP_SMOKE_ROOT/base-smoke-receipt.json" \
    --descriptor "$DSH_DESKTOP_SMOKE_DESCRIPTOR" --smoke-root "$DSH_DESKTOP_SMOKE_ROOT" --platform linux --scope core \
    > "$DSH_LINUX_EVIDENCE_ROOT/core-verification.json"
  cp "$DSH_DESKTOP_SMOKE_ROOT/base-smoke-receipt.json" "$DSH_LINUX_EVIDENCE_ROOT/base-smoke-receipt.json"
}

[[ "$(dpkg-deb -f "$deb" Package)" == deepseek-harness && "$(dpkg-deb -f "$deb" Version)" == "$version" ]]
[[ "$(dpkg-deb -f "$deb" Architecture)" == amd64 ]]
for dependency in lsof python3; do
  dpkg-deb -f "$deb" Depends | tr ',' '\n' | grep -Eq "^[[:space:]]*$dependency([[:space:]]|$)"
done
dpkg-deb -x "$old_deb" "$owned/old-deb"
prepare_legacy_fixture deb "$owned/old-deb/opt/DeepSeek Harness" "$old_deb"
deb_installed=true
sudo apt-get install -y "$old_deb"
[[ "$(dpkg-query -W -f='${Version}' deepseek-harness)" == 0.5.7 ]]
run_legacy_native_start '/opt/DeepSeek Harness/deepseek-harness' deb
sudo apt-get install -y "$deb"
[[ "$(dpkg-query -W -f='${Version}' deepseek-harness)" == "$version" ]]
desktop=/usr/share/applications/deepseek-harness.desktop
desktop-file-validate "$desktop"
grep -F 'StartupWMClass=deepseek-harness' "$desktop"
if grep -E -- '--(no-sandbox|disable.*sandbox)' "$desktop"; then exit 1; fi
dpkg-query -L deepseek-harness | grep -E '/icons/.+/apps/deepseek-harness\.png$' > "$evidence/installed-icons.txt"
[[ -s "$evidence/installed-icons.txt" ]]
while IFS= read -r icon; do test -s "$icon"; done < "$evidence/installed-icons.txt"
if [[ "$ubuntu_version" == 24.04 ]]; then [[ -f /etc/apparmor.d/deepseek-harness ]]; fi
export DSH_LINUX_DESKTOP_EXECUTABLE='/opt/DeepSeek Harness/deepseek-harness'
export DSH_LINUX_EVIDENCE_ROOT="$evidence/deb"
export DSH_LINUX_PACKAGE_FORMAT=deb
landlock="/opt/DeepSeek Harness/$core_root/@deepseek-ai/node-addon-system-linux-x64/bin/landlock-run"
test -x "$landlock"
"$landlock" --probe > "$evidence/landlock-probe.txt"
run_linux_native_checks
retention_snapshot > "$owned/deb-retention-before.json"
sudo apt-get install --reinstall -y "$deb"
retention_snapshot > "$owned/deb-retention-after.json"
cmp "$owned/deb-retention-before.json" "$owned/deb-retention-after.json"
sudo apt-get purge -y deepseek-harness
deb_installed=false
retention_snapshot > "$owned/deb-retention-after.json"
cmp "$owned/deb-retention-before.json" "$owned/deb-retention-after.json"
[[ ! -e "$DSH_LINUX_DESKTOP_EXECUTABLE" && ! -e "$desktop" && ! -e /etc/apparmor.d/deepseek-harness ]]
while IFS= read -r icon; do test ! -e "$icon"; done < "$evidence/installed-icons.txt"
printf '{"oldInstall":"0.5.7","upgrade":true,"reinstall":true,"purge":true,"baseReceiptVerifiedBeforePurge":true,"dataRetained":true,"packageKitUpdate":"not-tested"}\n' > "$evidence/deb-lifecycle.json"

chmod 0755 "$old_image"
(cd "$owned/old-appimage" && "$old_image" --appimage-extract > /dev/null)
prepare_legacy_fixture appimage "$owned/old-appimage/squashfs-root" "$old_image"
cp "$old_image" "$appimage"
chmod 0755 "$appimage"
if [[ "$ubuntu_version" == 24.04 ]]; then
  policy_installed=true
  sudo bash scripts/linux-desktop-appimage-policy.sh install "$appimage"
fi
run_legacy_native_start "$appimage" appimage
# The published old bridge provides manual installation only. This explicit, stopped replacement
# checks old-profile continuation; it is not acceptance of the new protected automatic update backend.
cp "$image" "$appimage"
chmod 0755 "$appimage"
export DSH_LINUX_DESKTOP_EXECUTABLE="$appimage"
export DSH_LINUX_EVIDENCE_ROOT="$evidence/appimage"
export DSH_LINUX_PACKAGE_FORMAT=appimage
run_linux_native_checks
retention_snapshot > "$owned/appimage-retention-before.json"
if [[ "$policy_installed" == true ]]; then
  sudo bash scripts/linux-desktop-appimage-policy.sh remove "$appimage"
  policy_installed=false
fi
rm -- "$appimage"
retention_snapshot > "$owned/appimage-retention-after.json"
cmp "$owned/appimage-retention-before.json" "$owned/appimage-retention-after.json"
printf '{"oldDirectLaunch":"0.5.7","candidateDirectLaunch":true,"manualReplacement":true,"removal":true,"dataRetained":true,"protectedAutomaticUpdate":"not-tested"}\n' > "$evidence/appimage-lifecycle.json"
git diff --quiet HEAD --
node --input-type=module <<'NODE'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
const base = JSON.parse(await readFile(process.env.DSH_DESKTOP_SMOKE_DESCRIPTOR, 'utf8'))
const evidence = join(process.env.RUNNER_TEMP, 'linux-native-evidence')
const artifacts = []
for (const extension of ['deb', 'AppImage']) {
  const name = `DeepSeek-Harness-${base.desktopVersion}-linux-x64.${extension}`
  const path = join('apps/desktop/release', name), digest = createHash('sha256')
  for await (const chunk of createReadStream(path)) digest.update(chunk)
  artifacts.push({ name, bytes: (await stat(path)).size, sha256: digest.digest('hex') })
}
const receipts = []
for (const format of ['deb', 'appimage']) {
  const bytes = await readFile(join(evidence, format, 'base-smoke-receipt.json'))
  const receipt = JSON.parse(bytes)
  const verification = JSON.parse(await readFile(join(evidence, format, 'core-verification.json'), 'utf8'))
  if (receipt.outcome !== 'core-passed' || receipt.composition !== 'base' || receipt.checks.pauseRecovery?.status !== 'not-run'
    || verification.scope !== 'core' || verification.outcome !== 'core-passed'
    || JSON.stringify(verification.unverifiedChecks) !== '["pauseRecovery"]') throw new Error('A required native core receipt is incomplete or has a different scope.')
  receipts.push({ format, runId: receipt.runId, scope: 'core', outcome: receipt.outcome,
    unverifiedChecks: ['pauseRecovery'], sha256: createHash('sha256').update(bytes).digest('hex') })
}
const osRelease = await readFile('/etc/os-release', 'utf8')
await writeFile(join(evidence, 'candidate-evidence.json'), JSON.stringify({
  schemaVersion: 2, candidateRevision: process.env.CANDIDATE_SHA, composition: 'base',
  scope: 'core', unverifiedChecks: ['pauseRecovery'], fullReleaseAcceptance: false,
  platform: 'linux-x64', ubuntuVersion: /^VERSION_ID="([^"]+)"/m.exec(osRelease)?.[1],
  desktopVersion: base.desktopVersion, harnessVersion: base.harnessVersion, officialSourceSha: base.officialSourceSha,
  baseline: base.baseline, artifacts, receipts, display: 'X11/Xvfb', wayland: 'not-tested',
  packageKitAuthorizationAndUpdate: 'not-tested', protectedAppImageUpdateAndNewAppReady: 'not-tested',
  enhancedTurnNavigator: 'separate base-plus-enhancement acceptance required', realExternalWebService: 'not-tested',
}, null, 2) + '\n')
NODE
trap - EXIT
