/** Tipo de vehículo. Condiciona qué mantenimientos aplican. */
export type VehicleType = 'car' | 'motorcycle' | 'van';

export type FuelType = 'gasoline' | 'diesel' | 'electric' | 'hybrid';

export interface Vehicle {
  id: string;
  nickname: string;
  make: string;
  model: string;
  year: number;
  type: VehicleType;
  fuel: FuelType;
  plate?: string;
  /** Kilometraje actual. Es la magnitud sobre la que gira todo el dominio. */
  mileage: number;
  /** Fecha de la última lectura del cuentakilómetros, en ISO. */
  mileageUpdatedAt: string;
  /** Media de km al mes, para estimar cuándo vencerá el próximo servicio. */
  monthlyMileage?: number;
  color?: string;
  /** Foto en base64, ya reducida en el cliente. */
  photo?: string;
  notes?: string;
  createdAt: string;
}

export interface VehicleDraft {
  nickname: string;
  make: string;
  model: string;
  year: number;
  type: VehicleType;
  fuel: FuelType;
  plate?: string;
  mileage: number;
  monthlyMileage?: number;
  color?: string;
  photo?: string;
  notes?: string;
}
