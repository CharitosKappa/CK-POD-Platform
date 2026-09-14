import type { SqlPool, SqlResult, TransactionClient } from '@let-it-be/db';
import { MemoryObjectStorage } from '@let-it-be/storage';
import { describe, expect, it } from 'vitest';

import { loadProviderReferenceAssets } from './generation-worker.js';

describe('loadProviderReferenceAssets', () => {
  it('loads active project-owned reference images from private storage in request order', async () => {
    const pool = referencePool([
      {
        id: 'reference-2',
        storage_key: 'projects/project-1/references/reference-2.jpg',
        content_type: 'image/jpeg',
        byte_size: 2,
      },
      {
        id: 'reference-1',
        storage_key: 'projects/project-1/references/reference-1.png',
        content_type: 'image/png',
        byte_size: 3,
      },
    ]);
    const storage = new MemoryObjectStorage();
    await storage.put({
      key: 'projects/project-1/references/reference-1.png',
      body: new Uint8Array([1, 2, 3]),
      contentType: 'image/png',
    });
    await storage.put({
      key: 'projects/project-1/references/reference-2.jpg',
      body: new Uint8Array([4, 5]),
      contentType: 'image/jpeg',
    });

    const assets = await loadProviderReferenceAssets(pool, storage, 'project-1', [
      'reference-1',
      'reference-2',
    ]);

    expect(assets).toEqual([
      { id: 'reference-1', body: new Uint8Array([1, 2, 3]), contentType: 'image/png' },
      { id: 'reference-2', body: new Uint8Array([4, 5]), contentType: 'image/jpeg' },
    ]);
  });

  it('rejects references that are missing from the active project asset set', async () => {
    await expect(
      loadProviderReferenceAssets(referencePool([]), new MemoryObjectStorage(), 'project-1', [
        'reference-1',
      ]),
    ).rejects.toThrow('Reference image is no longer available.');
  });

  it('rejects unsupported reference media before a paid provider request', async () => {
    const pool = referencePool([
      {
        id: 'reference-1',
        storage_key: 'projects/project-1/references/reference-1.gif',
        content_type: 'image/gif',
        byte_size: 3,
      },
    ]);

    await expect(
      loadProviderReferenceAssets(pool, new MemoryObjectStorage(), 'project-1', ['reference-1']),
    ).rejects.toThrow('Reference image format is not supported.');
  });
});

function referencePool(
  rows: Array<{
    id: string;
    storage_key: string;
    content_type: string;
    byte_size: number;
  }>,
): SqlPool {
  return {
    query: async <T>(text: string): Promise<SqlResult<T>> => {
      expect(text).toContain("asset_type = 'REFERENCE'");
      expect(text).toContain("status = 'ACTIVE'");
      return { rows: rows as T[], rowCount: rows.length };
    },
    connect: async (): Promise<TransactionClient> => {
      throw new Error('Unexpected transaction.');
    },
  };
}
