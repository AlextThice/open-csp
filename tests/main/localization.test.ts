// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';
import { resources } from '../../src/renderer/src/i18n/resources';
import { menuResources } from '../../src/shared/localization/menu-resources';
import { formatDate, formatSize } from '../../src/renderer/src/i18n/format';

const keys = (object: object, prefix = ''): string[] =>
  Object.entries(object).flatMap(([key, value]) =>
    typeof value === 'object' && value !== null
      ? keys(value as object, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
describe('localization CI contract', () => {
  it('rejects missing and extra resource keys, including native menus', () => {
    expect(keys(resources.en.translation).sort()).toEqual(keys(resources.ru.translation).sort());
    expect(keys(menuResources.en).sort()).toEqual(keys(menuResources.ru).sort());
  });
  it('resolves all literal translation keys used in renderer source', () => {
    const available = new Set(keys(resources.en.translation));
    const visit = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) visit(path);
        else if (path.endsWith('.tsx') && !path.endsWith('.test.tsx')) {
          const source = readFileSync(path, 'utf8');
          for (const match of source.matchAll(/\bt\(['"]([\w.-]+)['"]/gu)) {
            const key = match[1] ?? '';
            expect(available.has(key) || available.has(`${key}_other`), `${path}: ${key}`).toBe(
              true,
            );
          }
        }
      }
    };
    visit(resolve('src/renderer/src'));
  });
  it('uses Russian plural forms and locale-specific number and date formats', async () => {
    const i18n = createInstance();
    await i18n.init({ resources, lng: 'ru', fallbackLng: 'en' });
    expect(i18n.t('commander.selected', { count: 1 })).toBe('Выбран 1 элемент');
    expect(i18n.t('commander.selected', { count: 2 })).toBe('Выбрано 2 элемента');
    expect(i18n.t('commander.selected', { count: 5 })).toBe('Выбрано 5 элементов');
    expect(formatSize(1536n, 'ru')).toContain('1,5');
    expect(formatSize(1536n, 'en')).toContain('1.5');
    expect(formatDate('2026-09-04T12:00:00Z', 'ru')).not.toBe(
      formatDate('2026-09-04T12:00:00Z', 'en'),
    );
    await i18n.changeLanguage('en');
    expect(i18n.t('library.close')).toBe('Close');
  });
});
