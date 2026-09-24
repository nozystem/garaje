import { describe, expect, it } from 'vitest';

import type { MaintenanceRecord, PlanStatus } from '../core/models/maintenance.model';
import { nextService, plansForRecords } from './service-label';

function status(id: string, changes: Partial<PlanStatus> & { title?: string; category?: string } = {}): PlanStatus {
  const { title = id, category = 'oil', ...rest } = changes;
  return {
    plan: { id, vehicleId: 'v', title, category, active: true, createdAt: '' } as PlanStatus['plan'],
    status: 'ok',
    limitingFactor: 'none',
    progress: 0,
    ...rest,
  };
}

function record(changes: Partial<MaintenanceRecord>): MaintenanceRecord {
  return { id: 'r', vehicleId: 'v', category: 'oil', title: '', date: '', mileage: 0, createdAt: '', ...changes };
}

describe('plansForRecords', () => {
  const oil = status('oil', { title: 'Oil change', category: 'oil' });
  const brakes = status('brakes', { title: 'Brake fluid', category: 'brakes' });
  const pads = status('pads', { title: 'Brake pads', category: 'brakes' });

  it('uses the task a record was logged from', () => {
    expect(plansForRecords([record({ planId: 'pads', category: 'brakes' })], [oil, brakes, pads])).toEqual([pads]);
  });

  it('matches a hand-written record by name, then by category', () => {
    expect(plansForRecords([record({ title: 'oil change ' })], [oil, brakes])).toEqual([oil]);
    expect(plansForRecords([record({ title: 'Discs', category: 'brakes' })], [oil, brakes, pads])).toEqual([brakes, pads]);
  });
});

describe('nextService', () => {
  const now = Date.parse('2026-01-01T00:00:00Z');

  it('takes the nearest mileage and date across the tasks', () => {
    const next = nextService(
      [
        status('a', { kmRemaining: 15_000, estimatedDueDate: '2027-04-01T00:00:00Z' }),
        status('b', { kmRemaining: 5_000, estimatedDueDate: '2026-06-01T00:00:00Z' }),
      ],
      250_000,
      1000,
      now
    );
    expect(next).toEqual({ km: 255_000, date: '2026-06-01T00:00:00.000Z' });
  });

  it('estimates the mileage of a time-only task from the monthly distance', () => {
    expect(nextService([status('itv', { daysRemaining: 365 })], 250_000, 1000, now).km).toBe(261_991);
  });
});
