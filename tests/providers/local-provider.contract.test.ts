import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalProvider } from '../../src/main/providers/local/local-provider';
import { createLocalProviderPath } from '../../src/shared/models/provider-path';
import { runFileSystemProviderContractTests } from './provider-contract';

runFileSystemProviderContractTests('LocalProvider', async () => {
  const rootPath = await mkdtemp(join(tmpdir(), 'openscp-local-contract-'));
  const provider = new LocalProvider({ rootPath });

  return {
    dispose: async () => {
      await rm(rootPath, { force: true, recursive: true });
    },
    path: (...segments) => createLocalProviderPath(join(rootPath, ...segments)),
    provider,
    root: createLocalProviderPath(rootPath),
  };
});
