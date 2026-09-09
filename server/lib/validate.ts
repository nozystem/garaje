export type Validation<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

const VEHICLE_TYPES = ['car', 'motorcycle', 'van'];
const FUEL_TYPES = ['gasoline', 'diesel', 'electric', 'hybrid'];
const CATEGORIES = [
  'oil', 'filters', 'brakes', 'tires', 'battery',
  'coolant', 'timing-belt', 'inspection', 'insurance', 'other',
];

const MAX_PHOTO_BYTES = 300_000;

function asRecord(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null
    ? (input as Record<string, unknown>)
    : {};
}

function str(value: unknown, max = 120): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

function num(value: unknown, min: number, max: number): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function isoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function photoOrNull(value: unknown, errors: string[]): string | null {
  if (value === null || value === undefined || value === '') return null;

  if (typeof value !== 'string') {
    errors.push('The photo is not valid');
    return null;
  }
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) {
    errors.push('The photo format is not supported');
    return null;
  }
  if (value.length > MAX_PHOTO_BYTES) {
    errors.push('The photo is too large');
    return null;
  }
  return value;
}

export interface VehicleInput {
  nickname: string;
  make: string;
  model: string;
  year: number;
  type: string;
  fuel: string;
  plate?: string;
  mileage: number;
  monthlyMileage?: number;
  color?: string;
  photo?: string;
  notes?: string;
}

export function validateVehicle(input: unknown): Validation<VehicleInput> {
  const body = asRecord(input);
  const errors: string[] = [];
  const maxYear = new Date().getFullYear() + 1;

  const nickname = str(body['nickname'], 60);
  const make = str(body['make'], 60);
  const model = str(body['model'], 60);
  const year = num(body['year'], 1900, maxYear);
  const mileage = num(body['mileage'], 0, 3_000_000);
  const type = str(body['type'], 20);
  const fuel = str(body['fuel'], 20);

  if (!nickname) errors.push('Name is required');
  if (!make) errors.push('Make is required');
  if (!model) errors.push('Model is required');
  if (year === null) errors.push(`Year must be between 1900 and ${maxYear}`);
  if (mileage === null) errors.push('Mileage must be a positive number');
  if (!type || !VEHICLE_TYPES.includes(type)) errors.push('Invalid vehicle type');
  if (!fuel || !FUEL_TYPES.includes(fuel)) errors.push('Invalid fuel type');

  const photo = photoOrNull(body['photo'], errors);

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      nickname: nickname as string,
      make: make as string,
      model: model as string,
      year: year as number,
      type: type as string,
      fuel: fuel as string,
      mileage: mileage as number,
      plate: str(body['plate'], 15) ?? undefined,
      monthlyMileage: num(body['monthlyMileage'], 0, 20_000) ?? undefined,
      color: str(body['color'], 30) ?? undefined,
      photo: photo ?? undefined,
      notes: str(body['notes'], 1000) ?? undefined,
    },
  };
}

export interface RecordInput {
  vehicleId: string;
  category: string;
  title: string;
  date: string;
  mileage: number;
  cost?: number;
  workshop?: string;
  notes?: string;
  planId?: string;
}

export function validateRecord(input: unknown): Validation<RecordInput> {
  const body = asRecord(input);
  const errors: string[] = [];

  const vehicleId = str(body['vehicleId'], 64);
  const title = str(body['title'], 120);
  const date = isoDate(body['date']);
  const mileage = num(body['mileage'], 0, 3_000_000);
  const category = str(body['category'], 20);

  if (!vehicleId) errors.push('Vehicle is required');
  if (!title) errors.push('Title is required');
  if (!date) errors.push('Invalid date');
  if (mileage === null) errors.push('Mileage must be a positive number');
  if (!category || !CATEGORIES.includes(category)) errors.push('Invalid category');

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      vehicleId: vehicleId as string,
      category: category as string,
      title: title as string,
      date: date as string,
      mileage: mileage as number,
      cost: num(body['cost'], 0, 1_000_000) ?? undefined,
      workshop: str(body['workshop'], 80) ?? undefined,
      notes: str(body['notes'], 1000) ?? undefined,
      planId: str(body['planId'], 64) ?? undefined,
    },
  };
}

export interface PlanInput {
  vehicleId: string;
  category: string;
  title: string;
  intervalKm?: number;
  intervalMonths?: number;
  lastServiceMileage?: number;
  lastServiceDate?: string;
  active: boolean;
  notes?: string;
}

export function validatePlan(input: unknown): Validation<PlanInput> {
  const body = asRecord(input);
  const errors: string[] = [];

  const vehicleId = str(body['vehicleId'], 64);
  const title = str(body['title'], 120);
  const category = str(body['category'], 20);
  const intervalKm = num(body['intervalKm'], 1, 500_000);
  const intervalMonths = num(body['intervalMonths'], 1, 240);

  if (!vehicleId) errors.push('Vehicle is required');
  if (!title) errors.push('Title is required');
  if (!category || !CATEGORIES.includes(category)) errors.push('Invalid category');

  if (intervalKm === null && intervalMonths === null) {
    errors.push('Set an interval in kilometres, in months, or both');
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      vehicleId: vehicleId as string,
      category: category as string,
      title: title as string,
      intervalKm: intervalKm ?? undefined,
      intervalMonths: intervalMonths ?? undefined,
      lastServiceMileage: num(body['lastServiceMileage'], 0, 3_000_000) ?? undefined,
      lastServiceDate: isoDate(body['lastServiceDate']) ?? undefined,
      active: body['active'] !== false,
      notes: str(body['notes'], 1000) ?? undefined,
    },
  };
}
