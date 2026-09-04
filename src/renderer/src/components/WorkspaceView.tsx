import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LocalDirectoryListing } from '@shared/ipc/contracts';
import type { WorkspaceRemoteSessionReference } from '@shared/models/workspace-tab';
import { useTranslation } from 'react-i18next';
import { PathBreadcrumbs } from './PathBreadcrumbs';
import { DriveSelector } from './DriveSelector';
import { VirtualFileList } from './VirtualFileList';
import { SftpPanel } from './SftpPanel';
import { useWorkspaceService } from './useWorkspaceService';
import { CommanderSurface, CommandButtons, type FileCommand } from './CommanderSurface';
import { Dialog } from './Dialog';
import { readFileDrop } from './file-drop';

type ActivePanel = 'local' | 'remote';
type DirectoryState =
  | { readonly listing: LocalDirectoryListing | undefined; readonly status: 'loading' }
  | {
      readonly errorKey: string;
      readonly listing: LocalDirectoryListing | undefined;
      readonly path: string | null;
      readonly status: 'error';
    }
  | { readonly listing: LocalDirectoryListing; readonly status: 'ready' };

export interface WorkspaceViewProps {
  readonly isActive: boolean;
  readonly remoteSession: WorkspaceRemoteSessionReference | null;
  readonly tabId: string;
  readonly tabPanelId: string;
  readonly workspaceId: string;
}

export const WorkspaceView = ({
  isActive,
  remoteSession,
  tabId,
  tabPanelId,
  workspaceId,
}: WorkspaceViewProps) => {
  const { t } = useTranslation();
  const service = useWorkspaceService(isActive);
  const [localSelection, setLocalSelection] = useState<string | null>(null);
  const [localSelections, setLocalSelections] = useState<string[]>([]);
  const [operation, setOperation] = useState<'mkdir' | 'rename' | 'delete' | null>(null);
  const [activePanel, setActivePanel] = useState<ActivePanel>('local');
  const [directoryState, setDirectoryState] = useState<DirectoryState>({
    listing: undefined,
    status: 'loading',
  });
  const requestVersion = useRef(0);
  const localPanelReference = useRef<HTMLElement>(null);
  const remotePanelReference = useRef<HTMLElement>(null);

  const loadDirectory = useCallback(async (path: string | null): Promise<void> => {
    const currentRequestVersion = requestVersion.current + 1;
    requestVersion.current = currentRequestVersion;
    setDirectoryState((current) => ({ listing: current.listing, status: 'loading' }));
    const response = await window.desktop.listLocalDirectory(path);

    if (requestVersion.current !== currentRequestVersion) {
      return;
    }

    if (response.ok) {
      setLocalSelection(null);
      setLocalSelections([]);
      setDirectoryState({ listing: response.data, status: 'ready' });
    } else {
      setDirectoryState((current) => ({
        errorKey: response.error.messageKey,
        listing: current.listing,
        path,
        status: 'error',
      }));
    }
  }, []);

  useEffect(() => {
    void loadDirectory(null);
  }, [loadDirectory]);

  const listing = directoryState.listing;
  const remoteSessionState = service.snapshot.sessions.find(
    (item) => item.workspaceId === workspaceId,
  );
  const completedDownloads = service.snapshot.transfers
    .filter(
      (item) =>
        item.workspaceId === workspaceId &&
        item.direction === 'download' &&
        item.state === 'completed',
    )
    .map((item) => item.id)
    .join(',');
  const previousDownloads = useRef('');
  useEffect(() => {
    if (completedDownloads !== previousDownloads.current) {
      previousDownloads.current = completedDownloads;
      if (listing) void loadDirectory(listing.currentPath);
    }
  }, [completedDownloads, listing, loadDirectory]);
  const activePanelTitle = t(activePanel === 'local' ? 'localPanel.title' : 'remotePanel.title');

  const onPanelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'F6') {
      return;
    }

    event.preventDefault();

    if (activePanel === 'local') {
      (
        remotePanelReference.current?.querySelector<HTMLElement>(
          '[data-testid="file-row"][tabindex="0"]',
        ) ??
        remotePanelReference.current?.querySelector<HTMLElement>('.commander-surface') ??
        remotePanelReference.current
      )?.focus();
    } else {
      (
        localPanelReference.current?.querySelector<HTMLElement>(
          '[data-testid="file-row"][tabindex="0"]',
        ) ??
        localPanelReference.current?.querySelector<HTMLElement>('.commander-surface') ??
        localPanelReference.current
      )?.focus();
    }
  };

  const localCommands: FileCommand[] = [
    {
      id: 'copy',
      label: t('commander.copy'),
      key: 'F5',
      disabled: !localSelections.length || remoteSessionState?.state !== 'connected',
      run: () =>
        remotePanelReference.current
          ?.querySelector<HTMLButtonElement>('[data-command="upload"]')
          ?.click(),
    },
    {
      id: 'rename',
      label: t('operations.rename'),
      key: 'F2',
      disabled: localSelections.length !== 1,
      run: () => setOperation('rename'),
    },
    {
      id: 'mkdir',
      label: t('operations.mkdir'),
      key: 'F7',
      disabled: !listing,
      run: () => setOperation('mkdir'),
    },
    {
      id: 'delete',
      label: t('operations.delete'),
      key: 'Delete',
      disabled: !localSelections.length,
      run: () => setOperation('delete'),
    },
    {
      id: 'refresh',
      label: t('commander.refresh'),
      key: 'F4',
      run: () => void loadDirectory(listing?.currentPath ?? null),
    },
    {
      id: 'up',
      label: t('commander.up'),
      key: 'Backspace',
      disabled: !listing?.parentPath,
      run: () => void loadDirectory(listing?.parentPath ?? null),
    },
  ];
  return (
    <section
      aria-labelledby={tabId}
      className="workspace"
      data-remote-provider={remoteSession?.provider ?? 'none'}
      data-workspace-id={workspaceId}
      hidden={!isActive}
      id={tabPanelId}
      role="tabpanel"
    >
      <div aria-label={t('panels.label')} className="panels" onKeyDown={onPanelKeyDown}>
        <section
          aria-label={t('localPanel.title')}
          className="panel"
          data-active={activePanel === 'local'}
          data-testid="local-panel"
          onFocus={() => setActivePanel('local')}
          ref={localPanelReference}
          tabIndex={0}
        >
          <CommanderSurface
            commands={localCommands}
            onDrop={(event) => {
              const payload = readFileDrop(event);
              if (!payload || !listing) return;
              for (const sourcePath of payload.paths)
                void service.run(
                  payload.side === 'local'
                    ? {
                        action: 'local-transfer',
                        workspaceId,
                        sourcePath,
                        destinationDirectory: listing.currentPath,
                        conflictPolicy: 'ask',
                      }
                    : {
                        action: 'transfer',
                        workspaceId: payload.workspaceId,
                        direction: 'download',
                        sourcePath,
                        destinationDirectory: listing.currentPath,
                        conflictPolicy: 'ask',
                      },
                );
            }}
          >
            <div className="panel__header">
              <div>
                <h2>{t('localPanel.title')}</h2>
                <span>{t('localPanel.subtitle')}</span>
              </div>
              {activePanel === 'local' ? (
                <span className="active-indicator">{t('panels.active')}</span>
              ) : null}
            </div>

            <CommandButtons commands={localCommands} />
            <div className="pathbar">
              <DriveSelector
                currentRootPath={listing?.breadcrumbs[0]?.path}
                isActive={isActive}
                onNavigate={(path) => void loadDirectory(path)}
              />
              {listing === undefined ? null : (
                <PathBreadcrumbs
                  breadcrumbs={listing.breadcrumbs}
                  onNavigate={(path) => void loadDirectory(path)}
                  onNavigateUp={() => {
                    if (listing.parentPath !== null) {
                      void loadDirectory(listing.parentPath);
                    }
                  }}
                  onRefresh={() => void loadDirectory(listing.currentPath)}
                  parentPath={listing.parentPath}
                />
              )}
            </div>

            {directoryState.status === 'loading' ? (
              <div aria-live="polite" className="panel-state">
                <span className="spinner" />
                <span>{t('fileList.loading')}</span>
              </div>
            ) : null}
            {directoryState.status === 'error' ? (
              <div className="panel-state panel-state--error" role="alert">
                <strong>{t('localPanel.errorTitle')}</strong>
                <span>{t(directoryState.errorKey)}</span>
                <div className="panel-state__actions">
                  {listing === undefined ? null : (
                    <button
                      onClick={() => setDirectoryState({ listing, status: 'ready' })}
                      type="button"
                    >
                      {t('toolbar.back')}
                    </button>
                  )}
                  <button onClick={() => void loadDirectory(directoryState.path)} type="button">
                    {t('toolbar.retry')}
                  </button>
                </div>
              </div>
            ) : null}
            {directoryState.status === 'ready' && listing?.entries.length === 0 ? (
              <div className="panel-state">{t('fileList.empty')}</div>
            ) : null}
            {directoryState.status === 'ready' &&
            listing !== undefined &&
            listing.entries.length > 0 ? (
              <VirtualFileList
                entries={listing.entries}
                selectedPath={localSelection}
                selectedPaths={localSelections}
                onSelectionChange={setLocalSelections}
                dragSource={{ workspaceId, side: 'local' }}
                onSelect={setLocalSelection}
                onOpenDirectory={(path) => void loadDirectory(path)}
              />
            ) : null}
          </CommanderSurface>
        </section>

        <section
          aria-label={t('remotePanel.title')}
          className="panel"
          data-active={activePanel === 'remote'}
          data-testid="remote-panel"
          onFocus={() => setActivePanel('remote')}
          ref={remotePanelReference}
          tabIndex={0}
        >
          <div className="panel__header">
            <div>
              <h2>{t('remotePanel.title')}</h2>
              <span>
                {remoteSessionState
                  ? t(`connections.states.${remoteSessionState.state}`)
                  : t('remotePanel.subtitle')}
              </span>
            </div>
            {activePanel === 'remote' ? (
              <span className="active-indicator">{t('panels.active')}</span>
            ) : null}
          </div>
          <SftpPanel
            workspaceId={workspaceId}
            snapshot={service.snapshot}
            run={service.run}
            errorKey={service.errorKey}
            localPath={listing?.currentPath}
            localSelection={localSelection}
            localSelections={localSelections}
          />
        </section>
      </div>

      <footer className="statusbar">
        <span title={t('commander.shortcuts')}>
          {t('commander.selected', { count: localSelections.length })} ·{' '}
          {t('status.items', { count: listing?.entries.length ?? 0 })}
        </span>
        <span className="statusbar__path" title={listing?.currentPath}>
          {listing?.currentPath ?? t('common.notAvailable')}
        </span>
        <span>{t('status.activePanel', { panel: activePanelTitle })}</span>
      </footer>
      {operation && listing ? (
        <Dialog title={t(`operations.${operation}`)} onClose={() => setOperation(null)}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const name = String(new FormData(event.currentTarget).get('name') ?? '');
              const separator = listing.currentPath.includes('\\') ? '\\' : '/';
              const destinationPath = `${listing.currentPath.replace(/[\\/]$/u, '')}${separator}${name}`;
              void (async () => {
                const paths = operation === 'mkdir' ? [destinationPath] : localSelections;
                for (const path of paths) {
                  const result = await service.run({
                    action: 'local-operation',
                    workspaceId,
                    operation,
                    path,
                    ...(operation === 'rename' ? { destinationPath } : {}),
                  });
                  if (!result) return;
                }
                setOperation(null);
                await loadDirectory(listing.currentPath);
              })();
            }}
          >
            {operation === 'delete' ? (
              <>
                <p>{t('commander.deleteSelection')}</p>
                <ul>
                  {localSelections.map((path) => (
                    <li key={path}>{path}</li>
                  ))}
                </ul>
              </>
            ) : (
              <label>
                {t('operations.name')}
                <input
                  autoFocus
                  name="name"
                  required
                  pattern="[^/\\\\]+"
                  defaultValue={
                    operation === 'rename'
                      ? (listing.entries.find((entry) => entry.path === localSelection)?.name ?? '')
                      : ''
                  }
                />
              </label>
            )}
            {service.errorKey ? <p role="alert">{t(service.errorKey)}</p> : null}
            <div className="dialog-actions">
              <button type="submit">{t('operations.confirm')}</button>
              <button type="button" onClick={() => setOperation(null)}>
                {t('connections.cancel')}
              </button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </section>
  );
};
