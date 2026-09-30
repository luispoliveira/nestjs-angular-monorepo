import { DynamicModule } from '@nestjs/common';
import { SentryModule } from '@sentry/nestjs/setup';
import { SharedModule } from './shared.module';

describe('SharedModule', () => {
  it('should register SentryModule first so every app gets route-named transactions', () => {
    const { imports = [] } = SharedModule.register();
    expect((imports[0] as DynamicModule).module).toBe(SentryModule);
  });
});
