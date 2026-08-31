import { randomUUID } from 'node:crypto';

import { Queue, Worker, type ConnectionOptions } from 'bullmq';

export interface EnqueueOptions {
  attempts?: number;
  idempotencyKey?: string;
}

export interface EnqueueInput<TPayload> {
  queue: string;
  name: string;
  payload: TPayload;
  options?: EnqueueOptions;
}

export interface QueuedJob<TPayload> {
  id: string;
  queue: string;
  name: string;
  payload: TPayload;
}

export type JobHandler<TPayload> = (job: QueuedJob<TPayload>) => Promise<void>;

export interface QueueWorker {
  close(): Promise<void>;
}

/** Provider-neutral asynchronous-job boundary for domain modules. */
export interface BackgroundJobQueue {
  enqueue<TPayload>(input: EnqueueInput<TPayload>): Promise<QueuedJob<TPayload>>;
  process<TPayload>(queue: string, handler: JobHandler<TPayload>): Promise<QueueWorker>;
  close(): Promise<void>;
}

/** Deterministic local/test adapter. Production jobs must use a durable queue. */
export class InMemoryJobQueue implements BackgroundJobQueue {
  private readonly handlers = new Map<string, JobHandler<unknown>>();
  private readonly jobsById = new Map<string, QueuedJob<unknown>>();
  private readonly dispatchedIds = new Set<string>();
  private readonly pending = new Set<Promise<void>>();

  async enqueue<TPayload>(input: EnqueueInput<TPayload>): Promise<QueuedJob<TPayload>> {
    const id = input.options?.idempotencyKey ?? randomUUID();
    const existing = this.jobsById.get(id) as QueuedJob<TPayload> | undefined;

    if (existing) {
      return existing;
    }

    const job: QueuedJob<TPayload> = {
      id,
      queue: input.queue,
      name: input.name,
      payload: input.payload,
    };
    this.jobsById.set(id, job);

    this.dispatch(job);

    return job;
  }

  async process<TPayload>(queue: string, handler: JobHandler<TPayload>): Promise<QueueWorker> {
    this.handlers.set(queue, handler as JobHandler<unknown>);
    for (const job of this.jobsById.values()) {
      if (job.queue === queue) this.dispatch(job);
    }

    return {
      close: async () => {
        this.handlers.delete(queue);
      },
    };
  }

  async close(): Promise<void> {
    await this.waitForIdle();
    this.handlers.clear();
    this.jobsById.clear();
    this.dispatchedIds.clear();
  }

  /** Test/local-development helper; production callers use durable worker acknowledgements. */
  async waitForIdle(): Promise<void> {
    await Promise.all([...this.pending]);
  }

  private dispatch<TPayload>(job: QueuedJob<TPayload>): void {
    if (this.dispatchedIds.has(job.id)) return;
    const handler = this.handlers.get(job.queue) as JobHandler<TPayload> | undefined;
    if (!handler) return;
    this.dispatchedIds.add(job.id);
    const task = Promise.resolve()
      .then(() => handler(job))
      .catch(() => undefined)
      .finally(() => this.pending.delete(task));
    this.pending.add(task);
  }
}

/** Redis-backed BullMQ adapter for durable production job execution. */
export class BullMqJobQueue implements BackgroundJobQueue {
  private readonly queues = new Map<string, Queue>();
  private readonly workers = new Set<Worker>();

  public constructor(private readonly connection: ConnectionOptions) {}

  async enqueue<TPayload>(input: EnqueueInput<TPayload>): Promise<QueuedJob<TPayload>> {
    const queue = this.getQueue(input.queue);
    const job = await queue.add(input.name, input.payload, {
      attempts: input.options?.attempts ?? 3,
      ...(input.options?.idempotencyKey ? { jobId: input.options.idempotencyKey } : {}),
      removeOnComplete: true,
      removeOnFail: false,
    });

    return {
      id: job.id ?? randomUUID(),
      queue: input.queue,
      name: input.name,
      payload: input.payload,
    };
  }

  async process<TPayload>(queue: string, handler: JobHandler<TPayload>): Promise<QueueWorker> {
    const worker = new Worker<TPayload>(
      queue,
      async (job) =>
        handler({
          id: job.id ?? 'unknown',
          queue,
          name: job.name,
          payload: job.data,
        }),
      { connection: this.connection },
    );
    this.workers.add(worker);

    return {
      close: async () => {
        this.workers.delete(worker);
        await worker.close();
      },
    };
  }

  async close(): Promise<void> {
    await Promise.all([...this.workers].map((worker) => worker.close()));
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
    this.workers.clear();
    this.queues.clear();
  }

  private getQueue(name: string): Queue {
    const existing = this.queues.get(name);
    if (existing) {
      return existing;
    }

    const queue = new Queue(name, { connection: this.connection });
    this.queues.set(name, queue);
    return queue;
  }
}

/** A short-lived Redis probe for readiness checks; it creates no job or queue state. */
export async function verifyRedisConnection(connection: ConnectionOptions): Promise<void> {
  const queue = new Queue('let-it-be-readiness-probe', { connection });
  try {
    await queue.waitUntilReady();
  } finally {
    await queue.close();
  }
}
