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
