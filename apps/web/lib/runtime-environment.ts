import { parseServerEnvironment, type ServerEnvironment } from '@let-it-be/config';

import { loadLocalEnvironment } from '../instrumentation-node';

/**
 * Next development route workers do not share instrumentation's process state.
 * Load the optional root local environment only in development, then validate it
 * through the same fail-closed production parser used everywhere else.
 */
export function serverEnvironment(): ServerEnvironment {
  loadLocalEnvironment();
  return parseServerEnvironment(process.env);
}
