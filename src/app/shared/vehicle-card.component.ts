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

@Component({
  selector: 'app-vehicle-card',
  templateUrl: './vehicle-card.component.html',
  styleUrl: './vehicle-card.component.scss',
  imports: [IonBadge, IonCard, IonCardContent, IonIcon, IonNote, KmPipe],
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

  get fuelLabel(): string {
    switch (this.vehicle().fuel) {
      case 'diesel': return 'Diesel';
      case 'electric': return 'Electric';
      case 'hybrid': return 'Hybrid';
      default: return 'Petrol';
    }
  }
}
