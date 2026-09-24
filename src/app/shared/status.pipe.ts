import { Pipe, PipeTransform, inject } from '@angular/core';

import { CATEGORY_ICONS } from '../core/data/maintenance-presets';
import { I18n } from '../core/i18n/i18n.service';
import { DueStatus, MaintenanceCategory } from '../core/models/maintenance.model';

// Los pipes con texto son impuros para seguir al idioma elegido.

@Pipe({ name: 'categoryLabel', pure: false })
export class CategoryLabelPipe implements PipeTransform {
  private readonly i18n = inject(I18n);

  transform(category: MaintenanceCategory): string {
    return this.i18n.t(`category.${category}`);
  }
}

@Pipe({ name: 'categoryIcon' })
export class CategoryIconPipe implements PipeTransform {
  transform(category: MaintenanceCategory): string {
    return CATEGORY_ICONS[category] ?? 'construct-outline';
  }
}

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

@Pipe({ name: 'statusLabel', pure: false })
export class StatusLabelPipe implements PipeTransform {
  private readonly i18n = inject(I18n);

  transform(status: DueStatus): string {
    return this.i18n.t(`status.${status}`);
  }
}

@Pipe({ name: 'km', pure: false })
export class KmPipe implements PipeTransform {
  private readonly i18n = inject(I18n);

  transform(value: number | undefined): string {
    if (value === undefined) return '—';
    return new Intl.NumberFormat(this.i18n.locale()).format(Math.round(value)) + ' km';
  }
}
