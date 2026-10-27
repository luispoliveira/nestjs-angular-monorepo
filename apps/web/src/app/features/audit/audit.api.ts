import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { AuditEventListQuery, AuditEventsListResponse, auditEventsListResponseSchema } from '@repo/shared-types';
import { firstValueFrom } from 'rxjs';
import { webConfig } from '../../config/app-config';

/**
 * Read-only client for the admin audit trail. Like CustomersApi, every
 * response is parsed through its shared schema at the network boundary, so a
 * malformed payload (or an action this build does not know) rejects instead
 * of reaching a signal.
 */
@Injectable({ providedIn: 'root' })
export class AuditApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${webConfig.apiUrl}/v1/audit-events`;

  async list(query: Partial<AuditEventListQuery>): Promise<AuditEventsListResponse> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === '') continue;
      params = params.set(key, value instanceof Date ? value.toISOString() : String(value));
    }
    const body = await firstValueFrom(this.http.get<unknown>(this.baseUrl, { params }));
    return auditEventsListResponseSchema.parse(body);
  }
}
