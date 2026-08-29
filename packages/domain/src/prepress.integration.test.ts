import { randomBytes } from 'node:crypto';

import { createDatabaseClient, type SqlPool } from '@let-it-be/db';
import { createEmptyEditorDocument } from '@let-it-be/editor-schema';
import { InMemoryJobQueue } from '@let-it-be/queue';
import { MemoryObjectStorage } from '@let-it-be/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AssetService } from './assets.js';
import { IdentityService } from './identity.js';
import { PrepressService, startPrepressConsumer } from './prepress.js';
import { ProjectService } from './projects.js';

const integrationDatabaseUrl = process.env.DATABASE_URL;
const integrationSuite = integrationDatabaseUrl ? describe : describe.skip;

integrationSuite('prepress and production rendering integration', () => {
  let pool: SqlPool;
  let close: () => Promise<void>;
  let identity: IdentityService;
  let projects: ProjectService;

  beforeAll(() => {
    const database = createDatabaseClient(integrationDatabaseUrl as string);
    pool = database.pool;
    close = database.close;
    identity = new IdentityService(pool);
    projects = new ProjectService(pool);
  });

  afterAll(async () => close());

  it('renders a private production master asynchronously with lineage and a controlled preview', async () => {
    const harness = await createHarness(pool);
    const guest = await identity.createGuestSession();
    const project = await projects.create(guest, selection('black'));
    const source = await insertSource(pool, project.id, harness.storage, 'bright-art');
    const document = artworkDocument(source.id);
    await projects.autosave(guest, project.id, document, project.revision);

    const requested = await harness.prepress.request(guest, project.id);
    await harness.queue.waitForIdle();
    const completed = await harness.prepress.latest(guest, project.id);
    const duplicate = await harness.prepress.request(guest, project.id);

    expect(completed).toMatchObject({
      id: requested.id,
      status: 'REVIEW_REQUIRED',
      score: { band: 'GREEN' },
    });
    expect(duplicate.id).toBe(requested.id);
    expect(JSON.stringify(completed)).not.toContain('production-master');
    expect(JSON.stringify(completed)).not.toContain('storage_key');

    const assets = await pool.query<{ id: string; asset_type: string; storage_key: string }>(
      `SELECT id, asset_type, storage_key FROM app.assets WHERE project_id = $1 AND asset_type IN ('PRODUCTION_MASTER', 'PREPRESS_PREVIEW')`,
      [project.id],
    );
    const master = assets.rows.find((asset) => asset.asset_type === 'PRODUCTION_MASTER');
    const preview = assets.rows.find((asset) => asset.asset_type === 'PREPRESS_PREVIEW');
    expect(master?.storage_key).toMatch(/^prepress\//);
    expect(await harness.storage.exists(master?.storage_key as string)).toBe(true);
    const assetService = new AssetService(pool);
    expect(
      await assetService.getControlledPreview(guest, project.id, master?.id as string),
    ).toBeNull();
    expect(
      await assetService.getControlledPreview(guest, project.id, preview?.id as string),
    ).toMatchObject({ contentType: 'image/png' });
    expect(
      await assetService.getControlledPreview(
        await identity.createGuestSession(),
        project.id,
        preview?.id as string,
      ),
    ).toBeNull();
    const lineage = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM app.asset_lineage WHERE derived_asset_id = $1`,
      [master?.id],
    );
    expect(lineage.rows[0]?.count).toBe(1);
    await harness.close();
  });

  it('persists a blocked result for an invalid draft without destroying the document', async () => {
    const harness = await createHarness(pool);
    const guest = await identity.createGuestSession();
    const project = await projects.create(guest, selection('white'));
    const source = await insertSource(pool, project.id, harness.storage, 'invalid-placement');
    const document = artworkDocument(source.id);
    document.layers[0] = { ...document.layers[0]!, x: 0.98 };
    const saved = await projects.autosave(guest, project.id, document, project.revision);
    await harness.prepress.request(guest, project.id);
    await harness.queue.waitForIdle();
    const result = await harness.prepress.latest(guest, project.id);

    expect(result).toMatchObject({ status: 'BLOCKED' });
    expect(result?.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'PRINT_AREA_CLIPPING', severity: 'BLOCKER' }),
      ]),
    );
    expect((await projects.getVersions(guest, project.id))[0]?.id).toBe(saved.version.id);
    await harness.close();
  });

  it('retries a failed source resolution idempotently after the source becomes available', async () => {
    const harness = await createHarness(pool);
    const guest = await identity.createGuestSession();
    const project = await projects.create(guest, selection('navy'));
    const source = await insertSource(pool, project.id, harness.storage, 'retry-source', false);
    await projects.autosave(guest, project.id, artworkDocument(source.id), project.revision);
    const first = await harness.prepress.request(guest, project.id);
    await harness.queue.waitForIdle();
    expect((await harness.prepress.latest(guest, project.id))?.status).toBe('FAILED');
    await harness.storage.put({
      key: source.key,
      body: svg('retry-source'),
      contentType: 'image/svg+xml',
    });
    const retried = await harness.prepress.request(guest, project.id);
    await harness.queue.waitForIdle();
    expect(retried.id).toBe(first.id);
    expect((await harness.prepress.latest(guest, project.id))?.status).toBe('REVIEW_REQUIRED');
    await harness.close();
  });
});

async function createHarness(pool: SqlPool) {
  const queue = new InMemoryJobQueue();
  const storage = new MemoryObjectStorage();
  const prepress = new PrepressService(pool, queue, storage);
  const consumer = await startPrepressConsumer(queue, (runId) => prepress.process(runId));
  return {
    queue,
    storage,
    prepress,
    close: async () => {
      await consumer.close();
      await queue.close();
    },
  };
}

function artworkDocument(assetId: string) {
  const document = createEmptyEditorDocument();
  return {
    ...document,
    layers: [
      {
        id: 'art',
        type: 'image' as const,
        assetId,
        x: 0.5,
        y: 0.5,
        width: 0.4,
        height: 0.4,
        rotation: 12,
        opacity: 1,
        visible: true,
        locked: false,
        zIndex: 0,
        crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
      },
      {
        id: 'words',
        type: 'text' as const,
        text: 'BRIGHT DAY',
        fontId: 'inter' as const,
        fontWeight: 700 as const,
        fontSize: 105,
        fill: '#ffffff',
        alignment: 'center' as const,
        x: 0.5,
        y: 0.8,
        width: 0.65,
        height: 0.12,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        zIndex: 1,
      },
    ],
  };
}

async function insertSource(
  pool: SqlPool,
  projectId: string,
  storage: MemoryObjectStorage,
  label: string,
  store = true,
): Promise<{ id: string; key: string }> {
  const key = `sources/${randomBytes(8).toString('hex')}.svg`;
  const result = await pool.query<{ id: string }>(
    `INSERT INTO app.assets (project_id, asset_type, storage_key, content_type, byte_size, width, height)
     VALUES ($1, 'SOURCE_OUTPUT', $2, 'image/svg+xml', 400, 1200, 1200) RETURNING id`,
    [projectId, key],
  );
  const assetId = result.rows[0]?.id as string;
  if (store) await storage.put({ key, body: svg(label), contentType: 'image/svg+xml' });
  return { id: assetId, key };
}

function svg(label: string): Uint8Array {
  return new TextEncoder().encode(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200"><rect width="1200" height="1200" fill="#f36848"/><text x="80" y="620" font-size="130" fill="white">${label}</text></svg>`,
  );
}

function selection(colorCode: string) {
  return { productModelId: 'essential-dtg-tee', colorCode };
}
