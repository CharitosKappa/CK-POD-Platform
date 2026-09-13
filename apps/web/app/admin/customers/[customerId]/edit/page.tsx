import { redirect } from 'next/navigation';

export default async function EditCustomerPage({
  params,
}: Readonly<{ params: Promise<{ customerId: string }> }>) {
  const { customerId } = await params;
  redirect(`/admin/customers/${encodeURIComponent(customerId)}`);
}
