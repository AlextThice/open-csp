import { posix as path } from 'node:path';
import { FakeProvider } from '../../src/main/providers/fake/fake-provider';
import { createLocalProviderPath } from '../../src/shared/models/provider-path';
import { runFileSystemProviderContractTests } from './provider-contract';

runFileSystemProviderContractTests('FakeProvider', async () => ({
  dispose: async () => undefined,
  path: (...segments) => createLocalProviderPath(path.join('/', ...segments)),
  provider: new FakeProvider(),
  root: createLocalProviderPath('/'),
}));
