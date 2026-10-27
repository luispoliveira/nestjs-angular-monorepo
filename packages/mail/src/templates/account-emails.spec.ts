import {
  escapeHtml,
  renderAccountActivatedEmail,
  renderAccountInvitationEmail,
} from './account-emails';

const link = 'https://app.example.com/reset-password?token=abc123';

describe('renderAccountInvitationEmail', () => {
  const email = renderAccountInvitationEmail({ invitationLink: link });

  it('has an English subject', () => {
    expect(email.subject).toBe('Your account has been created');
  });

  it('puts the full link in the html (as a button and as plain text) and in the text body', () => {
    expect(email.html).toContain(`href="${link}"`);
    expect(email.text).toContain(link);
  });

  it('states the one-hour expiry and how to request a new link', () => {
    for (const body of [email.html, email.text]) {
      expect(body).toContain('1 hour');
      expect(body.toLowerCase()).toContain('sign-in page');
    }
  });

  it('escapes the link in html but keeps it verbatim in the text body', () => {
    const hostile = 'https://app.example.com/x?a=1&b="2"<s>';
    const out = renderAccountInvitationEmail({ invitationLink: hostile });
    expect(out.html).not.toContain(hostile);
    expect(out.html).toContain(escapeHtml(hostile));
    expect(out.html).not.toContain('<s>');
    expect(out.text).toContain(hostile);
  });

  it('is a complete html document', () => {
    expect(email.html.startsWith('<!DOCTYPE html>')).toBe(true);
  });
});

describe('renderAccountActivatedEmail', () => {
  const email = renderAccountActivatedEmail();

  it('has an English subject', () => {
    expect(email.subject).toBe('Your account is active');
  });

  it('tells the user they can sign in, in both bodies', () => {
    expect(email.html).toContain('You can now sign in');
    expect(email.text).toContain('You can now sign in');
  });

  it('carries no link and no credentials', () => {
    expect(email.html).not.toContain('href=');
    expect(email.text).not.toMatch(/https?:\/\//);
  });
});

describe('escapeHtml', () => {
  it('escapes the five html-significant characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
  });
});
