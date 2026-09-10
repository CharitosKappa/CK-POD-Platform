import { OperationsCustomerList } from '../../ops/customers/operations-customer-list';

export default function AdminCustomersPage() {
  return <OperationsCustomerList apiBase="/api/admin/customers" pageBase="/admin/customers" />;
}
