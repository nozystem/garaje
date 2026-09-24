import { Component, inject } from '@angular/core';
import { IonApp, IonRouterOutlet } from '@ionic/angular';

import { ThemeService } from './core/services/theme.service';

@Component({
  selector: 'app-root',
  template: `
    <ion-app>
      <ion-router-outlet></ion-router-outlet>
    </ion-app>
  `,
  imports: [IonApp, IonRouterOutlet],
})
export class AppComponent {
  // Se crea al arrancar para aplicar el modo y seguir los cambios del sistema.
  private readonly theme = inject(ThemeService);
}
