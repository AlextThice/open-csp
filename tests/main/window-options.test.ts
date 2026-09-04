import { describe, expect, it } from 'vitest';
import { createWebPreferences, createWindowOptions } from '../../src/main/window-options';

describe('main window security defaults', () => {
  it('keeps Node.js isolated from the renderer', () => {
    const preferences = createWebPreferences('C:/application/out/main');

    expect(preferences.nodeIntegration).toBe(false);
    expect(preferences.contextIsolation).toBe(true);
    expect(preferences.sandbox).toBe(true);
    expect(preferences.webSecurity).toBe(true);
    expect(preferences.allowRunningInsecureContent).toBe(false);
    expect(preferences.webviewTag).toBe(false);
  });

  it('keeps the window hidden until its content is ready', () => {
    const options = createWindowOptions('C:/application/out/main');

    expect(options.show).toBe(false);
  });
});
