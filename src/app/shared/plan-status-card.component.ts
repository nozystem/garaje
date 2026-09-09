import { DatePipe } from '@angular/common';
import { Component, input, output } from '@angular/core';
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
    DatePipe,
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

    if (s.limitingFactor === 'km' && s.kmRemaining !== undefined) {
      return s.kmRemaining < 0
        ? `${this.formatKm(-s.kmRemaining)} over`
        : `${this.formatKm(s.kmRemaining)} left`;
    }

    if (s.limitingFactor === 'time' && s.daysRemaining !== undefined) {
      return s.daysRemaining < 0
        ? `Overdue by ${this.formatDays(-s.daysRemaining)}`
        : `${this.formatDays(s.daysRemaining)} left`;
    }

    return 'No due date';
  }

  private formatKm(km: number): string {
    return new Intl.NumberFormat('en-GB').format(Math.round(km)) + ' km';
  }

  private formatDays(days: number): string {
    const d = Math.round(days);
    if (d < 31) return `${d} day${d === 1 ? '' : 's'}`;
    const months = Math.round(d / 30.44);
    return `${months} month${months === 1 ? '' : 's'}`;
  }
}
