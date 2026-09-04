import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { ProfileStore } from '../persistence/profile-store';

export const importKnownHosts = (store: ProfileStore, content: string) => {
  let imported = 0;
  let skipped = 0;
  let conflicts = 0;
  for (const raw of content.split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [hosts, type, encoded] = line.split(/\s+/u);
    if (
      !hosts ||
      !type ||
      !encoded ||
      hosts.startsWith('@') ||
      ![
        'ssh-ed25519',
        'ssh-rsa',
        'ecdsa-sha2-nistp256',
        'ecdsa-sha2-nistp384',
        'ecdsa-sha2-nistp521',
      ].includes(type) ||
      !/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)
    ) {
      skipped++;
      continue;
    }
    const key = Buffer.from(encoded, 'base64');
    if (
      key.length < 8 ||
      key.length > 16384 ||
      key.readUInt32BE(0) !== type.length ||
      key.subarray(4, 4 + type.length).toString() !== type
    ) {
      skipped++;
      continue;
    }
    const fingerprint = `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/u, '')}`;
    let candidates = hosts.split(',');
    if (hosts.startsWith('|1|')) {
      const [, , saltText, hashText] = hosts.split('|');
      const salt = Buffer.from(saltText ?? '', 'base64');
      const expected = Buffer.from(hashText ?? '', 'base64');
      candidates = store
        .list()
        .filter((profile) => profile.kind === 'sftp')
        .map((profile) =>
          profile.port === 22 ? profile.host : `[${profile.host}]:${profile.port}`,
        )
        .filter((host) => {
          const hash = createHmac('sha1', salt).update(host).digest();
          return expected.length === hash.length && timingSafeEqual(expected, hash);
        });
      if (!candidates.length) skipped++;
    }
    for (const candidate of candidates) {
      const match = /^\[([^\]]+)\]:(\d+)$/u.exec(candidate);
      const host = match?.[1] ?? candidate;
      const port = Number(match?.[2] ?? 22);
      if (!host || /[*!?|\s]/u.test(host) || port < 1 || port > 65535) {
        skipped++;
        continue;
      }
      const previous = store.getHostKey(host, port);
      if (previous && previous !== fingerprint) {
        conflicts++;
        continue;
      }
      if (previous) {
        skipped++;
        continue;
      }
      store.trustHost(host, port, fingerprint);
      imported++;
    }
  }
  return { imported, skipped, conflicts };
};
