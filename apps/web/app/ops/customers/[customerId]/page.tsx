import { OperationsCustomerDetail } from './operations-customer-detail';

export default async function OperationsCustomerDetailPage({
  params,
}: Readonly<{ params: Promise<{ customerId: string }> }>) {
  const { customerId } = await params;
  return <OperationsCustomerDetail customerId={customerId} />;
}
