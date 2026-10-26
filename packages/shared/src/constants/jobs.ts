export const JOB_PATTERNS = {
  SEND_WELCOME_EMAIL: 'job:send_welcome_email',
  SEND_PASSWORD_RESET_EMAIL: 'job:send_password_reset_email',
  SEND_PASSWORD_CHANGED_EMAIL: 'job:send_password_changed_email',
  SEND_EMAIL_VERIFICATION_EMAIL: 'job:send_email_verification_email',
  SEND_TWO_FACTOR_ENABLED_EMAIL: 'job:send_two_factor_enabled_email',
  SEND_TWO_FACTOR_DISABLED_EMAIL: 'job:send_two_factor_disabled_email',
  SEND_ACCOUNT_INVITATION_EMAIL: 'job:send_account_invitation_email',
  SEND_ACCOUNT_ACTIVATED_EMAIL: 'job:send_account_activated_email',
} as const;
