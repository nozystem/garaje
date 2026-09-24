import { Component, computed, inject, input, output } from '@angular/core';
import { IonBadge, IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  calendarOutline,
  checkmarkCircle,
  constructOutline,
  ellipseOutline,
  speedometerOutline,
} from 'ionicons/icons';

import { LocalDatePipe, TranslatePipe } from '../core/i18n/i18n.pipes';
import { I18n } from '../core/i18n/i18n.service';
import { PlanStatus } from '../core/models/maintenance.model';
import { Vehicle } from '../core/models/vehicle.model';
import { CarIllustrationComponent } from './car-illustration.component';
import { remainingText } from './plan-remaining';
import { KmPipe, StatusColorPipe } from './status.pipe';

/**
 * Tarjeta de un coche en la cuadrícula del garaje: su imagen y, debajo, lo
 * que importa de un vistazo (kilómetros y el próximo mantenimiento).
 */
@Component({
  selector: 'app-vehicle-card',
  templateUrl: './vehicle-card.component.html',
  styleUrl: './vehicle-card.component.scss',
  imports: [
    CarIllustrationComponent, IonBadge, IonIcon, KmPipe, LocalDatePipe, StatusColorPipe,
    TranslatePipe,
  ],
})
export class VehicleCardComponent {
  private readonly i18n = inject(I18n);

  readonly vehicle = input.required<Vehicle>();
  /** Tareas del coche, de la más urgente a la menos. */
  readonly plans = input<PlanStatus[]>([]);
  /** En modo selección, tocar la tarjeta la marca en vez de abrir el coche. */
  readonly selectable = input(false);
  readonly selected = input(false);

  readonly open = output<string>();

  readonly overdue = computed(() => this.plans().filter((p) => p.status === 'overdue').length);
  readonly dueSoon = computed(() => this.plans().filter((p) => p.status === 'due-soon').length);

  /** La tarea más urgente: la que toca antes. */
  readonly next = computed(() => this.plans()[0] ?? null);

  readonly nextRemaining = computed(() => {
    const next = this.next();
    return next ? remainingText(next, this.i18n) : '';
  });

  constructor() {
    addIcons({ calendarOutline, checkmarkCircle, constructOutline, ellipseOutline, speedometerOutline });
  }
}
