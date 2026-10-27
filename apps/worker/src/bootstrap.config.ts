import { BootstrapUtil } from '@repo/shared';
import { EnvironmentEnum } from '@repo/shared-types';

/** The dashboard lives outside the `api` prefix, as the dlq-management-api spec says. */
export const BULL_BOARD_ROUTE = '/admin/queues';

/** Kept out of main.ts so the integration suite boots the exact same HTTP setup. */
export function workerBootstrapConfig(params: {
  environment: EnvironmentEnum;
  corsOrigin: string;
}): Parameters<typeof BootstrapUtil.setup>[1] {
  return {
    globalPrefix: 'api',
    globalPrefixExclude: [BULL_BOARD_ROUTE.slice(1)],
    useHelmet: true,
    enableVersioning: true,
    swagger:
      params.environment !== EnvironmentEnum.PRODUCTION
        ? {
            title: 'Worker API',
            description: 'API for managing worker tasks',
            version: '1.0.0',
            tag: 'worker',
            path: 'docs',
          }
        : undefined,
    cors: {
      origin: params.corsOrigin,
      credentials: true,
    },
    enableCookieParser: true,
    trustProxy: true,
  };
}
