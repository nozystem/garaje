import { Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import {
  AlertController,
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonTitle,
  IonToolbar,
  ToastController,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  downloadOutline,
  logOutOutline,
  personCircleOutline,
  trashOutline,
} from 'ionicons/icons';

import { AuthService } from '../../core/services/auth.service';
import { GarageStore } from '../../core/services/garage.store';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.page.html',
  styleUrl: './settings.page.scss',
  imports: [
    IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon,
    IonItem, IonLabel, IonTitle, IonToolbar,
  ],
})
export class SettingsPage {
  private readonly alerts = inject(AlertController);
  private readonly toasts = inject(ToastController);
  private readonly router = inject(Router);
  readonly auth = inject(AuthService);
  readonly store = inject(GarageStore);

  readonly counts = computed(() => ({
    vehicles: this.store.vehicles().length,
    plans: this.store.plans().length,
    records: this.store.records().length,
  }));

  constructor() {
    addIcons({
      downloadOutline, logOutOutline, personCircleOutline, trashOutline,
    });
    void this.store.load();
  }

  /** Descarga una copia de los datos del usuario. */
  exportData(): void {
    const data = {
      exportedAt: new Date().toISOString(),
      account: this.auth.user()?.email,
      vehicles: this.store.vehicles(),
      plans: this.store.plans(),
      records: this.store.records(),
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `garaje-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async logout(): Promise<void> {
    await this.auth.logout();
    this.store.reset();
    void this.router.navigate(['/entrar']);
  }

  async confirmDeleteAccount(): Promise<void> {
    const alert = await this.alerts.create({
      header: '¿Borrar la cuenta?',
      message:
        'Se borrarán tus vehículos, su historial y sus mantenimientos. ' +
        'No se puede deshacer.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Borrar cuenta',
          role: 'destructive',
          handler: () => {
            void this.deleteAccount();
          },
        },
      ],
    });
    await alert.present();
  }

  private async deleteAccount(): Promise<void> {
    try {
      await this.auth.deleteAccount();
      this.store.reset();
      void this.router.navigate(['/entrar']);
    } catch (error) {
      const toast = await this.toasts.create({
        message: AuthService.message(error),
        color: 'danger',
        duration: 3000,
        position: 'top',
      });
      await toast.present();
    }
  }
}
