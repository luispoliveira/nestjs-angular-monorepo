import z from 'zod';
import { zodValidator } from './zod.validator.js';

// Minimal AbstractControl-shaped mocks — zodValidator only relies on
// `.value`, `.controls`, `.errors`, and `.setErrors()`, so a real
// @angular/forms FormGroup isn't needed (and would require an ESM-capable
// test runner, since @angular/forms ships as .mjs only).
function makeControl(errors: Record<string, unknown> | null = null) {
  const control = {
    errors,
    setErrors(next: Record<string, unknown> | null) {
      control.errors = next;
    },
  };
  return control;
}

function makeGroup(
  value: Record<string, unknown>,
  controls: Record<string, ReturnType<typeof makeControl>>,
) {
  return { value, controls } as unknown as Parameters<
    ReturnType<typeof zodValidator>
  >[0];
}

const testSchema = z.object({
  name: z.string().min(1, 'Full name is required'),
  email: z.email('Invalid email address'),
  role: z.enum(['admin', 'user']),
});

describe('zodValidator', () => {
  it('returns null and clears no field errors for a valid value', () => {
    const nameControl = makeControl();
    const emailControl = makeControl();
    const roleControl = makeControl();
    const group = makeGroup(
      { name: 'Ada', email: 'ada@example.com', role: 'admin' },
      { name: nameControl, email: emailControl, role: roleControl },
    );

    const result = zodValidator(testSchema)(group);

    expect(result).toBeNull();
    expect(nameControl.errors).toBeNull();
  });

  it('reports a required-field violation against the correct control', () => {
    const nameControl = makeControl();
    const emailControl = makeControl();
    const roleControl = makeControl();
    const group = makeGroup(
      { name: '', email: 'ada@example.com', role: 'admin' },
      { name: nameControl, email: emailControl, role: roleControl },
    );

    const result = zodValidator(testSchema)(group);

    expect(result).toEqual({ zod: { name: 'Full name is required' } });
    expect(nameControl.errors).toEqual({ zod: 'Full name is required' });
    expect(emailControl.errors).toBeNull();
    expect(roleControl.errors).toBeNull();
  });

  it('reports a malformed-email violation against the email control', () => {
    const nameControl = makeControl();
    const emailControl = makeControl();
    const roleControl = makeControl();
    const group = makeGroup(
      { name: 'Ada', email: 'not-an-email', role: 'admin' },
      { name: nameControl, email: emailControl, role: roleControl },
    );

    const result = zodValidator(testSchema)(group);

    expect(result).toEqual({ zod: { email: 'Invalid email address' } });
    expect(emailControl.errors).toEqual({ zod: 'Invalid email address' });
    expect(nameControl.errors).toBeNull();
  });

  it('reports an enum violation against the role control', () => {
    const nameControl = makeControl();
    const emailControl = makeControl();
    const roleControl = makeControl();
    const group = makeGroup(
      { name: 'Ada', email: 'ada@example.com', role: 'superadmin' },
      { name: nameControl, email: emailControl, role: roleControl },
    );

    const result = zodValidator(testSchema)(group);

    expect(result).not.toBeNull();
    expect(result?.['zod']).toHaveProperty('role');
    expect(roleControl.errors?.['zod']).toBeDefined();
    expect(nameControl.errors).toBeNull();
    expect(emailControl.errors).toBeNull();
  });

  it('clears a previously-set zod error once the value becomes valid', () => {
    const nameControl = makeControl({ zod: 'Full name is required' });
    const emailControl = makeControl();
    const roleControl = makeControl();
    const group = makeGroup(
      { name: 'Ada', email: 'ada@example.com', role: 'admin' },
      { name: nameControl, email: emailControl, role: roleControl },
    );

    const result = zodValidator(testSchema)(group);

    expect(result).toBeNull();
    expect(nameControl.errors).toBeNull();
  });

  it('preserves non-zod errors on a control while clearing its zod error', () => {
    const nameControl = makeControl({ zod: 'Full name is required', required: true });
    const emailControl = makeControl();
    const roleControl = makeControl();
    const group = makeGroup(
      { name: 'Ada', email: 'ada@example.com', role: 'admin' },
      { name: nameControl, email: emailControl, role: roleControl },
    );

    zodValidator(testSchema)(group);

    expect(nameControl.errors).toEqual({ required: true });
  });

  it('falls back to a single group-level error on a control with no children', () => {
    const plainControl = { value: '', errors: null, setErrors: () => {} } as unknown as Parameters<
      ReturnType<typeof zodValidator>
    >[0];

    const result = zodValidator(z.string().min(1, 'Required'))(plainControl);

    expect(result).toEqual({ zod: { '': 'Required' } });
  });
});
