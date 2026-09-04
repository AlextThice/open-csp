#!/bin/sh
set -eu
# Do not install a setuid helper or globally disable Chromium's sandbox.
# User namespaces must be available; unsupported hosts fail closed.
chmod 0755 /opt/OpenSCP/chrome-sandbox
if [ -e /usr/bin/openscp ] || [ -L /usr/bin/openscp ]; then
  if [ "$(readlink /usr/bin/openscp 2>/dev/null || true)" != /opt/OpenSCP/openscp ]; then
    echo 'Refusing to replace an unrelated /usr/bin/openscp.' >&2
    exit 1
  fi
fi
ln -sfn /opt/OpenSCP/openscp /usr/bin/openscp
update-desktop-database -q || true
