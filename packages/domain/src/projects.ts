import { createHash, randomUUID } from 'node:crypto';

import { withTransaction, type SqlClient, type SqlPool } from '@let-it-be/db';
import {
  createEmptyEditorDocument,
  createGeneratedLayer,
  migrateEditorDocument,
  withPlacementStatus,
  type EditorDocumentV1,
  type GeneratedLayer,
} from '@let-it-be/editor-schema';

import type { ActiveSession } from './identity';
import { mapPrototypeStyleSelection, StyleCatalogService, type StyleSelection } from './styles';
import type { LifecycleOrchestrator } from './operations-analytics';

export type EditorDocument = EditorDocumentV1;

export interface Project {
  id: string;
  productModelId: string | null;
  selectedColorCode: string | null;
  styleSelection: StyleSelection;
  activeVersionId: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  revision: number;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectVersion {
  id: string;
  projectId: string;
  versionNumber: number;
  editorDocument: EditorDocument;
  snapshotReason: 'INITIAL' | 'AUTOSAVE' | 'GENERATION' | 'DESTRUCTIVE_EDIT';
  createdAt: Date;
}

export interface ProjectSelection {
  productModelId: string;
  colorCode: string;
}

export interface ProjectCreationDraft {
  projectId: string;
  prompt: string;
  referenceAssetIds: string[];
  prototypeStyleId: string | null;
  prototypeToneId: string;
  selectedSize: string | null;
  updatedAt: Date;
}

export interface UpdateProjectCreationDraftInput {
  expectedRevision: number;
  prompt: string;
}

export interface UpdateProjectCreationStyleInput {
  expectedRevision: number;
  prototypeStyleId: string;
  prototypeToneId: string;
}

export interface UpdateProjectCreationProductInput extends ProjectSelection {
  expectedRevision: number;
  selectedSize: string;
}

export interface ApplyDeliveredGenerationInput {
  expectedRevision: number;
  generationId: string;
  transform: {
    x: number;
    y: number;
    scale: number;
    rotation: number;
    flipped: boolean;
  };
}

export type GuidedStyleSelectionInput =
  { selectionMode: 'AUTO' } | { selectionMode: 'MANUAL'; styleFamilyId: string; presetId: string };

export interface ProjectServiceOptions {
  guestRetentionDays?: number;
  userRetentionDays?: number;
  maxPersistentVersions?: number;
}

interface ProjectRow {
  id: string;
  product_model_id: string | null;
  selected_color_code: string | null;
  style_selection_mode: StyleSelection['selectionMode'];
  style_family_id: string | null;
  style_preset_id: string | null;
  style_preset_version: number | null;
  active_version_id: string | null;
  status: Project['status'];
  revision: number;
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface VersionRow {
  id: string;
  project_id: string;
  version_number: number;
  editor_document: EditorDocument;
  snapshot_reason: ProjectVersion['snapshotReason'];
  created_at: Date;
  document_hash: string;
}

interface CreationDraftRow {
  project_id: string;
  prompt: string;
  reference_asset_ids: string[];
  prototype_style_id: string | null;
  prototype_tone_id: string;
  selected_size: string | null;
  updated_at: Date;
}

export class ProjectConflictError extends Error {}
export class ProjectValidationError extends Error {}

export class ProjectService {
  private readonly guestRetentionDays: number;
  private readonly userRetentionDays: number;
  private readonly maxPersistentVersions: number;

  public constructor(
    private readonly pool: SqlPool,
    options: ProjectServiceOptions = {},
    private readonly lifecycle?: LifecycleOrchestrator,
  ) {
    this.guestRetentionDays = options.guestRetentionDays ?? 7;
    this.userRetentionDays = options.userRetentionDays ?? 90;
    this.maxPersistentVersions = options.maxPersistentVersions ?? 20;
  }

  async create(
    session: ActiveSession,
    selection: ProjectSelection,
    document: EditorDocument | unknown = emptyEditorDocument(),
  ): Promise<Project> {
    const project = await withTransaction(this.pool, async (client) => {
      await assertSelectable(client, selection);
      const projectResult = await client.query<ProjectRow>(
        `INSERT INTO app.projects (
          owner_type, owner_session_id, owner_user_id, product_model_id, selected_color_code, expires_at
        ) VALUES (
          $1, $2, $3, $4, $5, now() + ($6::text || ' days')::interval
        ) RETURNING *`,
        [
          session.userId ? 'USER' : 'GUEST',
          session.userId ? null : session.id,
          session.userId,
          selection.productModelId,
          selection.colorCode,
          String(session.userId ? this.userRetentionDays : this.guestRetentionDays),
        ],
      );
      const project = mapProject(requireRow(projectResult.rows[0]));
      const version = await this.insertVersion(
        client,
        project.id,
        1,
        migrateEditorDocument(document),
        'INITIAL',
        session,
      );
      const active = await client.query<ProjectRow>(
        'UPDATE app.projects SET active_version_id = $1 WHERE id = $2 RETURNING *',
        [version.id, project.id],
      );
      await client.query(
        `INSERT INTO app.project_creation_drafts (project_id)
         VALUES ($1)
         ON CONFLICT (project_id) DO NOTHING`,
        [project.id],
      );
      return mapProject(requireRow(active.rows[0]));
    });
    if (session.userId && this.lifecycle) {
      const user = await this.pool.query<{ email: string }>(
        'SELECT email FROM app.users WHERE id = $1',
        [session.userId],
      );
      if (user.rows[0])
        await this.lifecycle.trigger({
          type: 'SAVED_PROJECT',
          classification: 'MARKETING',
          recipientEmail: user.rows[0].email,
          projectId: project.id,
          idempotencyKey: `saved-project:${project.id}`,
          payload: { productModelId: project.productModelId, colorCode: project.selectedColorCode },
        });
    }
    return project;
  }

  async get(session: ActiveSession, projectId: string): Promise<Project | null> {
    const result = await this.pool.query<ProjectRow>(
      `${projectSelect()} WHERE p.id = $1 AND ${ownershipClause()}`,
      [projectId, session.id, session.userId],
    );
    return result.rows[0] ? mapProject(result.rows[0]) : null;
  }

  async getVersions(session: ActiveSession, projectId: string): Promise<ProjectVersion[]> {
    await this.requireAccess(this.pool, session, projectId);
    const result = await this.pool.query<VersionRow>(
      `SELECT id, project_id, version_number, editor_document, snapshot_reason, created_at, document_hash
       FROM app.project_versions WHERE project_id = $1 ORDER BY version_number DESC`,
      [projectId],
    );
    return result.rows.map(mapVersion);
  }

  async getCreationDraft(
    session: ActiveSession,
    projectId: string,
  ): Promise<ProjectCreationDraft | null> {
    const result = await this.pool.query<CreationDraftRow>(
      `SELECT d.project_id, d.prompt, d.reference_asset_ids, d.prototype_style_id,
              d.prototype_tone_id, d.selected_size, d.updated_at
       FROM app.project_creation_drafts d
       JOIN app.projects p ON p.id = d.project_id
       WHERE d.project_id = $1 AND ${ownershipClause()}`,
      [projectId, session.id, session.userId],
    );
    return result.rows[0] ? mapCreationDraft(result.rows[0]) : null;
  }

  async updateCreationDraft(
    session: ActiveSession,
    projectId: string,
    input: UpdateProjectCreationDraftInput,
  ): Promise<{ project: Project; draft: ProjectCreationDraft }> {
    return withTransaction(this.pool, async (client) => {
      await this.requireAccess(client, session, projectId);
      const updatedProject = await client.query<ProjectRow>(
        `UPDATE app.projects
         SET revision = revision + 1, updated_at = now()
         WHERE id = $1 AND revision = $2
         RETURNING *`,
        [projectId, input.expectedRevision],
      );
      if (!updatedProject.rows[0]) {
        throw new ProjectConflictError('Project changed before this draft could be saved.');
      }
      const updatedDraft = await client.query<CreationDraftRow>(
        `INSERT INTO app.project_creation_drafts (project_id, prompt)
         VALUES ($1, $2)
         ON CONFLICT (project_id) DO UPDATE
           SET prompt = EXCLUDED.prompt, updated_at = now()
         RETURNING project_id, prompt, reference_asset_ids, prototype_style_id,
                   prototype_tone_id, selected_size, updated_at`,
        [projectId, input.prompt],
      );
      return {
        project: mapProject(requireRow(updatedProject.rows[0])),
        draft: mapCreationDraft(requireRow(updatedDraft.rows[0])),
      };
    });
  }

  async updateCreationStyle(
    session: ActiveSession,
    projectId: string,
    input: UpdateProjectCreationStyleInput,
  ): Promise<{ project: Project; draft: ProjectCreationDraft }> {
    return withTransaction(this.pool, async (client) => {
      await this.requireAccess(client, session, projectId);
      const currentDraft = await client.query<CreationDraftRow>(
        `SELECT project_id, prompt, reference_asset_ids, prototype_style_id,
                prototype_tone_id, selected_size, updated_at
         FROM app.project_creation_drafts
         WHERE project_id = $1
         FOR UPDATE`,
        [projectId],
      );
      const draft = requireRow(currentDraft.rows[0]);
      const mapped = mapPrototypeStyleSelection({
        style: input.prototypeStyleId,
        tone: input.prototypeToneId,
        prompt: draft.prompt,
      });
      const resolved = await new StyleCatalogService(client).resolveManual(mapped);
      const updatedProject = await client.query<ProjectRow>(
        `UPDATE app.projects
         SET style_selection_mode = 'MANUAL', style_family_id = $1, style_preset_id = $2,
             style_preset_version = $3, revision = revision + 1, updated_at = now()
         WHERE id = $4 AND revision = $5
         RETURNING *`,
        [
          resolved.styleFamilyId,
          resolved.presetId,
          resolved.presetVersion,
          projectId,
          input.expectedRevision,
        ],
      );
      if (!updatedProject.rows[0]) {
        throw new ProjectConflictError('Project changed before this style could be saved.');
      }
      const updatedDraft = await client.query<CreationDraftRow>(
        `UPDATE app.project_creation_drafts
         SET prototype_style_id = $2, prototype_tone_id = $3, updated_at = now()
         WHERE project_id = $1
         RETURNING project_id, prompt, reference_asset_ids, prototype_style_id,
                   prototype_tone_id, selected_size, updated_at`,
        [projectId, input.prototypeStyleId, input.prototypeToneId],
      );
      return {
        project: mapProject(requireRow(updatedProject.rows[0])),
        draft: mapCreationDraft(requireRow(updatedDraft.rows[0])),
      };
    });
  }

  async updateCreationProduct(
    session: ActiveSession,
    projectId: string,
    input: UpdateProjectCreationProductInput,
  ): Promise<{ project: Project; draft: ProjectCreationDraft }> {
    return withTransaction(this.pool, async (client) => {
      await this.requireAccess(client, session, projectId);
      await assertSelectableVariant(client, input);
      const updatedProject = await client.query<ProjectRow>(
        `UPDATE app.projects
         SET product_model_id = $1, selected_color_code = $2,
             revision = revision + 1, updated_at = now()
         WHERE id = $3 AND revision = $4
         RETURNING *`,
        [input.productModelId, input.colorCode, projectId, input.expectedRevision],
      );
      if (!updatedProject.rows[0]) {
        throw new ProjectConflictError('Project changed before this product could be saved.');
      }
      const updatedDraft = await client.query<CreationDraftRow>(
        `UPDATE app.project_creation_drafts
         SET selected_size = $2, updated_at = now()
         WHERE project_id = $1
         RETURNING project_id, prompt, reference_asset_ids, prototype_style_id,
                   prototype_tone_id, selected_size, updated_at`,
        [projectId, input.selectedSize],
      );
      return {
        project: mapProject(requireRow(updatedProject.rows[0])),
        draft: mapCreationDraft(requireRow(updatedDraft.rows[0])),
      };
    });
  }

  async selectProduct(
    session: ActiveSession,
    projectId: string,
    selection: ProjectSelection,
    expectedRevision: number,
  ): Promise<Project> {
    return withTransaction(this.pool, async (client) => {
      await this.requireAccess(client, session, projectId);
      await assertSelectable(client, selection);
      const result = await client.query<ProjectRow>(
        `UPDATE app.projects
         SET product_model_id = $1, selected_color_code = $2, revision = revision + 1, updated_at = now()
         WHERE id = $3 AND revision = $4
         RETURNING *`,
        [selection.productModelId, selection.colorCode, projectId, expectedRevision],
      );
      if (!result.rows[0])
        throw new ProjectConflictError('Project changed before this selection could be saved.');
      return mapProject(result.rows[0]);
    });
  }

  async selectGuidedStyle(
    session: ActiveSession,
    projectId: string,
    selection: GuidedStyleSelectionInput,
    expectedRevision: number,
  ): Promise<Project> {
    return withTransaction(this.pool, async (client) => {
      await this.requireAccess(client, session, projectId);
      const resolved =
        selection.selectionMode === 'MANUAL'
          ? await new StyleCatalogService(client).resolveManual({
              styleFamilyId: selection.styleFamilyId,
              presetId: selection.presetId,
            })
          : null;
      const result = await client.query<ProjectRow>(
        `UPDATE app.projects
         SET style_selection_mode = $1, style_family_id = $2, style_preset_id = $3,
             style_preset_version = $4, revision = revision + 1, updated_at = now()
         WHERE id = $5 AND revision = $6
         RETURNING *`,
        [
          selection.selectionMode,
          resolved?.styleFamilyId ?? null,
          resolved?.presetId ?? null,
          resolved?.presetVersion ?? null,
          projectId,
          expectedRevision,
        ],
      );
      if (!result.rows[0]) {
        throw new ProjectConflictError('Project changed before this style could be saved.');
      }
      return mapProject(result.rows[0]);
    });
  }

  async autosave(
    session: ActiveSession,
    projectId: string,
    document: EditorDocument | unknown,
    expectedRevision: number,
  ): Promise<{ project: Project; version: ProjectVersion; unchanged: boolean }> {
    return withTransaction(this.pool, async (client) => {
      const project = await this.requireAccess(client, session, projectId);
      const latestResult = await client.query<VersionRow>(
        `SELECT id, project_id, version_number, editor_document, snapshot_reason, created_at, document_hash
         FROM app.project_versions WHERE project_id = $1 ORDER BY version_number DESC LIMIT 1`,
        [projectId],
      );
      const latest = requireRow(latestResult.rows[0]);
      const normalizedDocument = migrateEditorDocument(document);
      const documentHash = hashDocument(normalizedDocument);
      if (latest.document_hash === documentHash) {
        return { project, version: mapVersion(latest), unchanged: true };
      }
      const updated = await client.query<ProjectRow>(
        `UPDATE app.projects SET revision = revision + 1, updated_at = now()
         WHERE id = $1 AND revision = $2 RETURNING *`,
        [projectId, expectedRevision],
      );
      if (!updated.rows[0])
        throw new ProjectConflictError('Project changed before autosave could be applied.');
      const version = await this.insertVersion(
        client,
        projectId,
        latest.version_number + 1,
        normalizedDocument,
        'AUTOSAVE',
        session,
      );
      const active = await client.query<ProjectRow>(
        'UPDATE app.projects SET active_version_id = $1 WHERE id = $2 RETURNING *',
        [version.id, projectId],
      );
      await this.trimVersions(client, projectId);
      return { project: mapProject(requireRow(active.rows[0])), version, unchanged: false };
    });
  }

  /**
   * Promotes an owned, delivered generation into the immutable project history.
   * Consumer editor coordinates are mapped into the qualified safe area and fitted
   * once more on the server before prepress can consume the document.
   */
  async applyDeliveredGeneration(
    session: ActiveSession,
    projectId: string,
    input: ApplyDeliveredGenerationInput,
  ): Promise<{ project: Project; version: ProjectVersion; unchanged: boolean }> {
    validateDeliveredTransform(input.transform);
    return withTransaction(this.pool, async (client) => {
      const project = await this.requireAccess(client, session, projectId);
      const generationResult = await client.query<{
        id: string;
        status: string;
        delivered_asset_id: string | null;
        asset_status: string | null;
      }>(
        `SELECT g.id, g.status, g.delivered_asset_id, a.status AS asset_status
         FROM app.generations g
         LEFT JOIN app.assets a ON a.id = g.delivered_asset_id AND a.project_id = g.project_id
         WHERE g.id = $1 AND g.project_id = $2`,
        [input.generationId, projectId],
      );
      const generation = generationResult.rows[0];
      if (
        !generation ||
        generation.status !== 'SUCCEEDED' ||
        !generation.delivered_asset_id ||
        generation.asset_status !== 'ACTIVE'
      ) {
        throw new ProjectValidationError('The delivered design is not ready to print.');
      }
      if (!project.activeVersionId) {
        throw new ProjectValidationError('The active design version is unavailable.');
      }
      const activeResult = await client.query<VersionRow>(
        `SELECT id, project_id, version_number, editor_document, snapshot_reason, created_at, document_hash
         FROM app.project_versions WHERE id = $1 AND project_id = $2`,
        [project.activeVersionId, projectId],
      );
      const active = requireRow(activeResult.rows[0]);
      const currentDocument = migrateEditorDocument(active.editor_document);
      const existingGenerated = currentDocument.layers.find((layer) => layer.type === 'generated');
      const layer = fitGeneratedLayer(currentDocument, {
        ...createGeneratedLayer({
          layerId: existingGenerated?.id ?? randomUUID(),
          assetId: generation.delivered_asset_id,
          generationId: generation.id,
          zIndex:
            existingGenerated?.zIndex ??
            currentDocument.layers.reduce(
              (maximum, candidate) => Math.max(maximum, candidate.zIndex),
              -1,
            ) + 1,
        }),
        x:
          currentDocument.printArea.safeBounds.x +
          (input.transform.x / 100) * currentDocument.printArea.safeBounds.width,
        y:
          currentDocument.printArea.safeBounds.y +
          (input.transform.y / 100) * currentDocument.printArea.safeBounds.height,
        width: 0.55 * input.transform.scale,
        height: 0.55 * input.transform.scale,
        rotation: input.transform.rotation,
        flipX: input.transform.flipped,
      });
      const nextDocument = withPlacementStatus({
        ...currentDocument,
        layers: existingGenerated
          ? currentDocument.layers.map((candidate) =>
              candidate.id === existingGenerated.id ? layer : candidate,
            )
          : [...currentDocument.layers, layer],
      });
      if (nextDocument.placementStatus !== 'VALID') {
        throw new ProjectValidationError('Keep the design inside the printable area.');
      }
      const documentHash = hashDocument(nextDocument);
      if (active.document_hash === documentHash) {
        return { project, version: mapVersion(active), unchanged: true };
      }
      const updated = await client.query<ProjectRow>(
        `UPDATE app.projects SET revision = revision + 1, updated_at = now()
         WHERE id = $1 AND revision = $2 RETURNING *`,
        [projectId, input.expectedRevision],
      );
      if (!updated.rows[0]) {
        throw new ProjectConflictError('Project changed before the design could be prepared.');
      }
      const version = await this.insertVersion(
        client,
        projectId,
        active.version_number + 1,
        nextDocument,
        'GENERATION',
        session,
      );
      const activated = await client.query<ProjectRow>(
        'UPDATE app.projects SET active_version_id = $1 WHERE id = $2 RETURNING *',
        [version.id, projectId],
      );
      await this.trimVersions(client, projectId);
      return {
        project: mapProject(requireRow(activated.rows[0])),
        version,
        unchanged: false,
      };
    });
  }

  private async requireAccess(
    client: SqlClient,
    session: ActiveSession,
    projectId: string,
  ): Promise<Project> {
    const result = await client.query<ProjectRow>(
      `${projectSelect()} WHERE p.id = $1 AND ${ownershipClause()}`,
      [projectId, session.id, session.userId],
    );
    const project = result.rows[0];
    if (!project) throw new Error('Project not found.');
    return mapProject(project);
  }

  private async insertVersion(
    client: SqlClient,
    projectId: string,
    versionNumber: number,
    document: EditorDocument,
    reason: ProjectVersion['snapshotReason'],
    session: ActiveSession,
  ): Promise<ProjectVersion> {
    const result = await client.query<VersionRow>(
      `INSERT INTO app.project_versions (
         project_id, version_number, editor_document, document_hash, snapshot_reason,
         created_by_session_id, created_by_user_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, project_id, version_number, editor_document, snapshot_reason, created_at, document_hash`,
      [
        projectId,
        versionNumber,
        document,
        hashDocument(document),
        reason,
        session.id,
        session.userId,
      ],
    );
    return mapVersion(requireRow(result.rows[0]));
  }

  private async trimVersions(client: SqlClient, projectId: string): Promise<void> {
    await client.query(
      `DELETE FROM app.project_versions
       WHERE id IN (
         SELECT id FROM app.project_versions
         WHERE project_id = $1
         ORDER BY version_number DESC
         OFFSET $2
       )`,
      [projectId, this.maxPersistentVersions],
    );
  }
}

function validateDeliveredTransform(input: ApplyDeliveredGenerationInput['transform']): void {
  if (
    !Number.isFinite(input.x) ||
    !Number.isFinite(input.y) ||
    input.x < 0 ||
    input.x > 100 ||
    input.y < 0 ||
    input.y > 100 ||
    !Number.isFinite(input.scale) ||
    input.scale <= 0 ||
    input.scale > 1.4 ||
    !Number.isFinite(input.rotation) ||
    typeof input.flipped !== 'boolean'
  ) {
    throw new ProjectValidationError('The design placement is invalid.');
  }
}

function fitGeneratedLayer(document: EditorDocument, candidate: GeneratedLayer): GeneratedLayer {
  const safe = document.printArea.safeBounds;
  const radians = (candidate.rotation * Math.PI) / 180;
  const cosine = Math.abs(Math.cos(radians));
  const sine = Math.abs(Math.sin(radians));
  let width = candidate.width;
  let height = candidate.height;
  let extentX = (width * cosine + height * sine) / 2;
  let extentY = (width * sine + height * cosine) / 2;
  const fit = Math.min(1, safe.width / (extentX * 2), safe.height / (extentY * 2));
  width *= fit;
  height *= fit;
  extentX = (width * cosine + height * sine) / 2;
  extentY = (width * sine + height * cosine) / 2;
  return {
    ...candidate,
    width,
    height,
    x: Math.min(Math.max(candidate.x, safe.x + extentX), safe.x + safe.width - extentX),
    y: Math.min(Math.max(candidate.y, safe.y + extentY), safe.y + safe.height - extentY),
  };
}

export function emptyEditorDocument(): EditorDocument {
  return createEmptyEditorDocument();
}

function projectSelect(): string {
  return `SELECT p.id, p.product_model_id, p.selected_color_code, p.active_version_id,
    p.style_selection_mode, p.style_family_id, p.style_preset_id, p.style_preset_version,
    p.status, p.revision, p.expires_at, p.created_at, p.updated_at FROM app.projects p`;
}

function ownershipClause(): string {
  return `((p.owner_type = 'GUEST' AND p.owner_session_id = $2)
    OR (p.owner_type = 'USER' AND p.owner_user_id = $3::uuid))`;
}

async function assertSelectable(client: SqlClient, selection: ProjectSelection): Promise<void> {
  const result = await client.query<{ id: string }>(
    `SELECT p.id FROM app.product_models p JOIN app.product_variants v ON v.product_model_id = p.id
     WHERE p.id = $1 AND v.color_code = $2 AND p.status = 'ACTIVE' AND v.status = 'ACTIVE' LIMIT 1`,
    [selection.productModelId, selection.colorCode],
  );
  if (!result.rows[0]) throw new Error('Selected product color is unavailable.');
}

async function assertSelectableVariant(
  client: SqlClient,
  selection: UpdateProjectCreationProductInput,
): Promise<void> {
  const result = await client.query<{ id: string }>(
    `SELECT v.id FROM app.product_models p
     JOIN app.product_variants v ON v.product_model_id = p.id
     WHERE p.id = $1 AND v.color_code = $2 AND v.size = $3
       AND p.status = 'ACTIVE' AND v.status = 'ACTIVE'
     LIMIT 1`,
    [selection.productModelId, selection.colorCode, selection.selectedSize.toUpperCase()],
  );
  if (!result.rows[0]) throw new Error('That color and size combination is unavailable.');
}

function hashDocument(document: EditorDocument): string {
  return createHash('sha256').update(stableJson(document)).digest('hex');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function mapProject(row: ProjectRow): Project {
  return {
    id: row.id,
    productModelId: row.product_model_id,
    selectedColorCode: row.selected_color_code,
    styleSelection: {
      selectionMode: row.style_selection_mode,
      styleFamilyId: row.style_family_id,
      presetId: row.style_preset_id,
      presetVersion: row.style_preset_version,
    },
    activeVersionId: row.active_version_id,
    status: row.status,
    revision: row.revision,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapVersion(row: VersionRow): ProjectVersion {
  return {
    id: row.id,
    projectId: row.project_id,
    versionNumber: row.version_number,
    editorDocument: migrateEditorDocument(row.editor_document),
    snapshotReason: row.snapshot_reason,
    createdAt: row.created_at,
  };
}

function mapCreationDraft(row: CreationDraftRow): ProjectCreationDraft {
  return {
    projectId: row.project_id,
    prompt: row.prompt,
    referenceAssetIds: row.reference_asset_ids,
    prototypeStyleId: row.prototype_style_id,
    prototypeToneId: row.prototype_tone_id,
    selectedSize: row.selected_size,
    updatedAt: row.updated_at,
  };
}

function requireRow<T>(row: T | undefined): T {
  if (!row) throw new Error('Expected database row was not returned.');
  return row;
}
