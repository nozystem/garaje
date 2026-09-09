export type MaintenanceCategory =
  | 'oil'
  | 'filters'
  | 'brakes'
  | 'tires'
  | 'battery'
  | 'coolant'
  | 'timing-belt'
  | 'inspection'
  | 'insurance'
  | 'other';

export interface MaintenanceRecord {
  id: string;
  vehicleId: string;
  category: MaintenanceCategory;
  title: string;
  date: string;
  mileage: number;
  cost?: number;
  workshop?: string;
  notes?: string;
  planId?: string;
  createdAt: string;
}

export interface MaintenancePlan {
  id: string;
  vehicleId: string;
  category: MaintenanceCategory;
  title: string;
  intervalKm?: number;
  intervalMonths?: number;
  lastServiceMileage?: number;
  lastServiceDate?: string;
  active: boolean;
  notes?: string;
  createdAt: string;
}

export type DueStatus = 'overdue' | 'due-soon' | 'upcoming' | 'ok';

export interface PlanStatus {
  plan: MaintenancePlan;
  status: DueStatus;
  kmRemaining?: number;
  daysRemaining?: number;
  limitingFactor: 'km' | 'time' | 'none';
  estimatedDueDate?: string;
  progress: number;
}
