import {
  DueStatus,
  MaintenancePlan,
  PlanStatus,
} from '../models/maintenance.model';
import { Vehicle } from '../models/vehicle.model';

const DUE_SOON_THRESHOLD = 0.9;
const UPCOMING_THRESHOLD = 0.75;

const DEFAULT_MONTHLY_KM = 1000;

const MS_PER_DAY = 86_400_000;
const DAYS_PER_MONTH = 30.44;

export function evaluatePlan(
  plan: MaintenancePlan,
  vehicle: Vehicle,
  now: Date = new Date()
): PlanStatus {
  const byKm = evaluateByMileage(plan, vehicle);
  const byTime = evaluateByTime(plan, now);

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

function clamp(value: number): number {
  return Math.max(0, value);
}

export function byUrgency(a: PlanStatus, b: PlanStatus): number {
  return b.progress - a.progress;
}
