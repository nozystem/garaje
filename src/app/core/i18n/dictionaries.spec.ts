import { describe, expect, it } from 'vitest';

import { en, TranslationKey } from './en';
import { es } from './es';

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('translations', () => {
  const keys = Object.keys(en) as TranslationKey[];

  it('has a Spanish text for every key', () => {
    for (const key of keys) expect(es[key]?.trim(), key).toBeTruthy();
  });

  it('keeps the same placeholders in both languages', () => {
    for (const key of keys) expect(placeholders(es[key]), key).toEqual(placeholders(en[key]));
  });
});
