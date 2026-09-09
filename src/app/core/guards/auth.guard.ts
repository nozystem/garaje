import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from '../services/auth.service';

/** Deja pasar solo con sesión iniciada. */
export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  await auth.restore();

  return auth.isLoggedIn() ? true : router.createUrlTree(['/entrar']);
};

/** Lo contrario: si ya hay sesión, la pantalla de acceso sobra. */
export const guestGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  await auth.restore();

  return auth.isLoggedIn() ? router.createUrlTree(['/garaje']) : true;
};
