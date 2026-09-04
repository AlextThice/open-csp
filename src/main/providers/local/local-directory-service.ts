import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import type {
  LocalBreadcrumb,
  LocalDirectoryListing,
  LocalDirectoryRequest,
} from '@shared/ipc/contracts';
import { createLocalProviderPath } from '@shared/models/provider-path';
import { LocalProvider } from './local-provider';

export class LocalDirectoryService {
  private connectionPromise: Promise<void> | undefined;

  public constructor(
    private readonly provider: LocalProvider,
    private readonly initialPath: string,
  ) {}

  public async list(request: LocalDirectoryRequest): Promise<LocalDirectoryListing> {
    await this.ensureConnected();
    const rootPath = this.provider.rootPath.path;
    const currentPath = resolve(request.path ?? this.initialPath);
    const entries = await this.provider.list(createLocalProviderPath(currentPath));

    return {
      breadcrumbs: this.createBreadcrumbs(rootPath, currentPath),
      currentPath,
      entries: entries.map((entry) => {
        if (entry.path.provider !== 'local') {
          throw new Error('The local provider returned a non-local path.');
        }

        return {
          kind: entry.kind,
          modifiedAt: entry.modifiedAt ?? null,
          name: entry.name,
          path: entry.path.path,
          size: entry.size,
        };
      }),
      parentPath: relative(rootPath, currentPath) === '' ? null : dirname(currentPath),
    };
  }

  private async ensureConnected(): Promise<void> {
    if (this.provider.connectionState === 'connected') {
      return;
    }

    this.connectionPromise ??= this.provider.connect().finally(() => {
      this.connectionPromise = undefined;
    });
    await this.connectionPromise;
  }

  private createBreadcrumbs(rootPath: string, currentPath: string): readonly LocalBreadcrumb[] {
    const breadcrumbs: LocalBreadcrumb[] = [
      {
        label: basename(rootPath) || rootPath,
        path: rootPath,
      },
    ];
    const relativePath = relative(rootPath, currentPath);

    if (relativePath === '') {
      return breadcrumbs;
    }

    let breadcrumbPath = rootPath;

    for (const segment of relativePath.split(sep)) {
      breadcrumbPath = join(breadcrumbPath, segment);
      breadcrumbs.push({ label: segment, path: breadcrumbPath });
    }

    return breadcrumbs;
  }
}
