import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { createMinioProvider } from '../integration/s3-harness';
import { createS3ProviderPath } from '../../src/shared/models/provider-path';
import type { DesktopApi } from '../../src/shared/desktop-api';

test('keyboard selection, local file operations, profile library and live Russian localization', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openscp-product-ui-'));
  const userData = await mkdtemp(join(tmpdir(), 'openscp-product-user-'));
  let application: ElectronApplication | undefined;
  try {
    await writeFile(join(root, 'a.txt'), 'a');
    await writeFile(join(root, 'b.txt'), 'b');
    application = await electron.launch({
      args: [
        '--disable-gpu',
        '--in-process-gpu',
        '--no-sandbox',
        `--user-data-dir=${userData}`,
        resolve('out/main/index.js'),
      ],
      env: {
        ...process.env,
        OPENSCP_DISABLE_HARDWARE_ACCELERATION: '1',
        OPENSCP_LOCAL_ROOT: root,
      },
    });
    const window = await application.firstWindow();
    const local = window.getByTestId('local-panel');
    await local.getByRole('row', { name: 'a.txt', exact: true }).focus();
    await window.keyboard.press('ControlOrMeta+a');
    await expect(local.locator('[aria-selected="true"]')).toHaveCount(2);
    await local.getByRole('row', { name: 'a.txt', exact: true }).click();
    await window.keyboard.press('Shift+ArrowDown');
    await expect(local.locator('[aria-selected="true"]')).toHaveCount(2);
    await window.keyboard.press('F7');
    let dialog = window.getByRole('dialog');
    await dialog.getByLabel('Name', { exact: true }).fill('keyboard-folder');
    await window.keyboard.press('Enter');
    await expect(local.getByRole('row', { name: 'Open keyboard-folder' })).toBeVisible();
    await local.getByRole('row', { name: 'a.txt', exact: true }).click();
    await window.keyboard.press('F2');
    dialog = window.getByRole('dialog');
    await dialog.getByLabel('Name', { exact: true }).fill('renamed.txt');
    await window.keyboard.press('Enter');
    await expect(local.getByRole('row', { name: 'renamed.txt', exact: true })).toBeVisible();
    await local.getByRole('row', { name: 'renamed.txt', exact: true }).focus();
    await window.keyboard.press('Delete');
    dialog = window.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await readFile(join(root, 'renamed.txt'), 'utf8')).toBe('a');
    await local.getByRole('row', { name: 'renamed.txt', exact: true }).click({ button: 'right' });
    await window.getByRole('menuitem', { name: /Delete/u }).click();
    await window.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(local.getByRole('row', { name: 'renamed.txt', exact: true })).toHaveCount(0);
    await window.getByRole('button', { name: 'Profiles and diagnostics' }).click();
    dialog = window.getByRole('dialog', { name: 'Profiles and diagnostics' });
    await dialog.getByRole('button', { name: 'Import profiles', exact: true }).click();
    await dialog.getByLabel('File contents').fill(
      JSON.stringify({
        version: 1,
        profiles: [
          {
            kind: 'sftp',
            group: 'Servers',
            profile: {
              id: null,
              name: 'Library fixture',
              host: 'fixture.test',
              port: 22,
              username: 'fixture',
              authMode: 'password',
              privateKeyPath: '',
              initialDirectory: '/',
              timeout: 20000,
              keepalive: 10000,
            },
          },
        ],
      }),
    );
    await dialog.getByRole('button', { name: 'Import reviewed contents' }).click();
    await expect(dialog.getByText('Imported: 1 · Skipped: 0 · Conflicts: 0')).toBeVisible();
    await dialog.getByLabel('Search profiles').fill('fixture');
    await dialog
      .getByLabel('Connection profile')
      .selectOption({ label: 'SFTP · Library fixture · Servers' });
    await dialog.getByRole('button', { name: 'Export profiles', exact: true }).click();
    await expect(dialog.getByLabel('File contents')).not.toHaveValue(/safe-storage|ciphertext/u);
    await dialog.getByText('Developer diagnostics', { exact: true }).click();
    await dialog.getByRole('button', { name: 'Export diagnostic report' }).click();
    await expect(dialog.getByLabel('File contents')).not.toHaveValue(
      /fixture.test|Library fixture|safe-storage/u,
    );
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await window.getByLabel('Language', { exact: true }).selectOption('ru');
    await expect(window.getByRole('button', { name: 'Профили и диагностика' })).toBeVisible();
    const menuLabels = await application.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()?.items.map((item) => item.label),
    );
    expect(menuLabels).toEqual(['Файл', 'Правка', 'Вид']);
    await window.screenshot({ path: test.info().outputPath('commander-ru.png') });
    expect(
      await local.locator('.file-list__viewport').evaluate((element) => element.clientHeight),
    ).toBeGreaterThan(80);
  } finally {
    await application?.close();
    await rm(root, { recursive: true, force: true });
    await rm(userData, { recursive: true, force: true });
  }
});

test('multi-file keyboard upload, drag and drop, session streaming, queue restart review and close confirmation', async () => {
  test.skip(process.env.OPENSCP_INTEGRATION !== '1', 'Requires disposable OpenSSH and MinIO.');
  test.setTimeout(90000);
  const root = await mkdtemp(join(tmpdir(), 'openscp-product-transfer-'));
  const userData = await mkdtemp(join(tmpdir(), 'openscp-product-transfer-user-'));
  const prefix = `product-${randomUUID()}/`;
  const fixture = createMinioProvider();
  let application: ElectronApplication | undefined;
  const launch = () =>
    electron.launch({
      args: [
        '--disable-gpu',
        '--in-process-gpu',
        '--no-sandbox',
        `--user-data-dir=${userData}`,
        resolve('out/main/index.js'),
      ],
      env: {
        ...process.env,
        OPENSCP_DISABLE_HARDWARE_ACCELERATION: '1',
        OPENSCP_LOCAL_ROOT: root,
      },
    });
  try {
    await fixture.connect();
    await fixture.createDirectory(createS3ProviderPath('fixture-bucket', prefix));
    await mkdir(join(root, 'downloads'));
    await writeFile(join(root, 'a.txt'), 'a');
    await writeFile(join(root, 'b.txt'), 'b');
    await writeFile(join(root, 'drag.txt'), 'drag');
    application = await launch();
    let window = await application.firstWindow();
    await window.evaluate(async (initialPrefix) => {
      const desktop = Reflect.get(globalThis, 'desktop') as DesktopApi;
      await desktop.workspace({
        action: 'save-s3-profile',
        profile: {
          id: null,
          name: 'Product S3',
          endpoint: 'http://127.0.0.1:29000',
          region: 'us-east-1',
          bucket: 'fixture-bucket',
          initialPrefix,
          forcePathStyle: true,
          accessKeyId: 'fixture-access-only',
        },
        secretAccessKey: 'fixture-secret-only-not-production',
      });
      await desktop.workspace({
        action: 'save-profile',
        profile: {
          id: null,
          name: 'Product SFTP',
          host: '127.0.0.1',
          port: 22222,
          username: 'fixture',
          authMode: 'password',
          privateKeyPath: '',
          initialDirectory: '/home/fixture/data/Unicode каталог',
          timeout: 20000,
          keepalive: 10000,
        },
        secret: 'fixture-password-only',
      });
    }, prefix);
    let local = window.getByRole('tabpanel').getByTestId('local-panel');
    let remote = window.getByRole('tabpanel').getByTestId('remote-panel');
    await remote.getByLabel('Connection profile').selectOption({ label: 'S3 · Product S3' });
    await remote.getByRole('button', { name: 'Connect / test', exact: true }).click();
    await local.getByRole('row', { name: 'a.txt', exact: true }).focus();
    await window.keyboard.press('Shift+ArrowDown');
    await window.keyboard.press('F5');
    await expect(window.getByText(/^Completed ·/u)).toHaveCount(2);
    await local
      .getByRole('row', { name: 'drag.txt', exact: true })
      .dragTo(remote.locator('.commander-surface'));
    await expect(window.getByText(/^Completed ·/u)).toHaveCount(3);
    await writeFile(join(root, 'external.txt'), 'external file fixture');
    await window.evaluate(`(() => {
      const input = document.createElement('input');
      input.type = 'file';
      input.id = 'external-drop-fixture';
      document.body.append(input);
    })()`);
    await window.locator('#external-drop-fixture').setInputFiles(join(root, 'external.txt'));
    const resolvedFilePath = await window.evaluate<string | null>(`(() => {
      const input = document.getElementById('external-drop-fixture');
      const file = input.files?.[0];
      const desktop = Reflect.get(globalThis, 'desktop');
      const path = file ? desktop.getPathForFile?.(file) : undefined;
      if (file) {
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        document
          .querySelector('[data-testid="remote-panel"] .commander-surface')
          ?.dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true }));
      }
      input.remove();
      return path;
    })()`);
    expect(resolvedFilePath).toBe(join(root, 'external.txt'));
    await expect(window.getByText(/^Completed ·/u)).toHaveCount(4);
    await window.getByRole('button', { name: 'New workspace' }).click();
    await remote.getByLabel('Connection profile').selectOption({ label: 'SFTP · Product SFTP' });
    await remote.getByRole('button', { name: 'Connect / test', exact: true }).click();
    await remote.getByRole('button', { name: /Trust/u }).click();
    await expect(remote.getByRole('row', { name: 'привет мир.txt', exact: true })).toBeVisible();
    await remote.getByRole('row', { name: 'привет мир.txt', exact: true }).click();
    await remote.getByRole('button', { name: 'Copy to another session', exact: true }).click();
    const dialog = window.getByRole('dialog', { name: 'Copy to another session' });
    await dialog.getByRole('button', { name: 'Add to queue' }).click();
    await expect(window.getByText(/^Completed ·/u)).toHaveCount(5);
    expect(
      (await fixture.stat(createS3ProviderPath('fixture-bucket', `${prefix}привет мир.txt`))).size,
    ).toBe(13n);
    await window.getByRole('tab', { name: 'S3 · Product S3', exact: true }).click();
    await local.getByRole('row', { name: 'a.txt', exact: true }).click();
    await window.keyboard.press('F5');
    await expect(window.getByText(/^Already exists:/u)).toBeVisible();
    await application.close();
    application = await launch();
    window = await application.firstWindow();
    await expect(window.getByText(/The app stopped before this transfer finished/u)).toBeVisible();
    const state = await window.evaluate(async () => {
      const desktop = Reflect.get(globalThis, 'desktop') as DesktopApi;
      const result = await desktop.workspace({ action: 'snapshot' });
      return result.ok
        ? {
            sessions: result.data.snapshot.sessions.length,
            states: result.data.snapshot.transfers.map((item) => item.state),
          }
        : null;
    });
    expect(state?.sessions).toBe(0);
    expect(state?.states).toContain('requiring-review');
    await window.getByRole('button', { name: 'Close Workspace 1', exact: true }).click();
    await expect(window.getByRole('dialog', { name: 'Close active session?' })).toBeVisible();
    await window.getByRole('button', { name: 'Keep session open' }).click();
    await expect(window.getByRole('tab', { name: 'Workspace 1', exact: true })).toBeVisible();
    await window.getByRole('button', { name: 'Close Workspace 1', exact: true }).click();
    await window.getByRole('button', { name: 'Cancel transfers and close' }).click();
    await expect(window.getByRole('tab', { name: 'Workspace 1', exact: true })).toHaveCount(0);
    await expect(window.getByText(/^Cancelled ·/u)).toBeVisible();
    local = window.getByRole('tabpanel').getByTestId('local-panel');
    remote = window.getByRole('tabpanel').getByTestId('remote-panel');
    await remote.getByLabel('Connection profile').selectOption({ label: 'S3 · Product S3' });
    await remote.getByRole('button', { name: 'Connect / test', exact: true }).click();
    await window.getByLabel('Language', { exact: true }).selectOption('ru');
    await window.screenshot({ path: test.info().outputPath('connected-ru.png') });
    expect(
      await window
        .locator('html')
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    expect(
      await remote.locator('.file-list__viewport').evaluate((element) => element.clientHeight),
    ).toBeGreaterThanOrEqual(80);
    const viewport = await remote.locator('.file-list__viewport').boundingBox();
    const panel = await remote.boundingBox();
    expect(
      viewport && panel
        ? Math.min(viewport.y + viewport.height, panel.y + panel.height) -
            Math.max(viewport.y, panel.y)
        : 0,
    ).toBeGreaterThanOrEqual(70);
  } finally {
    await application?.close();
    await fixture.delete(createS3ProviderPath('fixture-bucket', prefix), { recursive: true });
    await fixture.disconnect();
    await rm(root, { recursive: true, force: true });
    await rm(userData, { recursive: true, force: true });
  }
});
