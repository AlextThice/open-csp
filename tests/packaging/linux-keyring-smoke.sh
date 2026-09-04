#!/bin/bash
set -euo pipefail
test "${OPENSCP_DISPOSABLE_KEYRING:-0}" = 1
# Run inside a fresh D-Bus session as a non-root user; never unlock a real user's keyring.
# Only intended for disposable CI/container users with a throwaway HOME.
export XDG_RUNTIME_DIR
XDG_RUNTIME_DIR=$(mktemp -d)
trap 'rm -rf -- "$XDG_RUNTIME_DIR"' EXIT
export XDG_CURRENT_DESKTOP=GNOME
printf '%s' 'disposable-ci-keyring-only' | gnome-keyring-daemon --unlock --components=secrets
if [ "$#" -eq 0 ]; then set -- test:packaged; fi
xvfb-run -a pnpm "$@"
