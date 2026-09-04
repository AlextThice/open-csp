#!/bin/bash
set -euo pipefail
image=$(realpath "${1:?Pass the exact AppImage path}")
workspace=$(pwd)
temporary=$(mktemp -d)
trap 'rm -rf -- "$temporary"' EXIT
cd "$temporary"
"$image" --appimage-extract >/dev/null
cd "$workspace"
export OPENSCP_PACKAGED_EXE="$temporary/squashfs-root/AppRun"
dbus-run-session -- bash tests/packaging/linux-keyring-smoke.sh
