import { SignInForm } from './sign-in-form';

interface SignInPageProps {
  searchParams: Promise<{ returnTo?: string }>;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { returnTo } = await searchParams;
  return (
    <main className="auth-prototype-page">
      <SignInForm returnTo={safeReturnTo(returnTo)} />
    </main>
  );
}

function safeReturnTo(value: string | undefined): string {
  if (!value?.startsWith('/') || value.startsWith('//')) return '/describe';
  return value;
}
