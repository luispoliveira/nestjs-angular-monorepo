import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongoService } from '@repo/shared';
import { EnvironmentEnum } from '@repo/shared-types';
import type { Mail, MailModuleOptions } from './interfaces/mail.interface';
import type { MailProvider } from './interfaces/provider.interface';

const MAX_RETRIES = 0; // Set to 0 to disable retries, adjust as needed
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    @Inject('MailProvider') private readonly mailProvider: MailProvider,
    @Inject('MAIL_MODULE_OPTIONS')
    private readonly options: MailModuleOptions,
    private readonly mongoService: MongoService,
    private readonly configService: ConfigService,
  ) {}

  private async sendWithRetry(
    mail: Mail,
    retries = MAX_RETRIES,
    attempt = 1,
  ): Promise<void> {
    try {
      await this.mailProvider.send(mail);
      await this.logEmail(mail);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Attempt ${attempt} failed to send email: ${errorMessage}`,
      );

      if (retries > 0) {
        const delayMs = Math.pow(2, attempt - 1) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return this.sendWithRetry(mail, retries - 1, attempt + 1);
      } else {
        this.logger.error('All attempts to send email failed.');
        throw new Error(
          `Failed to send email after multiple attempts: ${errorMessage}`,
        );
      }
    }
  }

  async send(mail: Mail): Promise<void> {
    const isDev =
      this.configService.get<EnvironmentEnum>(
        'NODE_ENV',
        EnvironmentEnum.DEVELOPMENT,
      ) === EnvironmentEnum.DEVELOPMENT;

    const mailToSend = { ...mail };

    if (isDev && !this.options.devEmail) {
      this.logger.warn(
        'Development mode: No devEmail configured. Email will not be sent.',
      );
      return;
    }

    if (isDev && this.options.devEmail) {
      this.logger.warn(
        `Development mode: Redirecting email to ${this.options.devEmail}`,
      );
      mailToSend.subject = `[DEV MODE - ${mail.to.map((r) => r.email).join(', ')}] ${mail.subject || ''}`;
      mailToSend.to = [{ name: 'Dev', email: this.options.devEmail }];
      delete mailToSend.cc;
      delete mailToSend.bcc;
    }

    return this.sendWithRetry(mailToSend);
  }

  private async logEmail(mail: Mail) {
    await this.mongoService.createEmailLog({
      to: mail.to,
      from: {
        email: this.options.fromEmail || '',
        name: this.options.fromName || '',
      },
      subject: mail.subject || '',
      text: mail.text || '',
      templateId: `${mail.templateId}`,
      params: mail.data || {},
    });
  }
}
