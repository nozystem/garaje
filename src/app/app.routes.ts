import { Routes } from '@angular/router';

import { authGuard, guestGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  {
    path: 'sign-in',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./pages/auth/auth.page').then((m) => m.AuthPage),
  },
  {
    path: 'garage',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/garage/garage.page').then((m) => m.GaragePage),
  },
  {
    path: 'vehicle/new',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/vehicle-form/vehicle-form.page').then((m) => m.VehicleFormPage),
  },
  {
    path: 'vehicle/:id',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/vehicle-detail/vehicle-detail.page').then((m) => m.VehicleDetailPage),
  },
  {
    path: 'vehicle/:id/edit',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/vehicle-form/vehicle-form.page').then((m) => m.VehicleFormPage),
  },
  {
    path: 'settings',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/settings/settings.page').then((m) => m.SettingsPage),
  },
  { path: '', redirectTo: 'garage', pathMatch: 'full' },
  { path: '**', redirectTo: 'garage' },
];
