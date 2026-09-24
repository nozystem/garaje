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
  IonSegment,
  IonSegmentButton,
  IonTitle,
  IonToolbar,
  ToastController,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  downloadOutline,
  logOutOutline,
  personCircleOutline,
  statsChartOutline,
  trashOutline,
} from 'ionicons/icons';

import { TranslatePipe } from '../../core/i18n/i18n.pipes';
import { I18n, LANGUAGES } from '../../core/i18n/i18n.service';
import { AuthService } from '../../core/services/auth.service';
import { GarageStore } from '../../core/services/garage.store';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.page.html',
  styleUrl: './settings.page.scss',
  imports: [
    IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon,
    IonItem, IonLabel, IonSegment, IonSegmentButton, IonTitle, IonToolbar, TranslatePipe,
  ],
})
export class SettingsPage {
  private readonly alerts = inject(AlertController);
  private readonly toasts = inject(ToastController);
  private readonly router = inject(Router);
  readonly auth = inject(AuthService);
  readonly store = inject(GarageStore);
  readonly i18n = inject(I18n);
  readonly languages = LANGUAGES;

  readonly counts = computed(() => ({
    vehicles: this.store.vehicles().length,
    plans: this.store.plans().length,
    records: this.store.records().length,
  }));

  constructor() {
    addIcons({
      downloadOutline, logOutOutline, personCircleOutline, statsChartOutline, trashOutline,
    });
    void this.store.load();
  }

  openAdmin(): void {
    void this.router.navigate(['/admin']);
  }

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
    link.download = `garage-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async logout(): Promise<void> {
    await this.auth.logout();
    this.store.reset();
    void this.router.navigate(['/sign-in']);
  }

  async confirmDeleteAccount(): Promise<void> {
    const alert = await this.alerts.create({
      header: this.i18n.t('settings.deleteTitle'),
      message: this.i18n.t('settings.deleteText'),
      buttons: [
        { text: this.i18n.t('common.cancel'), role: 'cancel' },
        {
          text: this.i18n.t('settings.deleteConfirm'),
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
      void this.router.navigate(['/sign-in']);
    } catch (error) {
      const toast = await this.toasts.create({
        message: this.i18n.serverMessage(AuthService.message(error)),
        color: 'danger',
        duration: 3000,
        position: 'top',
      });
      await toast.present();
    }
  }
}
