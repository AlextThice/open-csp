import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { WorkspaceTab } from '@shared/models/workspace-tab';
import { useTranslation } from 'react-i18next';
import { WorkspaceView } from './components/WorkspaceView';
import type { SupportedLanguage } from './i18n/resources';

import { ProfileLibrary } from './components/ProfileLibrary';
import { Dialog } from './components/Dialog';
import { useWorkspaceService } from './components/useWorkspaceService';
import { TransferQueue } from './components/TransferQueue';
const supportedLanguages = new Set<SupportedLanguage>(['en', 'ru']);

const createWorkspace = (sequence: number): WorkspaceTab => ({
  id: `workspace-${sequence}`,
  remoteSession: null,
  sequence,
});

const getTabId = (workspaceId: string): string => `workspace-tab-${workspaceId}`;
const getTabPanelId = (workspaceId: string): string => `workspace-panel-${workspaceId}`;

export const App = () => {
  const { i18n, t } = useTranslation();
  const nextWorkspaceSequence = useRef(1);
  const [workspaces, setWorkspaces] = useState<readonly WorkspaceTab[]>(() => [createWorkspace(1)]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState('workspace-1');
  const closingWorkspace = useRef(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [pendingClose, setPendingClose] = useState<string | null>(null);
  const service = useWorkspaceService(true);
  useEffect(() => {
    document.documentElement.lang = i18n.resolvedLanguage ?? i18n.language;
  }, [i18n.language, i18n.resolvedLanguage]);
  useEffect(() => {
    void window.desktop.workspace({ action: 'snapshot' }).then((result) => {
      if (result.ok) {
        const sequences = [
          ...new Set(
            result.data.snapshot.transfers
              .flatMap((item) => [item.workspaceId, item.destinationWorkspaceId])
              .filter((id): id is string => !!id && /^workspace-\d+$/u.test(id))
              .map((id) => Number(id.slice(10))),
          ),
        ].filter((number) => number > 0 && number < 10000);
        if (sequences.length) {
          const maximum = Math.max(...sequences, 1);
          nextWorkspaceSequence.current = maximum;
          setWorkspaces(
            [...new Set([1, ...sequences])]
              .sort((left, right) => left - right)
              .map(createWorkspace),
          );
        }
      }
      if (result.ok && result.data.snapshot.language)
        void i18n.changeLanguage(result.data.snapshot.language);
    });
  }, [i18n]);

  const getWorkspaceName = (workspace: WorkspaceTab): string =>
    (() => {
      const session = service.snapshot.sessions.find((item) => item.workspaceId === workspace.id);
      return session
        ? `${session.kind?.toUpperCase()} · ${session.name}`
        : (workspace.remoteSession?.displayName ??
            t('tabs.workspace', { number: workspace.sequence }));
    })();

  const focusTab = (workspaceId: string): void => {
    requestAnimationFrame(() => {
      document.getElementById(getTabId(workspaceId))?.focus();
    });
  };

  const selectWorkspace = (workspaceId: string, shouldFocus = false): void => {
    setActiveWorkspaceId(workspaceId);

    if (shouldFocus) {
      focusTab(workspaceId);
    }
  };

  const addWorkspace = (): void => {
    const sequence = nextWorkspaceSequence.current + 1;
    nextWorkspaceSequence.current = sequence;
    const workspace = createWorkspace(sequence);
    setWorkspaces((current) => [...current, workspace]);
    selectWorkspace(workspace.id, true);
  };

  const closeWorkspace = (workspaceId: string, cancelActive = false): void => {
    if (workspaces.length === 1 || closingWorkspace.current) {
      return;
    }
    closingWorkspace.current = true;
    void (async () => {
      const state = await window.desktop.workspace({ action: 'snapshot' });
      if (
        !cancelActive &&
        state.ok &&
        state.data.snapshot.transfers.some(
          (item) =>
            (item.workspaceId === workspaceId || item.destinationWorkspaceId === workspaceId) &&
            ['running', 'queued', 'requiring-review'].includes(item.state),
        )
      ) {
        setPendingClose(workspaceId);
        closingWorkspace.current = false;
        return;
      }
      return window.desktop.workspace(
        cancelActive
          ? { action: 'close-session', workspaceId, cancelActive: true }
          : { action: 'disconnect', workspaceId },
      );
    })().then((response) => {
      closingWorkspace.current = false;
      if (!response) return;
      if (!response.ok) {
        setCloseError(
          response.error.code === 'PROVIDER_CONFLICT'
            ? 'transfers.closeBusy'
            : response.error.messageKey,
        );
        return;
      }
      setCloseError(null);
      setPendingClose(null);
      const workspaceIndex = workspaces.findIndex((workspace) => workspace.id === workspaceId);
      const remainingWorkspaces = workspaces.filter((workspace) => workspace.id !== workspaceId);
      setWorkspaces((current) => current.filter((workspace) => workspace.id !== workspaceId));

      if (activeWorkspaceId === workspaceId) {
        const nextWorkspace =
          remainingWorkspaces[Math.min(workspaceIndex, remainingWorkspaces.length - 1)];

        if (nextWorkspace !== undefined) {
          setActiveWorkspaceId((current) => (current === workspaceId ? nextWorkspace.id : current));
          focusTab(nextWorkspace.id);
        }
      }
    });
  };

  const selectAdjacentWorkspace = (workspaceId: string, offset: number): void => {
    const workspaceIndex = workspaces.findIndex((workspace) => workspace.id === workspaceId);

    if (workspaceIndex < 0) {
      return;
    }

    const nextIndex = (workspaceIndex + offset + workspaces.length) % workspaces.length;
    const nextWorkspace = workspaces[nextIndex];

    if (nextWorkspace !== undefined) {
      selectWorkspace(nextWorkspace.id, true);
    }
  };

  const onTabKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    workspaceId: string,
  ): void => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      selectAdjacentWorkspace(workspaceId, -1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      selectAdjacentWorkspace(workspaceId, 1);
    }
  };

  const onAppKeyDown = (event: ReactKeyboardEvent<HTMLElement>): void => {
    if ((event.target as HTMLElement).closest('dialog, [role="dialog"]')) return;
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }

    if (event.key.toLowerCase() === 't') {
      event.preventDefault();
      addWorkspace();
    } else if (event.key.toLowerCase() === 'w') {
      event.preventDefault();
      closeWorkspace(activeWorkspaceId);
    }
  };

  const changeLanguage = (language: string): void => {
    if (supportedLanguages.has(language as SupportedLanguage)) {
      void i18n.changeLanguage(language);
      void window.desktop.workspace({
        action: 'set-language',
        language: language as SupportedLanguage,
      });
    }
  };

  return (
    <main className="app-shell" onKeyDown={onAppKeyDown}>
      <header className="toolbar">
        <div className="brand">
          <p>{t('app.tagline')}</p>
          <h1>{t('app.name')}</h1>
        </div>
        <div className="toolbar__actions">
          <button onClick={() => setLibraryOpen(true)}>{t('library.title')}</button>
          <label className="language-select">
            <span>{t('language.label')}</span>
            <select
              aria-label={t('language.label')}
              onChange={(event) => changeLanguage(event.currentTarget.value)}
              value={i18n.resolvedLanguage ?? i18n.language}
            >
              <option value="en">{t('language.english')}</option>
              <option value="ru">{t('language.russian')}</option>
            </select>
          </label>
          <span className="runtime-badge">{t('app.desktop')}</span>
        </div>
      </header>

      <div className="workspace-tabs-shell">
        {closeError ? (
          <span className="inline-error" role="alert">
            {t(closeError)}
          </span>
        ) : null}
        <div aria-label={t('tabs.label')} className="workspace-tabs" role="tablist">
          {workspaces.map((workspace) => {
            const isActive = workspace.id === activeWorkspaceId;
            const workspaceName = getWorkspaceName(workspace);

            return (
              <div className="workspace-tab" key={workspace.id} role="presentation">
                <button
                  aria-controls={getTabPanelId(workspace.id)}
                  aria-selected={isActive}
                  className="workspace-tab__select"
                  id={getTabId(workspace.id)}
                  onClick={() => selectWorkspace(workspace.id)}
                  onKeyDown={(event) => onTabKeyDown(event, workspace.id)}
                  role="tab"
                  tabIndex={isActive ? 0 : -1}
                  type="button"
                >
                  <span aria-hidden="true" className="workspace-tab__status" />
                  <span>{workspaceName}</span>
                </button>
                {workspaces.length > 1 ? (
                  <button
                    aria-label={t('tabs.close', { name: workspaceName })}
                    className="workspace-tab__close"
                    onClick={() => closeWorkspace(workspace.id)}
                    type="button"
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
        <button
          aria-label={t('tabs.add')}
          className="workspace-tab__add"
          onClick={addWorkspace}
          title={t('tabs.addHint')}
          type="button"
        >
          <span aria-hidden="true">+</span>
        </button>
      </div>

      {workspaces.map((workspace) => (
        <WorkspaceView
          isActive={workspace.id === activeWorkspaceId}
          key={workspace.id}
          remoteSession={workspace.remoteSession}
          tabId={getTabId(workspace.id)}
          tabPanelId={getTabPanelId(workspace.id)}
          workspaceId={workspace.id}
        />
      ))}
      <TransferQueue transfers={service.snapshot.transfers} run={service.run} />
      {libraryOpen ? <ProfileLibrary onClose={() => setLibraryOpen(false)} /> : null}
      {pendingClose ? (
        <Dialog title={t('library.closeTitle')} onClose={() => setPendingClose(null)}>
          <p>{t('library.closeWarning')}</p>
          {closeError ? <p role="alert">{t(closeError)}</p> : null}
          <button onClick={() => closeWorkspace(pendingClose, true)}>
            {t('library.cancelClose')}
          </button>
          <button onClick={() => setPendingClose(null)}>{t('library.keepOpen')}</button>
        </Dialog>
      ) : null}
    </main>
  );
};
