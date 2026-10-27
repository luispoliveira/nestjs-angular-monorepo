import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { ClsService } from 'nestjs-cls';
import { ZodValidationException } from 'nestjs-zod';
import { AuditService } from '../audit/audit.service';
import { AllExceptionFilter } from './http-exception.filter';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

const makeHttpContext = (overrides: Record<string, unknown> = {}) => {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const response = { status, ...overrides };
  const request = { method: 'GET', url: '/test', ...overrides };

  return {
    json,
    status,
    response,
    request,
    host: {
      getType: jest.fn().mockReturnValue('http'),
      switchToHttp: jest.fn().mockReturnValue({
        getResponse: () => response,
        getRequest: () => request,
      }),
    } as unknown as ArgumentsHost,
  };
};

describe('AllExceptionFilter', () => {
  let filter: AllExceptionFilter;
  let clsService: jest.Mocked<ClsService>;

  beforeEach(() => {
    clsService = { get: jest.fn().mockReturnValue('corr-123') } as unknown as jest.Mocked<ClsService>;
    filter = new AllExceptionFilter(clsService);
    jest.clearAllMocks();
  });

  describe('HTTP context', () => {
    it('should return structured JSON for an HttpException', () => {
      const { host, status, json } = makeHttpContext();
      const exception = new HttpException('Not found', HttpStatus.NOT_FOUND);

      filter.catch(exception, host);

      expect(status).toHaveBeenCalledWith(404);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 404,
          correlationId: 'corr-123',
          path: '/test',
        }),
      );
    });

    it('should return 500 for unknown errors', () => {
      const { host, status, json } = makeHttpContext();
      const exception = new Error('Something went wrong');

      filter.catch(exception, host);

      expect(status).toHaveBeenCalledWith(500);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 500 }),
      );
    });

    it('should call Sentry.captureException for 5xx errors', () => {
      const { host } = makeHttpContext();
      const exception = new HttpException('Server error', 500);

      filter.catch(exception, host);

      expect(Sentry.captureException).toHaveBeenCalledWith(exception);
    });

    it('should NOT call Sentry.captureException for 4xx errors', () => {
      const { host } = makeHttpContext();
      const exception = new HttpException('Bad request', 400);

      filter.catch(exception, host);

      expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it('should return 400 with errors array for ZodValidationException', () => {
      const { host, status, json } = makeHttpContext();
      const zodError = { issues: [{ message: 'Required', path: ['email'] }] };
      const exception = {
        getZodError: jest.fn().mockReturnValue(zodError),
      } as unknown as ZodValidationException;

      Object.setPrototypeOf(exception, ZodValidationException.prototype);
      filter.catch(exception, host);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          message: 'Validation failed',
          errors: zodError.issues,
        }),
      );
    });
  });

  describe('RPC context', () => {
    it('should re-throw and capture exception in RPC context', () => {
      const exception = new Error('RPC error');
      const host = {
        getType: jest.fn().mockReturnValue('rpc'),
      } as unknown as ArgumentsHost;

      expect(() => filter.catch(exception, host)).toThrow(exception);
      expect(Sentry.captureException).toHaveBeenCalledWith(exception);
    });
  });

  it('should not log the search value of the request url', () => {
    const errorSpy = jest
      .spyOn((filter as unknown as { logger: { error: () => void } }).logger, 'error')
      .mockImplementation(() => undefined);
    const { host } = makeHttpContext({ url: '/api/v1/customers?search=123456789' });

    filter.catch(new HttpException('Not found', HttpStatus.NOT_FOUND), host);

    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('123456789');
    expect(JSON.stringify(errorSpy.mock.calls)).toContain('search=[SANITIZED]');
  });

  it('should not echo the search value in the error response path', () => {
    const { host, json } = makeHttpContext({ url: '/api/v1/customers?search=123456789&take=101' });

    filter.catch(new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED), host);

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/api/v1/customers?search=[SANITIZED]&take=101' }),
    );
  });

  it('should not echo the search value in a validation error response path', () => {
    const { host, json } = makeHttpContext({ url: '/api/v1/customers?search=123456789&take=101' });
    const zodError = { issues: [{ path: ['take'], message: 'Too big' }] };
    const exception = Object.assign(Object.create(ZodValidationException.prototype), {
      getZodError: () => zodError,
    });

    filter.catch(exception, host);

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/api/v1/customers?search=[SANITIZED]&take=101' }),
    );
  });

  describe('audit of rejected requests', () => {
    let audit: { record: jest.Mock };
    let auditedFilter: AllExceptionFilter;
    const meta = { action: 'customer.delete', targetType: 'customer' };

    beforeEach(() => {
      audit = { record: jest.fn().mockResolvedValue(undefined) };
      auditedFilter = new AllExceptionFilter(clsService, audit as unknown as AuditService);
    });

    const contextWith = (extra: Record<string, unknown>) =>
      makeHttpContext({ url: '/api/v1/customers/c1', params: { id: 'c1' }, ip: '10.0.0.1', headers: { 'user-agent': 'jest' }, ...extra });

    it('records a 401 as a failure with no actor', () => {
      const { host } = contextWith({ audit: meta });

      auditedFilter.catch(new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED), host);

      const event = audit.record.mock.calls[0]![0] as Record<string, unknown>;
      expect(event).toMatchObject({
        action: 'customer.delete',
        outcome: 'failure',
        errorCode: '401',
        targetType: 'customer',
        targetId: 'c1',
        ip: '10.0.0.1',
        userAgent: 'jest',
      });
      expect(event).not.toHaveProperty('actorId');
    });

    it('records a 403 with the authenticated actor', () => {
      const { host } = contextWith({ audit: meta, user: { id: 'u1', email: 'u@x.y' } });

      auditedFilter.catch(new HttpException('Forbidden', HttpStatus.FORBIDDEN), host);

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'failure', errorCode: '403', actorId: 'u1', actorEmail: 'u@x.y' }),
      );
    });

    it('records the real admin of an impersonation session', () => {
      const { host } = contextWith({ audit: meta, user: { id: 'u1', impersonatedBy: 'admin-0' } });

      auditedFilter.catch(new HttpException('Forbidden', HttpStatus.FORBIDDEN), host);

      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ impersonatedById: 'admin-0' }));
    });

    it.each([HttpStatus.NOT_FOUND, HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT])(
      'does not record a %s (the interceptor owns those)',
      (status) => {
        const { host } = contextWith({ audit: meta });

        auditedFilter.catch(new HttpException('x', status), host);

        expect(audit.record).not.toHaveBeenCalled();
      },
    );

    it('records nothing when the route is not audited', () => {
      const { host } = contextWith({});

      auditedFilter.catch(new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED), host);

      expect(audit.record).not.toHaveBeenCalled();
    });

    it('records nothing when the interceptor already recorded this request', () => {
      const { host } = contextWith({ audit: meta, auditRecorded: true });

      auditedFilter.catch(new HttpException('Forbidden', HttpStatus.FORBIDDEN), host);

      expect(audit.record).not.toHaveBeenCalled();
    });

    it('keeps the response unchanged', () => {
      const { host, status, json } = contextWith({ audit: meta });

      auditedFilter.catch(new HttpException('Forbidden', HttpStatus.FORBIDDEN), host);

      expect(status).toHaveBeenCalledWith(403);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403, correlationId: 'corr-123' }));
    });

    it('works in apps that have no audit service', () => {
      const { host, status } = contextWith({ audit: meta });

      expect(() => filter.catch(new HttpException('Forbidden', HttpStatus.FORBIDDEN), host)).not.toThrow();
      expect(status).toHaveBeenCalledWith(403);
    });
  });
});
