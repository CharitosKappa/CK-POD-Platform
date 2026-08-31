import { type SqlPool } from '@let-it-be/db';

export const policyStages = [
  'PROMPT_PRE_GENERATION',
  'REFERENCE_UPLOAD',
  'GENERATED_OUTPUT',
  'FINAL_ARTWORK_PRE_PRODUCTION',
] as const;
export type PolicyStage = (typeof policyStages)[number];

export const policyOutcomes = ['ALLOW', 'BLOCK', 'REVIEW', 'UNKNOWN'] as const;
export type PolicyOutcome = (typeof policyOutcomes)[number];

export const policyCategories = [
  'COPYRIGHT_CHARACTER',
  'FAN_ART',
  'BRAND_LOGO',
  'TRADEMARK_RISK',
  'PUBLIC_PERSON_LIKENESS',
  'PROTECTED_LYRICS',
  'ADULT_CONTENT',
  'VIOLENCE_POLICY',
  'WEAPON_POLICY',
  'POLICY_UNCERTAIN',
  'OTHER_COMPLIANCE_REVIEW',
] as const;
export type PolicyCategory = (typeof policyCategories)[number];
export type PolicySeverity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type PolicyHumanDecision = 'APPROVED' | 'REJECTED' | 'HELD' | 'ESCALATED';

export interface PolicyFinding {
  category: PolicyCategory;
  code: string;
  severity: PolicySeverity;
  confidence: number;
  evidence?: Record<string, unknown>;
}

export interface PolicyClassification {
  outcome: PolicyOutcome;
  findings: PolicyFinding[];
  response?: Record<string, unknown>;
}

export interface PolicyClassifier {
  readonly id: string;
  readonly version: string;
  classify(input: {
    stage: PolicyStage;
    text?: string;
    imageBytes?: Uint8Array;
    metadata?: Record<string, unknown>;
  }): Promise<PolicyClassification>;
}

export interface PolicyEvaluationInput {
  stage: PolicyStage;
  projectId?: string;
  projectVersionId?: string;
  generationId?: string;
  orderId?: string;
  assetId?: string;
  text?: string;
  imageBytes?: Uint8Array;
  metadata?: Record<string, unknown>;
}

export interface PolicyEvaluation extends PolicyClassification {
  id: string;
  rulesetId: string;
  stage: PolicyStage;
  projectId: string | null;
  projectVersionId: string | null;
  generationId: string | null;
  orderId: string | null;
  assetId: string | null;
  createdAt: Date;
}

/** A provider-neutral, deterministic local classifier used in CI and development only. */
export class DeterministicPolicyClassifier implements PolicyClassifier {
  readonly id = 'deterministic-policy';
  readonly version = 'm8-v1';

  async classify(
    input: Parameters<PolicyClassifier['classify']>[0],
  ): Promise<PolicyClassification> {
    const text = [input.text, imageText(input.imageBytes), JSON.stringify(input.metadata ?? {})]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase('en-US');
    if (/(policy:unknown|classifier[ _-]?failure)/.test(text))
      return unknown('CLASSIFICATION_FAILED');
    const finding = (
      category: PolicyCategory,
      code: string,
      severity: PolicySeverity,
      confidence: number,
    ) => ({
      category,
      code,
      severity,
      confidence,
    });
    if (/(mickey|disney|marvel|pokemon|harry potter|star wars|hogwarts)/.test(text))
      return blocked(finding('FAN_ART', 'PROTECTED_CHARACTER_OR_FRANCHISE', 'CRITICAL', 0.98));
    if (/(explicit sex|porn|nude sexual|sexual act)/.test(text))
      return blocked(finding('ADULT_CONTENT', 'EXPLICIT_SEXUAL_CONTENT', 'CRITICAL', 0.98));
    if (/(graphic gore|shooting spree|assault rifle|weapon for violence)/.test(text))
      return blocked(
        finding('WEAPON_POLICY', 'PROHIBITED_WEAPON_OR_GRAPHIC_VIOLENCE', 'CRITICAL', 0.96),
      );
    if (
      /(taylor swift|beyonce|celebrity likeness|recognizable public figure|donald trump|barack obama)/.test(
        text,
      )
    )
      return blocked(
        finding('PUBLIC_PERSON_LIKENESS', 'RECOGNIZABLE_PERSON_MERCHANDISE', 'HIGH', 0.94),
      );
    if (/(bohemian rhapsody|song lyrics|lyrics:|exact lyric)/.test(text))
      return review(finding('PROTECTED_LYRICS', 'POTENTIALLY_PROTECTED_TEXT', 'HIGH', 0.86));
    if (/(nike|adidas|coca-cola|brand logo|trademark logo|logo)/.test(text))
      return review(finding('BRAND_LOGO', 'BRAND_OR_LOGO_RISK', 'HIGH', 0.84));
    if (/(fan art|copyrighted character|protected character)/.test(text))
      return review(finding('COPYRIGHT_CHARACTER', 'CHARACTER_OR_FAN_ART_RISK', 'HIGH', 0.78));
    return { outcome: 'ALLOW', findings: [], response: { deterministic: true } };
  }
}

export class PolicyService {
  public constructor(
    private readonly pool: SqlPool,
    private readonly classifier: PolicyClassifier = new DeterministicPolicyClassifier(),
    private readonly rulesetId = 'm8-mvp-2026-08',
  ) {}

  async evaluate(input: PolicyEvaluationInput): Promise<PolicyEvaluation> {
    let classification: PolicyClassification;
    try {
      classification = await this.classifier.classify(input);
    } catch {
      classification = unknown('CLASSIFIER_FAILURE');
    }
    const result = await this.pool.query<{
      id: string;
      created_at: Date;
      project_id: string | null;
      project_version_id: string | null;
      generation_id: string | null;
      order_id: string | null;
      asset_id: string | null;
    }>(
      `INSERT INTO app.policy_evaluations (
        ruleset_id, stage, machine_result, classifier_id, classifier_version, project_id,
        project_version_id, generation_id, order_id, asset_id, request_metadata, classifier_response
      ) VALUES ($1, $2, $3, $4, $5, $6::uuid, $7::uuid, $8::uuid, $9::uuid, $10::uuid, $11::jsonb, $12::jsonb)
      RETURNING id, created_at, project_id, project_version_id, generation_id, order_id, asset_id`,
      [
        this.rulesetId,
        input.stage,
        classification.outcome,
        this.classifier.id,
        this.classifier.version,
        input.projectId ?? null,
        input.projectVersionId ?? null,
        input.generationId ?? null,
        input.orderId ?? null,
        input.assetId ?? null,
        JSON.stringify({
          ...input.metadata,
          textPresent: Boolean(input.text),
          imagePresent: Boolean(input.imageBytes),
        }),
        JSON.stringify(classification.response ?? {}),
      ],
    );
    const row = required(result.rows[0], 'Could not persist policy evaluation.');
    for (const current of classification.findings) {
      await this.pool.query(
        `INSERT INTO app.policy_findings (evaluation_id, category, code, severity, confidence, affected_artifact, evidence)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
        [
          row.id,
          current.category,
          current.code,
          current.severity,
          current.confidence,
          JSON.stringify({
            stage: input.stage,
            assetId: input.assetId ?? null,
            projectVersionId: input.projectVersionId ?? null,
          }),
          JSON.stringify(current.evidence ?? {}),
        ],
      );
    }
    return {
      id: row.id,
      rulesetId: this.rulesetId,
      stage: input.stage,
      outcome: classification.outcome,
      findings: classification.findings,
      projectId: row.project_id,
      projectVersionId: row.project_version_id,
      generationId: row.generation_id,
      orderId: row.order_id,
      assetId: row.asset_id,
      createdAt: row.created_at,
    };
  }

  async evaluateFinalArtworkForOrder(orderNumber: string): Promise<PolicyEvaluation> {
    const result = await this.pool.query<{
      order_id: string;
      project_id: string;
      project_version_id: string;
      asset_id: string | null;
    }>(
      `SELECT o.id AS order_id, oi.project_id, oi.project_version_id, r.production_master_asset_id AS asset_id
       FROM app.orders o JOIN app.order_items oi ON oi.order_id = o.id
       JOIN app.prepress_runs r ON r.id = oi.prepress_run_id WHERE o.order_number = $1`,
      [orderNumber],
    );
    const row = required(result.rows[0], 'Order final artwork is unavailable.');
    return this.evaluate({
      stage: 'FINAL_ARTWORK_PRE_PRODUCTION',
      projectId: row.project_id,
      projectVersionId: row.project_version_id,
      orderId: row.order_id,
      ...(row.asset_id ? { assetId: row.asset_id } : {}),
      metadata: { orderNumber, artifact: 'production-master' },
    });
  }

  async recordHumanDecision(input: {
    evaluationId: string;
    orderId?: string;
    actorUserId: string;
    decision: PolicyHumanDecision;
    reasonCode: string;
    notes?: string;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO app.policy_human_decisions (evaluation_id, order_id, decision, reason_code, notes, actor_user_id)
       VALUES ($1, $2::uuid, $3, $4, $5, $6::uuid)`,
      [
        input.evaluationId,
        input.orderId ?? null,
        input.decision,
        input.reasonCode,
        input.notes ?? null,
        input.actorUserId,
      ],
    );
  }

  async finalArtworkEligibility(orderNumber: string): Promise<{ eligible: boolean; code: string }> {
    const result = await this.pool.query<{
      machine_result: PolicyOutcome | null;
      human_decision: PolicyHumanDecision | null;
    }>(
      `SELECT e.machine_result,
              (SELECT d.decision FROM app.policy_human_decisions d WHERE d.evaluation_id = e.id ORDER BY d.created_at DESC LIMIT 1) AS human_decision
       FROM app.orders o JOIN app.order_items oi ON oi.order_id = o.id
       JOIN app.prepress_runs r ON r.id = oi.prepress_run_id
       LEFT JOIN LATERAL (
         SELECT * FROM app.policy_evaluations pe WHERE pe.order_id = o.id
           AND pe.stage = 'FINAL_ARTWORK_PRE_PRODUCTION'
           AND pe.project_version_id = oi.project_version_id
           AND pe.asset_id IS NOT DISTINCT FROM r.production_master_asset_id
         ORDER BY pe.created_at DESC LIMIT 1
       ) e ON true WHERE o.order_number = $1`,
      [orderNumber],
    );
    const row = result.rows[0];
    if (!row?.machine_result) return { eligible: false, code: 'FINAL_POLICY_MISSING' };
    if (row.machine_result === 'BLOCK') return { eligible: false, code: 'FINAL_POLICY_BLOCKED' };
    if (row.machine_result === 'ALLOW') return { eligible: true, code: 'FINAL_POLICY_ALLOWED' };
    if (row.human_decision === 'APPROVED')
      return { eligible: true, code: 'FINAL_POLICY_HUMAN_APPROVED' };
    return {
      eligible: false,
      code: row.machine_result === 'UNKNOWN' ? 'FINAL_POLICY_UNKNOWN' : 'FINAL_POLICY_REVIEW',
    };
  }
}

function blocked(finding: PolicyFinding): PolicyClassification {
  return { outcome: 'BLOCK', findings: [finding], response: { deterministic: true } };
}
function review(finding: PolicyFinding): PolicyClassification {
  return { outcome: 'REVIEW', findings: [finding], response: { deterministic: true } };
}
function unknown(code: string): PolicyClassification {
  return {
    outcome: 'UNKNOWN',
    findings: [{ category: 'POLICY_UNCERTAIN', code, severity: 'HIGH', confidence: 0 }],
  };
}
function imageText(bytes: Uint8Array | undefined): string {
  if (!bytes) return '';
  return new TextDecoder().decode(bytes.slice(0, 24_000));
}
function required<T>(value: T | undefined, message: string): T {
  if (!value) throw new Error(message);
  return value;
}
