import { describe, expect, it } from 'vitest';

import { sanitizeReceipt } from './receipt-scan.ts';

describe('sanitizeReceipt', () => {
  it('keeps what makes sense and drops the rest', () => {
    expect(
      sanitizeReceipt({
        title: '  Cambio de aceite y filtro ',
        category: 'oil',
        date: '2026-05-10',
        mileage: 84_000.4,
        cost: 129.9,
        workshop: 'Talleres Pepe',
        parts: 'Aceite 5W30, filtro',
      })
    ).toEqual({
      title: 'Cambio de aceite y filtro',
      category: 'oil',
      date: '2026-05-10',
      mileage: 84_000,
      cost: 129.9,
      workshop: 'Talleres Pepe',
      parts: 'Aceite 5W30, filtro',
    });
  });

  it('turns anything invalid into null, and an unknown category into other', () => {
    expect(
      sanitizeReceipt({ title: '', category: 'rockets', date: '10/05/2026', mileage: -5, cost: 'free' })
    ).toEqual({
      title: null, category: 'other', date: null, mileage: null, cost: null, workshop: null, parts: null,
    });
  });
});
