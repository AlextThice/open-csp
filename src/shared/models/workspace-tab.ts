export interface WorkspaceRemoteSessionReference {
  readonly displayName: string;
  readonly profileId: string;
  readonly provider: 's3' | 'sftp';
  readonly sessionId: string;
}

export interface WorkspaceTab {
  readonly id: string;
  readonly remoteSession: WorkspaceRemoteSessionReference | null;
  readonly sequence: number;
}
