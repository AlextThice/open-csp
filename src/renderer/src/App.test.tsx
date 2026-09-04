import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { DesktopApi } from '@shared/desktop-api';
import type { LocalDirectoryListing } from '@shared/ipc/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { i18n } from './i18n';

const correlationId = '00000000-0000-4000-8000-000000000001';
const driveRootPath = 'C:\\';
const usersPath = 'C:\\Users';
const rootPath = 'C:\\Users\\test';
const childPath = `${rootPath}\\Documents`;

const rootListing: LocalDirectoryListing = {
  breadcrumbs: [
    { label: driveRootPath, path: driveRootPath },
    { label: 'Users', path: usersPath },
    { label: 'test', path: rootPath },
  ],
  currentPath: rootPath,
  entries: [
    {
      kind: 'directory',
      modifiedAt: '2026-08-30T12:00:00.000Z',
      name: 'Documents',
      path: childPath,
      size: 0n,
    },
    {
      kind: 'file',
      modifiedAt: '2026-08-30T12:00:00.000Z',
      name: 'notes.txt',
      path: `${rootPath}\\notes.txt`,
      size: 42n,
    },
  ],
  parentPath: usersPath,
};

const createDesktopApi = (listLocalDirectory: DesktopApi['listLocalDirectory']): DesktopApi => {
  const desktopApi: DesktopApi = {
    workspace: async () => ({
      correlationId,
      ok: true,
      data: {
        snapshot: { profiles: [], sessions: [], transfers: [], language: null },
        listing: null,
        privateKeyPath: null,
      },
    }),
    getRuntimeInfo: async () => ({
      correlationId,
      data: { platform: 'win32', runtime: 'electron' },
      ok: true,
    }),
    listLocalDirectory,
    listLocalDrives: async () => ({
      correlationId,
      data: [
        { label: driveRootPath, path: driveRootPath },
        { label: 'D:\\', path: 'D:\\' },
      ],
      ok: true,
    }),
    onAppReady: () => () => undefined,
    runtime: 'electron',
  };

  return Object.freeze(desktopApi);
};

const setDesktopApi = (desktopApi: DesktopApi): void => {
  Object.defineProperty(window, 'desktop', { configurable: true, value: desktopApi });
};

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('App', () => {
  it('keeps drive and directory selections independent between workspaces', async () => {
    const secondDrive: LocalDirectoryListing = {
      breadcrumbs: [{ label: 'D:\\', path: 'D:\\' }],
      currentPath: 'D:\\',
      entries: [],
      parentPath: null,
    };
    const listLocalDirectory = vi.fn(async (path: string | null) => ({
      correlationId,
      data: path === 'D:\\' ? secondDrive : rootListing,
      ok: true as const,
    }));
    setDesktopApi(createDesktopApi(listLocalDirectory));
    render(<App />);
    await screen.findByText('notes.txt');
    fireEvent.change(screen.getByRole('combobox', { name: 'Drive' }), {
      target: { value: 'D:\\' },
    });
    expect(await screen.findByText('This directory is empty.')).toBeTruthy();
    expect((screen.getByRole('combobox', { name: 'Drive' }) as HTMLSelectElement).value).toBe(
      'D:\\',
    );
    expect(
      (screen.getByRole('button', { name: 'Go to parent directory' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'New workspace' }));
    await within(screen.getByRole('tabpanel')).findByText('notes.txt');
    expect((screen.getByRole('combobox', { name: 'Drive' }) as HTMLSelectElement).value).toBe(
      'C:\\',
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Workspace 1' }));
    expect(within(screen.getByRole('tabpanel')).getByText('This directory is empty.')).toBeTruthy();
    expect((screen.getByRole('combobox', { name: 'Drive' }) as HTMLSelectElement).value).toBe(
      'D:\\',
    );
    expect(listLocalDirectory).toHaveBeenCalledTimes(3);
  });

  it('keeps drive selection usable after a failed switch or initial directory error', async () => {
    const listLocalDirectory = vi.fn(async (path: string | null) =>
      path === 'D:\\' || path === null
        ? {
            correlationId,
            error: {
              code: 'PROVIDER_ACCESS_DENIED' as const,
              messageKey: 'errors.provider.accessDenied' as const,
            },
            ok: false as const,
          }
        : { correlationId, data: rootListing, ok: true as const },
    );
    setDesktopApi(createDesktopApi(listLocalDirectory));
    render(<App />);
    await screen.findByText('Permission to perform this operation was denied.');
    fireEvent.change(screen.getByRole('combobox', { name: 'Drive' }), {
      target: { value: 'C:\\' },
    });
    await screen.findByText('notes.txt');
    fireEvent.change(screen.getByRole('combobox', { name: 'Drive' }), {
      target: { value: 'D:\\' },
    });
    await screen.findByText('Permission to perform this operation was denied.');
    expect(screen.queryByText('notes.txt')).toBeNull();
    expect((screen.getByRole('combobox', { name: 'Drive' }) as HTMLSelectElement).value).toBe(
      'C:\\',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText('notes.txt')).toBeTruthy();
  });

  it('refreshes drive options for attached and removed media', async () => {
    const listLocalDrives = vi
      .fn<DesktopApi['listLocalDrives']>()
      .mockResolvedValueOnce({ correlationId, data: [{ label: 'C:\\', path: 'C:\\' }], ok: true })
      .mockResolvedValueOnce({
        correlationId,
        data: [
          { label: 'C:\\', path: 'C:\\' },
          { label: 'E:\\', path: 'E:\\' },
        ],
        ok: true,
      })
      .mockResolvedValue({ correlationId, data: [{ label: 'C:\\', path: 'C:\\' }], ok: true });
    setDesktopApi(
      Object.freeze({
        ...createDesktopApi(async () => ({ correlationId, data: rootListing, ok: true })),
        listLocalDrives,
      }),
    );
    render(<App />);
    await screen.findByText('notes.txt');
    expect(screen.queryByRole('option', { name: 'E:\\' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh drives' }));
    expect(await screen.findByRole('option', { name: 'E:\\' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh drives' }));
    await waitFor(() => expect(screen.queryByRole('option', { name: 'E:\\' })).toBeNull());
    expect(screen.getByText('notes.txt')).toBeTruthy();
  });

  it('ignores a slow initial listing after the user switches drives', async () => {
    let completeInitialListing:
      ((response: Awaited<ReturnType<DesktopApi['listLocalDirectory']>>) => void) | undefined;
    const initialListing = new Promise<Awaited<ReturnType<DesktopApi['listLocalDirectory']>>>(
      (resolve) => {
        completeInitialListing = resolve;
      },
    );
    setDesktopApi(
      createDesktopApi(async (path) =>
        path === null
          ? initialListing
          : {
              correlationId,
              data: {
                breadcrumbs: [{ label: 'D:\\', path: 'D:\\' }],
                currentPath: 'D:\\',
                entries: [],
                parentPath: null,
              },
              ok: true,
            },
      ),
    );
    render(<App />);
    await screen.findByRole('option', { name: 'D:\\' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Drive' }), {
      target: { value: 'D:\\' },
    });
    await screen.findByText('This directory is empty.');
    await act(async () => completeInitialListing?.({ correlationId, data: rootListing, ok: true }));
    expect((screen.getByRole('combobox', { name: 'Drive' }) as HTMLSelectElement).value).toBe(
      'D:\\',
    );
    expect(screen.queryByText('notes.txt')).toBeNull();
  });

  it('loads the local directory and renders the complete two-panel shell', async () => {
    setDesktopApi(createDesktopApi(async () => ({ correlationId, data: rootListing, ok: true })));
    render(<App />);

    expect(screen.getByRole('heading', { level: 1, name: 'OpenSCP' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Local' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Remote' })).toBeTruthy();
    expect(await screen.findByText('notes.txt')).toBeTruthy();
    expect(screen.getByText('No remote connection')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Transfer queue' })).toBeTruthy();
  });

  it('uses the narrow preload contract', () => {
    expect(Object.keys(window.desktop).sort()).toEqual([
      'getRuntimeInfo',
      'listLocalDirectory',
      'listLocalDrives',
      'onAppReady',
      'runtime',
      'workspace',
    ]);
    expect(window.desktop.runtime).toBe('electron');
    expect(Object.isFrozen(window.desktop)).toBe(true);
  });

  it('changes directory through the preload API', async () => {
    const childListing: LocalDirectoryListing = {
      breadcrumbs: [
        { label: driveRootPath, path: driveRootPath },
        { label: 'Users', path: usersPath },
        { label: 'test', path: rootPath },
        { label: 'Documents', path: childPath },
      ],
      currentPath: childPath,
      entries: [],
      parentPath: rootPath,
    };
    const listLocalDirectory = vi.fn(async (path: string | null) => ({
      correlationId,
      data: path === childPath ? childListing : rootListing,
      ok: true as const,
    }));
    setDesktopApi(createDesktopApi(listLocalDirectory));
    render(<App />);

    fireEvent.doubleClick(await screen.findByRole('row', { name: 'Open Documents' }));

    await waitFor(() => expect(listLocalDirectory).toHaveBeenLastCalledWith(childPath));
    expect(await screen.findByText('This directory is empty.')).toBeTruthy();
    expect(screen.getByTestId('breadcrumbs').textContent).toContain('Documents');
  });

  it('allows navigation above the user directory toward the drive root', async () => {
    const usersListing: LocalDirectoryListing = {
      breadcrumbs: [
        { label: driveRootPath, path: driveRootPath },
        { label: 'Users', path: usersPath },
      ],
      currentPath: usersPath,
      entries: [],
      parentPath: driveRootPath,
    };
    const listLocalDirectory = vi.fn(async (path: string | null) => ({
      correlationId,
      data: path === usersPath ? usersListing : rootListing,
      ok: true as const,
    }));
    setDesktopApi(createDesktopApi(listLocalDirectory));
    render(<App />);
    await screen.findByText('notes.txt');

    fireEvent.click(screen.getByRole('button', { name: 'Go to parent directory' }));

    await waitFor(() => expect(listLocalDirectory).toHaveBeenLastCalledWith(usersPath));
    expect(screen.getByTestId('breadcrumbs').textContent).toContain(driveRootPath);
  });

  it('switches every visible shell label to Russian without reloading', async () => {
    setDesktopApi(createDesktopApi(async () => ({ correlationId, data: rootListing, ok: true })));
    render(<App />);
    await screen.findByText('notes.txt');

    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'ru' } });

    expect(await screen.findByRole('heading', { level: 2, name: 'Локальная' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Вкладка 1' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Диск' })).toBeTruthy();
    expect(screen.getByText('Нет удалённого подключения')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Очередь передач' })).toBeTruthy();
  });

  it('renders a localized error state and retries the same path', async () => {
    const listLocalDirectory = vi.fn(async () => ({
      correlationId,
      error: {
        code: 'PROVIDER_ACCESS_DENIED' as const,
        messageKey: 'errors.provider.accessDenied' as const,
      },
      ok: false as const,
    }));
    setDesktopApi(createDesktopApi(listLocalDirectory));
    render(<App />);

    expect(
      await screen.findByText('Permission to perform this operation was denied.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(listLocalDirectory).toHaveBeenCalledTimes(2));
  });

  it('keeps the previous directory available after a child access error', async () => {
    const listLocalDirectory = vi.fn(async (path: string | null) =>
      path === childPath
        ? {
            correlationId,
            error: {
              code: 'PROVIDER_ACCESS_DENIED' as const,
              messageKey: 'errors.provider.accessDenied' as const,
            },
            ok: false as const,
          }
        : { correlationId, data: rootListing, ok: true as const },
    );
    setDesktopApi(createDesktopApi(listLocalDirectory));
    render(<App />);

    fireEvent.doubleClick(await screen.findByRole('row', { name: 'Open Documents' }));
    expect(
      await screen.findByText('Permission to perform this operation was denied.'),
    ).toBeTruthy();
    expect(screen.getByTestId('breadcrumbs').textContent).toContain('test');

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(await screen.findByText('notes.txt')).toBeTruthy();
    expect(listLocalDirectory).toHaveBeenCalledTimes(2);
  });

  it('moves the active panel focus with F6', async () => {
    setDesktopApi(createDesktopApi(async () => ({ correlationId, data: rootListing, ok: true })));
    render(<App />);
    await screen.findByText('notes.txt');
    const localPanel = screen.getByTestId('local-panel');
    const remotePanel = screen.getByTestId('remote-panel');

    localPanel.focus();
    fireEvent.keyDown(localPanel, { key: 'F6' });

    expect(remotePanel.contains(document.activeElement)).toBe(true);
    expect(remotePanel.dataset.active).toBe('true');
  });

  it('creates and closes independent workspaces with keyboard shortcuts', async () => {
    const listLocalDirectory = vi.fn(async () => ({
      correlationId,
      data: rootListing,
      ok: true as const,
    }));
    setDesktopApi(createDesktopApi(listLocalDirectory));
    render(<App />);
    await screen.findByText('notes.txt');

    fireEvent.keyDown(screen.getByRole('main'), { ctrlKey: true, key: 't' });

    expect(
      (await screen.findByRole('tab', { name: 'Workspace 2' })).getAttribute('aria-selected'),
    ).toBe('true');
    await waitFor(() => expect(listLocalDirectory).toHaveBeenCalledTimes(2));

    fireEvent.keyDown(screen.getByRole('main'), { ctrlKey: true, key: 'w' });

    await waitFor(() => expect(screen.queryByRole('tab', { name: 'Workspace 2' })).toBeNull());
    expect(screen.getByRole('tab', { name: 'Workspace 1' }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('preserves each workspace directory while switching tabs', async () => {
    const childListing: LocalDirectoryListing = {
      breadcrumbs: [...rootListing.breadcrumbs, { label: 'Documents', path: childPath }],
      currentPath: childPath,
      entries: [],
      parentPath: rootPath,
    };
    const listLocalDirectory = vi.fn(async (path: string | null) => ({
      correlationId,
      data: path === childPath ? childListing : rootListing,
      ok: true as const,
    }));
    setDesktopApi(createDesktopApi(listLocalDirectory));
    render(<App />);
    const firstWorkspace = screen.getByRole('tabpanel');
    fireEvent.doubleClick(
      await within(firstWorkspace).findByRole('row', { name: 'Open Documents' }),
    );
    expect(await within(firstWorkspace).findByText('This directory is empty.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'New workspace' }));
    await waitFor(() => expect(listLocalDirectory).toHaveBeenCalledTimes(3));
    fireEvent.click(screen.getByRole('tab', { name: 'Workspace 1' }));

    const restoredWorkspace = screen.getByRole('tabpanel');
    expect(within(restoredWorkspace).getByText('This directory is empty.')).toBeTruthy();
    expect(listLocalDirectory).toHaveBeenCalledTimes(3);
  });
});
