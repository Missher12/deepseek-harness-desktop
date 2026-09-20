#!/usr/bin/env bash
# Grant user namespaces only to one explicitly selected AppImage on Ubuntu 24.04.
set -euo pipefail
[[ $# == 2 && ( $1 == describe || $1 == install || $1 == remove ) ]] || {
  echo 'Usage: bash linux-appimage-policy.sh describe|install|remove /absolute/app.AppImage' >&2
  exit 2
}
[[ $(uname -s) == Linux && $2 == /* ]] || exit 1
action=$1
# Validate both the supplied spelling and the canonical path, before command substitution can trim newlines.
path_pattern='^/[a-zA-Z0-9 /._-]+\.AppImage$'
[[ $2 =~ $path_pattern ]] || exit 1
appimage=$(realpath -m -- "$2")
[[ $appimage =~ $path_pattern ]] || exit 1
identifier=$(printf '%s' "$appimage" | sha256sum | cut -c 1-24)
profile_name="dsh-appimage-$identifier"
profile_target="/etc/apparmor.d/$profile_name"
render_profile() {
  cat <<PROFILE
abi <abi/4.0>,
include <tunables/global>
profile "$profile_name" "$appimage" flags=(unconfined) {
  userns,
}
PROFILE
}
profile_digest=$(render_profile | sha256sum | cut -d ' ' -f 1)
if [[ $action == describe ]]; then
  printf '{"appImage":"%s","profileName":"%s","profilePath":"%s","profileSha256":"%s"}\n' \
    "$appimage" "$profile_name" "$profile_target" "$profile_digest"
  exit 0
fi
[[ $EUID == 0 && ! -L $profile_target ]] || exit 1
if [[ -e $profile_target ]]; then
  [[ -f $profile_target ]] || exit 1
  # Never replace or remove a policy with different content, even at the expected name.
  [[ $(sha256sum "$profile_target" | cut -d ' ' -f 1) == "$profile_digest" ]] || exit 1
fi
if [[ $action == remove ]]; then
  if [[ -f $profile_target ]]; then
    apparmor_parser --remove "$profile_target"
    rm -- "$profile_target"
  fi
  exit 0
fi
[[ -f $appimage && -x $appimage ]] || exit 1
apparmor_status --enabled
profile_temp=$(mktemp)
trap 'rm -f -- "$profile_temp"' EXIT
render_profile > "$profile_temp"
apparmor_parser --skip-kernel-load --debug "$profile_temp" >/dev/null
install -m 0644 "$profile_temp" "$profile_target"
apparmor_parser --replace --write-cache --skip-read-cache "$profile_target"
printf 'Installed per-AppImage user namespace policy: %s\n' "$profile_name"
