import { DOCUMENT } from '@angular/common';
import { Injectable, computed, inject, signal } from '@angular/core';

export type ThemeMode = 'system' | 'light' | 'dark';

export const THEME_MODES: ThemeMode[] = ['system', 'light', 'dark'];

const STORAGE_KEY = 'garaje.theme';

/**
 * Modo claro u oscuro. Se elige en Settings y se guarda en el dispositivo;
 * con 'system' sigue al sistema, también si este cambia con la app abierta.
 * Se aplica poniendo o quitando la clase ion-palette-dark en <html>, que es
 * donde theme/variables.scss define la paleta oscura.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly systemQuery = this.document.defaultView?.matchMedia('(prefers-color-scheme: dark)');

  private readonly _mode = signal<ThemeMode>(initialMode());
  private readonly systemDark = signal(this.systemQuery?.matches ?? true);

  readonly mode = this._mode.asReadonly();
  readonly dark = computed(() =>
    this._mode() === 'system' ? this.systemDark() : this._mode() === 'dark'
  );

  constructor() {
    this.systemQuery?.addEventListener('change', (event) => {
      this.systemDark.set(event.matches);
      this.apply();
    });
    this.apply();
  }

  setMode(mode: ThemeMode): void {
    this._mode.set(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Sin almacenamiento (modo privado): el modo dura hasta cerrar la app.
    }
    this.apply();
  }

  private apply(): void {
    this.document.documentElement.classList.toggle('ion-palette-dark', this.dark());
  }
}

function initialMode(): ThemeMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'system' || saved === 'light' || saved === 'dark') return saved;
  } catch {
    // Sin almacenamiento: se sigue al sistema.
  }
  return 'system';
}
