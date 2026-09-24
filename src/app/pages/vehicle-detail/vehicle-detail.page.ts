import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  AlertController,
  IonBackButton,
  IonModal,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonSegment,
  IonSegmentButton,
  IonSpinner,
  IonTitle,
  IonToolbar,
  ToastController,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  addOutline, alertCircleOutline, batteryHalfOutline, bicycleOutline,
  busOutline, calendarOutline, carSportOutline, cashOutline, checkmarkCircleOutline,
  checkmarkOutline, constructOutline, createOutline, discOutline,
  documentTextOutline, ellipseOutline, funnelOutline, speedometerOutline,
  shieldCheckmarkOutline, sparklesOutline, syncOutline, thermometerOutline, timeOutline,
  trashOutline, waterOutline,
} from 'ionicons/icons';

import { MaintenancePlan, MaintenanceRecord, PlanStatus } from '../../core/models/maintenance.model';
import { LocalDatePipe, TranslatePipe } from '../../core/i18n/i18n.pipes';
import { I18n } from '../../core/i18n/i18n.service';
import { GarageStore } from '../../core/services/garage.store';
import { CarIllustrationComponent } from '../../shared/car-illustration.component';
import { PlanDraft, PlanFormComponent } from '../../shared/plan-form.component';
import { PlanStatusCardComponent } from '../../shared/plan-status-card.component';
import { PlanSuggestionsComponent } from '../../shared/plan-suggestions.component';
import { downloadServiceLabel } from '../../shared/service-label';
import {
  CategoryIconPipe,
  CategoryLabelPipe,
  KmPipe,
} from '../../shared/status.pipe';

type Tab = 'plans' | 'history';

@Component({
  selector: 'app-vehicle-detail',
  templateUrl: './vehicle-detail.page.html',
  styleUrl: './vehicle-detail.page.scss',
  imports: [
    CarIllustrationComponent, LocalDatePipe, RouterLink, TranslatePipe,
    IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon,
    IonItem, IonLabel, IonList, IonModal, IonNote, IonSegment,
    IonSegmentButton, IonSpinner, IonTitle, IonToolbar,
    PlanFormComponent, PlanStatusCardComponent, PlanSuggestionsComponent,
    CategoryIconPipe, CategoryLabelPipe, KmPipe,
  ],
})
export class VehicleDetailPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly alerts = inject(AlertController);
  private readonly toasts = inject(ToastController);
  readonly store = inject(GarageStore);
  private readonly i18n = inject(I18n);

  readonly vehicleId = signal<string>('');
  readonly tab = signal<Tab>('plans');

  readonly planModalOpen = signal(false);
  readonly aiPlanOpen = signal(false);
  readonly editingPlan = signal<MaintenancePlan | null>(null);

  readonly vehicle = computed(() => this.store.vehicle(this.vehicleId()));
  readonly plans = computed(() => this.store.plansFor(this.vehicleId()));
  readonly records = computed(() => this.store.recordsFor(this.vehicleId()));

  readonly overdue = computed(
    () => this.plans().filter((p) => p.status === 'overdue').length
  );

  readonly totalSpent = computed(() =>
    this.records().reduce((sum, r) => sum + (r.cost ?? 0), 0)
  );

  constructor() {
    addIcons({
      addOutline, alertCircleOutline, batteryHalfOutline, bicycleOutline,
      busOutline, calendarOutline, carSportOutline, cashOutline, checkmarkCircleOutline,
      checkmarkOutline, constructOutline, createOutline, discOutline,
      documentTextOutline, ellipseOutline, funnelOutline, speedometerOutline,
      shieldCheckmarkOutline, sparklesOutline, syncOutline, thermometerOutline, timeOutline,
      trashOutline, waterOutline,
    });
  }

  async ngOnInit(): Promise<void> {
    this.vehicleId.set(this.route.snapshot.paramMap.get('id') ?? '');
    await this.store.load();

    if (!this.vehicle()) {
      void this.router.navigate(['/garage']);
      return;
    }

    const planId = this.route.snapshot.queryParamMap.get('complete');
    if (planId) {
      const status = this.plans().find((p) => p.plan.id === planId);
      if (status) await this.completePlan(status);
    }
  }

  get typeIcon(): string {
    switch (this.vehicle()?.type) {
      case 'motorcycle': return 'bicycle-outline';
      case 'van': return 'bus-outline';
      default: return 'car-sport-outline';
    }
  }

  async completePlan(status: PlanStatus): Promise<void> {
    const vehicle = this.vehicle();
    if (!vehicle) return;

    const alert = await this.alerts.create({
      header: status.plan.title,
      message: this.i18n.t('detail.doneAt'),
      inputs: [
        {
          name: 'mileage',
          type: 'number',
          value: vehicle.mileage,
          placeholder: this.i18n.t('detail.km'),
        },
        { name: 'cost', type: 'number', placeholder: this.i18n.t('detail.cost') },
        { name: 'workshop', type: 'text', placeholder: this.i18n.t('detail.workshop') },
      ],
      buttons: [
        { text: this.i18n.t('common.cancel'), role: 'cancel' },
        {
          text: this.i18n.t('detail.logIt'),
          handler: (data) => {
            void this.registerCompletion(status, data);
          },
        },
      ],
    });
    await alert.present();
  }

  private async registerCompletion(
    status: PlanStatus,
    data: { mileage?: string; cost?: string; workshop?: string }
  ): Promise<void> {
    const mileage = Number(data.mileage);
    if (!Number.isFinite(mileage) || mileage < 0) {
      await this.toast(this.i18n.t('detail.badMileage'), 'danger');
      return;
    }

    try {
      await this.store.addRecord({
        vehicleId: this.vehicleId(),
        planId: status.plan.id,
        category: status.plan.category,
        title: status.plan.title,
        date: new Date().toISOString(),
        mileage,
        cost: data.cost ? Number(data.cost) : undefined,
        workshop: data.workshop || undefined,
      });
      await this.toast(this.i18n.t('detail.logged'), 'success');
    } catch (error) {
      await this.toast((error as Error).message, 'danger');
    }
  }

  openPlanForm(plan: MaintenancePlan | null = null): void {
    this.editingPlan.set(plan);
    this.planModalOpen.set(true);
  }

  closePlanForm(): void {
    this.planModalOpen.set(false);
    this.editingPlan.set(null);
  }

  /** Añade las tareas elegidas del plan de la IA, una tras otra. */
  async addSuggestedPlans(drafts: PlanDraft[]): Promise<void> {
    this.aiPlanOpen.set(false);
    let added = 0;
    try {
      for (const draft of drafts) {
        await this.store.addPlan(draft);
        added++;
      }
      await this.toast(this.i18n.t('detail.plansAdded', { n: added }), 'success');
    } catch (error) {
      await this.toast((error as Error).message, 'danger');
    }
  }

  async savePlan(draft: PlanDraft): Promise<void> {
    try {
      const editing = this.editingPlan();
      if (editing) {
        await this.store.updatePlan(editing.id, draft);
        await this.toast(this.i18n.t('detail.planUpdated'), 'success');
      } else {
        await this.store.addPlan(draft);
        await this.toast(this.i18n.t('detail.planAdded'), 'success');
      }
      this.closePlanForm();
    } catch (error) {
      await this.toast((error as Error).message, 'danger');
    }
  }

  async confirmDeletePlan(status: PlanStatus): Promise<void> {
    const alert = await this.alerts.create({
      header: this.i18n.t('detail.removePlanTitle'),
      message: this.i18n.t('detail.removePlanText', { title: status.plan.title }),
      buttons: [
        { text: this.i18n.t('common.cancel'), role: 'cancel' },
        {
          text: this.i18n.t('common.remove'),
          role: 'destructive',
          handler: () => {
            void this.removePlan(status.plan.id);
          },
        },
      ],
    });
    await alert.present();
  }

  private async removePlan(id: string): Promise<void> {
    try {
      await this.store.removePlan(id);
      await this.toast(this.i18n.t('detail.planRemoved'), 'success');
    } catch (error) {
      await this.toast((error as Error).message, 'danger');
    }
  }

  async confirmDelete(): Promise<void> {
    const alert = await this.alerts.create({
      header: this.i18n.t('detail.deleteTitle'),
      message: this.i18n.t('detail.deleteText'),
      buttons: [
        { text: this.i18n.t('common.cancel'), role: 'cancel' },
        {
          text: this.i18n.t('common.delete'),
          role: 'destructive',
          handler: () => {
            void this.remove();
          },
        },
      ],
    });
    await alert.present();
  }

  private async remove(): Promise<void> {
    try {
      await this.store.removeVehicle(this.vehicleId());
      await this.toast(this.i18n.t('detail.deleted'), 'success');
      void this.router.navigate(['/garage']);
    } catch (error) {
      await this.toast((error as Error).message, 'danger');
    }
  }

  async illustrate(id: string): Promise<void> {
    try {
      await this.store.illustrate(id);
    } catch (error) {
      await this.toast((error as Error).message, 'danger');
    }
  }

  /**
   * Etiqueta en PDF de la visita a la que pertenece el registro: todo lo
   * hecho ese día, con el próximo mantenimiento de esas tareas.
   */
  async downloadLabel(record: MaintenanceRecord): Promise<void> {
    const vehicle = this.vehicle();
    if (!vehicle) return;

    const day = record.date.slice(0, 10);
    const records = this.records().filter((r) => r.date.slice(0, 10) === day);
    const plans = new Set(records.map((r) => r.planId).filter(Boolean));
    const statuses = this.plans().filter((s) => plans.has(s.plan.id));

    const kms = statuses
      .filter((s) => s.kmRemaining !== undefined)
      .map((s) => vehicle.mileage + s.kmRemaining!);
    const dates = statuses
      .filter((s) => s.daysRemaining !== undefined)
      .map((s) => Date.now() + s.daysRemaining! * 86_400_000);

    try {
      await downloadServiceLabel(
        {
          vehicle,
          records,
          nextKm: kms.length ? Math.min(...kms) : undefined,
          nextDate: dates.length ? new Date(Math.min(...dates)).toISOString() : undefined,
        },
        this.i18n
      );
    } catch {
      await this.toast(this.i18n.t('detail.labelFailed'), 'danger');
    }
  }

  async deleteRecord(id: string): Promise<void> {
    try {
      await this.store.removeRecord(id);
      await this.toast(this.i18n.t('detail.recordDeleted'), 'success');
    } catch (error) {
      await this.toast((error as Error).message, 'danger');
    }
  }

  private async toast(message: string, color: string): Promise<void> {
    const toast = await this.toasts.create({
      // Los errores del servidor llegan en inglés; los ya traducidos no cambian.
      message: this.i18n.serverMessage(message), color, duration: 2500, position: 'top',
    });
    await toast.present();
  }
}
