import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LocalDrive } from '@shared/ipc/contracts';
import { providerErrorCodes } from '@shared/providers/provider-error';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalFileBrowserService } from '../../src/main/providers/local/local-file-browser-service';
import { createIpcHandlerDependencies } from '../../src/main/ipc/register-ipc-handlers';

const temporaryDirectories: string[] = [];

const createFixture = async () => {
  const fixturePath = await mkdtemp(join(tmpdir(), 'openscp-drives-'));
  temporaryDirectories.push(fixturePath);
  const firstRoot = join(fixturePath, 'first');
  const secondRoot = join(fixturePath, 'second');
  const homePath = join(firstRoot, 'home');
  await mkdir(homePath, { recursive: true });
  await mkdir(secondRoot);
  await writeFile(join(secondRoot, 'backup.txt'), 'backup');
  const drives: readonly LocalDrive[] = [
    { label: 'First drive', path: firstRoot },
    { label: 'Second drive', path: secondRoot },
  ];
  const discoverDrives = vi.fn(async () => drives);
  const service = new LocalFileBrowserService(homePath, discoverDrives);
  return { discoverDrives, drives, firstRoot, fixturePath, homePath, secondRoot, service };
};

afterEach(async () => {
  for (const temporaryDirectory of temporaryDirectories.splice(0)) {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
});

describe('LocalFileBrowserService', () => {
  it('serves simultaneous directories on different roots without changing the initial path', async () => {
    const { discoverDrives, firstRoot, homePath, secondRoot, service } = await createFixture();
    const [home, second, first] = await Promise.all([
      service.list({ path: null }),
      service.list({ path: secondRoot }),
      service.list({ path: firstRoot }),
    ]);

    expect(home.currentPath).toBe(homePath);
    expect(home.breadcrumbs[0]?.path).toBe(firstRoot);
    expect(second.breadcrumbs).toEqual([{ label: 'second', path: secondRoot }]);
    expect(second.entries[0]?.name).toBe('backup.txt');
    expect(second.parentPath).toBeNull();
    expect(first.parentPath).toBeNull();
    expect((await service.list({ path: null })).currentPath).toBe(homePath);
    expect(discoverDrives).toHaveBeenCalledOnce();
  });

  it('rejects traversal, sibling prefixes, relative paths and unknown roots', async () => {
    const { firstRoot, fixturePath, service } = await createFixture();

    for (const path of [
      join(firstRoot, '..'),
      `${firstRoot}-other`,
      fixturePath,
      'relative',
      '..',
    ]) {
      await expect(service.list({ path })).rejects.toMatchObject({
        code: providerErrorCodes.invalidPath,
      });
    }
  });

  it('refreshes attached and removed roots without losing access to other roots', async () => {
    const { discoverDrives, drives, homePath, secondRoot, service } = await createFixture();
    discoverDrives.mockResolvedValue(drives.slice(0, 1));
    expect(await service.listDrives()).toHaveLength(1);
    await expect(service.list({ path: secondRoot })).rejects.toMatchObject({
      code: providerErrorCodes.invalidPath,
    });

    discoverDrives.mockResolvedValue(drives);
    expect(await service.listDrives()).toHaveLength(2);
    expect((await service.list({ path: secondRoot })).currentPath).toBe(secondRoot);

    await rm(secondRoot, { recursive: true });
    await expect(service.list({ path: secondRoot })).rejects.toMatchObject({
      code: providerErrorCodes.notFound,
    });
    discoverDrives.mockResolvedValue(drives.slice(0, 1));
    expect(await service.listDrives()).toHaveLength(1);
    expect((await service.list({ path: null })).currentPath).toBe(homePath);
  });

  it('keeps a configured development root isolated from other drives', async () => {
    const { firstRoot, homePath, secondRoot } = await createFixture();
    const dependencies = createIpcHandlerDependencies({
      allowMultipleDrives: false,
      localInitialPath: homePath,
      localRootPath: firstRoot,
    });

    expect(await dependencies.listLocalDrives()).toEqual([{ label: firstRoot, path: firstRoot }]);
    expect((await dependencies.listLocalDirectory({ path: null })).currentPath).toBe(homePath);
    await expect(dependencies.listLocalDirectory({ path: secondRoot })).rejects.toMatchObject({
      code: providerErrorCodes.invalidPath,
    });
  });
});
