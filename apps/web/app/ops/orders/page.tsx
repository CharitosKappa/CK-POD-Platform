import { OperationsOrderList } from './operations-order-list';

export default async function OperationsOrdersPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ view?: string }> }>) {
  const { view } = await searchParams;
  return view ? <OperationsOrderList initialView={view} /> : <OperationsOrderList />;
}
