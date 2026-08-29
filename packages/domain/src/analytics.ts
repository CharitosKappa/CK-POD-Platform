import type { SqlClient } from '@let-it-be/db';

import type { ProductGenerationContext } from './ai-contracts';
import type { StyleSelection } from './styles';

export type GenerationAnalyticsEventName =
  | 'generation_started'
  | 'generation_succeeded'
  | 'generation_failed'
  | 'generation_rejected_internal';

/** Minimal server-side event writer; dashboards and delivery integrations remain Milestone 9 work. */
export async function recordGenerationAnalyticsEvent(
  client: SqlClient,
  input: {
    name: GenerationAnalyticsEventName;
    projectId: string;
    generationId: string;
    productContext: ProductGenerationContext;
    styleSelection: StyleSelection;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO app.analytics_events (event_name, project_id, generation_id, dimensions)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [
      input.name,
      input.projectId,
      input.generationId,
      JSON.stringify({
        productId: input.productContext.productModelId,
        colorCode: input.productContext.colorCode,
        styleFamilyId: input.styleSelection.styleFamilyId,
        presetId: input.styleSelection.presetId,
        presetVersion: input.styleSelection.presetVersion,
        selectionMode: input.styleSelection.selectionMode,
      }),
    ],
  );
}
