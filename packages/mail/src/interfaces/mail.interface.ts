import {
  InjectionToken,
  ModuleMetadata,
  OptionalFactoryDependency,
  Type,
} from '@nestjs/common';

export interface MailRecipient {
  name?: string;
  email: string;
}

export interface MailAttachment {
  filename: string;
  content: Buffer;
}

export interface Mail {
  to: MailRecipient[];
  cc?: MailRecipient[];
  bcc?: MailRecipient[];
  subject?: string;
  text?: string;
  html?: string;
  templateId?: string;
  data?: Record<string, unknown>;
  attachments?: MailAttachment[];
}

export type MailProviderName = 'brevo' | 'resend';

export interface MailModuleOptions {
  provider: MailProviderName;
  apiKey: string;
  fromEmail: string;
  fromName?: string;
  devEmail?: string;
}

export interface MailOptionsFactory {
  createMailOptions(): Promise<MailModuleOptions> | MailModuleOptions;
}

export interface MailModuleAsyncOptions extends Pick<
  ModuleMetadata,
  'imports'
> {
  useExisting?: Type<MailOptionsFactory>;
  useClass?: Type<MailOptionsFactory>;
  useFactory?: (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...args: any[]
  ) => Promise<MailModuleOptions> | MailModuleOptions;
  inject?: Array<InjectionToken | OptionalFactoryDependency>;
}
