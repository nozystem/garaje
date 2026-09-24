import { MaintenanceCategory } from '../models/maintenance.model';
import { FuelType, VehicleType } from '../models/vehicle.model';

export interface MaintenancePreset {
  /** Su nombre se traduce con la clave `preset.<id>`. */
  id: string;
  category: MaintenanceCategory;
  intervalKm?: number;
  intervalMonths?: number;
  types?: VehicleType[];
  fuels?: FuelType[];
}

export const MAINTENANCE_PRESETS: MaintenancePreset[] = [
  {
    category: 'oil',
    id: 'oil',
    intervalKm: 15000,
    intervalMonths: 12,
    fuels: ['gasoline', 'diesel', 'hybrid'],
  },
  {
    category: 'filters',
    id: 'airFilter',
    intervalKm: 30000,
    intervalMonths: 24,
    fuels: ['gasoline', 'diesel', 'hybrid'],
  },
  {
    category: 'filters',
    id: 'cabinFilter',
    intervalKm: 20000,
    intervalMonths: 12,
  },
  {
    category: 'brakes',
    id: 'brakeInspection',
    intervalKm: 20000,
    intervalMonths: 12,
  },
  {
    category: 'brakes',
    id: 'brakeFluid',
    intervalMonths: 24,
  },
  {
    category: 'tires',
    id: 'tyreRotation',
    intervalKm: 10000,
    types: ['car', 'van'],
  },
  {
    category: 'battery',
    id: 'batteryCheck',
    intervalMonths: 12,
  },
  {
    category: 'coolant',
    id: 'coolant',
    intervalKm: 60000,
    intervalMonths: 48,
    fuels: ['gasoline', 'diesel', 'hybrid'],
  },
  {
    category: 'timing-belt',
    id: 'timingBelt',
    intervalKm: 120000,
    intervalMonths: 84,
    fuels: ['gasoline', 'diesel'],
  },
  {
    category: 'inspection',
    id: 'inspection',
    intervalMonths: 12,
  },
  {
    category: 'insurance',
    id: 'insurance',
    intervalMonths: 12,
  },
];

export function presetsFor(
  type: VehicleType,
  fuel: FuelType
): MaintenancePreset[] {
  return MAINTENANCE_PRESETS.filter(
    (preset) =>
      (!preset.types || preset.types.includes(type)) &&
      (!preset.fuels || preset.fuels.includes(fuel))
  );
}

export const CATEGORY_ICONS: Record<MaintenanceCategory, string> = {
  oil: 'water-outline',
  filters: 'funnel-outline',
  brakes: 'disc-outline',
  tires: 'ellipse-outline',
  battery: 'battery-half-outline',
  coolant: 'thermometer-outline',
  'timing-belt': 'sync-outline',
  inspection: 'shield-checkmark-outline',
  insurance: 'document-text-outline',
  other: 'construct-outline',
};
