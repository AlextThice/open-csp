#!/bin/sh
set -eu
mc alias set fixture http://minio:9000 fixture-access-only fixture-secret-only-not-production >/dev/null
mc mb --ignore-existing fixture/fixture-bucket
mc mb --ignore-existing fixture/fixture-empty
mc admin user add fixture fixture-readonly fixture-readonly-password-only >/dev/null
mc admin policy create fixture fixture-list-read /readonly-policy.json >/dev/null
mc admin policy attach fixture fixture-list-read --user fixture-readonly >/dev/null
printf 'fixture object\n' | mc pipe 'fixture/fixture-bucket/prefix/Unicode ключ.txt'
printf '' | mc pipe fixture/fixture-bucket/prefix/zero-byte.bin
dd if=/dev/zero of=/tmp/multipart.bin bs=1048576 count=80 2>/dev/null
mc cp /tmp/multipart.bin fixture/fixture-bucket/multipart.bin
