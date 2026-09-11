type CustomerIdentity = {
  firstName: string;
  lastName: string;
  name: string;
  email: string;
};

export function customerDisplayName(customer: CustomerIdentity): string {
  const name = [customer.firstName.trim(), customer.lastName.trim()].filter(Boolean).join(' ');
  return name || customer.name.trim() || customer.email;
}

export function customerDuration(customerSince: Date, now = new Date()): string {
  if (!Number.isFinite(customerSince.getTime()) || !Number.isFinite(now.getTime())) return '0 days';
  if (customerSince >= now) return '0 days';

  let months =
    (now.getFullYear() - customerSince.getFullYear()) * 12 +
    now.getMonth() -
    customerSince.getMonth();
  if (now.getDate() < customerSince.getDate()) months -= 1;

  if (months < 1) {
    const days = Math.max(
      0,
      Math.floor((now.getTime() - customerSince.getTime()) / (24 * 60 * 60 * 1000)),
    );
    return `${days} ${days === 1 ? 'day' : 'days'}`;
  }
  if (months < 12) return `${months} ${months === 1 ? 'month' : 'months'}`;

  const years = Math.floor(months / 12);
  return `${years} ${years === 1 ? 'year' : 'years'}`;
}
