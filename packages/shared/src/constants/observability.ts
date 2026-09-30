/** Request paths kept out of HTTP logs and Sentry traces (probes, scrapes). */
export const SILENT_PATHS: readonly string[] = [
  '/health',
  '/metrics',
  '/favicon.ico',
];

/**
 * True when `path` (query string ignored) contains a SILENT_PATHS entry as a
 * whole segment, so the apps' global prefix ('/api/health/live') needs no
 * special-casing while '/healthcheck' stays logged and traced.
 */
export function isSilentPath(path: string): boolean {
  const clean = path.split('?')[0] ?? path;
  return SILENT_PATHS.some((p) => `${clean}/`.includes(`${p}/`));
}
