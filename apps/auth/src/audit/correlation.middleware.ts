import { CLS_CORRELATION_ID, ContextUtil, type ClsService } from '@repo/shared';

/**
 * better-auth is mounted straight on the HTTP adapter, outside Nest's
 * middleware chain, so the global CLS middleware never runs for `/api/auth/*`
 * and audit events recorded there would have no correlation id. This wraps
 * the better-auth handler (the module's `middleware` option) in a CLS
 * context with a fresh id, set the same way SharedModule does for Nest routes.
 */
export function withCorrelationId(cls: ClsService) {
  return (
    req: Record<string, unknown>,
    _res: unknown,
    next: (error?: unknown) => void,
  ): void =>
    cls.run(() => {
      const correlationId = ContextUtil.newCorrelationId();
      cls.set(CLS_CORRELATION_ID, correlationId);
      req[CLS_CORRELATION_ID] = correlationId;
      next();
    });
}
