import { describe, expect, it } from 'vitest';
import { resources } from './resources';

const collectKeys = (value: object, prefix = ''): readonly string[] =>
  Object.entries(value).flatMap(([key, child]) => {
    const fullKey = prefix.length === 0 ? key : `${prefix}.${key}`;
    return typeof child === 'object' && child !== null
      ? collectKeys(child as object, fullKey)
      : [fullKey];
  });

describe('translation resources', () => {
  it('keeps English and Russian translation keys in sync', () => {
    expect([...collectKeys(resources.ru.translation)].sort()).toEqual(
      [...collectKeys(resources.en.translation)].sort(),
    );
  });
});
