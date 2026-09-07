import { MaintenanceCategory } from '../models/maintenance.model';
import { FuelType, VehicleType } from '../models/vehicle.model';

/**
 * Intervalos orientativos por categoría. Son los que se proponen al crear un
 * plan; el usuario puede cambiarlos, porque el libro de cada fabricante manda.
 */
export interface MaintenancePreset {
  category: MaintenanceCategory;
  title: string;
  intervalKm?: number;
  intervalMonths?: number;
  /** Si se omite, aplica a todos los tipos de vehículo. */
  types?: VehicleType[];
  /** Si se omite, aplica a todos los combustibles. */
  fuels?: FuelType[];
}

export const MAINTENANCE_PRESETS: MaintenancePreset[] = [
  {
    category: 'oil',
    title: 'Cambio de aceite y filtro',
    intervalKm: 15000,
    intervalMonths: 12,
    fuels: ['gasoline', 'diesel', 'hybrid'],
  },
  {
    category: 'filters',
    title: 'Filtro de aire',
    intervalKm: 30000,
    intervalMonths: 24,
    fuels: ['gasoline', 'diesel', 'hybrid'],
  },
  {
    category: 'filters',
    title: 'Filtro de habitáculo',
    intervalKm: 20000,
    intervalMonths: 12,
  },
  {
    category: 'brakes',
    title: 'Revisión de frenos',
    intervalKm: 20000,
    intervalMonths: 12,
  },
  {
    category: 'brakes',
    title: 'Líquido de frenos',
    intervalMonths: 24,
  },
  {
    category: 'tires',
    title: 'Rotación de neumáticos',
    intervalKm: 10000,
    types: ['car', 'van'],
  },
  {
    category: 'battery',
    title: 'Revisión de batería',
    intervalMonths: 12,
  },
  {
    category: 'coolant',
    title: 'Líquido refrigerante',
    intervalKm: 60000,
    intervalMonths: 48,
    fuels: ['gasoline', 'diesel', 'hybrid'],
  },
  {
    category: 'timing-belt',
    title: 'Correa de distribución',
    intervalKm: 120000,
    intervalMonths: 84,
    fuels: ['gasoline', 'diesel'],
  },
  {
    category: 'inspection',
    title: 'ITV',
    intervalMonths: 12,
  },
  {
    category: 'insurance',
    title: 'Renovación del seguro',
    intervalMonths: 12,
  },
];

/** Los presets que tienen sentido para un vehículo concreto. */
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
  oil: 'Aceite',
  filters: 'Filtros',
  brakes: 'Frenos',
  tires: 'Neumáticos',
  battery: 'Batería',
  coolant: 'Refrigerante',
  'timing-belt': 'Distribución',
  inspection: 'ITV',
  insurance: 'Seguro',
  other: 'Otros',
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
