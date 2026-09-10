import { AdminSignInForm } from '../../../admin/sign-in/admin-sign-in-form';

function safeReturnTo(value: string | undefined): string {
  return value?.startsWith('/admin') ? value : '/admin/customers';
}

export default async function AdminSignInPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ returnTo?: string }> }>) {
  const { returnTo } = await searchParams;
  return <AdminSignInForm returnTo={safeReturnTo(returnTo)} />;
}
