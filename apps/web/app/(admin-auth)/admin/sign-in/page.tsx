import { AdminSignInForm } from '../../../admin/sign-in/admin-sign-in-form';
import { localDevelopmentAdminEmail } from '../../../../lib/development-auth';
import { serverEnvironment } from '../../../../lib/runtime-environment';

function safeReturnTo(value: string | undefined): string {
  return value?.startsWith('/admin') ? value : '/admin/customers';
}

export default async function AdminSignInPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ returnTo?: string }> }>) {
  const { returnTo } = await searchParams;
  const environment = serverEnvironment();
  const developmentAdminEmail = localDevelopmentAdminEmail(environment);

  return (
    <AdminSignInForm
      developmentAdminEmail={developmentAdminEmail}
      returnTo={safeReturnTo(returnTo)}
    />
  );
}
