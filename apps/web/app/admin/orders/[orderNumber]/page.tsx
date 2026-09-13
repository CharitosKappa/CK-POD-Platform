import { AdminOrderDetail } from './admin-order-detail';

export default async function AdminOrderDetailPage({
  params,
}: Readonly<{ params: Promise<{ orderNumber: string }> }>) {
  const { orderNumber } = await params;
  return (
    <AdminOrderDetail
      orderNumber={orderNumber}
      apiBase="/api/admin/orders"
      pageBase="/admin/orders"
    />
  );
}
