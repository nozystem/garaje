export interface StoredUser {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  createdAt: string;
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

export interface StoredVehicle {
  id: string;
  userId: string;
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
  userId: string;
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
  userId: string;
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

export interface GarageSnapshot {
  vehicles: StoredVehicle[];
  records: StoredRecord[];
  plans: StoredPlan[];
}
