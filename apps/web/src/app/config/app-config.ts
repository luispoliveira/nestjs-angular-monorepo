import { z } from 'zod';
import { environment } from '../../environments/environment';

/**
 * Build-time web app configuration, validated with `z.parse()` at module
 * load — a missing or malformed value throws immediately rather than
 * surfacing as an obscure runtime error later (design.md → D8).
 *
 * `authApiUrl` is baked in per environment.{ts,prod.ts} via Angular's
 * fileReplacements, because the auth service is a separate origin
 * (design.md → D1). `apiUrl` is always the relative `/api` prefix: the
 * frontend's own backend is reached same-origin, so no host is configured.
 *
 * Named `webConfig`, not `appConfig`, to avoid colliding with Angular's own
 * `ApplicationConfig` (see app/app.config.ts, imported as `appConfig` in
 * main.ts) — the two are unrelated and easy to conflate by name.
 */
const webConfigSchema = z.object({
  authApiUrl: z.url(),
  apiUrl: z.literal('/api'),
});

export type WebConfig = z.infer<typeof webConfigSchema>;

export const webConfig: WebConfig = webConfigSchema.parse({
  authApiUrl: environment.authApiUrl,
  apiUrl: '/api',
});
