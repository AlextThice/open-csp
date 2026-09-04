import { parse, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createConfiguredLocalBrowsePaths,
  createDefaultLocalBrowsePaths,
} from '../../src/main/providers/local/local-browse-paths';

describe('local browse paths', () => {
  it('uses the home directory as the initial path and its filesystem root as the boundary', () => {
    const homePath = resolve('Users', 'test-user');

    expect(createDefaultLocalBrowsePaths(homePath)).toEqual({
      initialPath: homePath,
      rootPath: parse(homePath).root,
    });
  });

  it('uses a configured development root as both boundary and initial path', () => {
    const configuredRootPath = resolve('fixtures', 'local-root');

    expect(createConfiguredLocalBrowsePaths(configuredRootPath)).toEqual({
      initialPath: configuredRootPath,
      rootPath: configuredRootPath,
    });
  });
});
