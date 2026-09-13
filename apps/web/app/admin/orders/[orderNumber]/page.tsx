import { AdminOrderDetail } from './admin-order-detail';
import { decodeOrderNumberRouteParam } from '../../../../lib/order-number-route';

export default async function AdminOrderDetailPage({
  params,
}: Readonly<{ params: Promise<{ orderNumber: string }> }>) {
  const { orderNumber } = await params;
  return (
    <AdminOrderDetail
      orderNumber={decodeOrderNumberRouteParam(orderNumber)}
      apiBase="/api/admin/orders"
      pageBase="/admin/orders"
    />
  );
}
