export type ProviderConnectionState =
  'connected' | 'connecting' | 'disconnected' | 'disconnecting' | 'failed';

export interface ProviderSessionSnapshot {
  readonly connectedAt?: string;
  readonly id: string;
  readonly state: ProviderConnectionState;
}
