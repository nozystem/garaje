import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import {
  IonButton,
  IonButtons,
  IonCheckbox,
  IonContent,
  IonHeader,
  IonIcon,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { sparklesOutline } from 'ionicons/icons';
import { firstValueFrom } from 'rxjs';

import { LocalDatePipe, TranslatePipe } from '../core/i18n/i18n.pipes';
import { I18n } from '../core/i18n/i18n.service';
import { MaintenancePlan } from '../core/models/maintenance.model';
import { Vehicle } from '../core/models/vehicle.model';
import { ApiService } from '../core/services/api.service';
import { PlanDraft } from './plan-form.component';
import { DoneState, SuggestionRow, lastService } from './plan-suggestions.logic';
import { CategoryIconPipe, KmPipe } from './status.pipe';


/**
 * Plan de mantenimiento propuesto por la IA para el coche, en tabla: el
 * usuario elige qué tareas añadir y, para cada una, si sabe cuándo se hizo.
 */
@Component({
  selector: 'app-plan-suggestions',
  templateUrl: './plan-suggestions.component.html',
  styleUrl: './plan-suggestions.component.scss',
  imports: [
    CategoryIconPipe, IonButton, IonButtons, IonCheckbox, IonContent, IonHeader, IonIcon,
    IonSpinner, IonTitle, IonToolbar, KmPipe, LocalDatePipe, TranslatePipe,
  ],
})
export class PlanSuggestionsComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly i18n = inject(I18n);

  readonly vehicle = input.required<Vehicle>();
  readonly existing = input<MaintenancePlan[]>([]);

  readonly accepted = output<PlanDraft[]>();
  readonly dismissed = output<void>();

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly rows = signal<SuggestionRow[]>([]);

  readonly selected = computed(() => this.rows().filter((r) => r.include).length);

  readonly today = new Date().toISOString().slice(0, 10);
  readonly states: DoneState[] = ['unknown', 'recent', 'at'];

  constructor() {
    addIcons({ sparklesOutline });
  }

  async ngOnInit(): Promise<void> {
    const known = new Set(this.existing().map((p) => normalize(p.title)));
    try {
      const { tasks } = await firstValueFrom(this.api.suggestPlan(this.vehicle().id, this.i18n.lang()));
      this.rows.set(
        tasks.map((task) => {
          const tracked = known.has(normalize(task.title));
          return { task, include: !tracked, tracked, state: 'unknown', doneKm: null, doneDate: '' };
        })
      );
    } catch (error) {
      this.error.set(this.i18n.serverMessage((error as Error).message));
    } finally {
      this.loading.set(false);
    }
  }

  update(index: number, changes: Partial<SuggestionRow>): void {
    this.rows.update((rows) => rows.map((row, i) => (i === index ? { ...row, ...changes } : row)));
  }

  /** Cuándo tocará, con lo que el usuario ha dicho de la última vez. */
  next(row: SuggestionRow): { km?: number; date?: string } {
    const { intervalKm, intervalMonths } = row.task;
    const last = lastService(row, this.vehicle().mileage);

    if (intervalKm) return { km: (last.mileage ?? this.vehicle().mileage) + intervalKm };

    const from = last.date ? new Date(last.date) : new Date();
    from.setMonth(from.getMonth() + (intervalMonths ?? 0));
    return { date: from.toISOString() };
  }

  accept(): void {
    const vehicle = this.vehicle();
    this.accepted.emit(
      this.rows()
        .filter((row) => row.include)
        .map((row) => {
          const last = lastService(row, vehicle.mileage);
          return {
            vehicleId: vehicle.id,
            category: row.task.category,
            title: row.task.title,
            intervalKm: row.task.intervalKm ?? undefined,
            intervalMonths: row.task.intervalMonths ?? undefined,
            lastServiceMileage: last.mileage,
            lastServiceDate: last.date,
            notes: row.task.why || undefined,
            active: true,
          };
        })
    );
  }
}


function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}
