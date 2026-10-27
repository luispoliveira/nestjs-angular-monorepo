import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  CreateCustomerInput,
  Customer,
  CustomerListQuery,
  customerSchema,
  CustomersListResponse,
  customersListResponseSchema,
  UpdateCustomerInput,
} from '@repo/shared-types';
import { firstValueFrom } from 'rxjs';
import { webConfig } from '../../config/app-config';

/**
 * The web app's first apps/api consumer (same-origin `/api`, session cookie
 * sent automatically). Every response is parsed through its shared schema
 * at the network boundary (design.md → D7), so a malformed payload rejects
 * instead of reaching a signal. Failed requests reject with the
 * `HttpErrorResponse`, so callers can branch on `status` (e.g. 409).
 */
@Injectable({ providedIn: 'root' })
export class CustomersApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${webConfig.apiUrl}/v1/customers`;

  async list(query: Partial<CustomerListQuery>): Promise<CustomersListResponse> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') params = params.set(key, String(value));
    }
    const body = await firstValueFrom(this.http.get<unknown>(this.baseUrl, { params }));
    return customersListResponseSchema.parse(body);
  }

  async create(input: CreateCustomerInput): Promise<Customer> {
    const body = await firstValueFrom(this.http.post<unknown>(this.baseUrl, input));
    return customerSchema.parse(body);
  }

  async update(id: string, input: UpdateCustomerInput): Promise<Customer> {
    const body = await firstValueFrom(this.http.patch<unknown>(`${this.baseUrl}/${id}`, input));
    return customerSchema.parse(body);
  }

  async remove(id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`${this.baseUrl}/${id}`));
  }
}
