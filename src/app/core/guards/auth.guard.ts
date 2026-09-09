import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  await auth.restore();

  return auth.isLoggedIn() ? true : router.createUrlTree(['/sign-in']);
};

export const guestGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  await auth.restore();

  return auth.isLoggedIn() ? router.createUrlTree(['/garage']) : true;
};
