import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  baseEnvSchema,
  BootstrapUtil,
  JOB_PATTERNS,
  QueueModule,
  QUEUES,
  SERVICES,
  SharedModule,
  TRUSTED_PROXY_HOPS,
} from '@repo/shared';
import { EnvironmentEnum } from '@repo/shared-types';
import { Queue } from 'bullmq';
import { of, throwError } from 'rxjs';
import supertest from 'supertest';
import { workerBootstrapConfig } from '../src/bootstrap.config';
import { BullBoardDashboardModule } from '../src/bull-board/bull-board.module';

const BOARD = '/admin/queues';
const BOARD_API = `${BOARD}/api`;
const RESET_LINK = 'https://app.test/reset-password?token=very-secret';
const VERIFICATION_LINK = 'https://app.test/verify-email?token=very-secret';

/** What apps/auth answers per token; anything else behaves as "auth is down". */
const authReply = (token: string) => {
  switch (token) {
    case 'admin-token':
      return of({ id: 'u-admin', email: 'admin@example.com', role: 'admin' });
    case 'user-token':
      return of({ id: 'u-user', email: 'user@example.com', role: 'user' });
    case 'rejected-token':
      return throwError(() => ({ status: 401, message: 'Unauthorized' }));
    default:
      return throwError(() => new Error('ECONNREFUSED'));
  }
};

describe('queue dashboard (integration)', () => {
  let app: INestApplication;
  let emailQueue: Queue;
  let dlqQueue: Queue;
  const send = jest.fn();

  const http = () => supertest(app.getHttpServer());
  const asAdmin = (req: supertest.Test) =>
    req.set('Authorization', 'Bearer admin-token');

  /** Same wiring as src/main.ts: the real BootstrapUtil with the worker's config. */
  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        SharedModule.register({
          validate: (c) => baseEnvSchema.parse(c),
          metrics: { appName: 'worker-bull-board-integration' },
        }),
        QueueModule.registerQueues([QUEUES.EMAIL, QUEUES.PUSH]),
        BullBoardDashboardModule,
      ],
    })
      .overrideProvider(SERVICES.AUTH)
      .useValue({ send })
      .compile();

    app = module.createNestApplication();
    BootstrapUtil.setup(
      app,
      workerBootstrapConfig({
        environment: EnvironmentEnum.PRODUCTION,
        corsOrigin: 'http://localhost:4200',
      }),
    );
    await app.init();

    emailQueue = module.get<Queue>(getQueueToken(QUEUES.EMAIL));
    dlqQueue = module.get<Queue>(getQueueToken(QUEUES.EMAIL_DLQ));
  });

  beforeEach(async () => {
    send.mockReset();
    send.mockImplementation((_pattern: string, { token }: { token: string }) =>
      authReply(token),
    );
    await Promise.all(
      [emailQueue, dlqQueue].map((q) => q.obliterate({ force: true })),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  describe('access', () => {
    it('shows every queue to an admin, all of them read-only', async () => {
      const res = await asAdmin(http().get(`${BOARD_API}/queues`)).expect(200);

      const queues = res.body.queues as {
        name: string;
        readOnlyMode: boolean;
      }[];
      expect(queues.map((q) => q.name).sort()).toEqual(
        [QUEUES.EMAIL, QUEUES.EMAIL_DLQ, QUEUES.PUSH, QUEUES.PUSH_DLQ].sort(),
      );
      expect(queues.every((q) => q.readOnlyMode)).toBe(true);
    });

    it('serves the dashboard page to an admin', async () => {
      const res = await asAdmin(http().get(BOARD)).expect(200);

      expect(res.headers['content-type']).toMatch(/html/);
    });

    it('answers 401 without a token and never calls the auth service', async () => {
      const res = await http().get(`${BOARD_API}/queues`).expect(401);

      expect(res.body).toMatchObject({ statusCode: 401 });
      expect(send).not.toHaveBeenCalled();
    });

    it('answers 401 when auth rejects the token', async () => {
      await http()
        .get(`${BOARD_API}/queues`)
        .set('Authorization', 'Bearer rejected-token')
        .expect(401);
    });

    it('answers 403, with no queue content, to a signed-in non-admin', async () => {
      const res = await http()
        .get(`${BOARD_API}/queues`)
        .set('Authorization', 'Bearer user-token')
        .expect(403);

      expect(res.body).toMatchObject({ statusCode: 403 });
      expect(res.body.queues).toBeUndefined();
    });

    it('answers 503, not 401, when the auth service is down', async () => {
      const res = await http()
        .get(`${BOARD_API}/queues`)
        .set('Authorization', 'Bearer any-token')
        .expect(503);

      expect(res.body).toMatchObject({ statusCode: 503 });
    });

    it('accepts the session cookie as well as a bearer token', async () => {
      await http()
        .get(`${BOARD_API}/queues`)
        .set('Cookie', 'better-auth.session_token=admin-token')
        .expect(200);
    });

    it('answers in the shared error shape', async () => {
      const res = await http().get(`${BOARD_API}/queues`).expect(401);

      // `path` is request.url, which Express strips to the mount point; and
      // the dashboard sits outside the `api` prefix ClsModule is mounted
      // under, so there is no correlationId (see CORNER_CASES.md).
      expect(res.body).toEqual({
        statusCode: 401,
        timestamp: expect.any(String),
        path: '/api/queues',
        message: expect.objectContaining({ statusCode: 401 }),
      });
    });
  });

  describe('read-only', () => {
    const q = (name: string) => `${BOARD_API}/queues/${name}`;
    const DLQ = QUEUES.EMAIL_DLQ;

    /** Every write route of the board, each with a *valid* body, so a refusal
     *  is the read-only rule and not a validation error masking a live write. */
    const writes = (jobId: string) =>
      [
        ['put', `${q(DLQ)}/retry/failed`, {}],
        ['put', `${q(DLQ)}/promote`, {}],
        ['put', `${q(DLQ)}/clean/completed`, {}],
        ['put', `${q(DLQ)}/pause`, {}],
        ['put', `${q(DLQ)}/resume`, {}],
        ['put', `${q(DLQ)}/concurrency`, { concurrency: 5 }],
        ['put', `${q(DLQ)}/rate-limit`, { max: 1, duration: 1000 }],
        ['put', `${q(DLQ)}/rate-limit/release`, {}],
        ['put', `${q(DLQ)}/empty`, {}],
        ['put', `${q(DLQ)}/obliterate`, { force: true }],
        ['put', `${q(DLQ)}/job-schedulers/s1/remove`, {}],
        ['patch', `${q(DLQ)}/job-schedulers/s1`, { every: 1000 }],
        ['put', `${q(DLQ)}/job-schedulers/s1/run`, {}],
        ['put', `${q(DLQ)}/${jobId}/retry`, {}],
        ['put', `${q(DLQ)}/${jobId}/clean`, {}],
        ['put', `${q(DLQ)}/${jobId}/promote`, {}],
        [
          'patch',
          `${q(DLQ)}/${jobId}/update-data`,
          { jobData: { email: 'x@y.z' } },
        ],
        [
          'patch',
          `${q(DLQ)}/${jobId}/delay`,
          { runAt: Date.now() + 3_600_000 },
        ],
        ['patch', `${q(DLQ)}/${jobId}/priority`, { priority: 1 }],
        ['put', `${q(DLQ)}/${jobId}/remove-unprocessed-children`, {}],
        ['post', `${q(DLQ)}/add`, { name: 'job:x', data: { email: 'x@y.z' } }],
      ] as [method: 'put' | 'post' | 'patch', path: string, body: object][];

    it('refuses every write on a read-only queue and leaves it unchanged', async () => {
      const job = await dlqQueue.add(JOB_PATTERNS.SEND_WELCOME_EMAIL, {
        email: 'user@example.com',
      });
      const before = await dlqQueue.getJobCounts();

      for (const [method, path, body] of writes(job.id as string)) {
        const res = await asAdmin(http()[method](path)).send(body);
        expect({ method, path, status: res.status }).toEqual({
          method,
          path,
          status: 405,
        });
      }

      expect(await dlqQueue.getJobCounts()).toEqual(before);
      expect(await dlqQueue.isPaused()).toBe(false);
      expect((await dlqQueue.getJob(job.id as string))?.data).toEqual({
        email: 'user@example.com',
      });
    });

    it('does not pause a queue through pause-all / resume-all', async () => {
      await asAdmin(http().put(`${BOARD_API}/queues/pause`)).send({});

      expect(await dlqQueue.isPaused()).toBe(false);
      expect(await emailQueue.isPaused()).toBe(false);
    });

    it('covers every write route the installed dashboard defines', () => {
      // A @bull-board upgrade that adds a write route must fail here, so it
      // gets a case above instead of slipping through unexamined.
      const routesFile = join(
        dirname(require.resolve('@bull-board/api')),
        'routes.js',
      );
      const defined = [
        ...readFileSync(routesFile, 'utf8').matchAll(
          /method: '(put|post|patch|delete)',\s*route: '([^']+)'/g,
        ),
      ].map(([, method, route]) => `${method} ${route}`);

      const covered = writes(':jobId').map(
        ([method, path]) =>
          `${method} ${path
            .replace(BOARD, '')
            .replace(DLQ, ':queueName')
            .replace(/\/failed$|\/completed$/, '/:queueStatus')
            .replace('/s1', '/:schedulerId')}`,
      );
      // Pause-all/resume-all and the metrics purge have their own cases/no route.
      const globalRoutes = ['put /api/queues/pause', 'put /api/queues/resume'];
      const unmapped = defined.filter(
        (route) =>
          !globalRoutes.includes(route) &&
          !route.endsWith('/api/metrics/history/purge') &&
          !covered.includes(route),
      );

      expect(unmapped).toEqual([]);
    });
  });

  describe('account links', () => {
    const jobsOf = async (queueName: string) => {
      const res = await asAdmin(
        http().get(`${BOARD_API}/queues`).query({
          activeQueue: queueName,
          status: 'waiting',
        }),
      ).expect(200);
      const queue = (
        res.body.queues as { name: string; jobs: unknown[] }[]
      ).find((q) => q.name === queueName);
      return (queue?.jobs ?? []) as {
        id: string;
        data: Record<string, unknown>;
      }[];
    };

    it('redacts the reset link, keeps the recipient, and leaves the stored job untouched', async () => {
      const job = await dlqQueue.add(JOB_PATTERNS.SEND_PASSWORD_RESET_EMAIL, {
        email: 'user@example.com',
        resetLink: RESET_LINK,
        correlationId: '11111111-1111-4111-8111-111111111111',
      });

      const [shown] = await jobsOf(QUEUES.EMAIL_DLQ);

      expect(shown.data).toMatchObject({
        email: 'user@example.com',
        resetLink: '[redacted]',
      });
      expect(JSON.stringify(shown)).not.toContain('very-secret');
      const stored = await dlqQueue.getJob(job.id as string);
      expect(stored?.data.resetLink).toBe(RESET_LINK);
    });

    it('redacts a verification link in the job detail view as well', async () => {
      const job = await dlqQueue.add(
        JOB_PATTERNS.SEND_EMAIL_VERIFICATION_EMAIL,
        {
          email: 'user@example.com',
          verificationLink: VERIFICATION_LINK,
        },
      );

      const res = await asAdmin(
        http().get(`${BOARD_API}/queues/${QUEUES.EMAIL_DLQ}/${job.id}`),
      ).expect(200);

      expect(res.body.job.data.verificationLink).toBe('[redacted]');
      expect(JSON.stringify(res.body)).not.toContain('very-secret');
    });
  });

  describe('transport', () => {
    it('trusts exactly the configured number of proxy hops', () => {
      const express = app.getHttpAdapter().getInstance() as {
        get(key: string): unknown;
      };

      expect(express.get('trust proxy')).toBe(TRUSTED_PROXY_HOPS);
    });

    it('renders under the default helmet headers without needing inline scripts', async () => {
      const res = await asAdmin(http().get(BOARD)).expect(200);

      const csp = res.headers['content-security-policy'] as string;
      expect(csp).toBeDefined();
      const scriptSrc = /script-src ([^;]+)/.exec(csp)?.[1] ?? '';
      expect(scriptSrc.trim()).toBe("'self'");

      // Every <script> is either a non-executable data block or a same-origin file.
      const scripts = [...res.text.matchAll(/<script\b([^>]*)>/g)].map(
        (m) => m[1],
      );
      expect(scripts.length).toBeGreaterThan(0);
      for (const attrs of scripts) {
        const isData = /type="application\/json"/.test(attrs);
        const src = /src="([^"]+)"/.exec(attrs)?.[1];
        expect(
          isData || (src !== undefined && !/^(https?:)?\/\//.test(src)),
        ).toBe(true);
      }
    });

    it('serves the assets the page references', async () => {
      const page = await asAdmin(http().get(`${BOARD}/`)).expect(200);
      const assets = [
        ...page.text.matchAll(/(?:src|href)="(static\/[^"]+)"/g),
      ].map((m) => m[1]);
      expect(assets.length).toBeGreaterThan(0);

      for (const asset of assets) {
        await asAdmin(http().get(`${BOARD}/${asset}`)).expect(200);
      }
    });
  });
});
