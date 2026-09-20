#!/usr/bin/env bash
# Disposable native runner only; the shared smoke owns isolated homes and application processes.
set -euo pipefail
[[ $# == 2 ]] || { echo 'Usage: bash desktop-packaging/linux-install-smoke.sh <artifact-dir> <new-evidence-dir>' >&2; exit 2; }
[[ $(uname -s) == Linux && $(uname -m) == x86_64 && $EUID != 0 ]]
artifacts=$(realpath "$1")
[[ $2 == /* && ! -e $2 ]]
mkdir -m 700 "$2"
evidence=$(realpath "$2")
repository=$(cd "$(dirname "$0")/.." && pwd -P)
mapfile -t debs < <(find "$artifacts" -maxdepth 1 -name '*.deb' -type f)
mapfile -t images < <(find "$artifacts" -maxdepth 1 -name '*.AppImage' -type f)
[[ ${#debs[@]} == 1 && ${#images[@]} == 1 ]]
(cd "$artifacts" && sha256sum -c SHA256SUMS-linux)
if dpkg-query -W -f='${Status}' deepseek-harness 2>/dev/null | grep -q 'install ok installed'; then
  echo 'Refusing to replace an existing Desktop installation.' >&2
  exit 1
fi
installed=false
cleanup() {
  local status=$? purge_status=0
  trap - EXIT
  if [[ $installed == true ]]; then sudo apt-get purge -y deepseek-harness || purge_status=$?; fi
  if dpkg-query -W -f='${Status}' deepseek-harness 2>/dev/null | grep -q 'install ok installed'; then purge_status=1; fi
  printf '{"purgeExitCode":%s}\n' "$purge_status" > "$evidence/package-cleanup.json"
  if [[ $status == 0 ]]; then exit "$purge_status"; else exit "$status"; fi
}
trap cleanup EXIT
installed=true
sudo apt-get install -y "${debs[0]}"
[[ $(dpkg-query -W -f='${Version}' deepseek-harness) == 0.1.6-alpha.2 ]]
mapfile -t executables < <(dpkg-query -L deepseek-harness | grep '/deepseek-harness$')
[[ ${#executables[@]} == 1 && -x ${executables[0]} ]]
dbus-run-session -- xvfb-run -a -s '-screen 0 1440x1000x24' node "$repository/desktop-packaging/smoke.mjs" "${executables[0]}" "$evidence/deb"
chmod u+x "${images[0]}"
dbus-run-session -- xvfb-run -a -s '-screen 0 1440x1000x24' node "$repository/desktop-packaging/smoke.mjs" "${images[0]}" "$evidence/appimage"
(cd "$artifacts" && sha256sum -c SHA256SUMS-linux)
