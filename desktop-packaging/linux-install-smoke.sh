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
policy_owned=false
policy_install_status=null
policy_remove_status=null
policy_file_absent=null
restriction=null
policy_helper="$repository/desktop-packaging/linux-appimage-policy.sh"
if [[ -r /proc/sys/kernel/apparmor_restrict_unprivileged_userns ]]; then
  restriction=$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns)
  [[ $restriction == 0 || $restriction == 1 ]]
fi
printf '{"apparmorRestrictUnprivilegedUserns":%s}\n' "$restriction" > "$evidence/userns-restriction.json"
cleanup() {
  local status=$? purge_status=0 policy_cleanup_status=0
  trap - EXIT
  if [[ $policy_owned == true ]]; then
    policy_remove_status=0
    sudo bash "$policy_helper" remove "${images[0]}" > "$evidence/appimage-policy-remove.log" 2>&1 || policy_remove_status=$?
    policy_file_absent=false
    if [[ ! -e $policy_target && ! -L $policy_target ]]; then policy_file_absent=true; fi
    if [[ $policy_remove_status != 0 || $policy_file_absent != true ]]; then policy_cleanup_status=1; fi
  fi
  printf '{"installExitCode":%s,"removeExitCode":%s,"profileFileAbsent":%s}\n' \
    "$policy_install_status" "$policy_remove_status" "$policy_file_absent" > "$evidence/appimage-policy-lifecycle.json"
  if [[ $installed == true ]]; then sudo apt-get purge -y deepseek-harness || purge_status=$?; fi
  if dpkg-query -W -f='${Status}' deepseek-harness 2>/dev/null | grep -q 'install ok installed'; then purge_status=1; fi
  printf '{"purgeExitCode":%s}\n' "$purge_status" > "$evidence/package-cleanup.json"
  if [[ $status == 0 ]]; then exit "$((purge_status || policy_cleanup_status))"; else exit "$status"; fi
}
trap cleanup EXIT
ubuntu_version=$(. /etc/os-release; printf '%s' "$VERSION_ID")
if [[ $ubuntu_version == 24.04 && $restriction != 1 ]]; then
  echo 'Ubuntu 24.04 userns restriction is not 1; recorded actual value without changing system policy.' >&2
  exit 1
fi
installed=true
sudo apt-get install -y "${debs[0]}"
[[ $(dpkg-query -W -f='${Version}' deepseek-harness) == 0.1.6-alpha.2 ]]
mapfile -t executables < <(dpkg-query -L deepseek-harness | grep '/deepseek-harness$')
[[ ${#executables[@]} == 1 && -x ${executables[0]} ]]
dbus-run-session -- xvfb-run -a -s '-screen 0 1440x1000x24' node "$repository/desktop-packaging/smoke.mjs" "${executables[0]}" "$evidence/deb"
chmod u+x "${images[0]}"
if [[ $ubuntu_version == 24.04 ]]; then
  bash "$policy_helper" describe "${images[0]}" > "$evidence/appimage-policy.json"
  policy_target=$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).profilePath' "$evidence/appimage-policy.json")
  [[ ! -e $policy_target && ! -L $policy_target ]]
  policy_owned=true
  policy_install_status=0
  sudo bash "$policy_helper" install "${images[0]}" > "$evidence/appimage-policy-install.log" 2>&1 || policy_install_status=$?
  if [[ $policy_install_status != 0 ]]; then exit "$policy_install_status"; fi
  sha256sum "$policy_target" > "$evidence/appimage-policy-installed.sha256"
fi
dbus-run-session -- xvfb-run -a -s '-screen 0 1440x1000x24' node "$repository/desktop-packaging/smoke.mjs" "${images[0]}" "$evidence/appimage"
(cd "$artifacts" && sha256sum -c SHA256SUMS-linux)
