import { Component, computed, inject, signal } from '@angular/core';
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
  IonNote,
  IonTitle,
  IonToolbar,
  ToastController,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  cloudOfflineOutline,
  cloudOutline,
  checkmarkOutline,
  copyOutline,
  downloadOutline,
  informationCircleOutline,
  keyOutline,
  logInOutline,
  warningOutline,
} from 'ionicons/icons';

import { GarageIdService } from '../../core/services/garage-id.service';
import { GarageStore } from '../../core/services/garage.store';

/**
 * Ajustes del garaje.
 *
 * Lo importante aquí es el identificador: no hay cuentas, así que es lo único
 * que permite abrir el mismo garaje desde otro dispositivo. Se puede copiar y
 * se puede introducir uno existente.
 */
@Component({
  selector: 'app-settings',
  templateUrl: './settings.page.html',
  styleUrl: './settings.page.scss',
  imports: [
    IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon,
    IonItem, IonLabel, IonNote, IonTitle, IonToolbar,
  ],
})
export class SettingsPage {
  private readonly alerts = inject(AlertController);
  private readonly toasts = inject(ToastController);
  private readonly router = inject(Router);
  readonly garageId = inject(GarageIdService);
  readonly store = inject(GarageStore);

  readonly copied = signal(false);

  readonly counts = computed(() => ({
    vehicles: this.store.vehicles().length,
    plans: this.store.plans().length,
    records: this.store.records().length,
  }));

  constructor() {
    addIcons({
      checkmarkOutline, cloudOfflineOutline, cloudOutline, copyOutline,
      downloadOutline,
      informationCircleOutline, keyOutline, logInOutline, warningOutline,
    });
    void this.store.load();
  }

  async copyId(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.garageId.id);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      await this.toast('No se ha podido copiar', 'danger');
    }
  }

  /** Permite abrir un garaje existente introduciendo su identificador. */
  async openExisting(): Promise<void> {
    const alert = await this.alerts.create({
      header: 'Abrir otro garaje',
      message:
        'Pega aquí el identificador del garaje que quieres abrir. El actual ' +
        'seguirá existiendo mientras conserves su identificador.',
      inputs: [
        { name: 'id', type: 'text', placeholder: 'Identificador del garaje' },
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Abrir',
          handler: (data: { id: string }) => {
            void this.adopt(data.id);
          },
        },
      ],
    });
    await alert.present();
  }

  private async adopt(id: string): Promise<void> {
    if (!this.garageId.adopt(id)) {
      await this.toast('Ese identificador no es válido', 'danger');
      return;
    }
    // El estado en memoria es del garaje anterior: hay que recargarlo entero.
    window.location.href = '/garaje';
  }

  /** Descarga una copia de los datos, por si se pierde el identificador. */
  exportData(): void {
    const data = {
      exportedAt: new Date().toISOString(),
      garageId: this.garageId.id,
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

  private async toast(message: string, color: string): Promise<void> {
    const toast = await this.toasts.create({
      message, color, duration: 2500, position: 'top',
    });
    await toast.present();
  }
}
