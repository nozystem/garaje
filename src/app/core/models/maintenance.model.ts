/**
 * Categorías de mantenimiento. Se usan para agrupar el historial y para
 * sugerir intervalos por defecto al crear un plan.
 */
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

/** Una intervención ya realizada. */
export interface MaintenanceRecord {
  id: string;
  vehicleId: string;
  category: MaintenanceCategory;
  title: string;
  /** Fecha en que se hizo, ISO. */
  date: string;
  /** Kilometraje en el momento de la intervención. */
  mileage: number;
  cost?: number;
  workshop?: string;
  notes?: string;
  /** Si vino de una tarea planificada, su id: así se puede reprogramar. */
  planId?: string;
  createdAt: string;
}

/**
 * Una tarea recurrente. Puede vencer por kilómetros, por tiempo, o por lo
 * que ocurra primero — que es como funcionan los libros de mantenimiento.
 */
export interface MaintenancePlan {
  id: string;
  vehicleId: string;
  category: MaintenanceCategory;
  title: string;
  /** Intervalo en kilómetros. Opcional: hay tareas solo temporales (ITV). */
  intervalKm?: number;
  /** Intervalo en meses. Opcional: hay tareas solo por uso. */
  intervalMonths?: number;
  /** Kilometraje de la última vez que se hizo. */
  lastServiceMileage?: number;
  /** Fecha de la última vez que se hizo, ISO. */
  lastServiceDate?: string;
  active: boolean;
  notes?: string;
  createdAt: string;
}

/** Cómo de urgente es una tarea. Ordena la lista y decide el color. */
export type DueStatus = 'overdue' | 'due-soon' | 'upcoming' | 'ok';

/**
 * Resultado de evaluar un plan contra el estado actual del vehículo.
 * Es un objeto derivado: no se guarda, se calcula.
 */
export interface PlanStatus {
  plan: MaintenancePlan;
  status: DueStatus;
  /** Kilómetros que faltan; negativo si ya se pasó. Undefined si no aplica. */
  kmRemaining?: number;
  /** Días que faltan; negativo si ya se pasó. Undefined si no aplica. */
  daysRemaining?: number;
  /** Qué criterio manda: el que vence antes. */
  limitingFactor: 'km' | 'time' | 'none';
  /** Fecha estimada de vencimiento, proyectando el uso mensual. */
  estimatedDueDate?: string;
  /** 0 a 1: cuánto del intervalo se ha consumido. Alimenta la barra. */
  progress: number;
}
