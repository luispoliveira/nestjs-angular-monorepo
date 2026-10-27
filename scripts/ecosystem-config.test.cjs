'use strict';

/**
 * Pins the PM2 deploy config (ecosystem.config.js + Makefile). Run with
 * `pnpm test:deploy`. No dependencies: `node:test` only, because the repo root
 * has no test runner and the config itself must load from the root.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CONFIG = path.join(ROOT, 'ecosystem.config.js');
const MAKEFILE = path.join(ROOT, 'Makefile');

// What `baseEnvSchema.NODE_ENV` accepts (packages/shared/src/config/base-env.schema.ts).
const ACCEPTED_NODE_ENV = ['development', 'production', 'test'];
const OWN_PORTS = {
  auth: 3000,
  api: 3100,
  notifications: 3200,
  worker: 3300,
  cron: 3400,
};
const ENV_BLOCKS = ['env_production', 'env_qa'];

/** Loads the config as PM2 would: from a working directory holding the given env files. */
function load(envFiles = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecosystem-'));
  for (const [name, content] of Object.entries(envFiles)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  const cwd = process.cwd();
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  process.chdir(dir);
  try {
    delete require.cache[CONFIG];
    return { apps: require(CONFIG).apps, warnings };
  } finally {
    process.chdir(cwd);
    console.warn = originalWarn;
  }
}

const eachEnvBlock = (apps, fn) => {
  for (const app of apps)
    for (const block of ENV_BLOCKS) fn(app, app[block], block);
};

test('every app declares both environment blocks', () => {
  const { apps } = load();
  assert.deepEqual(
    apps.map((a) => a.name).sort(),
    Object.keys(OWN_PORTS).sort(),
  );
  eachEnvBlock(apps, (app, env, block) =>
    assert.ok(env, `${app.name} has no ${block}`),
  );
});

test('every app runs with a NODE_ENV the env schemas accept (QA included)', () => {
  const { apps } = load();
  eachEnvBlock(apps, (app, env, block) =>
    assert.ok(
      ACCEPTED_NODE_ENV.includes(env.NODE_ENV),
      `${app.name} ${block}: NODE_ENV=${env.NODE_ENV} fails validation at boot`,
    ),
  );
});

test('an app keeps its own PORT and NODE_ENV when the shared env file declares them too', () => {
  const shared = 'PORT=9999\nNODE_ENV=staging\nSHARED=1\n';
  const { apps } = load({ '.env.production': shared, '.env.qa': shared });
  eachEnvBlock(apps, (app, env, block) => {
    assert.equal(
      Number(env.PORT),
      OWN_PORTS[app.name],
      `${app.name} ${block}: PORT was overridden`,
    );
    assert.ok(
      ACCEPTED_NODE_ENV.includes(env.NODE_ENV),
      `${app.name} ${block}: NODE_ENV was overridden`,
    );
  });
});

test('variables from the shared env file still reach every app', () => {
  const { apps } = load({
    '.env.production': 'SHARED=prod\n',
    '.env.qa': 'SHARED=qa\n',
  });
  for (const app of apps) {
    assert.equal(app.env_production.SHARED, 'prod');
    assert.equal(app.env_qa.SHARED, 'qa');
  }
});

test('falls back to .env when the environment-specific file is missing', () => {
  const { apps } = load({ '.env': 'SHARED=fallback\n' });
  eachEnvBlock(apps, (app, env) => assert.equal(env.SHARED, 'fallback'));
});

test('a missing env file warns and still yields a bootable block', () => {
  const { apps, warnings } = load();
  assert.ok(warnings.length > 0, 'expected a warning');
  eachEnvBlock(apps, (app, env) => {
    assert.equal(Number(env.PORT), OWN_PORTS[app.name]);
    assert.ok(ACCEPTED_NODE_ENV.includes(env.NODE_ENV));
  });
});

test('the config does not depend on the `dotenv` package (the repo root does not install it)', () => {
  const source = fs.readFileSync(CONFIG, 'utf8');
  assert.doesNotMatch(source, /require\(\s*['"]dotenv['"]\s*\)/);
});

test('the Makefile passes --env to every pm2 start, reload and restart', () => {
  const lines = fs
    .readFileSync(MAKEFILE, 'utf8')
    .split('\n')
    .filter((line) => /\$\(PM2\)\s+(start|reload|restart)\b/.test(line));
  assert.ok(lines.length >= 3, 'expected start, reload and restart targets');
  for (const line of lines) {
    assert.match(line, /--env\s+\$\(ENV\)/, `no --env on: ${line.trim()}`);
  }
});

test('the Makefile has no Next.js leftovers: the web app is an Angular static bundle', () => {
  const makefile = fs.readFileSync(MAKEFILE, 'utf8');
  assert.doesNotMatch(makefile, /\.next|NEXT_PUBLIC|Next\.js/i);
});

test('the Makefile build target runs the build without sourcing an env file', () => {
  const lines = fs.readFileSync(MAKEFILE, 'utf8').split('\n');
  const start = lines.findIndex((line) => /^build:/.test(line));
  assert.notEqual(start, -1, 'no build target');
  const recipe = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith('\t')) break;
    recipe.push(line.trim());
  }
  assert.ok(
    recipe.some((line) => /\bpnpm build\b/.test(line)),
    'build runs pnpm build',
  );
  assert.ok(
    recipe.every((line) => !/\bsource\b|\bset -a\b/.test(line)),
    'nothing in the Angular/Nest build reads environment variables, so nothing should be sourced',
  );
});

test("the Makefile's logs example names a real PM2 app", () => {
  const { apps } = load();
  const names = apps.map((app) => app.name);
  const example = /make logs APP=([\w-]+)/.exec(
    fs.readFileSync(MAKEFILE, 'utf8'),
  );
  assert.ok(example, 'expected a `make logs APP=<name>` example');
  assert.ok(
    names.includes(example[1]),
    `${example[1]} is not one of: ${names.join(', ')}`,
  );
});

test('the Makefile setup target creates the directory the ecosystem writes its logs to', () => {
  const { apps } = load();
  const logDir = path.dirname(apps[0].out_file).replace(/^\.\//, '');
  const lines = fs.readFileSync(MAKEFILE, 'utf8').split('\n');
  const start = lines.findIndex((line) => /^setup:/.test(line));
  assert.notEqual(start, -1, 'no setup target');
  const recipe = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith('\t')) break;
    recipe.push(line.trim());
  }
  assert.ok(
    recipe.some((line) => new RegExp(`mkdir -p ${logDir}(\\s|$)`).test(line)),
    `setup should run \`mkdir -p ${logDir}\`; got: ${recipe.join(' | ')}`,
  );
});
