import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoService } from '@repo/shared';
import { EnvironmentEnum } from '@repo/shared-types';
import type { Mail, MailModuleOptions } from './interfaces/mail.interface';
import type { MailProvider } from './interfaces/provider.interface';
import { MailService } from './mail.service';

const mockMail: Mail = {
  to: [{ email: 'user@example.com', name: 'User' }],
  subject: 'Test Subject',
  text: 'Hello',
  templateId: '1',
};

const mailOptions: MailModuleOptions = {
  provider: 'brevo',
  apiKey: 'test-key',
  fromEmail: 'noreply@example.com',
  fromName: 'Test App',
};

describe('MailService', () => {
  let service: MailService;
  let mailProvider: jest.Mocked<MailProvider>;
  let mongoService: jest.Mocked<MongoService>;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    mailProvider = { send: jest.fn().mockResolvedValue(undefined) };
    mongoService = { createEmailLog: jest.fn().mockResolvedValue(undefined) } as unknown as jest.Mocked<MongoService>;
    configService = { get: jest.fn() } as unknown as jest.Mocked<ConfigService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        { provide: 'MailProvider', useValue: mailProvider },
        { provide: 'MAIL_MODULE_OPTIONS', useValue: mailOptions },
        { provide: MongoService, useValue: mongoService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<MailService>(MailService);
  });

  describe('send — production mode', () => {
    beforeEach(() => {
      configService.get.mockReturnValue(EnvironmentEnum.PRODUCTION);
    });

    it('should call mailProvider.send with the mail as-is', async () => {
      await service.send(mockMail);
      expect(mailProvider.send).toHaveBeenCalledWith(expect.objectContaining({ to: mockMail.to }));
    });

    it('should log email to MongoDB after successful send', async () => {
      await service.send(mockMail);
      expect(mongoService.createEmailLog).toHaveBeenCalledWith(
        expect.objectContaining({ subject: 'Test Subject' }),
      );
    });

    it('should throw wrapped error when provider fails', async () => {
      mailProvider.send.mockRejectedValue(new Error('SMTP error'));
      await expect(service.send(mockMail)).rejects.toThrow(
        'Failed to send email after multiple attempts: SMTP error',
      );
    });

    it('should not write an email log entry when the provider rejects the send', async () => {
      mailProvider.send.mockRejectedValue(new Error('domain not verified'));
      await expect(service.send(mockMail)).rejects.toThrow('domain not verified');
      expect(mongoService.createEmailLog).not.toHaveBeenCalled();
    });
  });

  describe('send — development mode, no devEmail', () => {
    beforeEach(() => {
      configService.get.mockReturnValue(EnvironmentEnum.DEVELOPMENT);
    });

    it('should return early without sending when no devEmail is configured', async () => {
      const optionsWithoutDevEmail = { ...mailOptions };
      delete optionsWithoutDevEmail.devEmail;

      const mod = await Test.createTestingModule({
        providers: [
          MailService,
          { provide: 'MailProvider', useValue: mailProvider },
          { provide: 'MAIL_MODULE_OPTIONS', useValue: optionsWithoutDevEmail },
          { provide: MongoService, useValue: mongoService },
          { provide: ConfigService, useValue: configService },
        ],
      }).compile();

      const svc = mod.get<MailService>(MailService);
      await svc.send(mockMail);
      expect(mailProvider.send).not.toHaveBeenCalled();
    });
  });

  describe('send — development mode, with devEmail', () => {
    const devOptions: MailModuleOptions = { ...mailOptions, devEmail: 'dev@example.com' };

    beforeEach(async () => {
      configService.get.mockReturnValue(EnvironmentEnum.DEVELOPMENT);

      const mod = await Test.createTestingModule({
        providers: [
          MailService,
          { provide: 'MailProvider', useValue: mailProvider },
          { provide: 'MAIL_MODULE_OPTIONS', useValue: devOptions },
          { provide: MongoService, useValue: mongoService },
          { provide: ConfigService, useValue: configService },
        ],
      }).compile();

      service = mod.get<MailService>(MailService);
    });

    it('should redirect email to devEmail address', async () => {
      await service.send(mockMail);
      expect(mailProvider.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: [{ name: 'Dev', email: 'dev@example.com' }],
        }),
      );
    });

    it('should prepend [DEV MODE] to subject', async () => {
      await service.send(mockMail);
      const sentMail = mailProvider.send.mock.calls[0][0] as Mail;
      expect(sentMail.subject).toContain('[DEV MODE');
      expect(sentMail.subject).toContain('user@example.com');
    });
  });
});
