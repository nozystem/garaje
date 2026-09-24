import { Component, inject, input, output } from '@angular/core';
import {
  IonBadge,
  IonButton,
  IonIcon,
  IonItem,
  IonItemOption,
  IonItemOptions,
  IonItemSliding,
  IonLabel,
  IonNote,
  IonProgressBar,
} from '@ionic/angular';

import { LocalDatePipe, TranslatePipe } from '../core/i18n/i18n.pipes';
import { I18n } from '../core/i18n/i18n.service';
import { PlanStatus } from '../core/models/maintenance.model';
import {
  CategoryIconPipe,
  CategoryLabelPipe,
  KmPipe,
  StatusColorPipe,
  StatusLabelPipe,
} from './status.pipe';

@Component({
  selector: 'app-plan-status-card',
  templateUrl: './plan-status-card.component.html',
  styleUrl: './plan-status-card.component.scss',
  imports: [
    LocalDatePipe,
    TranslatePipe,
    IonBadge,
    IonButton,
    IonIcon,
    IonItem,
    IonItemOption,
    IonItemOptions,
    IonItemSliding,
    IonLabel,
    IonNote,
    IonProgressBar,
    CategoryIconPipe,
    CategoryLabelPipe,
    KmPipe,
    StatusColorPipe,
    StatusLabelPipe,
  ],
})
export class PlanStatusCardComponent {
  private readonly i18n = inject(I18n);

  readonly status = input.required<PlanStatus>();
  readonly showVehicle = input(false);
  readonly vehicleName = input<string>('');
  readonly editable = input(false);

  readonly complete = output<PlanStatus>();
  readonly edit = output<PlanStatus>();
  readonly remove = output<PlanStatus>();

  get progressValue(): number {
    return Math.min(1, this.status().progress);
  }

  get remainingText(): string {
    const s = this.status();
    const t = this.i18n.t.bind(this.i18n);

    if (s.limitingFactor === 'km' && s.kmRemaining !== undefined) {
      return s.kmRemaining < 0
        ? t('plan.kmOver', { km: this.formatKm(-s.kmRemaining) })
        : t('plan.kmLeft', { km: this.formatKm(s.kmRemaining) });
    }

    if (s.limitingFactor === 'time' && s.daysRemaining !== undefined) {
      return s.daysRemaining < 0
        ? t('plan.overdueBy', { time: this.formatDays(-s.daysRemaining) })
        : t('plan.timeLeft', { time: this.formatDays(s.daysRemaining) });
    }

    return t('plan.noDue');
  }

  private formatKm(km: number): string {
    return new Intl.NumberFormat(this.i18n.locale()).format(Math.round(km)) + ' km';
  }

  private formatDays(days: number): string {
    const d = Math.round(days);
    if (d < 31) return this.i18n.t(d === 1 ? 'unit.day' : 'unit.days', { n: d });
    const months = Math.round(d / 30.44);
    return this.i18n.t(months === 1 ? 'unit.month' : 'unit.months', { n: months });
  }
}
