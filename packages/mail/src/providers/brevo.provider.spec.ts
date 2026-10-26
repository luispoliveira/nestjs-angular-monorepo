import { BrevoClient } from '@getbrevo/brevo';
import type { Mail, MailModuleOptions } from '../interfaces/mail.interface';
import { BrevoProvider } from './brevo.provider';

jest.mock('@getbrevo/brevo', () => ({
  BrevoClient: jest.fn().mockImplementation(() => ({
    transactionalEmails: {
      sendTransacEmail: jest.fn().mockResolvedValue({}),
    },
  })),
}));

const mailOptions: MailModuleOptions = {
  provider: 'brevo',
  apiKey: 'brevo-test-key',
  fromEmail: 'noreply@example.com',
  fromName: 'Test Sender',
};

describe('BrevoProvider', () => {
  let provider: BrevoProvider;
  let mockSendTransacEmail: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new BrevoProvider(mailOptions);
    const brevoInstance = (BrevoClient as jest.Mock).mock.results[0]?.value as { transactionalEmails: { sendTransacEmail: jest.Mock } };
    mockSendTransacEmail = brevoInstance?.transactionalEmails.sendTransacEmail;
  });

  it('should call sendTransacEmail with correct sender and recipient', async () => {
    const mail: Mail = {
      to: [{ email: 'user@test.com', name: 'User' }],
      subject: 'Hello',
      text: 'Body text',
    };

    await provider.send(mail);

    expect(mockSendTransacEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        sender: { email: 'noreply@example.com', name: 'Test Sender' },
        to: [{ email: 'user@test.com', name: 'User' }],
        subject: 'Hello',
      }),
    );
  });

  it('should send the html body as htmlContent alongside the text body', async () => {
    await provider.send({
      to: [{ email: 'user@test.com' }],
      subject: 'Hello',
      html: '<p>Hi</p>',
      text: 'Hi',
    });

    expect(mockSendTransacEmail).toHaveBeenCalledWith(
      expect.objectContaining({ htmlContent: '<p>Hi</p>', textContent: 'Hi' }),
    );
  });

  it('should include cc and bcc when provided', async () => {
    const mail: Mail = {
      to: [{ email: 'to@test.com' }],
      cc: [{ email: 'cc@test.com' }],
      bcc: [{ email: 'bcc@test.com' }],
    };

    await provider.send(mail);

    expect(mockSendTransacEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        cc: [{ email: 'cc@test.com' }],
        bcc: [{ email: 'bcc@test.com' }],
      }),
    );
  });

  it('should include templateId and params when provided', async () => {
    const mail: Mail = {
      to: [{ email: 'to@test.com' }],
      templateId: '42',
      data: { userName: 'Alice' },
    };

    await provider.send(mail);

    expect(mockSendTransacEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        templateId: 42,
        params: { userName: 'Alice' },
      }),
    );
  });

  it('should encode attachments to base64', async () => {
    const mail: Mail = {
      to: [{ email: 'to@test.com' }],
      attachments: [
        { filename: 'file.txt', content: Buffer.from('hello') },
      ],
    };

    await provider.send(mail);

    expect(mockSendTransacEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        attachment: [{ name: 'file.txt', content: Buffer.from('hello').toString('base64') }],
      }),
    );
  });

  it('should re-throw errors from the Brevo client', async () => {
    mockSendTransacEmail.mockRejectedValue(new Error('API error'));

    await expect(provider.send({ to: [{ email: 'a@b.com' }] })).rejects.toThrow('API error');
  });
});
