import { createHash } from 'node:crypto';

import { withTransaction, type SqlClient, type SqlPool } from '@let-it-be/db';
import {
  createEmptyEditorDocument,
  migrateEditorDocument,
  type EditorDocumentV1,
} from '@let-it-be/editor-schema';

import type { ActiveSession } from './identity';
import { StyleCatalogService, type StyleSelection } from './styles';

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

export class ProjectConflictError extends Error {}

export class ProjectService {
  private readonly guestRetentionDays: number;
  private readonly userRetentionDays: number;
  private readonly maxPersistentVersions: number;

  public constructor(
    private readonly pool: SqlPool,
    options: ProjectServiceOptions = {},
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
    return withTransaction(this.pool, async (client) => {
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
      return mapProject(requireRow(active.rows[0]));
    });
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

function requireRow<T>(row: T | undefined): T {
  if (!row) throw new Error('Expected database row was not returned.');
  return row;
}
