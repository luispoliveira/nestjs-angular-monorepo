/**
 * Job data fields that carry a live account link (password reset, email
 * verification, account invitation). Whoever can read one can act as the account owner, so they
 * never leave the worker unredacted — not even to an admin dashboard. Add a
 * field here when a job input gains another link; the spec beside this file
 * fails if a URL field is missing.
 */
export const REDACTED_JOB_DATA_FIELDS = [
  'resetLink',
  'verificationLink',
  'invitationLink',
] as const;

export const REDACTED_PLACEHOLDER = '[redacted]';

/** A display copy of job data: stored data is never touched. */
export function redactJobData<T>(data: T): T {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return data;
  }
  const copy = { ...(data as Record<string, unknown>) };
  for (const field of REDACTED_JOB_DATA_FIELDS) {
    if (field in copy) copy[field] = REDACTED_PLACEHOLDER;
  }
  return copy as T;
}
