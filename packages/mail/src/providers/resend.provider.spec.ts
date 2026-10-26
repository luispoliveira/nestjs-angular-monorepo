import { Resend } from 'resend';
import type { Mail, MailModuleOptions } from '../interfaces/mail.interface';
import { ResendProvider } from './resend.provider';

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: jest.fn().mockResolvedValue({ data: { id: 'e1' }, error: null }) },
  })),
}));

const mailOptions: MailModuleOptions = {
  provider: 'resend',
  apiKey: 're_test_key',
  fromEmail: 'no-reply@example.com',
  fromName: 'App',
};

describe('ResendProvider', () => {
  let send: jest.Mock;

  const build = (options: MailModuleOptions = mailOptions) => {
    jest.clearAllMocks();
    const provider = new ResendProvider(options);
    const instance = (Resend as unknown as jest.Mock).mock.results[0]?.value as {
      emails: { send: jest.Mock };
    };
    send = instance.emails.send;
    return provider;
  };

  it('creates the client with the configured API key', () => {
    build();
    expect(Resend).toHaveBeenCalledWith('re_test_key');
  });

  it('sends from "FROM_NAME <FROM_EMAIL>" with subject, html and text', async () => {
    const mail: Mail = {
      to: [{ email: 'user@test.com', name: 'User' }],
      subject: 'Hello',
      html: '<p>Hi</p>',
      text: 'Hi',
    };

    await build().send(mail);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'App <no-reply@example.com>',
        to: ['User <user@test.com>'],
        subject: 'Hello',
        html: '<p>Hi</p>',
        text: 'Hi',
      }),
    );
  });

  it('uses the bare address as sender when FROM_NAME is not set', async () => {
    await build({ ...mailOptions, fromName: undefined }).send({
      to: [{ email: 'user@test.com' }],
      text: 'x',
    });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'no-reply@example.com', to: ['user@test.com'] }),
    );
  });

  it('maps cc, bcc and attachments', async () => {
    await build().send({
      to: [{ email: 'to@test.com' }],
      cc: [{ email: 'cc@test.com' }],
      bcc: [{ email: 'bcc@test.com', name: 'B' }],
      attachments: [{ filename: 'f.txt', content: Buffer.from('hello') }],
    });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        cc: ['cc@test.com'],
        bcc: ['B <bcc@test.com>'],
        attachments: [{ filename: 'f.txt', content: Buffer.from('hello') }],
      }),
    );
  });

  it('throws with the provider message when Resend returns an error result', async () => {
    const provider = build();
    send.mockResolvedValue({
      data: null,
      error: { name: 'validation_error', message: 'The domain is not verified' },
    });

    await expect(provider.send({ to: [{ email: 'a@b.com' }] })).rejects.toThrow(
      'The domain is not verified',
    );
  });

  it('re-throws when the SDK throws', async () => {
    const provider = build();
    send.mockRejectedValue(new Error('network down'));

    await expect(provider.send({ to: [{ email: 'a@b.com' }] })).rejects.toThrow(
      'network down',
    );
  });
});
