import { Component, effect, inject, input, output, signal } from '@angular/core';

import { IllustrationPainter } from '../core/services/illustration-painter.service';

/** Desde esta versión las ilustraciones llegan en verde de base y se pintan aquí. */
export const PAINTABLE_ILLUSTRATION_VERSION = 2;

/** El primer color del formulario, para coches guardados sin color. */
const DEFAULT_COLOR = '#e74c3c';

/**
 * Ilustración del coche pintada con su color. Mientras se pinta un color
 * nuevo sigue mostrando el anterior, para que el cambio no parpadee ni deje
 * ver el verde de base.
 */
@Component({
  selector: 'app-car-illustration',
  template: `
    @if (shown(); as url) {
      <img [src]="url" [alt]="alt()" />
    }
  `,
  styles: `
    :host {
      display: block;
    }

    img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
  `,
})
export class CarIllustrationComponent {
  private readonly painter = inject(IllustrationPainter);

  readonly src = input.required<string>();
  readonly color = input<string | undefined>();
  /** Las anteriores a la versión 2 ya venían pintadas y se muestran tal cual. */
  readonly version = input<number | undefined>();
  readonly alt = input('');
  /** La imagen no existe o no se pudo cargar (p. ej. un 404 de la caché). */
  readonly missing = output<string>();

  readonly shown = signal<string | null>(null);

  constructor() {
    effect((onCleanup) => {
      const src = this.src();
      const color = this.color() || DEFAULT_COLOR;
      if ((this.version() ?? 0) < PAINTABLE_ILLUSTRATION_VERSION) {
        this.shown.set(src);
        return;
      }

      let cancelled = false;
      onCleanup(() => (cancelled = true));
      this.painter
        .paint(src, color)
        .then((url) => !cancelled && this.shown.set(url))
        .catch(() => {
          if (cancelled) return;
          this.shown.set(null);
          this.missing.emit(src);
        });
    });
  }
}
