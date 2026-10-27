import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Counter, Histogram } from '@prometheus-io/client';
import { Observable, of, throwError } from 'rxjs';
import { firstValueFrom } from 'rxjs';

jest.mock('@prometheus-io/client', () => ({
  Histogram: jest.fn().mockReturnValue({ observe: jest.fn() }),
  Counter: jest.fn().mockReturnValue({ inc: jest.fn() }),
}));

// Import AFTER mock is set up
import { HttpMetricsInterceptor } from './http-metrics.interceptor';

const makeContext = (type: string, route = '/api/test', statusCode = 200) => {
  const getRequest = jest.fn().mockReturnValue({ method: 'GET', route: { path: route } });
  const getResponse = jest.fn().mockReturnValue({ statusCode });
  return {
    getType: jest.fn().mockReturnValue(type),
    switchToHttp: jest.fn().mockReturnValue({ getRequest, getResponse }),
  } as unknown as ExecutionContext;
};

const makeHandler = (obs: Observable<unknown>): CallHandler => ({
  handle: jest.fn().mockReturnValue(obs),
});

describe('HttpMetricsInterceptor', () => {
  let interceptor: HttpMetricsInterceptor;
  let mockHistogram: { observe: jest.Mock };
  let mockCounter: { inc: jest.Mock };

  beforeAll(() => {
    // Instances are created once at module scope — capture before any clearAllMocks
    mockHistogram = (Histogram as jest.Mock).mock.results[0].value as { observe: jest.Mock };
    mockCounter = (Counter as jest.Mock).mock.results[0].value as { inc: jest.Mock };
  });

  beforeEach(() => {
    interceptor = new HttpMetricsInterceptor();
    mockHistogram.observe.mockClear();
    mockCounter.inc.mockClear();
  });

  it('should passthrough without recording when context is not HTTP', async () => {
    const context = makeContext('rpc');
    const handler = makeHandler(of({ data: 'ok' }));

    const result$ = interceptor.intercept(context, handler);
    await firstValueFrom(result$);

    expect(mockHistogram.observe).not.toHaveBeenCalled();
    expect(mockCounter.inc).not.toHaveBeenCalled();
  });

  it('should call observe and inc on successful HTTP response', async () => {
    const context = makeContext('http', '/api/users', 200);
    const handler = makeHandler(of({ users: [] }));

    const result$ = interceptor.intercept(context, handler);
    await firstValueFrom(result$);

    expect(mockHistogram.observe).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET', route: '/api/users', status: '200' }),
      expect.any(Number),
    );
    expect(mockCounter.inc).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET', route: '/api/users', status: '200' }),
    );
  });

  it('should call observe and inc even on HTTP error response', async () => {
    const context = makeContext('http', '/api/fail', 500);
    const handler = makeHandler(throwError(() => new Error('fail')));

    const result$ = interceptor.intercept(context, handler);
    await firstValueFrom(result$).catch(() => {});

    expect(mockHistogram.observe).toHaveBeenCalled();
    expect(mockCounter.inc).toHaveBeenCalled();
  });

  it('should use [unknown] as route when route path is missing', async () => {
    const getRequest = jest.fn().mockReturnValue({ method: 'GET', route: undefined });
    const getResponse = jest.fn().mockReturnValue({ statusCode: 200 });
    const context = {
      getType: jest.fn().mockReturnValue('http'),
      switchToHttp: jest.fn().mockReturnValue({ getRequest, getResponse }),
    } as unknown as ExecutionContext;
    const handler = makeHandler(of({}));

    const result$ = interceptor.intercept(context, handler);
    await firstValueFrom(result$);

    expect(mockHistogram.observe).toHaveBeenCalledWith(
      expect.objectContaining({ route: '[unknown]' }),
      expect.any(Number),
    );
  });
});
