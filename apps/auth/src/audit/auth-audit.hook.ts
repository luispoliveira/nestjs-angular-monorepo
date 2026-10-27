import { Injectable, Logger } from '@nestjs/common';
import { AuditService, SentryUtil } from '@repo/shared';
import * as nestjsBetterAuth from '@thallesp/nestjs-better-auth';
import { buildAuthEvent } from './auth-audit';

/**
 * How long a response may wait for its audit event. The write is awaited so
 * the event normally exists when the response leaves, but if Mongo is down
 * the driver blocks ~30s: past this budget the response goes out and the
 * write finishes (or fails, logged and reported) in the background.
 */
export const AUDIT_HOOK_MAX_WAIT_MS = 2000;

/**
 * One after hook for every better-auth endpoint (a pathless `@AfterHook()`
 * runs for all of them, failures included — better-auth sets
 * `ctx.context.returned` to the APIError before running after hooks).
 * `AUTH_AUDIT_PATHS` decides what is audited.
 *
 * This hook must never throw: an APIError thrown from an after hook replaces
 * the real response, so a bug here could turn a successful sign-in into an error.
 */
@nestjsBetterAuth.Hook()
@Injectable()
export class AuthAuditHook {
  private readonly logger = new Logger(AuthAuditHook.name);

  constructor(
    private readonly audit: AuditService,
    private readonly authService: nestjsBetterAuth.AuthService,
  ) {}

  /**
   * better-auth clears the session during `/sign-out`, so the after hook can
   * no longer tell who signed out. Look the session up first and stash it on
   * the (shared) hook context for `buildAuthEvent`.
   */
  @nestjsBetterAuth.BeforeHook('/sign-out')
  async rememberSignOutSession(
    ctx: nestjsBetterAuth.AuthHookContext,
  ): Promise<void> {
    try {
      const found = await this.authService.api.getSession({
        headers: ctx.headers as Headers,
      });
      if (found) {
        // `auditSession` is read back by buildAuthEvent (AuthAuditContext).
        (ctx.context as unknown as Record<string, unknown>).auditSession =
          found;
      }
    } catch {
      // Best-effort: a sign-out without a known actor is still audited.
    }
  }

  /**
   * `/admin/revoke-user-session` is addressed by session token, so the
   * request does not say whose session it is. Look the owner up before the
   * session disappears and stash it for `buildAuthEvent`.
   */
  @nestjsBetterAuth.BeforeHook('/admin/revoke-user-session')
  async rememberRevokedSessionOwner(
    ctx: nestjsBetterAuth.AuthHookContext,
  ): Promise<void> {
    try {
      const token = (ctx.body as { sessionToken?: unknown } | undefined)
        ?.sessionToken;
      if (typeof token !== 'string') return;
      const found = await ctx.context.internalAdapter.findSession(token);
      if (found?.user?.id) {
        (ctx.context as unknown as Record<string, unknown>).auditTargetId =
          found.user.id;
      }
    } catch {
      // Best-effort: the event is still recorded, just without a target.
    }
  }

  @nestjsBetterAuth.AfterHook()
  async onAfter(ctx: nestjsBetterAuth.AuthHookContext): Promise<void> {
    try {
      const event = buildAuthEvent(ctx);
      if (event) await this.withinBudget(this.audit.record(event));
    } catch (error) {
      this.logger.error(
        'Failed to audit an authentication request',
        error instanceof Error ? error.stack : String(error),
      );
      SentryUtil.captureException(error, { tags: { component: 'audit' } });
    }
  }

  private async withinBudget(write: Promise<void>): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const budget = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, AUDIT_HOOK_MAX_WAIT_MS);
    });
    try {
      await Promise.race([write, budget]);
    } finally {
      clearTimeout(timer);
    }
  }
}
