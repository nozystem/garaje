import { Component, input, output } from '@angular/core';
import {
  IonBadge,
  IonCard,
  IonCardContent,
  IonIcon,
  IonNote,
} from '@ionic/angular';

import { PlanStatus } from '../core/models/maintenance.model';
import { Vehicle } from '../core/models/vehicle.model';
import { KmPipe } from './status.pipe';

import { TranslatePipe } from '../core/i18n/i18n.pipes';
import { CarIllustrationComponent } from './car-illustration.component';
@Component({
  selector: 'app-vehicle-card',
  templateUrl: './vehicle-card.component.html',
  styleUrl: './vehicle-card.component.scss',
  imports: [
    CarIllustrationComponent, IonBadge, IonCard, IonCardContent, IonIcon, IonNote, KmPipe,
    TranslatePipe,
  ],
})
export class VehicleCardComponent {
  readonly vehicle = input.required<Vehicle>();
  readonly alerts = input<PlanStatus[]>([]);

  readonly open = output<string>();

  get overdue(): number {
    return this.alerts().filter((a) => a.status === 'overdue').length;
  }

  get dueSoon(): number {
    return this.alerts().filter((a) => a.status === 'due-soon').length;
  }

  get typeIcon(): string {
    switch (this.vehicle().type) {
      case 'motorcycle': return 'bicycle-outline';
      case 'van': return 'bus-outline';
      default: return 'car-outline';
    }
  }
}
