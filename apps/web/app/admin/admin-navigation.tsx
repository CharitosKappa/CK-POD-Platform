'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const primary = [
  { href: '/admin', label: 'Home', icon: 'home' },
  { href: '/admin/orders', label: 'Orders', icon: 'orders' },
  { href: '/admin/customers', label: 'Customers', icon: 'customers' },
] as const;

function isCurrent(pathname: string, href: string) {
  return href === '/admin' ? pathname === href : pathname.startsWith(href);
}

export function AdminNavigation() {
  const pathname = usePathname();
  return (
    <nav className="commerce-admin-nav" aria-label="Admin navigation">
      {primary.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={isCurrent(pathname, item.href) ? 'page' : undefined}
          data-tooltip={item.label}
        >
          <AdminNavigationIcon name={item.icon} />
          <span className="commerce-admin-nav-label">{item.label}</span>
        </Link>
      ))}
      <p>Coming next</p>
      <span className="commerce-admin-nav-pending">Products</span>
      <span className="commerce-admin-nav-pending">Analytics</span>
    </nav>
  );
}

function AdminNavigationIcon({ name }: Readonly<{ name: (typeof primary)[number]['icon'] }>) {
  const paths = {
    home: <path d="M3.5 9.3 10 3.8l6.5 5.5v7.2h-4.1v-4.6H7.6v4.6H3.5Z" />,
    orders: (
      <>
        <path d="M5 3.5h10v13H5z" />
        <path d="M7.7 7h4.6M7.7 10h4.6M7.7 13h2.8" />
      </>
    ),
    customers: (
      <>
        <circle cx="10" cy="7" r="3" />
        <path d="M4.5 16.2c.7-3 2.6-4.4 5.5-4.4s4.8 1.4 5.5 4.4" />
      </>
    ),
  } as const;

  return (
    <span className="commerce-admin-nav-icon" aria-hidden="true">
      <svg viewBox="0 0 20 20">{paths[name]}</svg>
    </span>
  );
}
