import { Component, ElementRef, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonSegment,
  IonSegmentButton,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonTextarea,
  IonTitle,
  IonToolbar,
  ToastController,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  addOutline,
  batteryChargingOutline,
  bicycleOutline,
  busOutline,
  cameraOutline,
  carSportOutline,
  checkmarkOutline,
  flashOutline,
  informationCircleOutline,
  leafOutline,
  saveOutline,
  waterOutline,
} from 'ionicons/icons';

import { FuelType, VehicleType } from '../../core/models/vehicle.model';
import { CatalogMake, CatalogService } from '../../core/services/catalog.service';
import { PhotoService } from '../../core/services/photo.service';
import { GarageStore } from '../../core/services/garage.store';

const COLORS = [
  '#e74c3c', '#4d9de0', '#2ec27e', '#f5a623',
  '#9b59b6', '#16a085', '#5d6d7e', '#e67e22',
];

const TYPE_OPTIONS: { value: VehicleType; label: string; icon: string }[] = [
  { value: 'car', label: 'Car', icon: 'car-sport-outline' },
  { value: 'motorcycle', label: 'Motorbike', icon: 'bicycle-outline' },
  { value: 'van', label: 'Van', icon: 'bus-outline' },
];

const FUEL_OPTIONS: { value: FuelType; label: string; icon: string }[] = [
  { value: 'gasoline', label: 'Petrol', icon: 'water-outline' },
  { value: 'diesel', label: 'Diesel', icon: 'flash-outline' },
  { value: 'hybrid', label: 'Hybrid', icon: 'leaf-outline' },
  { value: 'electric', label: 'Electric', icon: 'battery-charging-outline' },
];

@Component({
  selector: 'app-vehicle-form',
  templateUrl: './vehicle-form.page.html',
  styleUrl: './vehicle-form.page.scss',
  imports: [
    ReactiveFormsModule,
    IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon,
    IonInput, IonItem, IonLabel, IonList, IonNote, IonSegment,
    IonSegmentButton, IonSelect, IonSelectOption, IonSpinner, IonTextarea,
    IonTitle, IonToolbar,
  ],
})
export class VehicleFormPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toasts = inject(ToastController);
  readonly store = inject(GarageStore);
  readonly catalog = inject(CatalogService);
  private readonly photos = inject(PhotoService);

  readonly colors = COLORS;
  readonly typeOptions = TYPE_OPTIONS;
  readonly fuelOptions = FUEL_OPTIONS;
  readonly saving = signal(false);
  readonly processingPhoto = signal(false);

  private readonly photoInput = viewChild<ElementRef<HTMLInputElement>>('photoInput');
  readonly editingId = signal<string | null>(null);
  readonly submitted = signal(false);

  readonly selectedType = signal<VehicleType>('car');
  readonly selectedMake = signal<string>('');

  readonly availableMakes = signal<CatalogMake[]>([]);

  readonly availableModels = computed(() =>
    this.catalog.modelsFor(this.availableMakes(), this.selectedMake())
  );

  readonly typeIcon = computed(
    () =>
      TYPE_OPTIONS.find((o) => o.value === this.selectedType())?.icon ??
      'car-sport-outline'
  );

  readonly form = this.fb.nonNullable.group({
    nickname: ['', [Validators.required, Validators.maxLength(60)]],
    type: ['car' as VehicleType, Validators.required],
    make: ['', Validators.required],
    model: ['', Validators.required],
    year: [
      new Date().getFullYear(),
      [Validators.required, Validators.min(1900), Validators.max(new Date().getFullYear() + 1)],
    ],
    fuel: ['gasoline' as FuelType, Validators.required],
    plate: [''],
    mileage: [0, [Validators.required, Validators.min(0)]],
    monthlyMileage: [1000, [Validators.min(0), Validators.max(20000)]],
    color: [COLORS[0]],
    photo: [''],
    notes: [''],
  });

  constructor() {
    addIcons({
      addOutline, batteryChargingOutline, bicycleOutline, busOutline,
      cameraOutline, carSportOutline, checkmarkOutline, flashOutline,
      informationCircleOutline, leafOutline, saveOutline, waterOutline,
    });
  }

  async ngOnInit(): Promise<void> {
    await Promise.all([this.store.load(), this.loadMakes('car')]);

    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return;

    const vehicle = this.store.vehicle(id);
    if (!vehicle) {
      void this.router.navigate(['/garage']);
      return;
    }

    this.editingId.set(id);
    this.selectedType.set(vehicle.type);
    this.selectedMake.set(vehicle.make);
    if (vehicle.type !== 'car') await this.loadMakes(vehicle.type);
    this.form.patchValue({
      nickname: vehicle.nickname,
      type: vehicle.type,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      fuel: vehicle.fuel,
      plate: vehicle.plate ?? '',
      mileage: vehicle.mileage,
      monthlyMileage: vehicle.monthlyMileage ?? 1000,
      color: vehicle.color ?? COLORS[0],
      photo: vehicle.photo ?? '',
      notes: vehicle.notes ?? '',
    });
  }

  async onTypeChange(type: VehicleType): Promise<void> {
    this.selectedType.set(type);
    this.form.patchValue({ type, make: '', model: '' });
    this.selectedMake.set('');
    await this.loadMakes(type);
  }

  private async loadMakes(type: VehicleType): Promise<void> {
    this.availableMakes.set(await this.catalog.makesFor(type));
  }

  onMakeChange(make: string): void {
    this.selectedMake.set(make);
    this.form.patchValue({ make, model: '' });
  }

  pickPhoto(): void {
    this.photoInput()?.nativeElement.click();
  }

  async onPhotoSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.processingPhoto.set(true);
    try {
      this.form.patchValue({ photo: await this.photos.process(file) });
    } catch (error) {
      await this.toast((error as Error).message, 'danger');
    } finally {
      this.processingPhoto.set(false);
      input.value = '';
    }
  }

  removePhoto(): void {
    this.form.patchValue({ photo: '' });
  }

  invalid(field: string): boolean {
    const control = this.form.get(field);
    return !!control && control.invalid && (control.touched || this.submitted());
  }

  async save(): Promise<void> {
    this.submitted.set(true);

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      await this.toast('Check the highlighted fields', 'warning');
      return;
    }

    this.saving.set(true);
    const value = this.form.getRawValue();

    try {
      const id = this.editingId();
      if (id) {
        await this.store.updateVehicle(id, value);
        await this.toast('Vehicle updated', 'success');
        void this.router.navigate(['/vehicle', id]);
      } else {
        const created = await this.store.addVehicle(value);
        await this.toast('Vehicle added', 'success');
        void this.router.navigate(['/vehicle', created.id]);
      }
    } catch (error) {
      await this.toast((error as Error).message, 'danger');
    } finally {
      this.saving.set(false);
    }
  }

  private async toast(message: string, color: string): Promise<void> {
    const toast = await this.toasts.create({ message, color, duration: 2500, position: 'top' });
    await toast.present();
  }
}
