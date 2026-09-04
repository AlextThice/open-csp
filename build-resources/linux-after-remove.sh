#!/bin/sh
set -eu
if [ "$(readlink /usr/bin/openscp 2>/dev/null || true)" = /opt/OpenSCP/openscp ]; then
  rm /usr/bin/openscp
fi
update-desktop-database -q || true
