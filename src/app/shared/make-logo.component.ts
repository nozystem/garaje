import { Component, computed, input } from '@angular/core';

import { MAKE_LOGOS } from '../core/data/make-logos';

/**
 * Logo de una marca sobre una ficha clara: muchos logos son negros y
 * desaparecerían sobre el fondo oscuro. Sin logo, muestra la inicial.
 */
@Component({
  selector: 'app-make-logo',
  template: `
    @if (src(); as src) {
      <img [src]="src" alt="" loading="lazy" />
    } @else {
      <span>{{ initial() }}</span>
    }
  `,
  styles: `
    :host {
      display: grid;
      place-items: center;
      flex: none;
      width: var(--size, 40px);
      height: var(--size, 40px);
      padding: 5px;
      border-radius: 10px;
      background: #f2f2f7;
      color: #12121a;
      font-weight: 700;
      font-size: calc(var(--size, 40px) * 0.42);
    }

    img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
  `,
})
export class MakeLogoComponent {
  readonly slug = input<string | undefined>();
  readonly name = input('');

  readonly src = computed(() => {
    const slug = this.slug();
    return slug && MAKE_LOGOS.has(slug) ? `assets/logos/${slug}.png` : null;
  });

  readonly initial = computed(() => this.name().trim().charAt(0).toUpperCase() || '?');
}
