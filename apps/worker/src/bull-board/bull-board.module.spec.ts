import { BullBoardModule } from '@bull-board/nestjs';
import { QUEUES } from '@repo/shared';
import { RedactingBullMQAdapter } from './redacting-bullmq.adapter';

jest.mock('@bull-board/nestjs', () => ({
  BullBoardModule: {
    forRootAsync: jest.fn().mockReturnValue({ module: class RootStub {} }),
    forFeature: jest.fn().mockReturnValue({ module: class FeatureStub {} }),
  },
}));

// The module's decorator runs at import time, so import it after the mock.
import './bull-board.module';

interface QueueRegistration {
  name: string;
  adapter: unknown;
  options: { readOnlyMode: boolean };
}

describe('BullBoardDashboardModule', () => {
  const registered = (
    (BullBoardModule.forFeature as jest.Mock).mock
      .calls as QueueRegistration[][]
  ).flat();

  it('shows the email and push queues with their dead-letter queues', () => {
    expect(registered.map((queue) => queue.name).sort()).toEqual(
      [QUEUES.EMAIL, QUEUES.EMAIL_DLQ, QUEUES.PUSH, QUEUES.PUSH_DLQ].sort(),
    );
  });

  it('registers every queue read-only, through the redacting adapter', () => {
    for (const queue of registered) {
      expect(queue.options.readOnlyMode).toBe(true);
      expect(queue.adapter).toBe(RedactingBullMQAdapter);
    }
  });
});
