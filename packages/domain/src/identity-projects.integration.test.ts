import { randomBytes } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, type SqlPool } from '@let-it-be/db';
import { MemoryObjectStorage } from '@let-it-be/storage';

import { ProductCatalogService } from './catalog.js';
import { IdentityService, InMemoryEmailCodeDelivery } from './identity.js';
import { ProjectConflictError, ProjectService, emptyEditorDocument } from './projects.js';
import { ReferenceAssetService } from './reference-assets.js';

const integrationDatabaseUrl = process.env.DATABASE_URL;
const integrationSuite = integrationDatabaseUrl ? describe : describe.skip;

integrationSuite('identity, projects, and catalog integration', () => {
  let pool: SqlPool;
  let close: () => Promise<void>;
  let identity: IdentityService;
  let emailCodes: InMemoryEmailCodeDelivery;
  let projects: ProjectService;
  let catalog: ProductCatalogService;

  beforeAll(() => {
    const database = createDatabaseClient(integrationDatabaseUrl as string);
    pool = database.pool;
    close = database.close;
    emailCodes = new InMemoryEmailCodeDelivery();
    identity = new IdentityService(pool, {
      codeDelivery: emailCodes,
      codePepper: 'test-email-code-pepper-that-is-long-enough-for-deterministic-tests',
    });
    projects = new ProjectService(pool, { maxPersistentVersions: 20 });
    catalog = new ProductCatalogService(pool);
  });

  afterAll(async () => close());

  it('creates a guest project and prevents another guest session from reading it', async () => {
    const guest = await identity.createGuestSession();
    expect((await identity.getSession(guest.token))?.kind).toBe('GUEST');
    const project = await projects.create(guest, selection('black'));

    expect((await projects.get(guest, project.id))?.selectedColorCode).toBe('black');
    expect(await projects.get(await identity.createGuestSession(), project.id)).toBeNull();
  });

  it('persists a private creation prompt with optimistic revision protection', async () => {
    const guest = await identity.createGuestSession();
    const project = await projects.create(guest, selection('black'));

    expect(await projects.getCreationDraft(guest, project.id)).toMatchObject({
      projectId: project.id,
      prompt: '',
      prototypeToneId: 'auto',
      referenceAssetIds: [],
    });

    const saved = await projects.updateCreationDraft(guest, project.id, {
      expectedRevision: project.revision,
      prompt: 'A sunset disco cat in a vintage print.',
    });
    expect(saved.project.revision).toBe(project.revision + 1);
    expect(saved.draft.prompt).toBe('A sunset disco cat in a vintage print.');
    expect((await projects.getCreationDraft(guest, project.id))?.prompt).toBe(
      'A sunset disco cat in a vintage print.',
    );
    const styled = await projects.updateCreationStyle(guest, project.id, {
      expectedRevision: saved.project.revision,
      prototypeStyleId: 'vintage-retro',
      prototypeToneId: 'heartfelt',
    });
    expect(styled.draft).toMatchObject({
      prompt: 'A sunset disco cat in a vintage print.',
      prototypeStyleId: 'vintage-retro',
      prototypeToneId: 'heartfelt',
    });
    expect(styled.project.styleSelection).toMatchObject({
      selectionMode: 'MANUAL',
      styleFamilyId: 'family-vintage',
      presetId: 'preset-vintage-heritage-badge',
    });
    const configured = await projects.updateCreationProduct(guest, project.id, {
      expectedRevision: styled.project.revision,
      productModelId: 'essential-dtg-tee',
      colorCode: 'red',
      selectedSize: '2xl',
    });
    expect(configured.project.selectedColorCode).toBe('red');
    expect(configured.draft.selectedSize).toBe('2xl');
    await expect(
      projects.updateCreationDraft(guest, project.id, {
        expectedRevision: project.revision,
        prompt: 'A stale update.',
      }),
    ).rejects.toBeInstanceOf(ProjectConflictError);
    expect(
      await projects.getCreationDraft(await identity.createGuestSession(), project.id),
    ).toBeNull();
  });

  it('replaces and removes a private reference image while preserving project ownership', async () => {
    const guest = await identity.createGuestSession();
    const otherGuest = await identity.createGuestSession();
    const project = await projects.create(guest, selection('black'));
    const storage = new MemoryObjectStorage();
    const references = new ReferenceAssetService(pool, storage);
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

    const first = await references.replace(guest, project.id, {
      expectedRevision: project.revision,
      body: png,
      contentType: 'image/png',
      width: 1,
      height: 1,
    });
    expect(first.asset).toMatchObject({ contentType: 'image/png', width: 1, height: 1 });
    expect((await projects.getCreationDraft(guest, project.id))?.referenceAssetIds).toEqual([
      first.asset?.id,
    ]);

    await expect(
      references.remove(otherGuest, project.id, first.asset!.id, first.projectRevision),
    ).rejects.toThrow('Project not found.');

    const second = await references.replace(guest, project.id, {
      expectedRevision: first.projectRevision,
      body: png,
      contentType: 'image/png',
      width: 1,
      height: 1,
    });
    const replaced = await pool.query<{ status: string; storage_key: string }>(
      'SELECT status, storage_key FROM app.assets WHERE id = $1',
      [first.asset?.id],
    );
    expect(replaced.rows[0]?.status).toBe('DELETED');
    expect(await storage.exists(replaced.rows[0]!.storage_key)).toBe(false);

    const removed = await references.remove(
      guest,
      project.id,
      second.asset!.id,
      second.projectRevision,
    );
    expect(removed.referenceAssetIds).toEqual([]);
    expect((await projects.getCreationDraft(guest, project.id))?.referenceAssetIds).toEqual([]);
  });

  it('migrates a guest project and all versions to an account while preserving ownership protection', async () => {
    const guest = await identity.createGuestSession();
    const project = await projects.create(guest, selection('white'));
    const saved = await projects.autosave(
      guest,
      project.id,
      { ...emptyEditorDocument(), canvas: { scale: 1.2 } },
      project.revision,
    );
    const email = uniqueEmail();
    await identity.requestEmailCode(email);
    const account = await identity.verifyEmailCode(guest, email, emailCodes.latestCodeFor(email)!);
    const accessible = await projects.get(account, project.id);

    expect(account.kind).toBe('AUTHENTICATED');
    expect(account.token).not.toBe(guest.token);
    expect(await identity.getSession(guest.token)).toBeNull();
    expect((await identity.getSession(account.token))?.id).toBe(account.id);
    expect(accessible).toMatchObject({ id: project.id, selectedColorCode: 'white' });
    expect(
      (await projects.getVersions(account, project.id)).map((version) => version.id),
    ).toContain(saved.version.id);

    const returningGuest = await identity.createGuestSession();
    await identity.requestEmailCode(email);
    const resumedAccount = await identity.verifyEmailCode(
      returningGuest,
      email,
      emailCodes.latestCodeFor(email)!,
    );
    expect((await projects.get(resumedAccount, project.id))?.id).toBe(project.id);

    const otherAccount = await identity.register(
      await identity.createGuestSession(),
      uniqueEmail(),
      'another-secure-password',
    );
    expect(await projects.get(otherAccount, project.id)).toBeNull();
    await identity.invalidate(account);
    expect(await identity.getSession(account.token)).toBeNull();
  });

  it('consumes email codes once and creates an account only after successful verification', async () => {
    const guest = await identity.createGuestSession();
    const email = uniqueEmail();

    await identity.requestEmailCode(email);
    const code = emailCodes.latestCodeFor(email);
    expect(code).toMatch(/^\d{6}$/);

    await expect(identity.verifyEmailCode(guest, email, '000000')).rejects.toThrow(
      'The code is invalid or has expired.',
    );
    const account = await identity.verifyEmailCode(guest, email, code!);
    expect(account.kind).toBe('AUTHENTICATED');
    await expect(
      identity.verifyEmailCode(await identity.createGuestSession(), email, code!),
    ).rejects.toThrow('The code is invalid or has expired.');
  });

  it('persists versions, skips unchanged autosave documents, and rejects stale writes', async () => {
    const guest = await identity.createGuestSession();
    const project = await projects.create(guest, selection('navy'));
    const changedDocument = { ...emptyEditorDocument(), layers: [{ id: 'layer-1' }] };
    const saved = await projects.autosave(guest, project.id, changedDocument, project.revision);
    const unchanged = await projects.autosave(
      guest,
      project.id,
      changedDocument,
      saved.project.revision,
    );

    expect(saved.unchanged).toBe(false);
    expect(unchanged.unchanged).toBe(true);
    expect(
      (await projects.autosave(guest, project.id, changedDocument, project.revision)).unchanged,
    ).toBe(true);
    expect((await projects.getVersions(guest, project.id)).length).toBe(2);
    await expect(
      projects.autosave(
        guest,
        project.id,
        { ...changedDocument, canvas: { x: 1 } },
        project.revision,
      ),
    ).rejects.toBeInstanceOf(ProjectConflictError);
  });

  it('retrieves the internal catalog and persists a revised product/color selection', async () => {
    const products = await catalog.listActiveProducts();
    expect(products).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'essential-dtg-tee', developmentOnly: true }),
      ]),
    );
    const guest = await identity.createGuestSession();
    const project = await projects.create(guest, selection('black'));
    const updated = await projects.selectProduct(
      guest,
      project.id,
      selection('navy'),
      project.revision,
    );

    expect(updated.selectedColorCode).toBe('navy');
    expect((await projects.get(guest, project.id))?.selectedColorCode).toBe('navy');
  });
});

function selection(colorCode: string) {
  return { productModelId: 'essential-dtg-tee', colorCode };
}

function uniqueEmail(): string {
  return `test-${randomBytes(8).toString('hex')}@example.test`;
}
