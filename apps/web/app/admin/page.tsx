import Link from 'next/link';

import { adminCommerceRuntime, requireAdminSession } from '../../lib/platform';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const date = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

function statusLabel(status: string) {
  return status.toLowerCase().replaceAll('_', ' ');
}

export default async function AdminPage() {
  const session = await requireAdminSession();
  const overview = await adminCommerceRuntime().dashboard(session);
  const metrics = [
    ['Gross sales', money.format(overview.metrics.grossSalesCents / 100), 'Last 30 days'],
    ['Orders', overview.metrics.orders.toLocaleString('en-US'), 'Last 30 days'],
    ['Average order', money.format(overview.metrics.averageOrderValueCents / 100), 'Last 30 days'],
    [
      'Customers',
      overview.metrics.customers.toLocaleString('en-US'),
      `${overview.metrics.returningCustomers} returning`,
    ],
  ] as const;
  const attention = [
    ['Needs review', overview.attention.needsReview, 'OPEN'],
    ['Ready to submit', overview.attention.readyToSubmit, 'OPEN'],
    ['On hold', overview.attention.onHold, 'ATTENTION'],
    ['Failed', overview.attention.failed, 'ATTENTION'],
  ] as const;
  return (
    <main className="commerce-admin-page commerce-admin-home">
      <header className="commerce-admin-page-heading">
        <div>
          <p>Commerce overview</p>
          <h1>Good morning.</h1>
          <span>Here&apos;s what is happening with your store.</span>
        </div>
        <Link href="/admin/orders">View orders</Link>
      </header>
      <section className="commerce-admin-metrics" aria-label="Store performance">
        {metrics.map(([label, value, caption]) => (
          <article key={label}>
            <p>{label}</p>
            <strong>{value}</strong>
            <small>{caption}</small>
          </article>
        ))}
      </section>
      <section className="commerce-admin-grid">
        <article className="commerce-admin-card commerce-admin-attention">
          <header>
            <div>
              <p>Action center</p>
              <h2>Needs attention</h2>
            </div>
            <Link href="/admin/orders?view=ATTENTION">View all</Link>
          </header>
          {attention.map(([label, count, view]) => (
            <Link key={label} href={`/admin/orders?view=${view}`}>
              <span>{label}</span>
              <strong>{count}</strong>
              <i aria-hidden="true">→</i>
            </Link>
          ))}
        </article>
        <article className="commerce-admin-card commerce-admin-best">
          <header>
            <div>
              <p>Last 30 days</p>
              <h2>Best sellers</h2>
            </div>
          </header>
          {overview.bestSellers.length ? (
            <ol>
              {overview.bestSellers.map((product) => (
                <li key={product.productName}>
                  <span>{product.productName}</span>
                  <strong>{product.units} units</strong>
                  <small>{product.orders} orders</small>
                </li>
              ))}
            </ol>
          ) : (
            <p className="commerce-admin-empty">Sales will appear here after your first order.</p>
          )}
        </article>
      </section>
      <section className="commerce-admin-card commerce-admin-recent">
        <header>
          <div>
            <p>Store activity</p>
            <h2>Recent orders</h2>
          </div>
          <Link href="/admin/orders">View all orders</Link>
        </header>
        <div className="commerce-admin-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Date</th>
                <th>Customer</th>
                <th>Payment</th>
                <th>Fulfillment</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {overview.recentOrders.map((order) => (
                <tr key={order.orderNumber}>
                  <td>
                    <Link href={`/admin/orders/${encodeURIComponent(order.orderNumber)}`}>
                      {order.orderNumber}
                    </Link>
                    <small>{order.productName}</small>
                  </td>
                  <td>{date.format(order.createdAt)}</td>
                  <td>
                    {order.customerName}
                    <small>{order.customerEmail}</small>
                  </td>
                  <td>
                    <span className="commerce-status is-paid">
                      {statusLabel(order.paymentStatus)}
                    </span>
                  </td>
                  <td>
                    <span className="commerce-status">{statusLabel(order.status)}</span>
                  </td>
                  <td>
                    <strong>{money.format(order.totalCents / 100)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!overview.recentOrders.length ? (
          <p className="commerce-admin-empty">No orders yet.</p>
        ) : null}
      </section>
    </main>
  );
}
