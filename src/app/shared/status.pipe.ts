import { Pipe, PipeTransform } from '@angular/core';

import { CATEGORY_ICONS, CATEGORY_LABELS } from '../core/data/maintenance-presets';
import { DueStatus, MaintenanceCategory } from '../core/models/maintenance.model';

@Pipe({ name: 'categoryLabel' })
export class CategoryLabelPipe implements PipeTransform {
  transform(category: MaintenanceCategory): string {
    return CATEGORY_LABELS[category] ?? category;
  }
}

@Pipe({ name: 'categoryIcon' })
export class CategoryIconPipe implements PipeTransform {
  transform(category: MaintenanceCategory): string {
    return CATEGORY_ICONS[category] ?? 'construct-outline';
  }
}

/** Color de Ionic para cada nivel de urgencia. */
@Pipe({ name: 'statusColor' })
export class StatusColorPipe implements PipeTransform {
  transform(status: DueStatus): string {
    switch (status) {
      case 'overdue': return 'danger';
      case 'due-soon': return 'warning';
      case 'upcoming': return 'primary';
      default: return 'success';
    }
  }
}

@Pipe({ name: 'statusLabel' })
export class StatusLabelPipe implements PipeTransform {
  transform(status: DueStatus): string {
    switch (status) {
      case 'overdue': return 'Vencido';
      case 'due-soon': return 'Toca ya';
      case 'upcoming': return 'Se acerca';
      default: return 'Al día';
    }
  }
}

/** Formatea kilómetros con separador de miles. */
@Pipe({ name: 'km' })
export class KmPipe implements PipeTransform {
  transform(value: number | undefined): string {
    if (value === undefined) return '—';
    return new Intl.NumberFormat('es-ES').format(Math.round(value)) + ' km';
  }
}
