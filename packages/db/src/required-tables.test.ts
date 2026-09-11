import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { requiredApplicationTables } from './required-tables.js';

const migrationsDirectory = fileURLToPath(new URL('../drizzle', import.meta.url));

describe('required application tables', () => {
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
