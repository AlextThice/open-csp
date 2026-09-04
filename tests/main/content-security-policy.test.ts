import { describe, expect, it } from 'vitest';
import {
  createProductionResponseHeaders,
  productionContentSecurityPolicy,
} from '../../src/main/security/content-security-policy';

describe('production content security policy', () => {
  it('does not allow evaluated scripts or external connections', () => {
    expect(productionContentSecurityPolicy).toContain("script-src 'self'");
    expect(productionContentSecurityPolicy).toContain("connect-src 'self'");
    expect(productionContentSecurityPolicy).toContain("object-src 'none'");
    expect(productionContentSecurityPolicy).not.toContain('unsafe-eval');
  });

  it('replaces an existing CSP header without dropping other headers', () => {
    expect(
      createProductionResponseHeaders({
        'content-security-policy': ["default-src * 'unsafe-eval'"],
        'X-Test': ['preserved'],
      }),
    ).toEqual({
      'Content-Security-Policy': [productionContentSecurityPolicy],
      'X-Test': ['preserved'],
    });
  });
});
