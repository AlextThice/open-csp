import { stat } from 'node:fs/promises';
import type { LocalDrive } from '@shared/ipc/contracts';

export const discoverLocalDrives = async (
  initialRootPath: string,
): Promise<readonly LocalDrive[]> => {
  if (process.platform !== 'win32') {
    return [{ label: initialRootPath, path: initialRootPath }];
  }

  const candidates = Array.from(
    { length: 26 },
    (_, index) => `${String.fromCharCode(65 + index)}:\\`,
  );
  const drives = await Promise.all(
    candidates.map(async (path): Promise<LocalDrive | undefined> => {
      try {
        return (await stat(path)).isDirectory() ? { label: path, path } : undefined;
      } catch {
        return undefined;
      }
    }),
  );
  const availableDrives = drives.filter((drive) => drive !== undefined);

  if (
    !availableDrives.some((drive) => drive.path.toLowerCase() === initialRootPath.toLowerCase())
  ) {
    availableDrives.push({ label: initialRootPath, path: initialRootPath });
  }

  return availableDrives;
};
