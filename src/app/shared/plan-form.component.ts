import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonSelect,
  IonSelectOption,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';

import { addIcons } from 'ionicons';
import {
  batteryHalfOutline, constructOutline, discOutline, documentTextOutline,
  ellipseOutline, funnelOutline, informationCircleOutline,
  shieldCheckmarkOutline, syncOutline, thermometerOutline, waterOutline,
} from 'ionicons/icons';

import { MAINTENANCE_PRESETS, presetsFor } from '../core/data/maintenance-presets';
import {
  MaintenanceCategory,
  MaintenancePlan,
} from '../core/models/maintenance.model';
import { Vehicle } from '../core/models/vehicle.model';
import { CategoryIconPipe, CategoryLabelPipe } from './status.pipe';

export type PlanDraft = Omit<MaintenancePlan, 'id' | 'createdAt'>;

@Component({
  selector: 'app-plan-form',
  templateUrl: './plan-form.component.html',
  styleUrl: './plan-form.component.scss',
  imports: [
    ReactiveFormsModule,
    IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonInput,
    IonItem, IonSelect, IonSelectOption, IonTitle, IonToolbar,
    CategoryIconPipe, CategoryLabelPipe,
  ],
})
export class PlanFormComponent implements OnInit {
  private readonly fb = inject(FormBuilder);

  readonly vehicle = input.required<Vehicle>();
  readonly editing = input<MaintenancePlan | null>(null);

  readonly planSaved = output<PlanDraft>();
  readonly dismissed = output<void>();

  readonly submitted = signal(false);
  readonly usedPreset = signal<string | null>(null);

  readonly categories = [...new Set(MAINTENANCE_PRESETS.map((p) => p.category))];

  constructor() {
    addIcons({
      batteryHalfOutline, constructOutline, discOutline, documentTextOutline,
      ellipseOutline, funnelOutline, informationCircleOutline,
      shieldCheckmarkOutline, syncOutline, thermometerOutline, waterOutline,
    });
  }

  readonly form = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(120)]],
    category: ['oil' as MaintenanceCategory, Validators.required],
    intervalKm: [null as number | null],
    intervalMonths: [null as number | null],
    lastServiceMileage: [null as number | null],
    lastServiceDate: [''],
  });

  get presets() {
    return presetsFor(this.vehicle().type, this.vehicle().fuel);
  }

  ngOnInit(): void {
    const plan = this.editing();
    if (!plan) return;

    this.form.patchValue({
      title: plan.title,
      category: plan.category,
      intervalKm: plan.intervalKm ?? null,
      intervalMonths: plan.intervalMonths ?? null,
      lastServiceMileage: plan.lastServiceMileage ?? null,
      lastServiceDate: plan.lastServiceDate?.slice(0, 10) ?? '',
    });
  }

  applyPreset(preset: (typeof MAINTENANCE_PRESETS)[number]): void {
    this.usedPreset.set(preset.title);
    this.form.patchValue({
      title: preset.title,
      category: preset.category,
      intervalKm: preset.intervalKm ?? null,
      intervalMonths: preset.intervalMonths ?? null,
    });
  }

  get missingInterval(): boolean {
    const { intervalKm, intervalMonths } = this.form.getRawValue();
    return !intervalKm && !intervalMonths;
  }

  invalid(field: string): boolean {
    const control = this.form.get(field);
    return !!control && control.invalid && (control.touched || this.submitted());
  }

  onSubmit(): void {
    this.submitted.set(true);

    if (this.form.invalid || this.missingInterval) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();
    this.planSaved.emit({
      vehicleId: this.vehicle().id,
      title: value.title,
      category: value.category,
      intervalKm: value.intervalKm ?? undefined,
      intervalMonths: value.intervalMonths ?? undefined,
      lastServiceMileage: value.lastServiceMileage ?? undefined,
      lastServiceDate: value.lastServiceDate
        ? new Date(value.lastServiceDate).toISOString()
        : undefined,
      active: true,
      notes: this.editing()?.notes,
    });
  }
}
