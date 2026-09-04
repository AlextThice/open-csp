import { access, lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, parse } from 'node:path';
import { createLocalProviderPath } from '@shared/models/provider-path';
import { ProviderError, providerErrorCodes } from '@shared/providers/provider-error';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalProvider } from '../../src/main/providers/local/local-provider';
import { normalizeLocalProviderError } from '../../src/main/providers/local/local-provider-error';

describe('LocalProvider platform behavior', () => {
  let rootPath = '';
  let outsidePath = '';
  let provider: LocalProvider;

  beforeEach(async () => {
    rootPath = await mkdtemp(join(tmpdir(), 'openscp-local-root-'));
    outsidePath = await mkdtemp(join(tmpdir(), 'openscp-local-outside-'));
    provider = new LocalProvider({ rootPath });
    await provider.connect();
  });

  afterEach(async () => {
    await provider.disconnect();
    await rm(rootPath, { force: true, recursive: true });
    await rm(outsidePath, { force: true, recursive: true });
  });

  it('rejects normalized paths outside the configured root', async () => {
    const outsideMarkerPath = join(outsidePath, 'must remain.txt');
    await writeFile(outsideMarkerPath, 'outside');
    const escapedPath = join(rootPath, '..', basename(outsidePath), 'created');

    await expect(
      provider.createDirectory(createLocalProviderPath(escapedPath)),
    ).rejects.toMatchObject({
      code: providerErrorCodes.invalidPath,
    });
    await expect(readFile(outsideMarkerPath, 'utf8')).resolves.toBe('outside');
    await expect(access(join(outsidePath, 'created'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('streams a file with Unicode, spaces, and a long name in bounded chunks', async () => {
    const directoryPath = join(rootPath, 'Каталог с пробелами');
    const longName = `длинное имя ${'a'.repeat(120)}.bin`;
    const filePath = join(directoryPath, longName);
    await provider.createDirectory(createLocalProviderPath(directoryPath));
    const stream = await provider.openWrite(createLocalProviderPath(filePath), {
      overwrite: false,
    });
    const writer = stream.getWriter();
    const chunk = new Uint8Array(64 * 1024).fill(37);

    for (let index = 0; index < 16; index += 1) {
      await writer.write(chunk);
    }

    await writer.close();
    const entry = await provider.stat(createLocalProviderPath(filePath));
    expect(entry.name).toBe(longName);
    expect(entry.size).toBe(1024n * 1024n);
    expect(Number.isNaN(Date.parse(entry.modifiedAt ?? ''))).toBe(false);
    expect(typeof entry.permissions).toBe('number');

    const readStream = await provider.openRead(createLocalProviderPath(filePath));
    const reader = readStream.getReader();
    let bytesRead = 0;
    let largestChunk = 0;

    while (true) {
      const result = await reader.read();

      if (result.done) {
        break;
      }

      bytesRead += result.value.byteLength;
      largestChunk = Math.max(largestChunk, result.value.byteLength);
    }

    expect(bytesRead).toBe(1024 * 1024);
    expect(largestChunk).toBeLessThanOrEqual(64 * 1024);
  });

  it('removes a directory symlink without following its external target', async () => {
    const externalFilePath = join(outsidePath, 'keep.txt');
    const linkPath = join(rootPath, 'external-link');
    await writeFile(externalFilePath, 'keep');
    await symlink(outsidePath, linkPath, process.platform === 'win32' ? 'junction' : 'dir');

    await provider.delete(createLocalProviderPath(linkPath), { recursive: true });

    await expect(readFile(externalFilePath, 'utf8')).resolves.toBe('keep');
    await expect(lstat(linkPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('cancels an active streaming read with a normalized error', async () => {
    const filePath = join(rootPath, 'cancel-read.bin');
    await writeFile(filePath, new Uint8Array(256 * 1024));
    const abortController = new AbortController();
    const stream = await provider.openRead(createLocalProviderPath(filePath), {
      signal: abortController.signal,
    });
    const reader = stream.getReader();
    await reader.read();
    abortController.abort();

    await expect(reader.read()).rejects.toMatchObject({
      code: providerErrorCodes.cancelled,
    });
  });

  it('blocks traversal through an intermediate symbolic link', async () => {
    const externalDirectoryPath = join(outsidePath, 'target');
    const linkPath = join(rootPath, 'linked-directory');
    await mkdir(externalDirectoryPath);
    await symlink(
      externalDirectoryPath,
      linkPath,
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    await expect(
      provider.openWrite(createLocalProviderPath(join(linkPath, 'escaped.txt')), {
        overwrite: false,
      }),
    ).rejects.toMatchObject({
      code: providerErrorCodes.unsupported,
    });
    await expect(access(join(externalDirectoryPath, 'escaped.txt'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('normalizes native access errors without losing the machine cause code', () => {
    const nativeError = Object.assign(new Error('C:\\private\\secret.txt'), { code: 'EACCES' });
    const normalizedError = normalizeLocalProviderError(nativeError, 'stat');

    expect(normalizedError).toBeInstanceOf(ProviderError);
    expect(normalizedError.code).toBe(providerErrorCodes.accessDenied);
    expect(normalizedError.protocolCause).toEqual({
      code: 'EACCES',
      operation: 'stat',
      provider: 'local',
    });
    expect(normalizedError.message).toBe('errors.provider.accessDenied');
  });

  it('lists a Windows drive root even when protected children deny metadata access', async () => {
    if (process.platform !== 'win32') {
      return;
    }

    const driveRootPath = parse(process.cwd()).root;
    const driveProvider = new LocalProvider({ rootPath: driveRootPath });
    await driveProvider.connect();

    const entries = await driveProvider.list(createLocalProviderPath(driveRootPath));

    expect(entries.length).toBeGreaterThan(0);
    await driveProvider.disconnect();
  });
});
