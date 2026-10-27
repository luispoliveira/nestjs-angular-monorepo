import { provideHttpClient, withFetch } from '@angular/common/http';
import { ApplicationConfig, isDevMode, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { routes } from './app.routes';
import { createQueryClient } from './query-client';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    // apps/api (same-origin /api) — see features/customers/customers.api.ts
    provideHttpClient(withFetch()),
    provideTanStackQuery(createQueryClient()),
    // Production builds only: `ng serve` must never serve a stale cached shell.
    // Waits for the app to settle (or 30 s) so registration never competes with
    // the first render.
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
