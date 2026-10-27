import type { MailModuleOptions } from './interfaces/mail.interface';
import { MailModule } from './mail.module';
import { BrevoProvider } from './providers/brevo.provider';
import { ResendProvider } from './providers/resend.provider';

jest.mock('@getbrevo/brevo', () => ({ BrevoClient: jest.fn() }));
jest.mock('resend', () => ({ Resend: jest.fn() }));

const options = (provider: string): MailModuleOptions =>
  ({
    provider,
    apiKey: 'key',
    fromEmail: 'no-reply@example.com',
  }) as MailModuleOptions;

describe('MailModule.createMailProvider', () => {
  it('resolves Brevo from the options', () => {
    expect(MailModule.createMailProvider(options('brevo'))).toBeInstanceOf(
      BrevoProvider,
    );
  });

  it('resolves Resend from the options', () => {
    expect(MailModule.createMailProvider(options('resend'))).toBeInstanceOf(
      ResendProvider,
    );
  });

  it('throws for an unknown provider, naming it', () => {
    expect(() => MailModule.createMailProvider(options('sendgrid'))).toThrow(
      /Invalid mail provider: sendgrid/,
    );
  });
});
