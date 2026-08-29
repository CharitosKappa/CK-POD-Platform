import { randomBytes } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, type SqlPool } from '@let-it-be/db';

import { ProductCatalogService } from './catalog.js';
import { IdentityService } from './identity.js';
import { ProjectConflictError, ProjectService, emptyEditorDocument } from './projects.js';

const integrationDatabaseUrl = process.env.DATABASE_URL;
const integrationSuite = integrationDatabaseUrl ? describe : describe.skip;

integrationSuite('identity, projects, and catalog integration', () => {
  let pool: SqlPool;
  let close: () => Promise<void>;
  let identity: IdentityService;
  let projects: ProjectService;
  let catalog: ProductCatalogService;

  beforeAll(() => {
    const database = createDatabaseClient(integrationDatabaseUrl as string);
    pool = database.pool;
    close = database.close;
    identity = new IdentityService(pool);
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
    const password = 'correct-horse-battery-staple';
    const account = await identity.register(guest, email, password);
    const accessible = await projects.get(account, project.id);

    expect(account.kind).toBe('AUTHENTICATED');
    expect(accessible).toMatchObject({ id: project.id, selectedColorCode: 'white' });
    expect(
      (await projects.getVersions(account, project.id)).map((version) => version.id),
    ).toContain(saved.version.id);

    const resumedAccount = await identity.login(
      await identity.createGuestSession(),
      email,
      password,
    );
    expect((await projects.get(resumedAccount, project.id))?.id).toBe(project.id);

    const otherAccount = await identity.register(
      await identity.createGuestSession(),
      uniqueEmail(),
      'another-secure-password',
    );
    expect(await projects.get(otherAccount, project.id)).toBeNull();
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
