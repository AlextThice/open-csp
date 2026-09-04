const sensitiveField = /password|passphrase|secret|token|credential|private.?key|authorization/i;

export const redact = (
  value: unknown,
  knownSecrets: readonly string[] = [],
  seen = new WeakSet<object>(),
): unknown => {
  if (typeof value === 'string') {
    let result = value.replace(
      /-----BEGIN [\s\S]*?PRIVATE KEY-----[\s\S]*?-----END [\s\S]*?PRIVATE KEY-----/gu,
      '[REDACTED]',
    );
    for (const secret of knownSecrets)
      if (secret.length > 0) result = result.split(secret).join('[REDACTED]');
    return result;
  }
  if (value instanceof Error) return { name: value.name, message: '[REDACTED]' };
  if (value instanceof Uint8Array) return '[BINARY]';
  if (typeof value !== 'object' || value === null) return value;
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((entry) => redact(entry, knownSecrets, seen));
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      sensitiveField.test(key) ? '[REDACTED]' : redact(entry, knownSecrets, seen),
    ]),
  );
};
