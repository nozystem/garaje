import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import {
  MaintenancePlan,
  MaintenanceRecord,
  PlanStatus,
} from '../models/maintenance.model';
import { Vehicle, VehicleDraft } from '../models/vehicle.model';
import { ApiService } from './api.service';
import { byUrgency, evaluatePlan } from './maintenance-calculator';

@Injectable({ providedIn: 'root' })
export class GarageStore {
  private readonly api = inject(ApiService);

  private readonly _vehicles = signal<Vehicle[]>([]);
  private readonly _records = signal<MaintenanceRecord[]>([]);
  private readonly _plans = signal<MaintenancePlan[]>([]);
  private readonly _loading = signal(false);
  private readonly _loaded = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly vehicles = this._vehicles.asReadonly();
  readonly records = this._records.asReadonly();
  readonly plans = this._plans.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly loaded = this._loaded.asReadonly();
  readonly error = this._error.asReadonly();

  readonly planStatuses = computed<PlanStatus[]>(() => {
    const vehiclesById = new Map(this._vehicles().map((v) => [v.id, v]));

    return this._plans()
      .filter((plan) => plan.active)
      .map((plan) => {
        const vehicle = vehiclesById.get(plan.vehicleId);
        return vehicle ? evaluatePlan(plan, vehicle) : null;
      })
      .filter((status): status is PlanStatus => status !== null)
      .sort(byUrgency);
  });

  readonly alerts = computed(() =>
    this.planStatuses().filter(
      (s) => s.status === 'overdue' || s.status === 'due-soon'
    )
  );

  readonly overdueCount = computed(
    () => this.planStatuses().filter((s) => s.status === 'overdue').length
  );

  readonly totalSpent = computed(() =>
    this._records().reduce((sum, r) => sum + (r.cost ?? 0), 0)
  );

  vehicle(id: string): Vehicle | undefined {
    return this._vehicles().find((v) => v.id === id);
  }

  recordsFor(vehicleId: string): MaintenanceRecord[] {
    return this._records()
      .filter((r) => r.vehicleId === vehicleId)
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  plansFor(vehicleId: string): PlanStatus[] {
    return this.planStatuses().filter((s) => s.plan.vehicleId === vehicleId);
  }

  alertsFor(vehicleId: string): PlanStatus[] {
    return this.alerts().filter((s) => s.plan.vehicleId === vehicleId);
  }

  async load(force = false): Promise<void> {
    if (this._loading() || (this._loaded() && !force)) return;

    this._loading.set(true);
    this._error.set(null);

    try {
      const snapshot = await firstValueFrom(this.api.loadGarage());

      this._vehicles.set(snapshot.vehicles);
      this._records.set(snapshot.records);
      this._plans.set(snapshot.plans);
      this._loaded.set(true);
    } catch (error) {
      this._error.set((error as Error).message);
    } finally {
      this._loading.set(false);
    }
  }

  async addVehicle(draft: VehicleDraft): Promise<Vehicle> {
    const vehicle = await firstValueFrom(this.api.createVehicle(draft));
    this._vehicles.update((list) => [...list, vehicle]);
    return vehicle;
  }

  async updateVehicle(id: string, draft: VehicleDraft): Promise<Vehicle> {
    const updated = await firstValueFrom(this.api.updateVehicle(id, draft));
    this._vehicles.update((list) => list.map((v) => (v.id === id ? updated : v)));
    return updated;
  }

  async removeVehicle(id: string): Promise<void> {
    await firstValueFrom(this.api.deleteVehicle(id));
    this._vehicles.update((list) => list.filter((v) => v.id !== id));
    this._records.update((list) => list.filter((r) => r.vehicleId !== id));
    this._plans.update((list) => list.filter((p) => p.vehicleId !== id));
  }

  async addRecord(
    record: Omit<MaintenanceRecord, 'id' | 'createdAt'>
  ): Promise<void> {
    await firstValueFrom(this.api.createRecord(record));
    await this.load(true);
  }

  async removeRecord(id: string): Promise<void> {
    await firstValueFrom(this.api.deleteRecord(id));
    this._records.update((list) => list.filter((r) => r.id !== id));
  }

  async addPlan(plan: Omit<MaintenancePlan, 'id' | 'createdAt'>): Promise<void> {
    const created = await firstValueFrom(this.api.createPlan(plan));
    this._plans.update((list) => [...list, created]);
  }

  async updatePlan(id: string, changes: Partial<MaintenancePlan>): Promise<void> {
    const current = this._plans().find((p) => p.id === id);
    if (!current) return;

    const updated = await firstValueFrom(
      this.api.updatePlan(id, { ...current, ...changes })
    );
    this._plans.update((list) => list.map((p) => (p.id === id ? updated : p)));
  }

  reset(): void {
    this._vehicles.set([]);
    this._records.set([]);
    this._plans.set([]);
    this._loaded.set(false);
    this._error.set(null);
  }

  async removePlan(id: string): Promise<void> {
    await firstValueFrom(this.api.deletePlan(id));
    this._plans.update((list) => list.filter((p) => p.id !== id));
  }
}
