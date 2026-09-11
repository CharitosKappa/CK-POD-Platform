import type { ServerEnvironment } from '@let-it-be/config';

type RuntimeEnvironment = Pick<ServerEnvironment, 'APP_ENV' | 'NODE_ENV'>;

export function mayExposeLocalDevelopmentCode(environment: RuntimeEnvironment): boolean {
  return environment.APP_ENV === 'local' && environment.NODE_ENV !== 'production';
}
