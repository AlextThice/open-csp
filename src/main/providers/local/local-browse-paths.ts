import { parse, resolve } from 'node:path';

export interface LocalBrowsePaths {
  readonly initialPath: string;
  readonly rootPath: string;
}

export const createDefaultLocalBrowsePaths = (homePath: string): LocalBrowsePaths => {
  const initialPath = resolve(homePath);

  return {
    initialPath,
    rootPath: parse(initialPath).root,
  };
};

export const createConfiguredLocalBrowsePaths = (rootPath: string): LocalBrowsePaths => {
  const resolvedRootPath = resolve(rootPath);

  return {
    initialPath: resolvedRootPath,
    rootPath: resolvedRootPath,
  };
};
