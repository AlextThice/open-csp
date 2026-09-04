import { describe, expect, it, vi } from 'vitest';
import {
  configureWebContentsSecurity,
  type CancellableNavigationEvent,
  type SecureWebContents,
} from '../../src/main/security/web-contents-security';

describe('web contents security', () => {
  it('blocks navigation, redirects, and new windows', () => {
    let navigationListener: ((event: CancellableNavigationEvent, url: string) => void) | undefined;
    let redirectListener: ((event: CancellableNavigationEvent, url: string) => void) | undefined;
    let windowOpenHandler: ((url: string) => { readonly action: 'deny' }) | undefined;
    const webContents: SecureWebContents = {
      onWillNavigate: (listener) => {
        navigationListener = listener;
      },
      onWillRedirect: (listener) => {
        redirectListener = listener;
      },
      setWindowOpenHandler: (handler) => {
        windowOpenHandler = handler;
      },
    };
    configureWebContentsSecurity(webContents);
    const navigationPreventDefault = vi.fn();
    const redirectPreventDefault = vi.fn();

    navigationListener?.({ preventDefault: navigationPreventDefault }, 'https://example.com');
    redirectListener?.({ preventDefault: redirectPreventDefault }, 'https://example.com');

    expect(navigationPreventDefault).toHaveBeenCalledOnce();
    expect(redirectPreventDefault).toHaveBeenCalledOnce();
    expect(windowOpenHandler?.('https://example.com')).toEqual({ action: 'deny' });
  });
});
