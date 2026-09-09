import { Component, OnInit, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonContent,
  IonFab,
  IonFabButton,
  IonHeader,
  IonIcon,
  IonList,
  IonRefresher,
  IonRefresherContent,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  addOutline,
  alertCircleOutline,
  batteryHalfOutline,
  bicycleOutline,
  buildOutline,
  busOutline,
  carOutline,
  checkmarkCircleOutline,
  chevronForwardOutline,
  constructOutline,
  discOutline,
  documentTextOutline,
  ellipseOutline,
  funnelOutline,
  settingsOutline,
  shieldCheckmarkOutline,
  syncOutline,
  thermometerOutline,
  waterOutline,
} from 'ionicons/icons';

import { GarageStore } from '../../core/services/garage.store';
import { PlanStatusCardComponent } from '../../shared/plan-status-card.component';
import { VehicleCardComponent } from '../../shared/vehicle-card.component';

@Component({
  selector: 'app-garage',
  templateUrl: './garage.page.html',
  styleUrl: './garage.page.scss',
  imports: [
    IonButton,
    IonButtons,
    IonCard,
    IonCardContent,
    IonContent,
    IonFab,
    IonFabButton,
    IonHeader,
    IonIcon,
    IonList,
    IonRefresher,
    IonRefresherContent,
    IonSpinner,
    IonTitle,
    IonToolbar,
    RouterLink,
    PlanStatusCardComponent,
    VehicleCardComponent,
  ],
})
export class GaragePage implements OnInit {
  private readonly router = inject(Router);
  readonly store = inject(GarageStore);

  readonly hasVehicles = computed(() => this.store.vehicles().length > 0);

  constructor() {
    addIcons({
      addOutline, alertCircleOutline, bicycleOutline, buildOutline,
      busOutline, carOutline,
      checkmarkCircleOutline, chevronForwardOutline, settingsOutline,
      waterOutline, funnelOutline, discOutline, ellipseOutline,
      batteryHalfOutline, thermometerOutline, syncOutline,
      shieldCheckmarkOutline, documentTextOutline, constructOutline,
    });
  }

  ngOnInit(): void {
    void this.store.load();
  }

  async refresh(event: CustomEvent): Promise<void> {
    await this.store.load(true);
    (event.target as HTMLIonRefresherElement).complete();
  }

  vehicleName(vehicleId: string): string {
    return this.store.vehicle(vehicleId)?.nickname ?? '';
  }

  openVehicle(id: string): void {
    void this.router.navigate(['/vehicle', id]);
  }

  completePlan(vehicleId: string, planId: string): void {
    void this.router.navigate(['/vehicle', vehicleId], {
      queryParams: { complete: planId },
    });
  }
}
