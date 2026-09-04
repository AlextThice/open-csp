#!/bin/bash
set -euo pipefail
test "$(uname -m)" = arm64
image=${1:?Pass the exact DMG path}
temporary=$(mktemp -d)
mounted=false
cleanup() {
  if [ "$mounted" = true ]; then hdiutil detach "$temporary/mount"; fi
  rm -rf -- "$temporary"
}
trap cleanup EXIT
mkdir "$temporary/mount" "$temporary/installed"
hdiutil attach "$image" -nobrowse -readonly -mountpoint "$temporary/mount"
mounted=true
applications=("$temporary/mount/"*.app)
test "${#applications[@]}" -eq 1
application="$temporary/installed/$(basename "${applications[0]}")"
ditto "${applications[0]}" "$application"
hdiutil detach "$temporary/mount"
mounted=false
if [ "${OPENSCP_SIGNED_BUILD:-0}" = 1 ]; then
  codesign --verify --deep --strict --verbose=2 "$application"
  xcrun stapler validate "$application"
  spctl --assess --type execute --verbose=2 "$application"
fi
executable=$(/usr/libexec/PlistBuddy -c 'Print CFBundleExecutable' "$application/Contents/Info.plist")
export OPENSCP_PACKAGED_EXE="$application/Contents/MacOS/$executable"
pnpm test:packaged
