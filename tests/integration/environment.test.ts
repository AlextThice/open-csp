import { describe, expect, it } from 'vitest';

describe('fixture environment', () => {
  it('waits for a healthy MinIO HTTP endpoint', async () => {
    const response = await fetch('http://127.0.0.1:29000/minio/health/live');
    expect(response.ok).toBe(true);
  });
});
