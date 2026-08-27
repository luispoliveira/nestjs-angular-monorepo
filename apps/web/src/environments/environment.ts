// Development defaults, used by `ng serve` / `ng build` with no configuration.
// Swapped for environment.prod.ts via angular.json's `production`
// fileReplacements — see design.md → D8.
export const environment = {
  // Same-site but cross-origin (design.md → D1); the dev proxy does not
  // forward this — auth is reached cross-origin in dev too (D1b), so the
  // origin allowlist is exercised locally rather than only in deployment.
  authApiUrl: 'http://localhost:3000',
};
