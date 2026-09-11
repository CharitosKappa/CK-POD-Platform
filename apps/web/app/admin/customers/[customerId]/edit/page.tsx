import { CustomerForm } from '../../_components/customer-form';

export default async function EditCustomerPage({
  params,
}: Readonly<{ params: Promise<{ customerId: string }> }>) {
  const { customerId } = await params;
  return <CustomerForm customerId={customerId} />;
}
