#!/usr/bin/env bash
# Installed-byte acceptance on disposable GitHub Ubuntu runners only.
set -euo pipefail
[[ "${GITHUB_ACTIONS:-}" == true && "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]]
[[ "$EUID" != 0 && -n "${RUNNER_TEMP:-}" && -n "${CANDIDATE_SHA:-}" ]]
cd "$(dirname "$0")/.."
[[ "$(git rev-parse HEAD)" == "$CANDIDATE_SHA" ]]
version="$(node -p "require('./apps/desktop/package.json').version")"
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
[[ "$(dpkg-deb -f "$deb" Package)" == deepseek-harness ]]
[[ "$(dpkg-deb -f "$deb" Version)" == "$version" ]]
[[ "$(dpkg-deb -f "$deb" Architecture)" == amd64 ]]
sudo apt-get install -y "$deb"
deb_installed=true
desktop=/usr/share/applications/deepseek-harness.desktop
desktop-file-validate "$desktop"
grep -F 'StartupWMClass=deepseek-harness' "$desktop"
if grep -E -- '--(no-sandbox|disable.*sandbox)' "$desktop"; then exit 1; fi
dpkg-query -L deepseek-harness | grep -E '/icons/.+/apps/deepseek-harness\.png$' > "$evidence/installed-icons.txt"
[[ -s "$evidence/installed-icons.txt" ]]
while IFS= read -r icon; do test -s "$icon"; done < "$evidence/installed-icons.txt"
if [[ -r /proc/sys/kernel/apparmor_restrict_unprivileged_userns ]]; then
  cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns > "$evidence/userns-restriction.txt"
  [[ -f /etc/apparmor.d/deepseek-harness ]]
fi
export DSH_LINUX_DESKTOP_EXECUTABLE='/opt/DeepSeek Harness/deepseek-harness'
export DSH_LINUX_EVIDENCE_ROOT="$evidence/deb"
env -u NODE_PATH -u NODE_OPTIONS node node_modules/vitest/vitest.mjs run \
  apps/desktop/tests/linux-packaged-smoke.spec.ts --config vitest.config.ts

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
if [[ -r /proc/sys/kernel/apparmor_restrict_unprivileged_userns ]]; then
  sudo bash scripts/linux-desktop-appimage-policy.sh install "$appimage"
  policy_installed=true
fi
export DSH_DESKTOP_SMOKE_ROOT="$owned/appimage-profile"
export DSH_DESKTOP_SMOKE_DSH_HOME="$owned/appimage-profile/dsh-home"
export DSH_DESKTOP_SMOKE_USER_DATA="$owned/appimage-profile/electron-data"
export DSH_LINUX_DESKTOP_EXECUTABLE="$appimage"
export DSH_LINUX_EVIDENCE_ROOT="$evidence/appimage"
env -u NODE_PATH -u NODE_OPTIONS node node_modules/vitest/vitest.mjs run \
  apps/desktop/tests/linux-packaged-smoke.spec.ts --config vitest.config.ts
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
}, null, 2) + '\n')
NODE
trap - EXIT
