import Link from 'next/link';
import type { ReactNode } from 'react';

const primaryLinks = [
  { href: '/ops/dashboard', label: 'Home' },
  { href: '/ops/orders', label: 'Orders' },
  { href: '/ops/customers', label: 'Customers' },
  { href: '/ops/providers', label: 'Products & providers' },
];

const operationsLinks = [
  { href: '/ops/orders', label: 'Fulfillment' },
  { href: '/ops/reviews', label: 'Review queue' },
];

export default function OperationsLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="ops-admin-shell">
      <aside className="ops-admin-sidebar" aria-label="Operations navigation">
        <Link className="ops-admin-brand" href="/ops/orders">
          <span>LI</span>
          <strong>LET IT BE</strong>
        </Link>
        <p className="ops-admin-store">Let It Be Store</p>
        <nav>
          <p className="ops-admin-nav-label">Store management</p>
          {primaryLinks.map((link) => (
            <Link key={link.href} href={link.href} className="ops-admin-nav-link">
              {link.label}
            </Link>
          ))}
          <p className="ops-admin-nav-label">Operations</p>
          {operationsLinks.map((link) => (
            <Link key={link.href} href={link.href} className="ops-admin-nav-link">
              {link.label}
            </Link>
          ))}
        </nav>
      </aside>
      <section className="ops-admin-main">
        <header className="ops-admin-mobile-header">
          <Link className="ops-admin-mobile-brand" href="/ops/orders">
            LI
          </Link>
          <span>Operations</span>
          <Link href="/ops/orders" aria-label="Orders">
            Menu
          </Link>
        </header>
        {children}
      </section>
    </div>
  );
}
