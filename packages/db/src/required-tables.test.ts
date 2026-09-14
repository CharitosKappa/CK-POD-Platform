import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { requiredApplicationTables } from './required-tables.js';

const migrationsDirectory = fileURLToPath(new URL('../drizzle', import.meta.url));

describe('required application tables', () => {
  it('registers every checked-in SQL migration in the Drizzle journal', async () => {
    const legacyUnjournaledDataFixes = new Set(['0027_cart_design_preview_prepress_fallback']);
    const migrationTags = (await readdir(migrationsDirectory))
      .filter((fileName) => fileName.endsWith('.sql'))
      .map((fileName) => fileName.replace(/\.sql$/, ''))
      .filter((tag) => !legacyUnjournaledDataFixes.has(tag))
      .sort();
    const journal = JSON.parse(
      await readFile(`${migrationsDirectory}/meta/_journal.json`, 'utf8'),
    ) as { entries: Array<{ tag: string }> };

    expect(journal.entries.map((entry) => entry.tag).sort()).toEqual(migrationTags);
  });

  it('includes the independent Store Credit tables', () => {
    expect(requiredApplicationTables).toContain('store_credit_accounts');
    expect(requiredApplicationTables).toContain('store_credit_ledger');
  });

  it('includes the independent order detail layer tables', () => {
    for (const table of [
      'order_printing_status_events',
      'order_fulfillment_status_history',
      'order_notes',
      'order_tags',
      'order_tag_assignments',
    ]) {
      expect(requiredApplicationTables).toContain(table);
    }
  });

  it('includes the independent order export table', () => {
    expect(requiredApplicationTables).toContain('order_exports');
  });

  it('includes the order admin action persistence tables', () => {
    for (const table of [
      'order_cancellations',
      'order_cancellation_groups',
      'order_returns',
      'order_return_items',
      'order_return_events',
      'order_revisions',
    ]) {
      expect(requiredApplicationTables).toContain(table);
    }
  });

  it('includes the separate additional-payment aggregate for upward order edits', async () => {
    expect(requiredApplicationTables).toContain('order_edit_payment_attempts');
    const sql = await readFile(`${migrationsDirectory}/0050_order_edit_payments.sql`, 'utf8');
    expect(sql).toContain('CREATE TABLE app.order_edit_payment_attempts');
    expect(sql).toContain('idempotency_key text NOT NULL UNIQUE');
    expect(sql).toContain("WHERE status IN ('PREPARING','PENDING')");
    expect(sql).toContain('order_revision_id uuid NOT NULL');
  });

  it('enforces the order admin action migration contracts', async () => {
    const sql = await readFile(`${migrationsDirectory}/0049_order_admin_actions.sql`, 'utf8');

    expect(sql).toContain(
      "CHECK (status IN ('REQUESTED','PROCESSING','SUCCEEDED','PARTIAL','FAILED'))",
    );
    expect(sql).toContain(
      "CHECK (state IN ('REQUESTED','APPROVED','IN_TRANSIT','RECEIVED','CLOSED','REJECTED'))",
    );
    expect(sql).toContain('UNIQUE (order_id, idempotency_key)');
    expect(sql).toContain('CHECK (quantity > 0)');
    expect(sql).toMatch(
      /ADD CONSTRAINT order_refunds_destination_backing_check CHECK \([\s\S]+?\n {2}\) NOT VALID;/,
    );
  });

  it('tracks every table created by the checked-in migrations', async () => {
    const migrationFiles = (await readdir(migrationsDirectory)).filter((fileName) =>
      fileName.endsWith('.sql'),
    );
    const createdTables: string[] = [];

    for (const migrationFile of migrationFiles) {
      const sql = await readFile(`${migrationsDirectory}/${migrationFile}`, 'utf8');
      createdTables.push(
        ...Array.from(sql.matchAll(/CREATE TABLE app\.([a-z0-9_]+)/g), (match) => match[1]!),
      );
    }

    expect(new Set(createdTables).size).toBe(createdTables.length);
    expect([...requiredApplicationTables].sort()).toEqual(createdTables.sort());
  });
});
