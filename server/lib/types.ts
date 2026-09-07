/**
 * Contrato entre la API y el cliente.
 *
 * La app vive en `src/`, el servidor en `server/`. Estos tipos describen lo
 * que viaja por la red y se mantienen alineados con `src/app/core/models/`.
 */

export interface StoredVehicle {
  id: string;
  ownerId: string;
  nickname: string;
  make: string;
  model: string;
  year: number;
  type: string;
  fuel: string;
  plate?: string;
  mileage: number;
  mileageUpdatedAt: string;
  monthlyMileage?: number;
  color?: string;
  photo?: string;
  notes?: string;
  createdAt: string;
}

export interface StoredRecord {
  id: string;
  ownerId: string;
  vehicleId: string;
  category: string;
  title: string;
  date: string;
  mileage: number;
  cost?: number;
  workshop?: string;
  notes?: string;
  planId?: string;
  createdAt: string;
}

export interface StoredPlan {
  id: string;
  ownerId: string;
  vehicleId: string;
  category: string;
  title: string;
  intervalKm?: number;
  intervalMonths?: number;
  lastServiceMileage?: number;
  lastServiceDate?: string;
  active: boolean;
  notes?: string;
  createdAt: string;
}

/** Todo el garaje en una respuesta: la app lo pide una vez y trabaja en local. */
export interface GarageSnapshot {
  vehicles: StoredVehicle[];
  records: StoredRecord[];
  plans: StoredPlan[];
}
