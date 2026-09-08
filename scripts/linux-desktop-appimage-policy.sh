#!/usr/bin/env bash
# Ubuntu 24.04: authorize user namespaces for one explicitly selected AppImage.
# Usage: sudo bash linux-desktop-appimage-policy.sh install|remove /absolute/app.AppImage
set -euo pipefail
[[ "$(uname -s)" == Linux && "$EUID" == 0 ]]
[[ "$#" == 2 && ( "$1" == install || "$1" == remove ) ]]
action="$1"
appimage="$(realpath -m -- "$2")"
# Reject AppArmor pattern/control syntax; spaces in an ordinary path are valid.
[[ "$appimage" =~ ^/[a-zA-Z0-9\ /._-]+\.AppImage$ ]]
identifier="$(printf '%s' "$appimage" | sha256sum | cut -c 1-24)"
profile_name="dsh-appimage-$identifier"
profile_target="/etc/apparmor.d/$profile_name"
if [[ "$action" == remove ]]; then
  if [[ -f "$profile_target" ]]; then
    apparmor_parser --remove "$profile_target"
    rm -- "$profile_target"
  fi
  exit 0
fi
[[ -f "$appimage" && -x "$appimage" ]]
apparmor_status --enabled
profile_temp="$(mktemp)"
trap 'rm -f -- "$profile_temp"' EXIT
cat > "$profile_temp" <<PROFILE
abi <abi/4.0>,
include <tunables/global>
profile "$profile_name" "$appimage" flags=(unconfined) {
  userns,
}
PROFILE
apparmor_parser --skip-kernel-load --debug "$profile_temp" >/dev/null
install -m 0644 "$profile_temp" "$profile_target"
apparmor_parser --replace --write-cache --skip-read-cache "$profile_target"
printf 'Installed per-AppImage user namespace policy: %s\n' "$profile_name"
