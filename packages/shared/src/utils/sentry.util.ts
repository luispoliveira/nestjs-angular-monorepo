// Loaded by each app's src/instrument.ts before anything else (via the
// `@repo/shared/sentry` subpath): keep imports free of Nest and the barrel.
import * as Sentry from '@sentry/nestjs';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { isSilentPath } from '../constants/observability';

type TracesSampler = NonNullable<Sentry.NodeOptions['tracesSampler']>;

function parseSampleRate(raw: string | undefined): number {
  const rate = Number(raw);
  return Number.isFinite(rate) ? Math.min(Math.max(rate, 0), 1) : 0;
}

function requestPath(context: Parameters<TracesSampler>[0]): string {
  const url = context.normalizedRequest?.url ?? context.name.split(' ')[1];
  if (!url) return '';
  try {
    return new URL(url, 'http://localhost').pathname;
  } catch {
    return '';
  }
}

// Runs before ConfigModule has loaded .env. Same precedence as ConfigModule:
// variables already set in the process environment win.
function loadDotEnv(): void {
  if (!existsSync('.env')) return;
  const parsed = parseEnv(readFileSync('.env', 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    process.env[key] ??= value;
  }
}

export class SentryUtil {
  static init(appName: string): void {
    loadDotEnv();

    const dsn = process.env.SENTRY_DSN;
    if (!dsn) return;

    const sampleRate = parseSampleRate(process.env.SENTRY_TRACES_SAMPLE_RATE);

    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV ?? 'development',
      tracesSampler: (context) =>
        isSilentPath(requestPath(context)) ? 0 : sampleRate,
      initialScope: {
        tags: { app: appName },
      },
    });
    // v11 streams spans, which carry attributes only — tags stay on errors.
    Sentry.getGlobalScope().setAttributes({ app: appName });
  }

  static captureException(
    exception: unknown,
    context?: {
      extra?: Record<string, unknown>;
      tags?: Record<string, string>;
    },
  ): void {
    Sentry.captureException(exception, context);
  }
}
