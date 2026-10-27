import { CallHandler, ExecutionContext } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { Observable, of, throwError } from 'rxjs';
import { MongoService } from '../mongo/mongo.service';
import { LoggingInterceptor } from './logging.interceptor';

const makeContext = (responseStatusCode = 200, url = '/api/test') => {
  const getRequest = jest.fn().mockReturnValue({
    method: 'GET',
    url,
    body: { key: 'value' },
    headers: { authorization: 'Bearer token' },
    ip: '127.0.0.1',
  });
  const getResponse = jest.fn().mockReturnValue({ statusCode: responseStatusCode });

  return {
    switchToHttp: jest.fn().mockReturnValue({ getRequest, getResponse }),
  } as unknown as ExecutionContext;
};

const makeHandler = (observable: Observable<unknown>): CallHandler => ({
  handle: jest.fn().mockReturnValue(observable),
});

describe('LoggingInterceptor', () => {
  let interceptor: LoggingInterceptor;
  let mongoService: jest.Mocked<MongoService>;
  let clsService: jest.Mocked<ClsService>;
  const mockLog = { _id: 'log-id-123' };

  beforeEach(() => {
    mongoService = {
      createLog: jest.fn().mockResolvedValue(mockLog),
      updateLog: jest.fn().mockResolvedValue(mockLog),
    } as unknown as jest.Mocked<MongoService>;

    clsService = {
      get: jest.fn().mockReturnValue('corr-abc'),
    } as unknown as jest.Mocked<ClsService>;

    interceptor = new LoggingInterceptor(mongoService, clsService);
  });

  it('should call createLog with request data on every request', async () => {
    const context = makeContext();
    const handler = makeHandler(of({ result: 'ok' }));

    const result$ = await interceptor.intercept(context, handler);
    await new Promise<void>((resolve) => result$.subscribe({ next: () => resolve(), error: resolve }));

    expect(mongoService.createLog).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        url: '/api/test',
        ip: '127.0.0.1',
        correlationId: 'corr-abc',
      }),
    );
  });

  it('should call updateLog with statusCode and duration on success', async () => {
    const context = makeContext(200);
    const handler = makeHandler(of({ data: 'response' }));

    const result$ = await interceptor.intercept(context, handler);
    await new Promise<void>((resolve) => result$.subscribe({ next: () => resolve(), error: resolve }));

    expect(mongoService.updateLog).toHaveBeenCalledWith(
      'log-id-123',
      expect.objectContaining({ statusCode: 200 }),
    );
  });

  it('should call updateLog with error statusCode on stream error', async () => {
    const context = makeContext(400);
    const error = { status: 400, response: { message: 'Bad request' } };
    const handler = makeHandler(throwError(() => error));

    const result$ = await interceptor.intercept(context, handler);
    await new Promise<void>((resolve) =>
      result$.subscribe({ next: resolve, error: () => resolve() }),
    );

    expect(mongoService.updateLog).toHaveBeenCalledWith(
      'log-id-123',
      expect.objectContaining({ statusCode: 400 }),
    );
  });

  it('should not call updateLog when createLog returns undefined (on error)', async () => {
    mongoService.createLog.mockResolvedValue(undefined as never);
    const context = makeContext(200);
    const handler = makeHandler(of({}));

    const result$ = await interceptor.intercept(context, handler);
    await new Promise<void>((resolve) => result$.subscribe({ next: () => resolve(), error: resolve }));

    expect(mongoService.updateLog).not.toHaveBeenCalled();
  });

  it.each(['/api/health/live', '/api/health/ready', '/api/metrics?x=1'])(
    'should skip the Mongo log for probe %s',
    async (url) => {
      const handler = makeHandler(of({ status: 'ok' }));

      const result$ = await interceptor.intercept(makeContext(200, url), handler);
      await new Promise<void>((resolve) =>
        result$.subscribe({ next: () => resolve(), error: resolve }),
      );

      expect(handler.handle).toHaveBeenCalled();
      expect(mongoService.createLog).not.toHaveBeenCalled();
      expect(mongoService.updateLog).not.toHaveBeenCalled();
    },
  );

  it('should store the request url with the search value redacted', async () => {
    const context = makeContext(200, '/api/v1/customers?skip=0&search=123456789');
    const handler = makeHandler(of({ result: 'ok' }));

    const result$ = await interceptor.intercept(context, handler);
    await new Promise<void>((resolve) => result$.subscribe({ next: () => resolve(), error: resolve }));

    expect(mongoService.createLog).toHaveBeenCalledWith(
      expect.objectContaining({ url: '/api/v1/customers?skip=0&search=[SANITIZED]' }),
    );
  });
});
