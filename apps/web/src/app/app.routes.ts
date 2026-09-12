import { Routes } from '@angular/router';
import { adminGuard } from './auth/admin.guard';
import { authGuard, guestGuard } from './auth/auth.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'sign-in' },
  {
    path: 'sign-in',
    loadComponent: () => import('./features/sign-in/sign-in').then((m) => m.SignIn),
    canActivate: [guestGuard],
  },
  // No guestGuard on these three: unlike /sign-in, an already-authenticated
  // session (e.g. an admin clicking a stale link, or a browser signed into a
  // different account) must not be bounced away before the token is used —
  // each carries its own proof (the URL token / the 2FA challenge cookie).
  {
    path: 'two-factor',
    loadComponent: () => import('./features/two-factor/two-factor').then((m) => m.TwoFactor),
  },
  {
    path: 'reset-password',
    loadComponent: () => import('./features/reset-password/reset-password').then((m) => m.ResetPassword),
  },
  {
    path: 'verify-email',
    loadComponent: () => import('./features/verify-email/verify-email').then((m) => m.VerifyEmail),
  },
  {
    path: '',
    loadComponent: () => import('./shell/shell').then((m) => m.Shell),
    canActivate: [authGuard],
    children: [
      {
        path: 'dashboard',
        loadComponent: () => import('./features/dashboard/dashboard').then((m) => m.Dashboard),
      },
      {
        path: 'account',
        loadComponent: () => import('./features/account/account').then((m) => m.Account),
      },
      {
        path: 'users',
        loadComponent: () => import('./features/users/users').then((m) => m.Users),
        canActivate: [adminGuard],
      },
      {
        path: 'users/:id',
        loadComponent: () => import('./features/users/user-detail/user-detail').then((m) => m.UserDetail),
        canActivate: [adminGuard],
      },
    ],
  },
];
