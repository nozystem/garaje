import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonContent,
  IonFab,
  IonFabButton,
  IonFooter,
  IonHeader,
  IonIcon,
  IonList,
  IonRefresher,
  IonRefresherContent,
  IonSpinner,
  IonTitle,
  IonToolbar,
  AlertController,
  ToastController,
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
  trashOutline,
  shieldCheckmarkOutline,
  syncOutline,
  thermometerOutline,
  waterOutline,
} from 'ionicons/icons';

import { TranslatePipe } from '../../core/i18n/i18n.pipes';
import { I18n } from '../../core/i18n/i18n.service';
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
    IonFooter,
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
    TranslatePipe,
  ],
})
export class GaragePage implements OnInit {
  private readonly router = inject(Router);
  private readonly alerts = inject(AlertController);
  private readonly toasts = inject(ToastController);
  readonly store = inject(GarageStore);
  readonly i18n = inject(I18n);

  readonly hasVehicles = computed(() => this.store.vehicles().length > 0);

  /** Selección múltiple para borrar varios coches a la vez. */
  readonly selecting = signal(false);
  readonly selected = signal<ReadonlySet<string>>(new Set());
  readonly deleting = signal(false);

  constructor() {
    addIcons({
      addOutline, alertCircleOutline, bicycleOutline, buildOutline,
      busOutline, carOutline,
      checkmarkCircleOutline, chevronForwardOutline, settingsOutline, trashOutline,
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
    if (this.selecting()) {
      this.selected.update((ids) => {
        const next = new Set(ids);
        if (!next.delete(id)) next.add(id);
        return next;
      });
      return;
    }
    void this.router.navigate(['/vehicle', id]);
  }

  selectAll(): void {
    this.selected.set(new Set(this.store.vehicles().map((v) => v.id)));
  }

  stopSelecting(): void {
    this.selecting.set(false);
    this.selected.set(new Set());
  }

  async confirmDelete(): Promise<void> {
    const n = this.selected().size;
    const alert = await this.alerts.create({
      header: this.i18n.t(n === 1 ? 'garage.deleteTitleOne' : 'garage.deleteTitleMany', { n }),
      message: this.i18n.t('garage.deleteText'),
      buttons: [
        { text: this.i18n.t('common.cancel'), role: 'cancel' },
        { text: this.i18n.t('common.delete'), role: 'destructive', handler: () => void this.deleteSelected() },
      ],
    });
    await alert.present();
  }

  private async deleteSelected(): Promise<void> {
    this.deleting.set(true);
    const ids = [...this.selected()];
    let deleted = 0;
    try {
      for (const id of ids) {
        await this.store.removeVehicle(id);
        deleted++;
      }
      this.stopSelecting();
      await this.toast(
        this.i18n.t(deleted === 1 ? 'garage.deletedOne' : 'garage.deletedMany', { n: deleted }),
        'success'
      );
    } catch (error) {
      // Los ya borrados salen de la selección; el resto sigue marcado.
      this.selected.set(new Set(ids.slice(deleted)));
      await this.toast(this.i18n.serverMessage((error as Error).message), 'danger');
    } finally {
      this.deleting.set(false);
    }
  }

  private async toast(message: string, color: string): Promise<void> {
    const toast = await this.toasts.create({ message, color, duration: 2500, position: 'top' });
    await toast.present();
  }

  completePlan(vehicleId: string, planId: string): void {
    void this.router.navigate(['/vehicle', vehicleId], {
      queryParams: { complete: planId },
    });
  }
}
