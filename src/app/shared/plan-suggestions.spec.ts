import { describe, expect, it } from 'vitest';

import type { SuggestedTask } from '../core/services/api.service';
import { SuggestionRow, lastService } from './plan-suggestions.logic';

function row(task: Partial<SuggestedTask>, changes: Partial<SuggestionRow> = {}): SuggestionRow {
  return {
    task: { category: 'oil', title: 'Oil', intervalKm: null, intervalMonths: null, why: '', ...task },
    include: true,
    tracked: false,
    state: 'unknown',
    doneKm: null,
    doneDate: '',
    ...changes,
  };
}

describe('lastService', () => {
  it('assumes an unknown task was done on time, at its last interval', () => {
    expect(lastService(row({ intervalKm: 15000 }), 250_000)).toEqual({ mileage: 240_000 });
  });

  it('counts a recent task from the current mileage and today', () => {
    const last = lastService(row({ intervalKm: 15000 }, { state: 'recent' }), 250_000);
    expect(last.mileage).toBe(250_000);
    expect(last.date?.slice(0, 10)).toBe(new Date().toISOString().slice(0, 10));
  });

  it('uses the mileage given for a task done at a known point', () => {
    expect(lastService(row({ intervalKm: 90000 }, { state: 'at', doneKm: 180_000 }), 250_000))
      .toEqual({ mileage: 180_000 });
  });

  it('uses the date given for a task that only goes by time', () => {
    const last = lastService(row({ intervalMonths: 12 }, { state: 'at', doneDate: '2026-03-01' }), 250_000);
    expect(last.date?.slice(0, 10)).toBe('2026-03-01');
  });
});
