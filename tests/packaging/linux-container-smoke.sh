#!/bin/bash
set -euo pipefail
cd /workspace
if [ "${OPENSCP_INTEGRATION:-0}" = 1 ]; then
  node tests/packaging/forward-fixtures.mjs &
  proxy=$!
  trap 'kill "$proxy" 2>/dev/null || true' EXIT
fi
dpkg -i release/openscp-*-linux-amd64.deb
test "$(stat -c %a /opt/OpenSCP/chrome-sandbox)" = 755
test -x /opt/OpenSCP/openscp
desktop-file-validate /usr/share/applications/openscp.desktop
export OPENSCP_DISPOSABLE_KEYRING=1
runuser -u smoke -- env OPENSCP_PACKAGED_EXE=/opt/OpenSCP/openscp \
  OPENSCP_TEST_NO_SANDBOX=1 dbus-run-session -- bash tests/packaging/linux-keyring-smoke.sh
dpkg -r openscp
test ! -e /usr/bin/openscp
runuser -u smoke -- env OPENSCP_TEST_NO_SANDBOX=1 \
  bash scripts/smoke-appimage.sh release/openscp-*-linux-x86_64.AppImage
runuser -u smoke -- pnpm test
if [ -d /artifacts ]; then
  cp release/openscp-*-linux-amd64.deb release/openscp-*-linux-x86_64.AppImage /artifacts/
fi
