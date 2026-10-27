import { EnvironmentEnum } from '@repo/shared-types';
import { IncomingMessage } from 'http';
import { Params } from 'nestjs-pino';
import { isSilentPath } from '../constants/observability';
import { SanitizeUtil } from '../utils/sanitize.util';

const isProduction = process.env.NODE_ENV === EnvironmentEnum.PRODUCTION;

// For TRPC batch requests show only the procedure name; otherwise strip query string
function cleanUrl(url: string): string {
  const trpcMatch = url.match(/\/trpc\/([^?]+)/);
  if (trpcMatch) return `/trpc/${trpcMatch[1]}`;
  return url.split('?')[0] ?? url;
}

export const pinoConfig: Params = {
  pinoHttp: {
    level: isProduction ? 'info' : 'debug',

    transport: isProduction
      ? undefined
      : {
          target: 'pino-pretty',
          options: {
            colorize: true,
            singleLine: true,
            translateTime: 'SYS:HH:MM:ss',
            ignore: 'pid,hostname,req,res,responseTime,requestId,correlationId',
            messageFormat: '{context} | {msg}',
          },
        },

    customProps: (req: IncomingMessage) => ({
      context: 'HTTP',
      requestId: (req as IncomingMessage & { id?: string | number }).id,
      correlationId:
        (req as unknown as Record<string, unknown>).correlationId ?? undefined,
    }),

    customSuccessMessage: (
      req: IncomingMessage,
      res: { statusCode: number },
      responseTime: number,
    ) => {
      const { method, url } = req as IncomingMessage & { url: string };
      return `${method} ${cleanUrl(url ?? '')} ${res.statusCode} +${responseTime}ms`;
    },

    customErrorMessage: (
      req: IncomingMessage,
      res: { statusCode: number },
      error: Error,
    ) => {
      const { method, url } = req as IncomingMessage & { url: string };
      return `${method} ${cleanUrl(url ?? '')} ${res.statusCode} - ${error.message}`;
    },

    customLogLevel: (
      _req: IncomingMessage,
      res: { statusCode: number },
      error?: Error,
    ) => {
      if (error || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },

    serializers: {
      req(req: {
        id: string;
        method: string;
        url: string;
        remoteAddress: string;
        remotePort: number;
      }) {
        return {
          id: req.id,
          method: req.method,
          url: SanitizeUtil.sanitizeUrl(req.url),
          remoteAddress: req.remoteAddress,
          remotePort: req.remotePort,
        };
      },
      res(res: { statusCode: number }) {
        return { statusCode: res.statusCode };
      },
    },

    autoLogging: {
      ignore: (req: IncomingMessage) => isSilentPath(req.url ?? ''),
    },

    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-api-key"]',
        'req.body.password',
        'req.body.currentPassword',
        'req.body.newPassword',
        'req.body.taxId',
        'res.headers["set-cookie"]',
      ],
      censor: '[REDACTED]',
    },
  },
};
