import { MaintenanceCategory } from '../models/maintenance.model';
import { FuelType, VehicleType } from '../models/vehicle.model';

export interface MaintenancePreset {
  category: MaintenanceCategory;
  title: string;
  intervalKm?: number;
  intervalMonths?: number;
  types?: VehicleType[];
  fuels?: FuelType[];
}

export const MAINTENANCE_PRESETS: MaintenancePreset[] = [
  {
    category: 'oil',
    title: 'Oil and filter change',
    intervalKm: 15000,
    intervalMonths: 12,
    fuels: ['gasoline', 'diesel', 'hybrid'],
  },
  {
    category: 'filters',
    title: 'Air filter',
    intervalKm: 30000,
    intervalMonths: 24,
    fuels: ['gasoline', 'diesel', 'hybrid'],
  },
  {
    category: 'filters',
    title: 'Cabin filter',
    intervalKm: 20000,
    intervalMonths: 12,
  },
  {
    category: 'brakes',
    title: 'Brake inspection',
    intervalKm: 20000,
    intervalMonths: 12,
  },
  {
    category: 'brakes',
    title: 'Brake fluid',
    intervalMonths: 24,
  },
  {
    category: 'tires',
    title: 'Tyre rotation',
    intervalKm: 10000,
    types: ['car', 'van'],
  },
  {
    category: 'battery',
    title: 'Battery check',
    intervalMonths: 12,
  },
  {
    category: 'coolant',
    title: 'Coolant',
    intervalKm: 60000,
    intervalMonths: 48,
    fuels: ['gasoline', 'diesel', 'hybrid'],
  },
  {
    category: 'timing-belt',
    title: 'Timing belt',
    intervalKm: 120000,
    intervalMonths: 84,
    fuels: ['gasoline', 'diesel'],
  },
  {
    category: 'inspection',
    title: 'Roadworthiness test',
    intervalMonths: 12,
  },
  {
    category: 'insurance',
    title: 'Insurance renewal',
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

export const CATEGORY_LABELS: Record<MaintenanceCategory, string> = {
  oil: 'Oil',
  filters: 'Filters',
  brakes: 'Brakes',
  tires: 'Tyres',
  battery: 'Battery',
  coolant: 'Coolant',
  'timing-belt': 'Timing belt',
  inspection: 'Roadworthiness test',
  insurance: 'Insurance',
  other: 'Other',
};

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
