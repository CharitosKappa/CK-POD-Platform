import { CustomerDetailClient } from '../_components/customer-detail-client';

export default async function AdminCustomerPage({
  params,
}: Readonly<{ params: Promise<{ customerId: string }> }>) {
  const { customerId } = await params;
  return <CustomerDetailClient customerId={customerId} />;
}
