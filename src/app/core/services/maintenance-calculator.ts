import {
  DueStatus,
  MaintenancePlan,
  PlanStatus,
} from '../models/maintenance.model';
import { Vehicle } from '../models/vehicle.model';

/** A partir de este porcentaje del intervalo consumido, avisamos. */
const DUE_SOON_THRESHOLD = 0.9;
const UPCOMING_THRESHOLD = 0.75;

/** Si no sabemos el uso real del vehículo, asumimos esto para estimar fechas. */
const DEFAULT_MONTHLY_KM = 1000;

const MS_PER_DAY = 86_400_000;
const DAYS_PER_MONTH = 30.44;

/**
 * Evalúa un plan de mantenimiento contra el estado actual del vehículo.
 *
 * Un plan puede vencer por kilómetros, por tiempo, o por ambos. Cuando hay
 * dos criterios manda el que se agote antes, que es como están escritos los
 * libros de mantenimiento ("cada 15.000 km o 12 meses, lo que ocurra antes").
 */
export function evaluatePlan(
  plan: MaintenancePlan,
  vehicle: Vehicle,
  now: Date = new Date()
): PlanStatus {
  const byKm = evaluateByMileage(plan, vehicle);
  const byTime = evaluateByTime(plan, now);

  // El factor limitante es el que va más avanzado hacia su vencimiento.
  let limitingFactor: PlanStatus['limitingFactor'] = 'none';
  let progress = 0;

  if (byKm && byTime) {
    limitingFactor = byKm.progress >= byTime.progress ? 'km' : 'time';
    progress = Math.max(byKm.progress, byTime.progress);
  } else if (byKm) {
    limitingFactor = 'km';
    progress = byKm.progress;
  } else if (byTime) {
    limitingFactor = 'time';
    progress = byTime.progress;
  }

  return {
    plan,
    status: toStatus(progress),
    kmRemaining: byKm?.remaining,
    daysRemaining: byTime?.remaining,
    limitingFactor,
    progress,
    estimatedDueDate: estimateDueDate(byKm?.remaining, byTime?.remaining, vehicle, now),
  };
}

function evaluateByMileage(
  plan: MaintenancePlan,
  vehicle: Vehicle
): { remaining: number; progress: number } | null {
  if (!plan.intervalKm || plan.intervalKm <= 0) {
    return null;
  }

  // Sin registro previo, el intervalo cuenta desde el km actual: el plan
  // acaba de crearse y aún no ha consumido nada.
  const base = plan.lastServiceMileage ?? vehicle.mileage;
  const used = vehicle.mileage - base;

  return {
    remaining: plan.intervalKm - used,
    progress: clamp(used / plan.intervalKm),
  };
}

function evaluateByTime(
  plan: MaintenancePlan,
  now: Date
): { remaining: number; progress: number } | null {
  if (!plan.intervalMonths || plan.intervalMonths <= 0) {
    return null;
  }

  const base = plan.lastServiceDate ?? plan.createdAt;
  const elapsedDays = (now.getTime() - new Date(base).getTime()) / MS_PER_DAY;
  const intervalDays = plan.intervalMonths * DAYS_PER_MONTH;

  return {
    remaining: Math.round(intervalDays - elapsedDays),
    progress: clamp(elapsedDays / intervalDays),
  };
}

/**
 * Proyecta cuándo vencerá el plan. Si manda el kilometraje, se traduce a
 * fecha usando el uso mensual declarado; si manda el tiempo, ya es una fecha.
 */
function estimateDueDate(
  kmRemaining: number | undefined,
  daysRemaining: number | undefined,
  vehicle: Vehicle,
  now: Date
): string | undefined {
  const candidates: number[] = [];

  if (kmRemaining !== undefined) {
    const monthlyKm = vehicle.monthlyMileage || DEFAULT_MONTHLY_KM;
    candidates.push((kmRemaining / monthlyKm) * DAYS_PER_MONTH);
  }

  if (daysRemaining !== undefined) {
    candidates.push(daysRemaining);
  }

  if (!candidates.length) {
    return undefined;
  }

  const days = Math.min(...candidates);
  return new Date(now.getTime() + days * MS_PER_DAY).toISOString();
}

function toStatus(progress: number): DueStatus {
  if (progress >= 1) return 'overdue';
  if (progress >= DUE_SOON_THRESHOLD) return 'due-soon';
  if (progress >= UPCOMING_THRESHOLD) return 'upcoming';
  return 'ok';
}

/** El progreso se limita por abajo a 0, pero no por arriba: pasarse cuenta. */
function clamp(value: number): number {
  return Math.max(0, value);
}

/** Ordena por urgencia: primero lo vencido, luego lo que queda más cerca. */
export function byUrgency(a: PlanStatus, b: PlanStatus): number {
  return b.progress - a.progress;
}
