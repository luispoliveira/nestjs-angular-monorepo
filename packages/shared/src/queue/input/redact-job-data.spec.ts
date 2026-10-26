import * as inputs from './index';
import { REDACTED_JOB_DATA_FIELDS, redactJobData } from './redact-job-data';

type ZodLike = {
  def: {
    type: string;
    format?: string;
    innerType?: ZodLike;
    shape?: Record<string, ZodLike>;
  };
  shape?: Record<string, ZodLike>;
};

const isObjectSchema = (value: unknown): value is Required<ZodLike> =>
  typeof value === 'object' &&
  value !== null &&
  (value as ZodLike).def?.type === 'object' &&
  !!(value as ZodLike).shape;

// optional()/nullable()/default() wrap the real type in `def.innerType`.
const unwrap = (schema: ZodLike): ZodLike =>
  schema.def.innerType ? unwrap(schema.def.innerType) : schema;

describe('redactJobData', () => {
  const schemas = Object.values(inputs).filter(isObjectSchema);

  it('finds the job input schemas it guards', () => {
    expect(schemas.length).toBeGreaterThanOrEqual(6);
  });

  it('lists every URL field of every job input schema', () => {
    const urlFields = schemas.flatMap((schema) =>
      Object.entries(schema.shape)
        .filter(([, field]) => unwrap(field).def.format === 'url')
        .map(([name]) => name),
    );

    expect(urlFields.length).toBeGreaterThan(0);
    for (const name of urlFields) {
      expect(REDACTED_JOB_DATA_FIELDS).toContain(name);
    }
  });

  it('replaces the account links and keeps every other field', () => {
    const data = {
      email: 'user@example.com',
      resetLink: 'https://app.test/reset?token=secret',
      verificationLink: 'https://app.test/verify?token=secret',
      correlationId: 'c0ffee00-0000-4000-8000-000000000000',
    };

    expect(redactJobData(data)).toEqual({
      email: 'user@example.com',
      resetLink: '[redacted]',
      verificationLink: '[redacted]',
      correlationId: 'c0ffee00-0000-4000-8000-000000000000',
    });
  });

  it('replaces the account invitation link too', () => {
    expect(
      redactJobData({
        email: 'user@example.com',
        invitationLink: 'https://app.test/reset-password?token=secret',
      }),
    ).toEqual({ email: 'user@example.com', invitationLink: '[redacted]' });
  });

  it('does not mutate the stored job data', () => {
    const data = { email: 'user@example.com', resetLink: 'https://x.test/t' };

    redactJobData(data);

    expect(data.resetLink).toBe('https://x.test/t');
  });

  it('does not add a field a job never had', () => {
    expect(redactJobData({ email: 'user@example.com' })).toEqual({
      email: 'user@example.com',
    });
  });

  it.each([null, undefined, 'text', 42, ['a']])(
    'returns a non-object payload (%p) unchanged',
    (value) => {
      expect(redactJobData(value)).toBe(value);
    },
  );
});
