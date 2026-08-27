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
