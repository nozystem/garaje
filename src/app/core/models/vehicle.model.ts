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
  mileage: number;
  mileageUpdatedAt: string;
  monthlyMileage?: number;
  color?: string;
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
