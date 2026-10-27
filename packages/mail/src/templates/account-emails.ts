/**
 * Account-lifecycle email templates (invitation, activation). Plain HTML in
 * code; email clients ignore external CSS and custom properties, so the shell
 * is a table layout with inline styles and literal, neutral colours — replace
 * `ACCENT` with the project's brand colour.
 */

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const ACCENT = '#2563eb';
const LINK_TTL_MINUTES = 60;

export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

type Block =
  | { paragraph: string }
  | { button: { label: string; href: string } };

const renderBlock = (block: Block): string =>
  'paragraph' in block
    ? `<p style="margin:0 0 16px;font-size:15px;line-height:22px;color:#1f2937;">${escapeHtml(block.paragraph)}</p>`
    : `<p style="margin:24px 0;"><a href="${escapeHtml(block.button.href)}" style="display:inline-block;padding:12px 24px;border-radius:8px;background:${ACCENT};color:#ffffff;font-weight:600;font-size:15px;text-decoration:none;">${escapeHtml(block.button.label)}</a></p>
<p style="margin:0 0 16px;font-size:13px;line-height:20px;color:#6b7280;">If the button does not work, copy this link into your browser:<br><a href="${escapeHtml(block.button.href)}" style="color:${ACCENT};word-break:break-all;">${escapeHtml(block.button.href)}</a></p>`;

const layout = (title: string, blocks: Block[]): string => `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;padding:32px;">
<tr><td>
<h1 style="margin:0 0 24px;font-size:22px;line-height:28px;color:#0b1220;">${escapeHtml(title)}</h1>
${blocks.map(renderBlock).join('\n')}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

const toText = (blocks: Block[]): string =>
  blocks
    .map((block) =>
      'paragraph' in block
        ? block.paragraph
        : `${block.button.label}: ${block.button.href}`,
    )
    .join('\n\n');

const render = (subject: string, blocks: Block[]): RenderedEmail => ({
  subject,
  html: layout(subject, blocks),
  text: toText(blocks),
});

export const renderAccountInvitationEmail = ({
  invitationLink,
}: {
  invitationLink: string;
}): RenderedEmail => {
  const hours = LINK_TTL_MINUTES / 60;
  return render('Your account has been created', [
    {
      paragraph:
        'An administrator created an account for you. Choose a password to activate it.',
    },
    { button: { label: 'Set your password', href: invitationLink } },
    {
      paragraph: `This link expires in ${hours} hour. If it has expired, request a new one from the sign-in page.`,
    },
  ]);
};

export const renderAccountActivatedEmail = (): RenderedEmail =>
  render('Your account is active', [
    { paragraph: 'Your password is set and your account is active.' },
    { paragraph: 'You can now sign in with your email and password.' },
  ]);
