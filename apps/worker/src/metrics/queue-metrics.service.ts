import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { QUEUES } from '@repo/shared';
import { Queue } from 'bullmq';
import { Counter, Gauge, Histogram } from 'prom-client';

@Injectable()
export class QueueMetricsService implements OnModuleInit {
  private durationHistogram!: Histogram;
  private failureCounter!: Counter;

  constructor(
    @InjectQueue(QUEUES.EMAIL) private readonly emailQueue: Queue,
    @InjectQueue(QUEUES.EMAIL_DLQ) private readonly emailDlqQueue: Queue,
    @InjectQueue(QUEUES.PUSH) private readonly pushQueue: Queue,
    @InjectQueue(QUEUES.PUSH_DLQ) private readonly pushDlqQueue: Queue,
  ) {}

  onModuleInit(): void {
    const pairs = [
      {
        queue: this.emailQueue,
        name: QUEUES.EMAIL,
        dlq: this.emailDlqQueue,
        dlqName: QUEUES.EMAIL_DLQ,
      },
      {
        queue: this.pushQueue,
        name: QUEUES.PUSH,
        dlq: this.pushDlqQueue,
        dlqName: QUEUES.PUSH_DLQ,
      },
    ];

    new Gauge({
      name: 'bullmq_queue_depth',
      help: 'BullMQ queue depth by state',
      labelNames: ['queue', 'state'],
      async collect() {
        for (const { queue, name, dlq, dlqName } of pairs) {
          const counts = await queue.getJobCounts(
            'waiting',
            'active',
            'delayed',
            'failed',
          );
          this.set({ queue: name, state: 'waiting' }, counts.waiting ?? 0);
          this.set({ queue: name, state: 'active' }, counts.active ?? 0);
          this.set({ queue: name, state: 'delayed' }, counts.delayed ?? 0);
          this.set({ queue: name, state: 'failed' }, counts.failed ?? 0);

          const dlqCounts = await dlq.getJobCounts('waiting');
          this.set(
            { queue: dlqName, state: 'waiting' },
            dlqCounts.waiting ?? 0,
          );
        }
      },
    });

    this.durationHistogram = new Histogram({
      name: 'bullmq_job_duration_seconds',
      help: 'BullMQ job processing duration in seconds',
      labelNames: ['queue', 'job_name'],
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10, 30],
    });

    this.failureCounter = new Counter({
      name: 'bullmq_job_failures_total',
      help: 'Total number of permanently failed BullMQ jobs',
      labelNames: ['queue', 'job_name'],
    });
  }

  recordDuration(
    jobName: string,
    durationMs: number,
    queue: string = QUEUES.EMAIL,
  ): void {
    this.durationHistogram.observe(
      { queue, job_name: jobName },
      durationMs / 1000,
    );
  }

  recordFailure(jobName: string, queue: string = QUEUES.EMAIL): void {
    this.failureCounter.inc({ queue, job_name: jobName });
  }
}
