import { Pool } from 'pg';

import { requireDatabaseUrl } from './runtime-environment.js';

const pool = new Pool({ connectionString: requireDatabaseUrl() });

try {
  const result = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'app'
       AND table_name = ANY($1::text[])`,
    [
      [
        'sessions',
        'users',
        'projects',
        'project_versions',
        'product_models',
        'product_variants',
        'assets',
        'generations',
        'generation_attempts',
        'credit_accounts',
        'credit_ledger',
        'style_families',
        'style_presets',
        'style_preset_versions',
        'analytics_events',
        'print_providers',
        'fulfillment_product_mappings',
        'fulfillment_variant_mappings',
        'provider_variants',
        'provider_qualifications',
        'provider_profile_mappings',
        'provider_costs',
        'shipping_quotes',
        'catalog_sync_runs',
        'routing_configurations',
        'routing_evaluations',
        'provider_derivatives',
        'fulfillment_operations',
        'fulfillment_events',
        'fulfillment_operational_events',
      ],
    ],
  );

  if (result.rows.length !== 30) {
    throw new Error('Required application tables are missing after migrations.');
  }

  console.info('Database migration verification passed.');
} finally {
  await pool.end();
}
