import { Inject, Injectable, Logger } from '@nestjs/common';
import { CreateEmailOptions, Resend } from 'resend';
import type {
  Mail,
  MailModuleOptions,
  MailRecipient,
} from '../interfaces/mail.interface';
import { MailProvider } from '../interfaces/provider.interface';

const toAddress = ({ name, email }: MailRecipient) =>
  name ? `${name} <${email}>` : email;

@Injectable()
export class ResendProvider implements MailProvider {
  private readonly logger = new Logger(ResendProvider.name);
  private readonly resend: Resend;

  constructor(
    @Inject('MAIL_MODULE_OPTIONS')
    private readonly options: MailModuleOptions,
  ) {
    this.resend = new Resend(this.options.apiKey);
  }

  async send(mail: Mail): Promise<void> {
    // ponytail: templateId/data are Brevo-hosted templates; Resend-hosted
    // templates are a later change, so only html/text bodies are sent here.
    const request = {
      from: toAddress({
        name: this.options.fromName,
        email: this.options.fromEmail,
      }),
      to: mail.to.map(toAddress),
      subject: mail.subject ?? '',
      html: mail.html,
      text: mail.text,
      ...(mail.cc && { cc: mail.cc.map(toAddress) }),
      ...(mail.bcc && { bcc: mail.bcc.map(toAddress) }),
      ...(mail.attachments && {
        attachments: mail.attachments.map(({ filename, content }) => ({
          filename,
          content,
        })),
      }),
    } as CreateEmailOptions;

    this.logger.log(
      `Sending email to ${mail.to.map((r) => r.email).join(', ')}`,
    );

    // The SDK resolves `{ error }` instead of throwing on API errors; throw
    // so MailService's catch and the queue's retry/DLQ see the failure.
    const { error } = await this.resend.emails.send(request);
    if (error) {
      this.logger.error(
        `Failed to send email with Resend: [${error.name}] ${error.message}`,
      );
      throw new Error(`Resend: [${error.name}] ${error.message}`);
    }

    this.logger.log('Email sent successfully.');
  }
}
