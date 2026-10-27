import {
  createCustomerSchema,
  customerListQuerySchema,
  customerSchema,
  customersListResponseSchema,
  isValidNif,
  normalizeNif,
  updateCustomerSchema,
} from './customer.schema.js';

// 123456789: weighted sum 156, 156 % 11 = 2 -> check digit 9 (valid).
// 100000070: weighted sum 23, 23 % 11 = 1 -> 11 - 1 = 10 -> check digit 0.
// 999999990: weighted sum 396, 396 % 11 = 0 -> 11 - 0 = 11 -> check digit 0.
const VALID_NIF = '123456789';

describe('normalizeNif', () => {
  it.each(['PT 123 456 789', 'pt123456789', '123456789', ' PT123 456789 '])(
    'reduces %p to the 9 digits',
    (input) => {
      expect(normalizeNif(input)).toBe('123456789');
    },
  );
});

describe('isValidNif', () => {
  it('accepts a NIF with a correct check digit', () => {
    expect(isValidNif(VALID_NIF)).toBe(true);
  });

  it('rejects a NIF with a wrong check digit', () => {
    expect(isValidNif('123456788')).toBe(false);
  });

  it.each(['12345678', '1234567890', '12345678a', ''])(
    'rejects %p (not exactly 9 digits)',
    (input) => {
      expect(isValidNif(input)).toBe(false);
    },
  );

  it('maps a computed check digit of 10 to 0', () => {
    expect(isValidNif('100000070')).toBe(true);
    expect(isValidNif('100000071')).toBe(false);
  });

  it('maps a computed check digit of 11 to 0', () => {
    expect(isValidNif('999999990')).toBe(true);
  });
});

describe('createCustomerSchema', () => {
  it('requires name', () => {
    expect(createCustomerSchema.safeParse({}).success).toBe(false);
  });

  it('rejects a blank name after trimming', () => {
    expect(createCustomerSchema.safeParse({ name: '   ' }).success).toBe(false);
  });

  it('rejects a name longer than 200 characters', () => {
    expect(
      createCustomerSchema.safeParse({ name: 'a'.repeat(201) }).success,
    ).toBe(false);
  });

  it('rejects an invalid email', () => {
    expect(
      createCustomerSchema.safeParse({ name: 'Ana', email: 'nope' }).success,
    ).toBe(false);
  });

  it('rejects notes longer than 2000 characters', () => {
    expect(
      createCustomerSchema.safeParse({ name: 'Ana', notes: 'a'.repeat(2001) })
        .success,
    ).toBe(false);
  });

  it('rejects an invalid NIF', () => {
    expect(
      createCustomerSchema.safeParse({ name: 'Ana', taxId: '123456788' })
        .success,
    ).toBe(false);
  });

  it('accepts a valid body and normalizes taxId', () => {
    const result = createCustomerSchema.parse({
      name: '  Ana Silva  ',
      email: 'ana@example.com',
      taxId: 'PT 123 456 789',
      notes: 'VIP',
    });
    expect(result).toEqual({
      name: 'Ana Silva',
      email: 'ana@example.com',
      taxId: '123456789',
      notes: 'VIP',
    });
  });

  it('accepts a body with only name', () => {
    expect(createCustomerSchema.parse({ name: 'Ana' })).toEqual({
      name: 'Ana',
    });
  });
});

describe('updateCustomerSchema', () => {
  it('accepts an empty body', () => {
    expect(updateCustomerSchema.parse({})).toEqual({});
  });

  it('accepts null to clear email, taxId and notes', () => {
    expect(
      updateCustomerSchema.parse({ email: null, taxId: null, notes: null }),
    ).toEqual({ email: null, taxId: null, notes: null });
  });

  it('does not accept null for name', () => {
    expect(updateCustomerSchema.safeParse({ name: null }).success).toBe(false);
  });

  it('still validates and normalizes taxId', () => {
    expect(updateCustomerSchema.safeParse({ taxId: '123' }).success).toBe(
      false,
    );
    expect(updateCustomerSchema.parse({ taxId: 'pt123456789' })).toEqual({
      taxId: '123456789',
    });
  });
});

describe('customerListQuerySchema', () => {
  it('applies the defaults', () => {
    expect(customerListQuerySchema.parse({})).toEqual({
      skip: 0,
      take: 20,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });
  });

  it.each(['taxId', 'taxIdHash', 'id', 'deletedAt'])(
    'rejects sortBy=%p (outside the allow-list)',
    (sortBy) => {
      expect(customerListQuerySchema.safeParse({ sortBy }).success).toBe(false);
    },
  );

  it.each(['name', 'email', 'createdAt', 'updatedAt'])(
    'accepts sortBy=%p',
    (sortBy) => {
      expect(customerListQuerySchema.parse({ sortBy }).sortBy).toBe(sortBy);
    },
  );

  it('rejects take above 100', () => {
    expect(customerListQuerySchema.safeParse({ take: '101' }).success).toBe(
      false,
    );
  });

  it('coerces query-string numbers', () => {
    const result = customerListQuerySchema.parse({ skip: '40', take: '10' });
    expect(result.skip).toBe(40);
    expect(result.take).toBe(10);
  });

  it('trims search', () => {
    expect(customerListQuerySchema.parse({ search: '  silva ' }).search).toBe(
      'silva',
    );
  });
});

describe('customerSchema / customersListResponseSchema', () => {
  const wireCustomer = {
    id: 'c1',
    name: 'Ana',
    email: null,
    taxId: '123456789',
    notes: null,
    createdAt: '2026-10-10T10:00:00.000Z',
    updatedAt: '2026-10-10T10:00:00.000Z',
  };

  it('decodes ISO dates from the wire into Date instances', () => {
    const parsed = customerSchema.parse(wireCustomer);
    expect(parsed.createdAt).toBeInstanceOf(Date);
  });

  it('encodes Date instances to ISO strings for responses', () => {
    const encoded = customerSchema.encode({
      ...wireCustomer,
      createdAt: new Date('2026-10-10T10:00:00.000Z'),
      updatedAt: new Date('2026-10-10T10:00:00.000Z'),
    });
    expect(encoded.createdAt).toBe('2026-10-10T10:00:00.000Z');
  });

  it('accepts a well-formed list response', () => {
    const result = customersListResponseSchema.safeParse({
      items: [wireCustomer],
      meta: { page: 1, pageSize: 20, totalPages: 1, total: 1 },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a list response without meta.total', () => {
    expect(
      customersListResponseSchema.safeParse({
        items: [wireCustomer],
        meta: { page: 1, pageSize: 20, totalPages: 1 },
      }).success,
    ).toBe(false);
  });

  it('rejects a list item without id', () => {
    const { id: _id, ...noId } = wireCustomer;
    expect(
      customersListResponseSchema.safeParse({
        items: [noId],
        meta: { page: 1, pageSize: 20, totalPages: 1, total: 1 },
      }).success,
    ).toBe(false);
  });
});
