#!/bin/sh
set -eu
ssh-keygen -A >/dev/null
mkdir -p /home/fixture/.ssh /home/fixture/data/'Unicode каталог' /home/fixture/data/restricted
cp /fixture-key.pub /home/fixture/.ssh/authorized_keys
printf 'fixture text\n' > /home/fixture/data/'Unicode каталог'/'привет мир.txt'
truncate -s 268435456 /home/fixture/data/large-sparse.bin
ln -sfn 'Unicode каталог' /home/fixture/data/link-directory
chown -R fixture:fixture /home/fixture
chmod 700 /home/fixture/.ssh
chmod 600 /home/fixture/.ssh/authorized_keys
chown root:root /home/fixture/data/restricted
chmod 000 /home/fixture/data/restricted
exec /usr/sbin/sshd -D -e
