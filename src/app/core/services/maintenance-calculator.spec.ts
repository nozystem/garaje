import { describe, expect, it } from 'vitest';

import { MaintenancePlan } from '../models/maintenance.model';
import { Vehicle } from '../models/vehicle.model';
import { byUrgency, evaluatePlan } from './maintenance-calculator';

const NOW = new Date('2026-06-01T12:00:00.000Z');

function vehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 'v1',
    nickname: 'Coche',
    make: 'Seat',
    model: 'León',
    year: 2018,
    type: 'car',
    fuel: 'diesel',
    mileage: 100_000,
    mileageUpdatedAt: NOW.toISOString(),
    monthlyMileage: 1000,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function plan(overrides: Partial<MaintenancePlan> = {}): MaintenancePlan {
  return {
    id: 'p1',
    vehicleId: 'v1',
    category: 'oil',
    title: 'Cambio de aceite',
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('evaluatePlan · vencimiento por kilómetros', () => {
  it('marca ok cuando apenas se ha consumido el intervalo', () => {
    const result = evaluatePlan(
      plan({ intervalKm: 15_000, lastServiceMileage: 95_000 }),
      vehicle({ mileage: 100_000 }),
      NOW
    );

    expect(result.status).toBe('ok');
    expect(result.kmRemaining).toBe(10_000);
    expect(result.limitingFactor).toBe('km');
  });

  it('avisa cuando queda poco para el límite', () => {
    const result = evaluatePlan(
      plan({ intervalKm: 15_000, lastServiceMileage: 86_000 }),
      vehicle({ mileage: 100_000 }),
      NOW
    );

    expect(result.status).toBe('due-soon');
    expect(result.kmRemaining).toBe(1_000);
  });

  it('marca vencido y devuelve kilómetros negativos al pasarse', () => {
    const result = evaluatePlan(
      plan({ intervalKm: 15_000, lastServiceMileage: 80_000 }),
      vehicle({ mileage: 100_000 }),
      NOW
    );

    expect(result.status).toBe('overdue');
    expect(result.kmRemaining).toBe(-5_000);
    expect(result.progress).toBeGreaterThan(1);
  });

  it('cuenta desde el kilometraje actual si nunca se hizo el servicio', () => {
    const result = evaluatePlan(
      plan({ intervalKm: 15_000 }),
      vehicle({ mileage: 100_000 }),
      NOW
    );

    expect(result.kmRemaining).toBe(15_000);
    expect(result.status).toBe('ok');
  });
});

describe('evaluatePlan · vencimiento por tiempo', () => {
  it('calcula los días restantes desde el último servicio', () => {
    const result = evaluatePlan(
      plan({ intervalMonths: 12, lastServiceDate: '2026-01-01T12:00:00.000Z' }),
      vehicle(),
      NOW
    );

    expect(result.limitingFactor).toBe('time');
    expect(result.daysRemaining).toBeGreaterThan(200);
    expect(result.daysRemaining).toBeLessThan(220);
  });

  it('marca vencido cuando ha pasado más tiempo del intervalo', () => {
    const result = evaluatePlan(
      plan({ intervalMonths: 6, lastServiceDate: '2025-01-01T00:00:00.000Z' }),
      vehicle(),
      NOW
    );

    expect(result.status).toBe('overdue');
    expect(result.daysRemaining).toBeLessThan(0);
  });
});

describe('evaluatePlan · cuando aplican los dos criterios', () => {
  it('manda el kilometraje si se agota antes', () => {
    const result = evaluatePlan(
      plan({
        intervalKm: 15_000,
        intervalMonths: 12,
        lastServiceMileage: 86_000,
        lastServiceDate: '2026-05-01T12:00:00.000Z',
      }),
      vehicle({ mileage: 100_000 }),
      NOW
    );

    expect(result.limitingFactor).toBe('km');
    expect(result.status).toBe('due-soon');
  });

  it('manda el tiempo si se agota antes', () => {
    const result = evaluatePlan(
      plan({
        intervalKm: 15_000,
        intervalMonths: 12,
        lastServiceMileage: 99_000,
        lastServiceDate: '2025-03-01T12:00:00.000Z',
      }),
      vehicle({ mileage: 100_000 }),
      NOW
    );

    expect(result.limitingFactor).toBe('time');
    expect(result.status).toBe('overdue');
    expect(result.daysRemaining).toBeLessThan(0);
  });
});

describe('evaluatePlan · estimación de fecha', () => {
  it('proyecta la fecha usando el uso mensual del vehículo', () => {
    const result = evaluatePlan(
      plan({ intervalKm: 10_000, lastServiceMileage: 95_000 }),
      vehicle({ mileage: 100_000, monthlyMileage: 1000 }),
      NOW
    );

    const due = new Date(result.estimatedDueDate!);
    const months = (due.getTime() - NOW.getTime()) / (30.44 * 86_400_000);
    expect(months).toBeGreaterThan(4.5);
    expect(months).toBeLessThan(5.5);
  });

  it('un plan sin intervalos no vence nunca', () => {
    const result = evaluatePlan(plan(), vehicle(), NOW);

    expect(result.limitingFactor).toBe('none');
    expect(result.status).toBe('ok');
    expect(result.estimatedDueDate).toBeUndefined();
  });
});

describe('byUrgency', () => {
  it('coloca primero lo más consumido', () => {
    const v = vehicle({ mileage: 100_000 });
    const statuses = [
      evaluatePlan(plan({ id: 'a', intervalKm: 15_000, lastServiceMileage: 95_000 }), v, NOW),
      evaluatePlan(plan({ id: 'b', intervalKm: 15_000, lastServiceMileage: 80_000 }), v, NOW),
      evaluatePlan(plan({ id: 'c', intervalKm: 15_000, lastServiceMileage: 88_000 }), v, NOW),
    ].sort(byUrgency);

    expect(statuses.map((s) => s.plan.id)).toEqual(['b', 'c', 'a']);
  });
});
