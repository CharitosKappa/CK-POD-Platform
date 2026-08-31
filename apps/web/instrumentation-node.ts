import { config as loadEnvironment } from 'dotenv';
import { fileURLToPath } from 'node:url';

export function loadLocalEnvironment(): void {
  if (process.env.NODE_ENV !== 'development') return;
  // The development server runs from apps/web while the checked-in local
  // configuration belongs to the repository root. Deployed configuration is
  // never loaded from this file and process values retain precedence.
  loadEnvironment({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });
}
