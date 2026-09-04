import type { ProviderPath } from '@shared/models/provider-path';

export type TransferConflictPolicy = 'ask' | 'fail' | 'overwrite' | 'rename' | 'skip';

export type TransferOperationState =
  'cancelled' | 'completed' | 'failed' | 'paused' | 'queued' | 'requiring-review' | 'running';

export interface TransferOperation {
  readonly conflictPolicy: TransferConflictPolicy;
  readonly destination: ProviderPath;
  readonly id: string;
  readonly source: ProviderPath;
  readonly state: TransferOperationState;
  readonly transferredBytes: bigint;
}
