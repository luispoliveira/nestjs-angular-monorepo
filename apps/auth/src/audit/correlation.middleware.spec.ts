import { CLS_CORRELATION_ID, type ClsService } from '@repo/shared';
import { withCorrelationId } from './correlation.middleware';

describe('withCorrelationId', () => {
  const makeCls = () => {
    const store = new Map<string, unknown>();
    const run = jest.fn((callback: () => unknown) => callback());
    const cls = {
      run,
      set: jest.fn((key: string, value: unknown) => store.set(key, value)),
      get: jest.fn((key: string) => store.get(key)),
    };
    return { cls: cls as unknown as ClsService, run, store };
  };

  it('opens a CLS context, stores a fresh correlation id and calls next inside it', () => {
    const { cls, run, store } = makeCls();
    const req: Record<string, unknown> = {};
    const next = jest.fn(() =>
      expect(store.get(CLS_CORRELATION_ID)).toBeDefined(),
    );

    withCorrelationId(cls)(req, {}, next);

    expect(run).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
    expect(store.get(CLS_CORRELATION_ID)).toMatch(/^\d+-[0-9a-f-]{36}$/);
  });

  it('also exposes the id on the request, like the Nest request middleware does', () => {
    const { cls, store } = makeCls();
    const req: Record<string, unknown> = {};

    withCorrelationId(cls)(req, {}, jest.fn());

    expect(req[CLS_CORRELATION_ID]).toBe(store.get(CLS_CORRELATION_ID));
  });

  it('gives every request its own id', () => {
    const first: Record<string, unknown> = {};
    const second: Record<string, unknown> = {};
    const { cls } = makeCls();

    withCorrelationId(cls)(first, {}, jest.fn());
    withCorrelationId(cls)(second, {}, jest.fn());

    expect(first[CLS_CORRELATION_ID]).not.toBe(second[CLS_CORRELATION_ID]);
  });
});
