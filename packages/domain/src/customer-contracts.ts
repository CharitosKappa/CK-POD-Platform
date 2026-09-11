export const customerViews = [
  'ALL',
  'NEW',
  'RETURNING',
  'HIGH_VALUE',
  'EMAIL_SUBSCRIBERS',
] as const;
export type CustomerView = (typeof customerViews)[number];

export const customerSorts = [
  'LAST_SEEN_DESC',
  'TOTAL_SPENT_DESC',
  'ORDER_COUNT_DESC',
  'NAME_ASC',
] as const;
export type CustomerSort = (typeof customerSorts)[number];

export const marketingStatuses = ['UNKNOWN', 'NOT_SUBSCRIBED', 'SUBSCRIBED'] as const;
export type MarketingStatus = (typeof marketingStatuses)[number];

export const CUSTOMER_HIGH_VALUE_CENTS = 15_000;
export const CUSTOMER_NEW_DAYS = 30;

export type CustomerAddressInput = Readonly<{
  line1?: string;
  line2?: string;
  city?: string;
  stateCode?: string;
  postalCode?: string;
  countryCode?: string;
}>;

export type CustomerProfileInput = Readonly<{
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  emailMarketingStatus?: MarketingStatus;
  smsMarketingStatus?: MarketingStatus;
  address?: CustomerAddressInput;
  tags?: string[];
  note?: string;
}>;

export function normalizeCustomerEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Enter a valid customer email.');
  return email;
}

export function normalizeCustomerTag(value: string): string {
  const tag = value.trim().replace(/\s+/g, ' ');
  if (!tag || tag.length > 48) throw new Error('Enter a customer tag of up to 48 characters.');
  return tag;
}

export function escapeCustomerCsv(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
