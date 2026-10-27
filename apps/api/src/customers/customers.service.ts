import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService, Prisma } from '@repo/database';
import { EncryptionService, PaginatedUtil } from '@repo/shared';
import {
  CreateCustomerInput,
  Customer,
  CustomerListQuery,
  isValidNif,
  normalizeNif,
  UpdateCustomerInput,
} from '@repo/shared-types';

type CustomerRow = Prisma.CustomerGetPayload<object>;

/**
 * Reference service for the Customers slice. The NIF arrives already
 * normalized and validated by the shared Zod schema; this service only
 * encrypts it (AES-GCM) and blind-indexes it (HMAC) — the plaintext is never
 * persisted. Soft delete: every query filters `deletedAt: null`.
 */
@Injectable()
export class CustomersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly encryption: EncryptionService,
  ) {}

  async list(query: CustomerListQuery) {
    const { skip, take, sortBy, sortOrder, search } = query;
    const where: Prisma.CustomerWhereInput = {
      deletedAt: null,
      ...(search ? { OR: this.searchFilters(search) } : {}),
    };

    const [rows, total] = await this.db.$transaction([
      this.db.customer.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip,
        take,
      }),
      this.db.customer.count({ where }),
    ]);

    return PaginatedUtil.getPaginatedResponse(
      rows.map((r) => this.toResponse(r)),
      total,
      skip,
      take,
    );
  }

  async findOne(id: string): Promise<Customer> {
    const row = await this.db.customer.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) throw new NotFoundException('Customer not found');
    return this.toResponse(row);
  }

  async create(input: CreateCustomerInput): Promise<Customer> {
    const { taxId, ...rest } = input;
    try {
      const row = await this.db.customer.create({
        data: {
          name: rest.name,
          email: rest.email,
          notes: rest.notes,
          ...this.taxIdColumns(taxId),
        },
      });
      return this.toResponse(row);
    } catch (error) {
      throw this.mapUniqueViolation(error);
    }
  }

  async update(id: string, input: UpdateCustomerInput): Promise<Customer> {
    const { taxId, ...rest } = input;
    try {
      const { count } = await this.db.customer.updateMany({
        where: { id, deletedAt: null },
        data: { ...rest, ...this.taxIdColumns(taxId) },
      });
      if (count === 0) throw new NotFoundException('Customer not found');
    } catch (error) {
      throw this.mapUniqueViolation(error);
    }
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    const { count } = await this.db.customer.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (count === 0) throw new NotFoundException('Customer not found');
  }

  /** string → encrypt + index; null → clear both; undefined → untouched. */
  private taxIdColumns(taxId: string | null | undefined) {
    if (taxId === undefined) return {};
    if (taxId === null) return { taxIdEncrypted: null, taxIdHash: null };
    return {
      taxIdEncrypted: this.encryption.encrypt(taxId),
      taxIdHash: this.encryption.blindIndex(taxId),
    };
  }

  // ponytail: ILIKE '%term%' scans the table; add a pg_trgm GIN index on
  // name/email if listing gets slow.
  private searchFilters(search: string): Prisma.CustomerWhereInput[] {
    const filters: Prisma.CustomerWhereInput[] = [
      { name: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ];
    const nif = normalizeNif(search);
    if (isValidNif(nif)) {
      filters.push({ taxIdHash: this.encryption.blindIndex(nif) });
    }
    return filters;
  }

  private toResponse(row: CustomerRow): Customer {
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      taxId: row.taxIdEncrypted
        ? this.encryption.decrypt(row.taxIdEncrypted)
        : null,
      notes: row.notes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private mapUniqueViolation(error: unknown): unknown {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return new ConflictException('NIF already in use');
    }
    return error;
  }
}
