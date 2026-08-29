import { describe, expect, it } from 'vitest';

import { InMemoryJobQueue } from './index.js';

describe('InMemoryJobQueue', () => {
  it('delivers a job to its handler and respects an idempotency key', async () => {
    const queue = new InMemoryJobQueue();
    const received: string[] = [];
    const worker = await queue.process<{ projectId: string }>('foundation', async (job) => {
      received.push(job.payload.projectId);
    });

    const first = await queue.enqueue({
      queue: 'foundation',
      name: 'check',
      payload: { projectId: 'project-1' },
      options: { idempotencyKey: 'foundation-check-project-1' },
    });
    const duplicate = await queue.enqueue({
      queue: 'foundation',
      name: 'check',
      payload: { projectId: 'project-1' },
      options: { idempotencyKey: 'foundation-check-project-1' },
    });

    expect(received).toEqual(['project-1']);
    expect(duplicate.id).toBe(first.id);

    await worker.close();
    await queue.close();
  });
});
