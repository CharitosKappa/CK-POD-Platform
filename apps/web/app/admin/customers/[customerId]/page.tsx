import { OperationsCustomerDetail } from '../../../ops/customers/[customerId]/operations-customer-detail';

export default async function AdminCustomerPage({
  params,
}: Readonly<{ params: Promise<{ customerId: string }> }>) {
  const { customerId } = await params;
  return (
    <OperationsCustomerDetail
      customerId={customerId}
      apiBase="/api/admin/customers"
      pageBase="/admin/customers"
      ordersBase="/admin/orders"
    />
  );
}
