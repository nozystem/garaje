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

/**
 * Una tarea de mantenimiento con su estado.
 *
 * Muestra el criterio que manda (kilómetros o tiempo) porque es la
 * información que decide si hay que ir al taller: no es lo mismo que falten
 * 500 km que que falten dos meses.
 */
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
  /** En la portada no se editan tareas: solo desde la ficha del vehículo. */
  readonly editable = input(false);

  readonly complete = output<PlanStatus>();
  readonly edit = output<PlanStatus>();
  readonly remove = output<PlanStatus>();

  /** La barra se llena a tope aunque el plan esté pasado de largo. */
  get progressValue(): number {
    return Math.min(1, this.status().progress);
  }

  get remainingText(): string {
    const s = this.status();

    if (s.limitingFactor === 'km' && s.kmRemaining !== undefined) {
      return s.kmRemaining < 0
        ? `Pasado ${this.formatKm(-s.kmRemaining)}`
        : `Faltan ${this.formatKm(s.kmRemaining)}`;
    }

    if (s.limitingFactor === 'time' && s.daysRemaining !== undefined) {
      return s.daysRemaining < 0
        ? `Vencido hace ${this.formatDays(-s.daysRemaining)}`
        : `Faltan ${this.formatDays(s.daysRemaining)}`;
    }

    return 'Sin vencimiento';
  }

  private formatKm(km: number): string {
    return new Intl.NumberFormat('es-ES').format(Math.round(km)) + ' km';
  }

  private formatDays(days: number): string {
    const d = Math.round(days);
    if (d < 31) return `${d} día${d === 1 ? '' : 's'}`;
    const months = Math.round(d / 30.44);
    return `${months} mes${months === 1 ? '' : 'es'}`;
  }
}
