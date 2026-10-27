import { BrevoClient } from '@getbrevo/brevo';
import { SendTransacEmailRequest } from '@getbrevo/brevo/transactionalEmails';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Mail, MailModuleOptions } from '../interfaces/mail.interface';
import { MailProvider } from '../interfaces/provider.interface';

@Injectable()
export class BrevoProvider implements MailProvider {
  private readonly logger = new Logger(BrevoProvider.name);
  private readonly brevo: BrevoClient;

  constructor(
    @Inject('MAIL_MODULE_OPTIONS')
    private readonly options: MailModuleOptions,
  ) {
    this.brevo = new BrevoClient({
      apiKey: this.options.apiKey,
    });
  }

  async send(mail: Mail): Promise<void> {
    const request: SendTransacEmailRequest = {};

    request.sender = {
      email: this.options.fromEmail,
      name: this.options.fromName,
    };
    request.to = mail.to;
    request.subject = mail.subject;
    request.textContent = mail.text;
    if (mail.html) request.htmlContent = mail.html;

    if (mail.cc) request.cc = mail.cc;

    if (mail.bcc) request.bcc = mail.bcc;

    if (mail.templateId) request.templateId = Number(mail.templateId);
    if (mail.data) request.params = mail.data;

    if (mail.attachments)
      request.attachment = mail.attachments.map((att) => ({
        name: att.filename,
        content: att.content.toString('base64'),
      }));

    try {
      this.logger.log(
        `Sending email to ${mail.to.map((r) => r.email).join(', ')}`,
      );
      await this.brevo.transactionalEmails.sendTransacEmail(request);
      this.logger.log('Email sent successfully.');
    } catch (error) {
      this.logger.error('Failed to send email with Brevo', error);
      // The error will be caught by the MailService's retry logic
      throw error;
    }
  }
}
