import { OperationsOrderDetail } from '../../../ops/orders/[orderNumber]/operations-order-detail';

export default async function AdminOrderDetailPage({
  params,
}: Readonly<{ params: Promise<{ orderNumber: string }> }>) {
  const { orderNumber } = await params;
  return (
    <OperationsOrderDetail
      orderNumber={orderNumber}
      apiBase="/api/admin/orders"
      pageBase="/admin/orders"
      commerceFirst
    />
  );
}
