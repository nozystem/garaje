import { formatDate } from '@angular/common';
import { Pipe, PipeTransform, inject } from '@angular/core';

import { TranslationKey } from './en';
import { I18n, TranslationParams } from './i18n.service';

/**
 * `{{ 'garage.title' | t }}` o `{{ 'garage.count' | t: { n: 3 } }}`.
 * Impuro para que cambie al elegir otro idioma; solo es buscar en un objeto.
 */
@Pipe({ name: 't', pure: false })
export class TranslatePipe implements PipeTransform {
  private readonly i18n = inject(I18n);

  // Acepta string para poder componer claves en la plantilla ('fuel.' + fuel).
  transform(key: TranslationKey | string, params?: TranslationParams): string {
    return this.i18n.t(key as TranslationKey, params);
  }
}

/** Como el pipe `date`, pero con el formato del idioma elegido. */
@Pipe({ name: 'ldate', pure: false })
export class LocalDatePipe implements PipeTransform {
  private readonly i18n = inject(I18n);

  transform(value: string | number | Date | null | undefined, format = 'mediumDate'): string {
    return value == null || value === '' ? '' : formatDate(value, format, this.i18n.locale());
  }
}
