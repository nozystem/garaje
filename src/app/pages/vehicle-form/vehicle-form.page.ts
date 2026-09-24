import {
  Component,
  ElementRef,
  OnInit,
  Signal,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { debounceTime, distinctUntilChanged, from, map, of, switchMap } from 'rxjs';
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
  IonModal,
  IonSearchbar,
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
  cameraOutline,
  carSportOutline,
  checkmarkOutline,
  chevronExpandOutline,
  flashOutline,
  informationCircleOutline,
  leafOutline,
  saveOutline,
  waterOutline,
} from 'ionicons/icons';

import { FuelType, Vehicle, VehicleType } from '../../core/models/vehicle.model';
import {
  CatalogMake,
  CatalogService,
  FacetFilters,
  FacetName,
  Facets,
  FacetValue,
  Generation,
} from '../../core/services/catalog.service';
import { PhotoService } from '../../core/services/photo.service';
import { GarageStore } from '../../core/services/garage.store';
import { BodyIconComponent } from '../../shared/body-icon.component';
import {
  CarIllustrationComponent,
  PAINTABLE_ILLUSTRATION_VERSION,
} from '../../shared/car-illustration.component';
import { MakeLogoComponent } from '../../shared/make-logo.component';

// Las ilustraciones se pintan en el navegador, así que cualquier color vale:
// estos son atajos, y hay un selector libre para el resto.
const COLORS = [
  '#e74c3c', '#4d9de0', '#2ec27e', '#f5a623',
  '#9b59b6', '#16a085', '#5d6d7e', '#e67e22',
  '#f4f4f4', '#b9bdc3', '#1f2023',
];

/** Para poner la marca de elegido en oscuro sobre los colores claros. */
function isLight(hex: string): boolean {
  const n = parseInt(hex.replace('#', ''), 16);
  const luminance = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return luminance > 170;
}

/** Para buscar sin distinguir mayúsculas ni tildes: "citro" encuentra Citroën. */
function normalize(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

const TRANSMISSION_LABELS: Record<string, string> = {
  manual: 'Manual',
  automatic: 'Automatic',
  automated_manual: 'Automated manual',
  dual_clutch: 'Dual clutch',
  cvt: 'CVT',
};

/** Motores que se muestran como máximo, de los más comunes a los menos. */
const MAX_ENGINES = 18;

type Picker = 'make' | 'model';

function label(value: string): string {
  const text = value.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Etiqueta corta de una generación: "2 generation facelift" pasa a
 * "Mk2 facelift"; los códigos de chasis ("E46", "Mk5/A5") se dejan tal cual.
 */
function generationLabel(value: string): string {
  return value.replace(/^(\d+) generation/i, 'Mk$1');
}

function values(list: FacetValue[] | undefined): string[] {
  return (list ?? []).map((v) => v.value);
}

const FUEL_OPTIONS: { value: FuelType; label: string; icon: string }[] = [
  { value: 'gasoline', label: 'Petrol', icon: 'water-outline' },
  { value: 'diesel', label: 'Diesel', icon: 'flash-outline' },
  { value: 'hybrid', label: 'Hybrid', icon: 'leaf-outline' },
  { value: 'electric', label: 'Electric', icon: 'battery-charging-outline' },
];

type FormValue = ReturnType<VehicleFormPage['form']['getRawValue']>;

@Component({
  selector: 'app-vehicle-form',
  templateUrl: './vehicle-form.page.html',
  styleUrl: './vehicle-form.page.scss',
  imports: [
    ReactiveFormsModule,
    IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon,
    IonInput, IonItem, IonLabel, IonModal, IonSearchbar,
    IonSpinner, IonTextarea, IonTitle, IonToolbar,
    BodyIconComponent, CarIllustrationComponent, MakeLogoComponent,
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
  readonly fuelOptions = FUEL_OPTIONS;
  readonly saving = signal(false);
  readonly processingPhoto = signal(false);

  private readonly photoInput = viewChild<ElementRef<HTMLInputElement>>('photoInput');
  readonly editingId = signal<string | null>(null);
  private readonly editing = signal<Vehicle | null>(null);
  /** Ilustración que no existe en la caché, para no insistir en mostrarla. */
  readonly missingIllustration = signal<string | null>(null);
  readonly isLight = isLight;
  readonly submitted = signal(false);

  readonly selectedMake = signal<string>('');

  readonly availableMakes = signal<CatalogMake[]>([]);

  readonly picker = signal<Picker | null>(null);
  readonly pickerQuery = signal('');
  /** El modelo no está en la lista y se escribe a mano. */
  readonly customModel = signal(false);

  readonly filteredMakes = computed(() => {
    const query = normalize(this.pickerQuery());
    const makes = this.availableMakes();
    return query ? makes.filter((m) => normalize(m.name).includes(query)) : makes;
  });

  readonly selectedMakeSlug = computed(
    () =>
      this.availableMakes().find(
        (m) => m.name.toLowerCase() === this.selectedMake().trim().toLowerCase()
      )?.slug
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
    generation: [''],
    body: [''],
    transmission: [''],
    engine: [''],
    plate: [''],
    mileage: [0, [Validators.required, Validators.min(0)]],
    monthlyMileage: [1000, [Validators.min(0), Validators.max(20000)]],
    color: [COLORS[0]],
    photo: [''],
    notes: [''],
  });

  private readonly value = toSignal(
    this.form.valueChanges.pipe(map(() => this.form.getRawValue())),
    { initialValue: this.form.getRawValue() }
  );

  // Cada paso pregunta a API Ninjas solo con lo elegido en los anteriores,
  // así cada lista ofrece lo que existe para ese coche.
  private readonly modelFacets = this.facetsFor(['model'], (v) =>
    v.make ? { make: v.make } : null
  );
  private readonly bodyFacets = this.facetsFor(['body'], (v) =>
    v.make && v.model ? { make: v.make, model: v.model, generation: v.generation } : null
  );
  private readonly fuelFacets = this.facetsFor(['fuel'], (v) =>
    v.make && v.model
      ? { make: v.make, model: v.model, generation: v.generation, body: v.body }
      : null
  );
  private readonly specFacets = this.facetsFor(['transmission', 'badge'], (v) =>
    v.make && v.model
      ? { make: v.make, model: v.model, generation: v.generation, body: v.body, fuel: v.fuel }
      : null
  );

  /** Generaciones del modelo elegido, de la más antigua a la más reciente. */
  readonly generations = toSignal(
    toObservable(
      computed(() => {
        const { make, model } = this.value();
        return make && model && !this.customModel() ? JSON.stringify([make, model]) : null;
      })
    ).pipe(
      distinctUntilChanged(),
      switchMap((key) => {
        if (!key) return of([] as Generation[]);
        const [make, model] = JSON.parse(key) as [string, string];
        return from(this.catalog.generations(make, model));
      })
    ),
    { initialValue: [] as Generation[] }
  );

  readonly generationLabel = generationLabel;

  readonly customColor = computed(() => !COLORS.includes(this.value().color));

  /**
   * Ilustración para la vista previa, que se pinta en directo con el color
   * elegido. Al editar es la del propio coche mientras no cambie lo que se
   * ve en ella; si no, la de un coche igual ya guardada en el servidor, que
   * solo se consulta y nunca se genera desde aquí.
   */
  readonly previewIllustration = computed(() => {
    const v = this.value();
    if (v.photo || !v.make || !v.model || this.customModel()) return null;

    const saved = this.editing();
    const own =
      saved?.illustration &&
      (saved.illustrationVersion ?? 0) >= PAINTABLE_ILLUSTRATION_VERSION &&
      saved.make === v.make &&
      saved.model === v.model
        ? saved.illustration
        : null;

    // Igual que en el servidor: rellenar un campo que estaba vacío concreta
    // el coche pero no lo cambia, así que su ilustración sigue valiendo.
    const same = (before: string | undefined, after: string) => !before || before === after;
    if (
      own &&
      saved!.year === Number(v.year) &&
      same(saved!.generation, v.generation) &&
      same(saved!.body, v.body)
    ) {
      return own;
    }

    const params = new URLSearchParams({ make: v.make, model: v.model, year: String(v.year) });
    if (v.generation) params.set('generation', v.generation);
    if (v.body) params.set('body', v.body);
    const url = `/api/illustrations?${params}`;
    // Si no hay una guardada de ese coche, mejor la suya que ninguna.
    return this.missingIllustration() === url ? own : url;
  });

  /** Modelos de API Ninjas, por popularidad; si no responde, los del catálogo. */
  readonly models = computed(() => {
    const remote = values(this.modelFacets().model);
    return remote.length
      ? remote
      : this.catalog.modelsFor(this.availableMakes(), this.selectedMake());
  });

  readonly filteredModels = computed(() => {
    const query = normalize(this.pickerQuery());
    return query ? this.models().filter((m) => normalize(m).includes(query)) : this.models();
  });

  readonly bodies = computed(() => values(this.bodyFacets().body));

  readonly availableFuels = computed(() => values(this.fuelFacets().fuel));

  readonly transmissions = computed(() =>
    values(this.specFacets().transmission).map((value) => ({
      value,
      label: TRANSMISSION_LABELS[value] ?? label(value),
    }))
  );

  readonly engines = computed(() =>
    values(this.specFacets().badge).slice(0, MAX_ENGINES)
  );

  constructor() {
    this.keepChoicesValid();

    addIcons({
      addOutline, batteryChargingOutline,
      cameraOutline, carSportOutline, checkmarkOutline, chevronExpandOutline, flashOutline,
      informationCircleOutline, leafOutline, saveOutline, waterOutline,
    });
  }

  async ngOnInit(): Promise<void> {
    // De momento la app es solo para coches: el tipo queda fijo en 'car'.
    await Promise.all([this.store.load(), this.loadMakes()]);

    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return;

    const vehicle = this.store.vehicle(id);
    if (!vehicle) {
      void this.router.navigate(['/garage']);
      return;
    }

    this.editingId.set(id);
    this.editing.set(vehicle);
    this.selectedMake.set(vehicle.make);
    this.form.patchValue({
      nickname: vehicle.nickname,
      type: vehicle.type,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      fuel: vehicle.fuel,
      generation: vehicle.generation ?? '',
      body: vehicle.body ?? '',
      transmission: vehicle.transmission ?? '',
      engine: vehicle.engine ?? '',
      plate: vehicle.plate ?? '',
      mileage: vehicle.mileage,
      monthlyMileage: vehicle.monthlyMileage ?? 1000,
      color: vehicle.color ?? COLORS[0],
      photo: vehicle.photo ?? '',
      notes: vehicle.notes ?? '',
    });
  }

  private async loadMakes(): Promise<void> {
    this.availableMakes.set(await this.catalog.makesFor('car'));
  }

  openPicker(picker: Picker): void {
    this.pickerQuery.set('');
    this.picker.set(picker);
  }

  closePicker(): void {
    const picker = this.picker();
    if (!picker) return;
    this.picker.set(null);
    this.form.controls[picker].markAsTouched();
  }

  pickMake(make: string): void {
    this.selectedMake.set(make);
    this.customModel.set(false);
    this.form.patchValue({
      make, model: '', generation: '', body: '', transmission: '', engine: '',
    });
    this.closePicker();
  }

  pickModel(model: string | null): void {
    this.customModel.set(model === null);
    this.form.patchValue({
      model: model ?? '', generation: '', body: '', transmission: '', engine: '',
    });
    this.closePicker();
  }

  /**
   * Elegir la generación sustituye a teclear el año: se pone el primero de
   * la generación salvo que el año escrito ya caiga dentro de ella.
   */
  pickGeneration(generation: Generation): void {
    if (this.form.controls.generation.value === generation.value) {
      this.form.patchValue({ generation: '' });
      return;
    }

    const year = Number(this.form.controls.year.value);
    const end = generation.to ?? new Date().getFullYear();
    const inside = year >= generation.from && year <= end;
    this.form.patchValue({
      generation: generation.value,
      year: inside ? year : generation.from,
      transmission: '',
      engine: '',
    });
  }

  /** Pulsar la opción elegida la deselecciona. */
  toggle(field: 'body' | 'transmission' | 'engine', value: string): void {
    this.form.patchValue({ [field]: this.form.controls[field].value === value ? '' : value });
  }

  fuelAvailable(fuel: FuelType): boolean {
    const available = this.availableFuels();
    return !available.length || available.includes(fuel);
  }

  /**
   * Cuando cambian las opciones, descarta lo que ya no existe para ese coche
   * y elige solo la opción si no hay más.
   */
  private keepChoicesValid(): void {
    effect(() => {
      const bodies = this.bodies();
      const current = this.value().body;
      if (bodies.length === 1 && !current) this.form.patchValue({ body: bodies[0] });
      else if (bodies.length && current && !bodies.includes(current)) {
        this.form.patchValue({ body: '' });
      }
    });

    effect(() => {
      // Al editar se respeta lo guardado aunque la API diga otra cosa.
      if (this.editingId()) return;
      const fuels = this.availableFuels().filter((f) => FUEL_OPTIONS.some((o) => o.value === f));
      if (fuels.length && !fuels.includes(this.value().fuel)) {
        this.form.patchValue({ fuel: fuels[0] as FuelType });
      }
    });

    effect(() => {
      const transmissions = this.transmissions().map((t) => t.value);
      const engines = values(this.specFacets().badge);
      const { transmission, engine } = this.value();
      if (transmissions.length && transmission && !transmissions.includes(transmission)) {
        this.form.patchValue({ transmission: '' });
      }
      if (engines.length && engine && !engines.includes(engine)) {
        this.form.patchValue({ engine: '' });
      }
    });
  }

  private facetsFor(
    facets: FacetName[],
    filters: (value: FormValue) => FacetFilters | null
  ): Signal<Facets> {
    const query = computed(() => {
      const result = filters(this.value());
      return result ? JSON.stringify(result) : null;
    });

    return toSignal(
      toObservable(query).pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((q) =>
          q ? from(this.catalog.facets(JSON.parse(q), facets)) : of({})
        )
      ),
      { initialValue: {} }
    );
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
