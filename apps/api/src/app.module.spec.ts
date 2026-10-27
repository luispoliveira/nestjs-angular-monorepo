import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import {
  AuditContextGuard,
  AuditInterceptor,
  MicroserviceAuthGuard,
  RolesGuard,
} from '@repo/shared';
import { AppModule } from './app.module';

type ProviderEntry = { provide: unknown; useClass?: unknown };
const providers = Reflect.getMetadata(
  'providers',
  AppModule,
) as ProviderEntry[];
const guardsInOrder = providers
  .filter((p) => p.provide === APP_GUARD)
  .map((p) => p.useClass);

describe('AppModule', () => {
  // Nest runs global guards in registration order (design.md → D5):
  // AuditContextGuard has to run first so a 401/403 from a later guard still
  // finds the @Audit metadata on the request.
  it('registers AuditContextGuard before the authentication and role guards', () => {
    expect(guardsInOrder).toEqual([
      AuditContextGuard,
      MicroserviceAuthGuard,
      RolesGuard,
    ]);
  });

  it('registers the AuditInterceptor globally', () => {
    expect(
      providers.some(
        (p) => p.provide === APP_INTERCEPTOR && p.useClass === AuditInterceptor,
      ),
    ).toBe(true);
  });
});
