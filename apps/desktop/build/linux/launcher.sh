#!/usr/bin/env bash
# electron-builder's AppRun may append --no-sandbox when unshare fails.
# Refuse that downgrade before starting the packaged Electron executable.
set -euo pipefail
for argument in "$@"; do
  case "${argument%%=*}" in
    --no-sandbox|--disable-setuid-sandbox|--disable-seccomp-filter-sandbox|--disable-namespace-sandbox|--single-process|--no-zygote)
      printf '%s\n' 'DeepSeek Harness requires the Chromium sandbox. On Ubuntu 24.04, install the application AppArmor policy or use the .deb package.' >&2
      exit 78
      ;;
  esac
done
launcher="$(readlink -f -- "$0")"
exec "$(dirname -- "$launcher")/deepseek-harness-bin" "$@"
