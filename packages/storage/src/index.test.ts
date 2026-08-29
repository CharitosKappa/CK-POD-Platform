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
  });
});
