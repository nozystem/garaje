import { DOCUMENT, registerLocaleData } from '@angular/common';
import localeEnGb from '@angular/common/locales/en-GB';
import localeEs from '@angular/common/locales/es';
import { Injectable, computed, inject, signal } from '@angular/core';

import { en, TranslationKey } from './en';
import { es } from './es';

export type Lang = 'en' | 'es';

/** Valores para los `{huecos}` de un texto; null (p. ej. de un pipe) queda vacío. */
export type TranslationParams = Record<string, string | number | null | undefined>;

export const LANGUAGES: { value: Lang; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
];

const DICTIONARIES: Record<Lang, Record<TranslationKey, string>> = { en, es };
/** Formato de fechas y números de cada idioma. */
const LOCALES: Record<Lang, string> = { en: 'en-GB', es: 'es' };
const STORAGE_KEY = 'garaje.lang';

registerLocaleData(localeEnGb, 'en-GB');
registerLocaleData(localeEs, 'es');

/**
 * Idioma de la app. Se elige en Settings y se guarda en el dispositivo; la
 * primera vez se toma el del navegador. Cambiarlo no recarga la página: los
 * textos se leen de una señal y se actualizan solos.
 */
@Injectable({ providedIn: 'root' })
export class I18n {
  private readonly document = inject(DOCUMENT);
  private readonly _lang = signal<Lang>(initialLang());

  readonly lang = this._lang.asReadonly();
  readonly locale = computed(() => LOCALES[this._lang()]);

  constructor() {
    this.document.documentElement.lang = this._lang();
  }

  setLang(lang: Lang): void {
    this._lang.set(lang);
    this.document.documentElement.lang = lang;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // Sin almacenamiento (modo privado): el idioma dura hasta cerrar la app.
    }
  }

  /** Texto de `key` en el idioma actual; `{nombre}` se sustituye por params. */
  t(key: TranslationKey, params?: TranslationParams): string {
    const text = DICTIONARIES[this._lang()][key] ?? en[key] ?? key;
    if (!params) return text;
    return text.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in params ? String(params[name] ?? '') : match
    );
  }

  /** Como t(), pero si la clave no existe devuelve `fallback` (datos de APIs). */
  tOr(key: string, fallback: string): string {
    return key in en ? this.t(key as TranslationKey) : fallback;
  }

  /**
   * Los errores del servidor llegan en inglés. Los conocidos se traducen;
   * el resto se muestra tal cual antes que no decir nada.
   */
  serverMessage(message: string): string {
    return message
      .split('. ')
      .map((part) => {
        const key = SERVER_MESSAGES[part.replace(/\.$/, '')];
        return key ? this.t(key) : part;
      })
      .join('. ');
  }
}

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'es') return saved;
  } catch {
    // Sin almacenamiento: se decide por el navegador.
  }
  return navigator.language?.toLowerCase().startsWith('es') ? 'es' : 'en';
}

/** Mensajes del servidor (y de los servicios del cliente) que se traducen. */
const SERVER_MESSAGES: Record<string, TranslationKey> = {
  'An account with that email already exists': 'error.emailTaken',
  'Incorrect email or password': 'error.wrongPassword',
  'Not signed in': 'error.notSignedIn',
  'This account no longer exists': 'error.accountGone',
  'Invalid email address': 'error.invalidEmail',
  'Password is too long': 'error.passwordTooLong',
  'Name must be between 2 and 60 characters': 'error.nameLength',
  'Invalid data': 'error.invalidData',
  'Not found': 'error.notFound',
  'Name is required': 'error.nameRequired',
  'Make is required': 'error.makeRequired',
  'Model is required': 'error.modelRequired',
  'Mileage must be a positive number': 'error.mileagePositive',
  'Title is required': 'error.titleRequired',
  'Invalid date': 'error.invalidDate',
  'Set an interval in kilometres, in months, or both': 'error.intervalRequired',
  'The photo is not valid': 'error.photoInvalid',
  'The photo format is not supported': 'error.photoFormat',
  'The photo is too large': 'error.photoTooLarge',
  'The vehicle does not exist': 'error.vehicleMissing',
  'Illustrations are not configured': 'error.illustrationsOff',
  'The illustration could not be created': 'error.illustrationFailed',
  'Maintenance plans are not configured': 'error.plansOff',
  'The maintenance plan could not be created': 'error.planFailed',
  'Cannot reach the server': 'error.offline',
  'The request could not be completed': 'error.generic',
  'That file is not an image': 'error.notAnImage',
  'The image could not be processed': 'error.imageProcessing',
  'The image is too large, try another one': 'error.imageTooLarge',
};
