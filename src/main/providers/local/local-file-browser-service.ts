import { isAbsolute, relative, resolve, sep } from 'node:path';
import type {
  LocalDirectoryListing,
  LocalDirectoryRequest,
  LocalDrive,
} from '@shared/ipc/contracts';
import { providerErrorCodes } from '@shared/providers/provider-error';
import { LocalDirectoryService } from './local-directory-service';
import { LocalProvider } from './local-provider';
import { createLocalProviderError } from './local-provider-error';

export class LocalFileBrowserService {
  private drives: readonly LocalDrive[] | undefined;
  private discoveryPromise: Promise<readonly LocalDrive[]> | undefined;
  private readonly directories = new Map<string, LocalDirectoryService>();

  public constructor(
    private readonly initialPath: string,
    private readonly discoverDrives: () => Promise<readonly LocalDrive[]>,
  ) {}

  public async listDrives(): Promise<readonly LocalDrive[]> {
    this.discoveryPromise ??= this.discoverDrives()
      .then((drives) => {
        this.drives = drives;
        return drives;
      })
      .finally(() => {
        this.discoveryPromise = undefined;
      });
    return this.discoveryPromise;
  }

  public async list(request: LocalDirectoryRequest): Promise<LocalDirectoryListing> {
    const requestedPath = request.path ?? this.initialPath;

    if (!isAbsolute(requestedPath)) {
      throw createLocalProviderError(providerErrorCodes.invalidPath, 'list');
    }

    const currentPath = resolve(requestedPath);
    const drives = this.drives ?? (await this.listDrives());
    const drive = drives
      .filter(({ path }) => {
        const relativePath = relative(path, currentPath);
        return (
          relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath)
        );
      })
      .sort((left, right) => right.path.length - left.path.length)[0];

    if (drive === undefined) {
      throw createLocalProviderError(providerErrorCodes.invalidPath, 'list');
    }

    let directory = this.directories.get(drive.path);

    if (directory === undefined) {
      directory = new LocalDirectoryService(
        new LocalProvider({ rootPath: drive.path }),
        drive.path,
      );
      this.directories.set(drive.path, directory);
    }

    return directory.list({ path: currentPath });
  }
}
