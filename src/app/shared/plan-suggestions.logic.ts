/**
 * Reglas del plan de la IA sin Angular ni Ionic, para poder probarlas solas.
 */
import type { SuggestedTask } from '../core/services/api.service';

/** Lo que sabe el usuario de la última vez que se hizo una tarea. */
export type DoneState = 'unknown' | 'recent' | 'at';

export interface SuggestionRow {
  task: SuggestedTask;
  include: boolean;
  /** Ya tiene una tarea con ese nombre: se ofrece, pero desmarcada. */
  tracked: boolean;
  state: DoneState;
  /** Con 'at': kilómetros (si la tarea va por km) o fecha (si solo va por tiempo). */
  doneKm: number | null;
  doneDate: string;
}

/**
 * Última vez que se hizo, según lo que sabe el usuario:
 * - 'unknown': se supone hecha a su tiempo, en el último múltiplo del
 *   intervalo (con 250.000 km y cambio cada 15.000, a los 240.000).
 * - 'recent': hecha ahora, con los kilómetros actuales.
 * - 'at': a los kilómetros o en la fecha que indique.
 */
export function lastService(row: SuggestionRow, mileage: number): { mileage?: number; date?: string } {
  const { intervalKm } = row.task;
  switch (row.state) {
    case 'recent':
      return { mileage, date: new Date().toISOString() };
    case 'at':
      return intervalKm
        ? { mileage: row.doneKm ?? mileage }
        : { date: row.doneDate ? new Date(row.doneDate).toISOString() : undefined };
    default:
      return { mileage: intervalKm ? Math.floor(mileage / intervalKm) * intervalKm : undefined };
  }
}
