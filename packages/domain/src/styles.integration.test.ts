import { randomBytes } from 'node:crypto';

import { createDatabaseClient, type SqlPool } from '@let-it-be/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { IdentityService } from './identity.js';
import { ProjectService } from './projects.js';
import { resolvePersistedStyleSelection, StyleCatalogService } from './styles.js';

const integrationDatabaseUrl = process.env.DATABASE_URL;
const integrationSuite = integrationDatabaseUrl ? describe : describe.skip;

integrationSuite('guided style catalog integration', () => {
  let pool: SqlPool;
  let close: () => Promise<void>;
  let identity: IdentityService;
  let projects: ProjectService;
  let catalog: StyleCatalogService;

  beforeAll(() => {
    const database = createDatabaseClient(integrationDatabaseUrl as string);
    pool = database.pool;
    close = database.close;
    identity = new IdentityService(pool);
    projects = new ProjectService(pool);
    catalog = new StyleCatalogService(pool);
  });

  afterAll(async () => close());

  it('returns visual consumer metadata without exposing private conditioning', async () => {
    const families = await catalog.listActive();
    expect(families).toHaveLength(5);
    expect(families.find((family) => family.id === 'family-vintage')).toMatchObject({
      displayName: 'Vintage',
      presets: expect.arrayContaining([
        expect.objectContaining({ id: 'preset-vintage-engraving', version: 1 }),
      ]),
    });
    expect(JSON.stringify(families)).not.toContain('promptConditioning');
    expect(JSON.stringify(families)).not.toContain('routingHints');
  });

  it('persists a valid family/preset selection and rejects a mismatched relationship', async () => {
    const guest = await identity.createGuestSession();
    const project = await projects.create(guest, selection('black'));
    const selected = await projects.selectGuidedStyle(
      guest,
      project.id,
      {
        selectionMode: 'MANUAL',
        styleFamilyId: 'family-dark',
        presetId: 'preset-dark-blackwork',
      },
      project.revision,
    );
    expect(selected.styleSelection).toEqual({
      selectionMode: 'MANUAL',
      styleFamilyId: 'family-dark',
      presetId: 'preset-dark-blackwork',
      presetVersion: 1,
    });
    await expect(
      projects.selectGuidedStyle(
        guest,
        project.id,
        {
          selectionMode: 'MANUAL',
          styleFamilyId: 'family-vintage',
          presetId: 'preset-dark-blackwork',
        },
        selected.revision,
      ),
    ).rejects.toThrow('unavailable');
  });

  it('keeps immutable preset versions attributable after a preset becomes inactive', async () => {
    const suffix = randomBytes(6).toString('hex');
    const familyId = `test-family-${suffix}`;
    const presetId = `test-preset-${suffix}`;
    const displayOrder = Number.parseInt(suffix.slice(0, 6), 16) + 100_000;
    const configuration = {
      promptConditioning: { family: 'Test', substyle: 'History', direction: 'Test history.' },
      compositionGuidance: { focus: 'subject', layout: 'balanced' },
      typographyGuidance: { mood: 'test', exactTextIsDeterministic: true },
      colorStrategy: { considerShirtColor: true, avoidLowContrast: true },
      textureDetailGuidance: { detailLevel: 'print-friendly', style: 'test' },
      printGuidance: { transparentBackgroundPreferred: true, avoidTinyDetails: true },
      negativeGuidance: ['unintended readable text'],
      routingHints: { task: 'TEXT_TO_ARTWORK' },
    };
    await pool.query(
      `INSERT INTO app.style_families (id, slug, display_name, description, display_order, visual_metadata)
       VALUES ($1, $2, 'Test', 'Test family', $3, $4::jsonb)`,
      [
        familyId,
        familyId,
        displayOrder,
        JSON.stringify({
          accent: '#111111',
          accentSecondary: '#eeeeee',
          previewKind: 'development-gradient',
        }),
      ],
    );
    await pool.query(
      `INSERT INTO app.style_presets (id, style_family_id, slug, display_name, description, display_order, visual_metadata)
       VALUES ($1, $2, $3, 'History', 'Test preset', 1, $4::jsonb)`,
      [
        presetId,
        familyId,
        presetId,
        JSON.stringify({
          accent: '#111111',
          accentSecondary: '#eeeeee',
          previewKind: 'development-gradient',
        }),
      ],
    );
    await pool.query(
      `INSERT INTO app.style_preset_versions (preset_id, version, style_family_id, configuration)
       VALUES ($1, 1, $2, $3::jsonb)`,
      [presetId, familyId, JSON.stringify(configuration)],
    );
    const guest = await identity.createGuestSession();
    const project = await projects.create(guest, selection('white'));
    const selected = await projects.selectGuidedStyle(
      guest,
      project.id,
      { selectionMode: 'MANUAL', styleFamilyId: familyId, presetId },
      project.revision,
    );
    await pool.query('UPDATE app.style_presets SET is_active = false WHERE id = $1', [presetId]);

    const resolved = await resolvePersistedStyleSelection(pool, selected.styleSelection, {
      projectId: project.id,
      rawPrompt: 'History should remain attributable.',
    });
    expect(resolved).toMatchObject({ presetId, presetVersion: 1 });
    await expect(
      pool.query(
        'UPDATE app.style_preset_versions SET configuration = $2::jsonb WHERE preset_id = $1',
        [presetId, JSON.stringify(configuration)],
      ),
    ).rejects.toThrow('append-only');
  });
});

function selection(colorCode: string) {
  return { productModelId: 'essential-dtg-tee', colorCode };
}
