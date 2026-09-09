import { Routes } from '@angular/router';

import { authGuard, guestGuard } from './core/guards/auth.guard';

/** Cada pantalla se carga bajo demanda. */
export const routes: Routes = [
  {
    path: 'entrar',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./pages/auth/auth.page').then((m) => m.AuthPage),
  },
  {
    path: 'garaje',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/garage/garage.page').then((m) => m.GaragePage),
  },
  {
    path: 'vehiculo/nuevo',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/vehicle-form/vehicle-form.page').then((m) => m.VehicleFormPage),
  },
  {
    path: 'vehiculo/:id',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/vehicle-detail/vehicle-detail.page').then((m) => m.VehicleDetailPage),
  },
  {
    path: 'vehiculo/:id/editar',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/vehicle-form/vehicle-form.page').then((m) => m.VehicleFormPage),
  },
  {
    path: 'ajustes',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/settings/settings.page').then((m) => m.SettingsPage),
  },
  { path: '', redirectTo: 'garaje', pathMatch: 'full' },
  { path: '**', redirectTo: 'garaje' },
];
