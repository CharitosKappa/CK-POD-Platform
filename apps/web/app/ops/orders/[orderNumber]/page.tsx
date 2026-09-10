import { OperationsOrderDetail } from './operations-order-detail';

export default async function OperationsOrderDetailPage({
  params,
}: Readonly<{ params: Promise<{ orderNumber: string }> }>) {
  const { orderNumber } = await params;
  return <OperationsOrderDetail orderNumber={orderNumber} />;
}
