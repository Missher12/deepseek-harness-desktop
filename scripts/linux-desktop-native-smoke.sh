#!/usr/bin/env bash
# Installed-byte acceptance on disposable GitHub Ubuntu runners only.
set -euo pipefail
[[ "${GITHUB_ACTIONS:-}" == true && "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]]
[[ "$EUID" != 0 && -n "${RUNNER_TEMP:-}" && -n "${CANDIDATE_SHA:-}" ]]
cd "$(dirname "$0")/.."
[[ "$(git rev-parse HEAD)" == "$CANDIDATE_SHA" ]]
version="$(node -p "require('./apps/desktop/package.json').version")"
ubuntu_version="$(. /etc/os-release; printf '%s' "$VERSION_ID")"
deb="$PWD/apps/desktop/release/DeepSeek-Harness-$version-linux-x64.deb"
image="$PWD/apps/desktop/release/DeepSeek-Harness-$version-linux-x64.AppImage"
evidence="$RUNNER_TEMP/linux-native-evidence"
owned="$(mktemp -d "$RUNNER_TEMP/dsh-linux-native-XXXXXX")"
mkdir -p "$evidence" "$owned/AppImage with spaces"
export DSH_DESKTOP_SMOKE_ROOT="$owned/desktop"
export DSH_DESKTOP_SMOKE_DSH_HOME="$owned/desktop/dsh-home"
export DSH_DESKTOP_SMOKE_USER_DATA="$owned/desktop/electron-data"
export DSH_TELEMETRY_DISABLED=1
appimage="$owned/AppImage with spaces/DeepSeek-Harness.AppImage"
policy_installed=false
deb_installed=false
cleanup() {
  if [[ "$policy_installed" == true ]]; then sudo bash scripts/linux-desktop-appimage-policy.sh remove "$appimage"; fi
  if [[ "$deb_installed" == true ]]; then sudo apt-get remove -y deepseek-harness; fi
}
trap cleanup EXIT
run_linux_native_checks() {
  # Separate owned phases: the simulated writer must be reaped before ordinary smoke.
  for spec in linux-existing-writer.spec.ts linux-packaged-smoke.spec.ts; do
    env -u NODE_PATH -u NODE_OPTIONS node node_modules/vitest/vitest.mjs run \
      "apps/desktop/tests/$spec" --config vitest.config.ts
  done
  node --import tsx/esm --input-type=module <<'NODE'
import { copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { verifySessionWorkspaceReceipt } from './scripts/desktop-session-workspace-receipt.ts'
const path = 'apps/desktop/release/desktop-smoke-session-workspaces-linux.json'
await verifySessionWorkspaceReceipt(path)
await copyFile(path, join(process.env.DSH_LINUX_EVIDENCE_ROOT, 'session-workspaces.json'))
NODE
}
[[ "$(dpkg-deb -f "$deb" Package)" == deepseek-harness ]]
[[ "$(dpkg-deb -f "$deb" Version)" == "$version" ]]
[[ "$(dpkg-deb -f "$deb" Architecture)" == amd64 ]]
dpkg-deb -f "$deb" Depends | tr ',' '\n' | grep -Eq '^[[:space:]]*lsof([[:space:]]|$)'
sudo apt-get install -y "$deb"
deb_installed=true
desktop=/usr/share/applications/deepseek-harness.desktop
desktop-file-validate "$desktop"
grep -F 'StartupWMClass=deepseek-harness' "$desktop"
if grep -E -- '--(no-sandbox|disable.*sandbox)' "$desktop"; then exit 1; fi
dpkg-query -L deepseek-harness | grep -E '/icons/.+/apps/deepseek-harness\.png$' > "$evidence/installed-icons.txt"
[[ -s "$evidence/installed-icons.txt" ]]
while IFS= read -r icon; do test -s "$icon"; done < "$evidence/installed-icons.txt"
if [[ "$ubuntu_version" == 24.04 ]]; then
  cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns > "$evidence/userns-restriction.txt"
  [[ "$(cat "$evidence/userns-restriction.txt")" == 1 ]]
  [[ -f /etc/apparmor.d/deepseek-harness ]]
fi
export DSH_LINUX_DESKTOP_EXECUTABLE='/opt/DeepSeek Harness/deepseek-harness'
export DSH_LINUX_EVIDENCE_ROOT="$evidence/deb"
export DSH_LINUX_PACKAGE_FORMAT=deb
landlock='/opt/DeepSeek Harness/resources/app.asar.unpacked/node_modules/@deepseek-ai/node-addon-system-linux-x64/bin/landlock-run'
test -x "$landlock"
"$landlock" --probe > "$evidence/landlock-probe.txt"
run_linux_native_checks

# Reinstall tests dpkg's upgrade maintainer-script path; neither reinstall nor
# purge may remove the user's Harness settings, Sessions, or Electron profile.
mkdir -p "$DSH_DESKTOP_SMOKE_DSH_HOME/sessions" "$DSH_DESKTOP_SMOKE_USER_DATA"
printf 'retained session\n' > "$DSH_DESKTOP_SMOKE_DSH_HOME/sessions/linux-retention-sentinel"
printf 'retained preferences\n' > "$DSH_DESKTOP_SMOKE_USER_DATA/linux-retention-sentinel"
sha256sum "$DSH_DESKTOP_SMOKE_DSH_HOME/settings.yaml" \
  "$DSH_DESKTOP_SMOKE_DSH_HOME/sessions/linux-retention-sentinel" \
  "$DSH_DESKTOP_SMOKE_USER_DATA/linux-retention-sentinel" > "$owned/retention.sha256"
sudo apt-get install --reinstall -y "$deb"
sha256sum -c "$owned/retention.sha256"
sudo apt-get purge -y deepseek-harness
deb_installed=false
sha256sum -c "$owned/retention.sha256"
[[ ! -e "$DSH_LINUX_DESKTOP_EXECUTABLE" && ! -e "$desktop" && ! -e /etc/apparmor.d/deepseek-harness ]]
while IFS= read -r icon; do test ! -e "$icon"; done < "$evidence/installed-icons.txt"
printf '{"install":true,"reinstall":true,"purge":true,"dataRetained":true}\n' > "$evidence/deb-lifecycle.json"

cp "$image" "$appimage"
chmod 0755 "$appimage"
if [[ "$ubuntu_version" == 24.04 ]]; then
  sudo bash scripts/linux-desktop-appimage-policy.sh install "$appimage"
  policy_installed=true
fi
export DSH_DESKTOP_SMOKE_ROOT="$owned/appimage-profile"
export DSH_DESKTOP_SMOKE_DSH_HOME="$owned/appimage-profile/dsh-home"
export DSH_DESKTOP_SMOKE_USER_DATA="$owned/appimage-profile/electron-data"
export DSH_LINUX_DESKTOP_EXECUTABLE="$appimage"
export DSH_LINUX_EVIDENCE_ROOT="$evidence/appimage"
export DSH_LINUX_PACKAGE_FORMAT=appimage
run_linux_native_checks
if [[ "$policy_installed" == true ]]; then
  sudo bash scripts/linux-desktop-appimage-policy.sh remove "$appimage"
  policy_installed=false
fi
rm -- "$appimage"
[[ -s "$DSH_DESKTOP_SMOKE_DSH_HOME/settings.yaml" ]]
printf '{"directAppImageLaunch":true,"pathWithSpaces":true,"removal":true,"dataRetained":true}\n' > "$evidence/appimage-lifecycle.json"
git diff --quiet HEAD --
node --input-type=module <<'NODE'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
const metadata = JSON.parse(await readFile('apps/desktop/update-metadata.json', 'utf8'))
const artifacts = []
for (const extension of ['deb', 'AppImage']) {
  const name = `DeepSeek-Harness-${metadata.desktopVersion}-linux-x64.${extension}`
  const path = join('apps/desktop/release', name)
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(path)) digest.update(chunk)
  artifacts.push({ name, bytes: (await stat(path)).size, sha256: digest.digest('hex') })
}
const osRelease = await readFile('/etc/os-release', 'utf8')
const version = /^VERSION_ID="([^"]+)"/m.exec(osRelease)?.[1]
if (!['22.04', '24.04'].includes(version)) throw new Error('Unexpected Ubuntu version')
await writeFile(join(process.env.RUNNER_TEMP, 'linux-native-evidence/candidate-evidence.json'), JSON.stringify({
  schemaVersion: 1, candidateRevision: process.env.CANDIDATE_SHA,
  platform: 'linux-x64', ubuntuVersion: version,
  desktopVersion: metadata.desktopVersion, harnessVersion: metadata.harnessVersion,
  artifacts, display: 'X11/Xvfb', wayland: 'not-tested',
  sandbox: 'kernel-verified', provider: 'controlled-loopback',
  debLifecycle: 'passed', appImageLifecycle: 'passed',
  existingWriter: 'real kernel and packaged Desktop with simulated writer; passed',
  sessionWriteLease: 'actual installed runtime; contention and release passed',
  managedProcessRange: 'observed systemd-user scope or PGID fallback; see per-format kernel-ownership/native.json',
  realExternalWebService: 'not-tested',
}, null, 2) + '\n')
NODE
trap - EXIT
