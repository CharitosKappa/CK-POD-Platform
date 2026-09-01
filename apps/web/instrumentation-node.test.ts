import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadLocalEnvironment, resolveRepositoryRoot } from './instrumentation-node.js';

describe('development environment discovery', () => {
  it('finds the monorepo root rather than an application-local environment file', () => {
    expect(resolveRepositoryRoot(resolve(process.cwd(), 'apps', 'web'))).toBe(process.cwd());
  });

  it('loads only the optional monorepo root file in development', () => {
    const loaded: string[] = [];
    loadLocalEnvironment({
      nodeEnvironment: 'development',
      workingDirectory: resolve(process.cwd(), 'apps', 'web'),
      fileExists: () => true,
      load: (path) => loaded.push(path),
    });
    expect(loaded).toEqual([resolve(process.cwd(), '.env')]);
  });

  it('never loads a file outside development', () => {
    loadLocalEnvironment({
      nodeEnvironment: 'production',
      fileExists: () => true,
      load: () => {
        throw new Error('production must not load a local environment file');
      },
    });
  });
});
