import { describe, expect, it } from 'vitest';

import { MemoryObjectStorage } from './index.js';

describe('MemoryObjectStorage', () => {
  it('stores, reads, and removes a private object without exposing a URL', async () => {
    const storage = new MemoryObjectStorage();
    const body = new TextEncoder().encode('private asset');

    await storage.put({
      key: 'projects/example/preview.png',
      body,
      contentType: 'image/png',
      metadata: { classification: 'preview' },
    });

    expect(await storage.exists('projects/example/preview.png')).toBe(true);
    expect(await storage.get('projects/example/preview.png')).toMatchObject({
      contentType: 'image/png',
      metadata: { classification: 'preview' },
    });

    await storage.delete('projects/example/preview.png');
    expect(await storage.get('projects/example/preview.png')).toBeNull();
  });

  it('rejects unsafe object keys', async () => {
    const storage = new MemoryObjectStorage();

    await expect(
      storage.put({
        key: '../outside.png',
        body: new Uint8Array(),
        contentType: 'image/png',
      }),
    ).rejects.toThrow(/traversal/);
    await expect(
      storage.put({
        key: '/absolute/private.png',
        body: new Uint8Array(),
        contentType: 'image/png',
      }),
    ).rejects.toThrow(/relative paths/);
  });

  it('accepts streamed writes and exposes streamed reads', async () => {
    const storage = new MemoryObjectStorage();
    async function* chunks() {
      yield new TextEncoder().encode('first ');
      yield new TextEncoder().encode('second');
    }

    await storage.put({
      key: 'admin/customer-exports/example.csv',
      body: chunks(),
      contentType: 'text/csv',
    });
    const opened = await storage.open('admin/customer-exports/example.csv');
    const values: Uint8Array[] = [];
    for await (const chunk of opened!.body) values.push(chunk);

    expect(new TextDecoder().decode(values[0])).toBe('first second');
  });
});
