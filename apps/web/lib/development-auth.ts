import type { ServerEnvironment } from '@let-it-be/config';

type RuntimeEnvironment = Pick<ServerEnvironment, 'APP_ENV' | 'NODE_ENV'>;
type LocalAdminEnvironment = RuntimeEnvironment & { INITIAL_ADMIN_EMAIL?: string | undefined };

const fallbackLocalAdminEmail = 'admin@letitbe.local';

export function mayExposeLocalDevelopmentCode(environment: RuntimeEnvironment): boolean {
  return environment.APP_ENV === 'local' && environment.NODE_ENV !== 'production';
}

export function localDevelopmentAdminEmail(environment: LocalAdminEnvironment): string | undefined {
  if (!mayExposeLocalDevelopmentCode(environment)) return undefined;
  return environment.INITIAL_ADMIN_EMAIL?.trim().toLowerCase() || fallbackLocalAdminEmail;
}
