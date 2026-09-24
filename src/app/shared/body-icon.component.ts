import { Component, computed, input } from '@angular/core';

/**
 * Silueta lateral de cada carrocería de API Ninjas, con la trasera a la
 * izquierda. Todas comparten las ruedas y la línea inferior.
 */
const PROFILES: Record<string, string> = {
  sedan: 'M3 22V16l7-1 8-7h20l8 6 14 2v6',
  hatchback: 'M5 22V10l3-3h27l9 7 16 2v6',
  wagon: 'M3 22V9l3-2h32l8 7 14 2v6',
  liftback: 'M3 22v-7l19-8h14l9 7 15 2v6',
  coupe: 'M3 22v-6l19-8h12l12 7 14 2v5',
  convertible: 'M3 22v-7h39l18 1v6M40 15l4-5',
  suv: 'M3 22V6l3-2h34l8 7 13 2v9',
  mpv: 'M3 22V6l3-2h28l16 8 11 2v8',
  pickup: 'M3 22v-9h25V6h12l7 6 14 2v8',
  van: 'M3 22V4h41l8 6 9 3v9',
};

@Component({
  selector: 'app-body-icon',
  template: `
    <svg viewBox="0 0 64 30" fill="none" stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path [attr.d]="profile()" />
      <path d="M3 22h8M21 22h22M53 22h8" />
      <circle cx="16" cy="22" r="4.5" />
      <circle cx="48" cy="22" r="4.5" />
    </svg>
  `,
  styles: `
    :host {
      display: block;
      width: 100%;
    }

    svg {
      display: block;
      width: 100%;
      height: auto;
    }
  `,
})
export class BodyIconComponent {
  readonly body = input('');

  readonly profile = computed(() => PROFILES[this.body().toLowerCase()] ?? PROFILES['sedan']);
}
