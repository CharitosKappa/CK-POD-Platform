import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function resolveRepositoryRoot(workingDirectory = process.cwd()): string {
  let candidate = resolve(workingDirectory);
  while (!existsSync(resolve(candidate, 'pnpm-workspace.yaml'))) {
    const parent = dirname(candidate);
    if (parent === candidate) return resolve(workingDirectory);
    candidate = parent;
  }
  return candidate;
}

export function loadLocalEnvironment(
  input: {
    nodeEnvironment?: string;
    workingDirectory?: string;
    fileExists?: (path: string) => boolean;
    load?: (path: string) => void;
  } = {},
): void {
  if ((input.nodeEnvironment ?? process.env.NODE_ENV) !== 'development') return;
  // The development server runs from apps/web while the checked-in local
  // configuration belongs to the repository root. Deployed configuration is
  // never loaded from this file and process values retain precedence. Resolve
  // at runtime so Next does not treat an optional .env as a bundle dependency.
  const rootEnvironment = resolve(resolveRepositoryRoot(input.workingDirectory), '.env');
  if ((input.fileExists ?? existsSync)(rootEnvironment))
    (input.load ?? process.loadEnvFile)(rootEnvironment);
}
