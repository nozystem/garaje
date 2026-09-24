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
import { remainingText } from './plan-remaining';
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
    return remainingText(this.status(), this.i18n);
  }
}
