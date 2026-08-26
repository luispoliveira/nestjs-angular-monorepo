#!/usr/bin/env node
/**
 * Fails if the workspace lockfile resolves more than one version of `zod`.
 * The shared schema contract (packages/shared-types) depends on every
 * package seeing the same Zod construct — a second resolved version would
 * silently break `instanceof` checks and schema identity across packages.
 *
 * Usage: node scripts/verify-single-zod-version.mjs
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const lockfile = readFileSync(resolve(ROOT, 'pnpm-lock.yaml'), 'utf8');
const versions = new Set(
  [...lockfile.matchAll(/^ {2}zod@([^:]+):$/gm)].map((match) => match[1]),
);

if (versions.size === 0) {
  console.error('Could not find any resolved `zod` version in pnpm-lock.yaml.');
  process.exit(1);
}

if (versions.size > 1) {
  console.error(
    `Expected exactly one resolved \`zod\` version, found ${versions.size}: ${[...versions].join(', ')}`,
  );
  process.exit(1);
}

console.log(`OK: single resolved zod version — ${[...versions][0]}`);
