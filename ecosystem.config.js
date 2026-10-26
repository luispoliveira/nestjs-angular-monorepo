'use strict';

/**
 * PM2 Ecosystem — PROD / QA
 *
 * Usage:
 *   pm2 start ecosystem.config.js --env production
 *   pm2 start ecosystem.config.js --env qa
 *
 * Log rotation (install once per server):
 *   pm2 install pm2-logrotate
 *   pm2 set pm2-logrotate:max_size 20M
 *   pm2 set pm2-logrotate:retain 30
 *   pm2 set pm2-logrotate:compress true
 *   pm2 set pm2-logrotate:rotateInterval '0 0 * * *'
 *   pm2 set pm2-logrotate:workerInterval 3600
 *
 * Env file (single, shared across all apps — create before deploying):
 *   .env.production   (production)
 *   .env.qa           (qa / staging)
 *
 * App-specific vars (PORT) are defined directly below and always win over the
 * shared file. Every `pm2 start|reload|restart` MUST pass `--env <name>`: PM2
 * only applies an `env_<name>` block when asked, and without one the apps boot
 * with no environment at all (the Makefile always passes `--env $(ENV)`).
 */

const fs = require('fs');
const path = require('path');
const { parseEnv } = require('util');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Loads shared environment variables from <root>/.env.<envName>.
 * Falls back to <root>/.env if the environment-specific file is missing.
 *
 * @param {string} envName - Environment name ('production' | 'qa')
 * @returns {Record<string, string>}
 */
function loadSharedEnv(envName) {
  const specificFile = path.resolve(`.env.${envName}`);
  const fallbackFile = path.resolve('.env');

  const file = fs.existsSync(specificFile) ? specificFile : fallbackFile;

  if (!fs.existsSync(file)) {
    console.warn(
      `[PM2] WARNING: No shared env file found (.env.${envName} or .env)`,
    );
    return {};
  }

  // util.parseEnv, not `dotenv`: the repo root does not install dotenv, so
  // requiring it here fails with MODULE_NOT_FOUND on a clean server.
  return parseEnv(fs.readFileSync(file, 'utf8'));
}

/**
 * The environment block of one app: the shared file first, then the app's own
 * values, so a `PORT` or `NODE_ENV` in the shared file can never override them
 * (it would put every app on one port).
 *
 * NODE_ENV is `production` for QA too: the env schemas accept only
 * development | production | test, so `qa` fails validation at boot. What makes
 * a deployment QA is the `.env.qa` file, not NODE_ENV.
 *
 * @param {string} envName - 'production' | 'qa', selects the shared env file
 * @param {number} port
 * @returns {Record<string, string | number>}
 */
function appEnv(envName, port) {
  return { ...loadSharedEnv(envName), NODE_ENV: 'production', PORT: port };
}

// ---------------------------------------------------------------------------
// Shared defaults
// ---------------------------------------------------------------------------

/** Options forwarded to pm2-logrotate via file-level config */
const logRotate = {
  log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
  merge_logs: true,
};

/**
 * HTTP NestJS services (auth, api, web) — stateless, cluster-safe.
 */
const httpServiceDefaults = {
  ...logRotate,
  instances: process.env.NODE_APP_INSTANCES || 1,
  exec_mode: 'cluster',
  autorestart: true,
  watch: false,
  max_memory_restart: '1G',
  restart_delay: 5000,
  max_restarts: 10,
  min_uptime: '10s',
  kill_timeout: 5000,
  listen_timeout: 10000,
  wait_ready: true,
};

/**
 * Bull queue consumer (worker).
 * Cluster is safe — Bull distributes jobs via Redis so each instance picks up
 * separate jobs (competing consumers). Scale instances to increase throughput.
 */
const workerDefaults = {
  ...logRotate,
  instances: process.env.NODE_APP_INSTANCES || 1,
  exec_mode: 'cluster',
  autorestart: true,
  watch: false,
  max_memory_restart: '512M',
  restart_delay: 5000,
  max_restarts: 10,
  min_uptime: '10s',
  kill_timeout: 5000,
  listen_timeout: 10000,
  wait_ready: true,
};

/**
 * Redis pub/sub transport (notifications).
 * MUST stay fork:1 — Redis pub/sub delivers each message to ALL subscribers,
 * so multiple instances would process every event N times (fan-out).
 */
const redisTransportDefaults = {
  ...logRotate,
  instances: 1,
  exec_mode: 'fork',
  autorestart: true,
  watch: false,
  max_memory_restart: '512M',
  restart_delay: 5000,
  max_restarts: 10,
  min_uptime: '10s',
  kill_timeout: 5000,
  listen_timeout: 10000,
  wait_ready: true,
};

// ---------------------------------------------------------------------------
// App definitions
// ---------------------------------------------------------------------------

const LOG_DIR = './logs';

module.exports = {
  apps: [
    // -------------------------------------------------------------------------
    // auth — HTTP + better-auth session management
    // -------------------------------------------------------------------------
    {
      ...httpServiceDefaults,
      name: 'auth',
      script: './apps/auth/dist/main.js',
      error_file: `${LOG_DIR}/auth-error.log`,
      out_file: `${LOG_DIR}/auth-out.log`,
      env_production: appEnv('production', 3000),
      env_qa: appEnv('qa', 3000),
    },

    // -------------------------------------------------------------------------
    // api — tRPC / REST API gateway
    // -------------------------------------------------------------------------
    {
      ...httpServiceDefaults,
      name: 'api',
      script: './apps/api/dist/main.js',
      error_file: `${LOG_DIR}/api-error.log`,
      out_file: `${LOG_DIR}/api-out.log`,
      env_production: appEnv('production', 3100),
      env_qa: appEnv('qa', 3100),
    },

    // -------------------------------------------------------------------------
    // notifications — Redis pub/sub transport, fork:1 (fan-out risk)
    // -------------------------------------------------------------------------
    {
      ...redisTransportDefaults,
      name: 'notifications',
      script: './apps/notifications/dist/main.js',
      error_file: `${LOG_DIR}/notifications-error.log`,
      out_file: `${LOG_DIR}/notifications-out.log`,
      env_production: appEnv('production', 3200),
      env_qa: appEnv('qa', 3200),
    },

    // -------------------------------------------------------------------------
    // worker — Bull queue consumer, cluster-safe (competing consumers)
    // -------------------------------------------------------------------------
    {
      ...workerDefaults,
      name: 'worker',
      script: './apps/worker/dist/main.js',
      error_file: `${LOG_DIR}/worker-error.log`,
      out_file: `${LOG_DIR}/worker-out.log`,
      env_production: appEnv('production', 3300),
      env_qa: appEnv('qa', 3300),
    },

    // web has no PM2 process: the Angular build is a static bundle
    // (apps/web/dist/web/browser/) served directly by nginx — see
    // docs/deploy/nginx/frontend.conf and DEPLOY-PM2.md §9.

    // -------------------------------------------------------------------------
    // cron — scheduled jobs (@nestjs/schedule), health/metrics HTTP only.
    // MUST stay fork:1 — @nestjs/schedule runs jobs per-process, so cluster
    // instances would each fire the same scheduled job N times.
    // -------------------------------------------------------------------------
    {
      ...httpServiceDefaults,
      instances: 1,
      exec_mode: 'fork',
      name: 'cron',
      script: './apps/cron/dist/main.js',
      error_file: `${LOG_DIR}/cron-error.log`,
      out_file: `${LOG_DIR}/cron-out.log`,
      env_production: appEnv('production', 3400),
      env_qa: appEnv('qa', 3400),
    },
  ],
};
