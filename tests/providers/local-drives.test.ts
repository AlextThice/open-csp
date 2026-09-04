import { stat } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { discoverLocalDrives } from '../../src/main/providers/local/local-drives';

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  const mockedStat = vi.fn();
  return { ...original, default: { ...original, stat: mockedStat }, stat: mockedStat };
});

afterEach(() => vi.resetAllMocks());

describe('local drive discovery', () => {
  it.runIf(process.platform === 'win32')(
    'discovers multiple drive letters and tolerates missing media',
    async () => {
      vi.mocked(stat).mockImplementation(async (path) => {
        if (path === 'C:\\' || path === 'D:\\' || path === 'Z:\\') {
          return { isDirectory: () => true } as Awaited<ReturnType<typeof stat>>;
        }

        throw Object.assign(new Error('Drive unavailable'), { code: 'ENOENT' });
      });

      expect(await discoverLocalDrives('C:\\')).toEqual([
        { label: 'C:\\', path: 'C:\\' },
        { label: 'D:\\', path: 'D:\\' },
        { label: 'Z:\\', path: 'Z:\\' },
      ]);
      expect(stat).toHaveBeenCalledTimes(26);
    },
  );

  it.runIf(process.platform === 'win32')(
    'preserves the initial root even when its probe is denied',
    async () => {
      vi.mocked(stat).mockRejectedValue(Object.assign(new Error('Denied'), { code: 'EACCES' }));

      expect(await discoverLocalDrives('C:\\')).toEqual([{ label: 'C:\\', path: 'C:\\' }]);
    },
  );

  it.runIf(process.platform !== 'win32')(
    'uses the filesystem root on non-Windows platforms',
    async () => {
      expect(await discoverLocalDrives('/')).toEqual([{ label: '/', path: '/' }]);
      expect(stat).not.toHaveBeenCalled();
    },
  );
});
