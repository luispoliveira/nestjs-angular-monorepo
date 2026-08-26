#!/usr/bin/env node
// Fails `ng build` with a named error when a required config value is
// missing or malformed. Angular's static build (no SSR/prerendering) never
// executes app code, so app-config.ts's own top-level `z.parse()` would
// only ever throw in the browser — this script runs the same schema
// against every environment file at build time instead (design.md → D8).
//
// Run directly by Node's native TypeScript support (no transpile step);
// see apps/web/package.json's `build` script.
import { z } from 'zod';
import { environment as developmentEnvironment } from '../src/environments/environment.ts';
import { environment as productionEnvironment } from '../src/environments/environment.prod.ts';

const appConfigSchema = z.object({
  authApiUrl: z.url(),
});

const targets = [
  { name: 'development', environment: developmentEnvironment },
  { name: 'production', environment: productionEnvironment },
];

let hasError = false;

for (const { name, environment } of targets) {
  const result = appConfigSchema.safeParse(environment);
  if (!result.success) {
    hasError = true;
    console.error(`✘ Invalid ${name} environment config (src/environments/environment${name === 'production' ? '.prod' : ''}.ts):`);
    for (const issue of result.error.issues) {
      console.error(`  - ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    }
  }
}

if (hasError) {
  console.error('\nBuild aborted: fix the environment file(s) above before building.');
  process.exit(1);
}

console.log(`Angular environment config OK (${targets.map((t) => t.name).join(', ')}).`);
