export const MESSAGE_PATTERNS = {
  AUTH_AUTHENTICATE: 'auth:authenticate',
  DLQ_LIST: 'dlq:list',
  DLQ_REPLAY: 'dlq:replay',
  DLQ_PURGE: 'dlq:purge',
} as const;

export const EVENT_PATTERNS = {
  USER_CREATED: 'user:created',
  USER_PASSWORD_RESET_REQUESTED: 'user:password_reset_requested',
  USER_PASSWORD_CHANGED: 'user:password_changed',
  USER_EMAIL_VERIFICATION_REQUESTED: 'user:email_verification_requested',
  USER_TWO_FACTOR_ENABLED: 'user:two_factor_enabled',
  USER_TWO_FACTOR_DISABLED: 'user:two_factor_disabled',
  USER_INVITED: 'user:invited',
  USER_ACCOUNT_ACTIVATED: 'user:account_activated',
} as const;
