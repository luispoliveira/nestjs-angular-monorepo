import { PrismaClient } from '@repo/database';
import { faker } from '@faker-js/faker';

export interface CreateCustomerOverrides {
  name?: string;
  email?: string | null;
  notes?: string | null;
  /** Normalized NIF; stored only when `crypto` is supplied. */
  taxId?: string;
  deletedAt?: Date | null;
}

/** Structural subset of `EncryptionService` — keeps this package free of `@repo/shared`. */
export interface CustomerCrypto {
  encrypt(plaintext: string): string;
  blindIndex(plaintext: string): string;
}

export async function createCustomer(
  db: PrismaClient,
  overrides: CreateCustomerOverrides = {},
  crypto?: CustomerCrypto,
) {
  const { taxId, ...rest } = overrides;
  if (taxId !== undefined && !crypto) {
    throw new Error('createCustomer: pass `crypto` to store a taxId');
  }

  return db.customer.create({
    data: {
      name: rest.name ?? faker.person.fullName(),
      email: rest.email === undefined ? faker.internet.email() : rest.email,
      notes: rest.notes ?? null,
      deletedAt: rest.deletedAt ?? null,
      ...(taxId !== undefined && crypto
        ? {
            taxIdEncrypted: crypto.encrypt(taxId),
            taxIdHash: crypto.blindIndex(taxId),
          }
        : {}),
    },
  });
}
