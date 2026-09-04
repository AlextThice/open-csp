import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProviderError, providerErrorCodes } from '@shared/providers/provider-error';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalDirectoryService } from '../../src/main/providers/local/local-directory-service';
import { LocalProvider } from '../../src/main/providers/local/local-provider';

const temporaryDirectories: string[] = [];

const createService = async (): Promise<{
  readonly rootPath: string;
  readonly service: LocalDirectoryService;
}> => {
  const rootPath = await mkdtemp(join(tmpdir(), 'openscp-ui-'));
  temporaryDirectories.push(rootPath);
  return {
    rootPath,
    service: new LocalDirectoryService(new LocalProvider({ rootPath }), rootPath),
  };
};

afterEach(async () => {
  for (const temporaryDirectory of temporaryDirectories.splice(0)) {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
});

describe('LocalDirectoryService', () => {
  it('returns provider entries, breadcrumbs, and safe navigation metadata', async () => {
    const { rootPath, service } = await createService();
    const childPath = join(rootPath, 'Documents');
    await mkdir(childPath);
    await writeFile(join(rootPath, 'notes.txt'), 'hello');

    const rootListing = await service.list({ path: null });
    const childListing = await service.list({ path: childPath });

    expect(rootListing.currentPath).toBe(rootPath);
    expect(rootListing.parentPath).toBeNull();
    expect(rootListing.entries.map((entry) => entry.name)).toEqual(['Documents', 'notes.txt']);
    expect(rootListing.entries.find((entry) => entry.name === 'notes.txt')?.size).toBe(5n);
    expect(childListing.parentPath).toBe(rootPath);
    expect(childListing.breadcrumbs.at(-1)).toEqual({ label: 'Documents', path: childPath });
  });

  it('does not allow renderer-requested paths outside the provider root', async () => {
    const { rootPath, service } = await createService();

    await expect(service.list({ path: join(rootPath, '..') })).rejects.toMatchObject({
      code: providerErrorCodes.invalidPath,
    } satisfies Partial<ProviderError>);
  });

  it('starts in the user directory but allows navigation to the provider root', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'openscp-root-'));
    temporaryDirectories.push(rootPath);
    const usersPath = join(rootPath, 'Users');
    const homePath = join(usersPath, 'test-user');
    await mkdir(homePath, { recursive: true });
    const service = new LocalDirectoryService(new LocalProvider({ rootPath }), homePath);

    const initialListing = await service.list({ path: null });
    const parentListing = await service.list({ path: usersPath });
    const rootListing = await service.list({ path: rootPath });

    expect(initialListing.currentPath).toBe(homePath);
    expect(initialListing.parentPath).toBe(usersPath);
    expect(initialListing.breadcrumbs.at(0)?.path).toBe(rootPath);
    expect(parentListing.parentPath).toBe(rootPath);
    expect(rootListing.parentPath).toBeNull();
  });
});
