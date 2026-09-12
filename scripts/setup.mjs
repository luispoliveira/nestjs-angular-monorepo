#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { dirname, resolve } from 'path';
import { createInterface } from 'readline/promises';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ─── ANSI helpers ────────────────────────────────────────────────────────────
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  dim: '\x1b[2m',
};
const log = (msg) => process.stdout.write(msg + '\n');
const step = (msg) => log(`\n${c.bold}${c.cyan}▸ ${msg}${c.reset}`);
const ok = (msg) => log(`  ${c.green}✔${c.reset} ${msg}`);
const skip = (msg) => log(`  ${c.yellow}⚠${c.reset}  ${msg}`);

// ─── Prompt helper ───────────────────────────────────────────────────────────
async function prompt(rl, question, defaultValue) {
  const hint = defaultValue ? ` ${c.dim}(${defaultValue})${c.reset}` : '';
  const answer = await rl.question(`    ${question}${hint}: `);
  return answer.trim() || defaultValue || '';
}

// ─── Replace DB credentials + auth secret in an .env file content ────────────
function applyCredentials(content, pg, mongo, secret) {
  // postgres://USER:PASS@HOST:PORT/DB?query
  content = content.replace(
    /(postgres:\/\/)[^:@]+:[^@]*@([^/]+)\/[^?'"\s]*/g,
    (_, proto, host) =>
      `${proto}${encodeURIComponent(pg.user)}:${encodeURIComponent(pg.password)}@${host}/${pg.db}`,
  );
  // mongodb://USER:PASS@HOST:PORT/DB?query  (preserve ?authSource=admin)
  content = content.replace(
    /(mongodb:\/\/)[^:@]+:[^@]*@([^/]+)\/([^?'"\s]*)(\?[^'"\s]*)?/g,
    (_, proto, host, _db, qs) =>
      `${proto}${encodeURIComponent(mongo.user)}:${encodeURIComponent(mongo.password)}@${host}/${mongo.db}${qs ?? ''}`,
  );
  // BETTER_AUTH_SECRET — replace any placeholder with the generated secret
  if (secret) {
    content = content.replace(
      /^BETTER_AUTH_SECRET=.*/m,
      `BETTER_AUTH_SECRET="${secret}"`,
    );
  }
  return content;
}

// ─── Local-dev overrides for apps/auth's browser-facing URLs ────────────────
// .env.example ships production-shaped placeholders (auth.example.com,
// admin.example.com, .example.com) on purpose, to force an explicit choice
// in real deployments — but pnpm setup exists to bootstrap local dev, so it
// swaps them for the actual dev ports (README's Environment Variables
// reference: BETTER_AUTH_URL/CORS_ORIGIN/UI_URL on localhost:3000/:4200,
// COOKIE_DOMAIN unset since dev isn't split across sibling subdomains).
function applyAuthDevDefaults(content) {
  content = content.replace(
    /^BETTER_AUTH_URL=.*/m,
    'BETTER_AUTH_URL="http://localhost:3000/api/auth"',
  );
  content = content.replace(
    /^CORS_ORIGIN=.*/m,
    'CORS_ORIGIN="http://localhost:3000,http://localhost:4200"',
  );
  content = content.replace(/^COOKIE_DOMAIN=.*\n/m, '');
  content = /^UI_URL=/m.test(content)
    ? content.replace(/^UI_URL=.*/m, 'UI_URL="http://localhost:4200"')
    : content.replace(/^(BETTER_AUTH_URL=.*)$/m, '$1\nUI_URL="http://localhost:4200"');
  return content;
}

// ─── Files to copy & patch ───────────────────────────────────────────────────
// apps/web is intentionally absent: Angular has no runtime .env, config is
// baked in at build time via src/environments/{environment.ts,environment.prod.ts}.
const APP_ENV_FILES = [
  ['.env.example', '.env'],
  ['apps/auth/.env.example', 'apps/auth/.env'],
  ['apps/api/.env.example', 'apps/api/.env'],
  ['apps/notifications/.env.example', 'apps/notifications/.env'],
  ['apps/worker/.env.example', 'apps/worker/.env'],
  ['apps/cron/.env.example', 'apps/cron/.env'],
  ['packages/database/.env.example', 'packages/database/.env'],
];

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  log(`\n${c.bold}${c.cyan}╔══════════════════════════════════╗`);
  log(`║      Project Setup Wizard        ║`);
  log(`╚══════════════════════════════════╝${c.reset}`);

  // 1. Project name ────────────────────────────────────────────────────────
  step('Project name');
  const pkgPath = resolve(ROOT, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const projectName = await prompt(rl, 'Name', pkg.name);

  // 2. PostgreSQL ──────────────────────────────────────────────────────────
  step('PostgreSQL');
  const pgDb = await prompt(rl, 'Database name', 'nestjs');
  const pgUser = await prompt(rl, 'Username', 'nestjs');
  const pgPassword = await prompt(rl, 'Password', 'change-me');

  // 3. MongoDB ─────────────────────────────────────────────────────────────
  step('MongoDB');
  const mongoDb = await prompt(rl, 'Database name', 'nestjs');
  const mongoUser = await prompt(rl, 'Username', 'nestjs');
  const mongoPassword = await prompt(rl, 'Password', 'change-me');

  rl.close();

  const pg = { db: pgDb, user: pgUser, password: pgPassword };
  const mongo = { db: mongoDb, user: mongoUser, password: mongoPassword };
  const betterAuthSecret = randomBytes(32).toString('base64');

  // ── Apply ────────────────────────────────────────────────────────────────
  step('Applying changes');

  // Update package.json name
  if (projectName !== pkg.name) {
    pkg.name = projectName;
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    ok(`package.json  name → "${projectName}"`);
  }

  // App .env files
  for (const [src, dest] of APP_ENV_FILES) {
    const srcPath = resolve(ROOT, src);
    const destPath = resolve(ROOT, dest);
    if (!existsSync(srcPath)) {
      skip(`${src} not found, skipping`);
      continue;
    }
    if (existsSync(destPath)) {
      skip(`${dest} already exists, skipping`);
      continue;
    }
    let content = applyCredentials(readFileSync(srcPath, 'utf8'), pg, mongo, betterAuthSecret);
    if (dest === 'apps/auth/.env') content = applyAuthDevDefaults(content);
    writeFileSync(destPath, content);
    ok(`${src} → ${dest}`);
  }

  // docker/postgres.env
  {
    const srcPath = resolve(ROOT, 'docker/postgres.env.example');
    const destPath = resolve(ROOT, 'docker/postgres.env');
    if (!existsSync(srcPath)) {
      skip('docker/postgres.env.example not found, skipping');
    } else if (existsSync(destPath)) {
      skip('docker/postgres.env already exists, skipping');
    } else {
      const content = readFileSync(srcPath, 'utf8')
        .replace(/^POSTGRES_DB=.*/m, `POSTGRES_DB="${pg.db}"`)
        .replace(/^POSTGRES_USER=.*/m, `POSTGRES_USER="${pg.user}"`)
        .replace(
          /^POSTGRES_PASSWORD=.*/m,
          `POSTGRES_PASSWORD="${pg.password}"`,
        );
      writeFileSync(destPath, content);
      ok('docker/postgres.env.example → docker/postgres.env');
    }
  }

  // docker/mongo.env
  {
    const srcPath = resolve(ROOT, 'docker/mongo.env.example');
    const destPath = resolve(ROOT, 'docker/mongo.env');
    if (!existsSync(srcPath)) {
      skip('docker/mongo.env.example not found, skipping');
    } else if (existsSync(destPath)) {
      skip('docker/mongo.env already exists, skipping');
    } else {
      const content = readFileSync(srcPath, 'utf8')
        .replace(
          /^MONGO_INITDB_ROOT_USERNAME=.*/m,
          `MONGO_INITDB_ROOT_USERNAME=${mongo.user}`,
        )
        .replace(
          /^MONGO_INITDB_ROOT_PASSWORD=.*/m,
          `MONGO_INITDB_ROOT_PASSWORD=${mongo.password}`,
        )
        .replace(
          /^MONGO_INITDB_DATABASE=.*/m,
          `MONGO_INITDB_DATABASE=${mongo.db}`,
        );
      writeFileSync(destPath, content);
      ok('docker/mongo.env.example → docker/mongo.env');
    }
  }

  log(`\n${c.bold}${c.green}✔ Setup complete!${c.reset}`);
  log(`${c.dim}  Next steps: pnpm docker:up && pnpm dev${c.reset}\n`);
}

main().catch((err) => {
  process.stderr.write(`\n\x1b[31mError: ${err.message}\x1b[0m\n`);
  process.exit(1);
});
