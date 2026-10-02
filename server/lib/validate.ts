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
  generation?: string;
  body?: string;
  transmission?: string;
  engine?: string;
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
      generation: str(body['generation'], 40) ?? undefined,
      body: str(body['body'], 30) ?? undefined,
      transmission: str(body['transmission'], 30) ?? undefined,
      engine: str(body['engine'], 40) ?? undefined,
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
  parts?: string;
  photo?: string;
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

  const photo = photoOrNull(body['photo'], errors);

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
      parts: str(body['parts'], 500) ?? undefined,
      photo: photo ?? undefined,
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

const DOCUMENT_KINDS = ['insurance', 'inspection', 'registration', 'tax', 'warranty', 'other'];

export interface DocumentInput {
  vehicleId: string;
  kind: string;
  title: string;
  number?: string;
  provider?: string;
  expiresAt?: string;
  cost?: number;
  notes?: string;
  photo?: string;
}

export function validateDocument(input: unknown): Validation<DocumentInput> {
  const body = asRecord(input);
  const errors: string[] = [];

  const vehicleId = str(body['vehicleId'], 64);
  const title = str(body['title'], 120);
  const kind = str(body['kind'], 20);
  const expires = body['expiresAt'];
  const expiresAt = expires === undefined || expires === null || expires === '' ? null : isoDate(expires);

  if (!vehicleId) errors.push('Vehicle is required');
  if (!title) errors.push('Title is required');
  if (!kind || !DOCUMENT_KINDS.includes(kind)) errors.push('Invalid document type');
  if (expires && !expiresAt) errors.push('Invalid date');

  const photo = photoOrNull(body['photo'], errors);

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      vehicleId: vehicleId as string,
      kind: kind as string,
      title: title as string,
      number: str(body['number'], 60) ?? undefined,
      provider: str(body['provider'], 80) ?? undefined,
      expiresAt: expiresAt ?? undefined,
      cost: num(body['cost'], 0, 1_000_000) ?? undefined,
      notes: str(body['notes'], 1000) ?? undefined,
      photo: photo ?? undefined,
    },
  };
}

export interface FuelInput {
  vehicleId: string;
  date: string;
  mileage: number;
  liters: number;
  cost: number;
  fullTank: boolean;
  station?: string;
}

export function validateFuel(input: unknown): Validation<FuelInput> {
  const body = asRecord(input);
  const errors: string[] = [];

  const vehicleId = str(body['vehicleId'], 64);
  const date = isoDate(body['date']);
  const mileage = num(body['mileage'], 0, 3_000_000);
  const liters = num(body['liters'], 0.1, 500);
  const cost = num(body['cost'], 0, 10_000);

  if (!vehicleId) errors.push('Vehicle is required');
  if (!date) errors.push('Invalid date');
  if (mileage === null) errors.push('Mileage must be a positive number');
  if (liters === null) errors.push('Litres must be between 0.1 and 500');
  if (cost === null) errors.push('Cost must be a positive number');

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      vehicleId: vehicleId as string,
      date: date as string,
      mileage: mileage as number,
      liters: liters as number,
      cost: cost as number,
      fullTank: body['fullTank'] !== false,
      station: str(body['station'], 80) ?? undefined,
    },
  };
}

export interface WorkshopInput {
  name: string;
  phone?: string;
  address?: string;
  notes?: string;
}

export function validateWorkshop(input: unknown): Validation<WorkshopInput> {
  const body = asRecord(input);
  const name = str(body['name'], 80);
  const phone = body['phone'] === undefined || body['phone'] === '' ? null : str(body['phone'], 30);

  const errors: string[] = [];
  if (!name) errors.push('Name is required');
  if (phone && !/^[+0-9 ()-]{3,30}$/.test(phone)) errors.push('Invalid phone number');
  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      name: name as string,
      phone: phone ?? undefined,
      address: str(body['address'], 160) ?? undefined,
      notes: str(body['notes'], 500) ?? undefined,
    },
  };
}
