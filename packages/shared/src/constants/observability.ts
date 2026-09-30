/** Request paths kept out of HTTP logs and Sentry traces (probes, scrapes). */
export const SILENT_PATHS: readonly string[] = [
  '/health',
  '/metrics',
  '/favicon.ico',
];
