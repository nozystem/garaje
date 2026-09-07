import { DatePipe } from '@angular/common';
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
  shieldCheckmarkOutline, syncOutline, thermometerOutline, timeOutline,
  trashOutline, waterOutline,
} from 'ionicons/icons';

import { MaintenancePlan, PlanStatus } from '../../core/models/maintenance.model';
import { GarageStore } from '../../core/services/garage.store';
import { PlanDraft, PlanFormComponent } from '../../shared/plan-form.component';
import { PlanStatusCardComponent } from '../../shared/plan-status-card.component';
import {
  CategoryIconPipe,
  CategoryLabelPipe,
  KmPipe,
} from '../../shared/status.pipe';

type Tab = 'plans' | 'history';

/**
 * Ficha de un vehículo: su estado, los mantenimientos pendientes y el
 * historial de lo ya hecho.
 */
@Component({
  selector: 'app-vehicle-detail',
  templateUrl: './vehicle-detail.page.html',
  styleUrl: './vehicle-detail.page.scss',
  imports: [
    DatePipe, RouterLink,
    IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon,
    IonItem, IonLabel, IonList, IonModal, IonNote, IonSegment,
    IonSegmentButton, IonSpinner, IonTitle, IonToolbar,
    PlanFormComponent, PlanStatusCardComponent,
    CategoryIconPipe, CategoryLabelPipe, KmPipe,
  ],
})
export class VehicleDetailPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly alerts = inject(AlertController);
  private readonly toasts = inject(ToastController);
  readonly store = inject(GarageStore);

  readonly vehicleId = signal<string>('');
  readonly tab = signal<Tab>('plans');

  /** Modal de alta y edición de tareas. */
  readonly planModalOpen = signal(false);
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
      shieldCheckmarkOutline, syncOutline, thermometerOutline, timeOutline,
      trashOutline, waterOutline,
    });
  }

  async ngOnInit(): Promise<void> {
    this.vehicleId.set(this.route.snapshot.paramMap.get('id') ?? '');
    await this.store.load();

    if (!this.vehicle()) {
      void this.router.navigate(['/garaje']);
    }
  }

  get typeIcon(): string {
    switch (this.vehicle()?.type) {
      case 'motorcycle': return 'bicycle-outline';
      case 'van': return 'bus-outline';
      default: return 'car-sport-outline';
    }
  }

  /** Cierra una tarea: pide el kilometraje y registra la intervención. */
  async completePlan(status: PlanStatus): Promise<void> {
    const vehicle = this.vehicle();
    if (!vehicle) return;

    const alert = await this.alerts.create({
      header: status.plan.title,
      message: '¿A qué kilometraje se ha hecho?',
      inputs: [
        {
          name: 'mileage',
          type: 'number',
          value: vehicle.mileage,
          placeholder: 'Kilómetros',
        },
        { name: 'cost', type: 'number', placeholder: 'Coste (opcional)' },
        { name: 'workshop', type: 'text', placeholder: 'Taller (opcional)' },
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Registrar',
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
      await this.toast('El kilometraje no es válido', 'danger');
      return;
    }

    try {
      // El servidor reprograma el plan y actualiza el cuentakilómetros.
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
      await this.toast('Mantenimiento registrado', 'success');
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

  async savePlan(draft: PlanDraft): Promise<void> {
    try {
      const editing = this.editingPlan();
      if (editing) {
        await this.store.updatePlan(editing.id, draft);
        await this.toast('Tarea actualizada', 'success');
      } else {
        await this.store.addPlan(draft);
        await this.toast('Tarea añadida', 'success');
      }
      this.closePlanForm();
    } catch (error) {
      await this.toast((error as Error).message, 'danger');
    }
  }

  async confirmDeletePlan(status: PlanStatus): Promise<void> {
    const alert = await this.alerts.create({
      header: '¿Quitar la tarea?',
      message: `"${status.plan.title}" dejará de avisarte. El historial se conserva.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Quitar',
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
      await this.toast('Tarea quitada', 'success');
    } catch (error) {
      await this.toast((error as Error).message, 'danger');
    }
  }

  async confirmDelete(): Promise<void> {
    const alert = await this.alerts.create({
      header: '¿Borrar el vehículo?',
      message:
        'Se borrarán también su historial y sus mantenimientos. No se puede deshacer.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Borrar',
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
      await this.toast('Vehículo borrado', 'success');
      void this.router.navigate(['/garaje']);
    } catch (error) {
      await this.toast((error as Error).message, 'danger');
    }
  }

  async deleteRecord(id: string): Promise<void> {
    try {
      await this.store.removeRecord(id);
      await this.toast('Registro borrado', 'success');
    } catch (error) {
      await this.toast((error as Error).message, 'danger');
    }
  }

  private async toast(message: string, color: string): Promise<void> {
    const toast = await this.toasts.create({
      message, color, duration: 2500, position: 'top',
    });
    await toast.present();
  }
}
