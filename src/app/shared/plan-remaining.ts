import { I18n } from '../core/i18n/i18n.service';
import { PlanStatus } from '../core/models/maintenance.model';

/** "Faltan 3.200 km", "Vencido hace 2 meses"…: lo que queda para una tarea. */
export function remainingText(status: PlanStatus, i18n: I18n): string {
  const km = (value: number) =>
    new Intl.NumberFormat(i18n.locale()).format(Math.round(value)) + ' km';

  if (status.limitingFactor === 'km' && status.kmRemaining !== undefined) {
    return status.kmRemaining < 0
      ? i18n.t('plan.kmOver', { km: km(-status.kmRemaining) })
      : i18n.t('plan.kmLeft', { km: km(status.kmRemaining) });
  }

  if (status.limitingFactor === 'time' && status.daysRemaining !== undefined) {
    return status.daysRemaining < 0
      ? i18n.t('plan.overdueBy', { time: duration(-status.daysRemaining, i18n) })
      : i18n.t('plan.timeLeft', { time: duration(status.daysRemaining, i18n) });
  }

  return i18n.t('plan.noDue');
}

function duration(days: number, i18n: I18n): string {
  const d = Math.round(days);
  if (d < 31) return i18n.t(d === 1 ? 'unit.day' : 'unit.days', { n: d });
  const months = Math.round(d / 30.44);
  return i18n.t(months === 1 ? 'unit.month' : 'unit.months', { n: months });
}
