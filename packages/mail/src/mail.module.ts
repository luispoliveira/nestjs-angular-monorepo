import { DynamicModule, Module, Provider, Type } from '@nestjs/common';
import { MongoModule } from '@repo/shared';
import {
  MailModuleAsyncOptions,
  MailModuleOptions,
  MailOptionsFactory,
} from './interfaces/mail.interface';
import { MailProvider } from './interfaces/provider.interface';
import { MailService } from './mail.service';
import { BrevoProvider } from './providers/brevo.provider';
import { ResendProvider } from './providers/resend.provider';

@Module({
  imports: [MongoModule],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {
  static forRoot(options: MailModuleOptions): DynamicModule {
    return {
      module: MailModule,
      providers: [
        {
          provide: 'MAIL_MODULE_OPTIONS',
          useValue: options,
        },
        this.mailProvider,
      ],
    };
  }

  static forRootAsync(options: MailModuleAsyncOptions): DynamicModule {
    return {
      module: MailModule,
      imports: options.imports,
      providers: [...this.createAsyncProviders(options), this.mailProvider],
    };
  }

  /**
   * Resolved from the options rather than at module definition, so the
   * provider can come from validated config (`MAIL_PROVIDER`) instead of
   * being fixed before `ConfigService` exists.
   */
  static createMailProvider(options: MailModuleOptions): MailProvider {
    switch (options.provider) {
      case 'resend':
        return new ResendProvider(options);
      case 'brevo':
        return new BrevoProvider(options);
      default:
        throw new Error(
          `Invalid mail provider: ${String(options.provider as unknown)}`,
        );
    }
  }

  private static readonly mailProvider: Provider = {
    provide: 'MailProvider',
    useFactory: (options: MailModuleOptions) =>
      MailModule.createMailProvider(options),
    inject: ['MAIL_MODULE_OPTIONS'],
  };

  private static createAsyncProviders(
    options: MailModuleAsyncOptions,
  ): Provider[] {
    if (options.useFactory) {
      return [this.createAsyncOptionsProvider(options)];
    }

    const useClass = options.useClass as Type<MailOptionsFactory>;
    return [
      this.createAsyncOptionsProvider(options),
      {
        provide: useClass,
        useClass,
      },
    ];
  }

  private static createAsyncOptionsProvider(
    options: MailModuleAsyncOptions,
  ): Provider {
    if (options.useFactory) {
      return {
        provide: 'MAIL_MODULE_OPTIONS',
        useFactory: options.useFactory,
        inject: options.inject || [],
      };
    }

    return {
      provide: 'MAIL_MODULE_OPTIONS',
      useFactory: (optionsFactory: MailOptionsFactory) =>
        optionsFactory.createMailOptions(),
      inject: [options.useClass as Type<MailOptionsFactory>],
    };
  }
}
