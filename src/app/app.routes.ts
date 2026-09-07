import { Routes } from '@angular/router';

/** Cada pantalla se carga bajo demanda. */
export const routes: Routes = [
  {
    path: 'garaje',
    loadComponent: () =>
      import('./pages/garage/garage.page').then((m) => m.GaragePage),
  },
  {
    path: 'vehiculo/nuevo',
    loadComponent: () =>
      import('./pages/vehicle-form/vehicle-form.page').then((m) => m.VehicleFormPage),
  },
  {
    path: 'vehiculo/:id',
    loadComponent: () =>
      import('./pages/vehicle-detail/vehicle-detail.page').then((m) => m.VehicleDetailPage),
  },
  {
    path: 'vehiculo/:id/editar',
    loadComponent: () =>
      import('./pages/vehicle-form/vehicle-form.page').then((m) => m.VehicleFormPage),
  },
  {
    path: 'ajustes',
    loadComponent: () =>
      import('./pages/settings/settings.page').then((m) => m.SettingsPage),
  },
  { path: '', redirectTo: 'garaje', pathMatch: 'full' },
  { path: '**', redirectTo: 'garaje' },
];
