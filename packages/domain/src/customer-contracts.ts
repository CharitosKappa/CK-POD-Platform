export const customerViews = [
  'ALL',
  'RECENTLY_ADDED',
  'PROSPECTS',
  'FIRST_TIME',
  'RETURNING',
  'HIGH_VALUE',
  'EMAIL_SUBSCRIBERS',
] as const;
export type CustomerView = (typeof customerViews)[number];

export const customerSorts = [
  'LAST_SEEN_DESC',
  'NAME_ASC',
  'NAME_DESC',
  'EMAIL_ASC',
  'EMAIL_DESC',
  'EMAIL_MARKETING_ASC',
  'EMAIL_MARKETING_DESC',
  'LOCATION_ASC',
  'LOCATION_DESC',
  'ORDER_COUNT_ASC',
  'ORDER_COUNT_DESC',
  'TOTAL_SPENT_ASC',
  'TOTAL_SPENT_DESC',
  'LAST_ORDER_ASC',
  'LAST_ORDER_DESC',
  'TAGS_ASC',
  'TAGS_DESC',
  'CUSTOMER_ADDED_ASC',
  'CUSTOMER_ADDED_DESC',
  'CUSTOMER_UPDATED_ASC',
  'CUSTOMER_UPDATED_DESC',
] as const;
export type CustomerSort = (typeof customerSorts)[number];

export const marketingStatuses = ['UNKNOWN', 'NOT_SUBSCRIBED', 'SUBSCRIBED'] as const;
export type MarketingStatus = (typeof marketingStatuses)[number];

export const customerLocales = ['en'] as const;
export type CustomerLocale = (typeof customerLocales)[number];

export const customerLocaleSources = ['DEFAULT', 'BROWSER', 'CUSTOMER', 'ADMIN'] as const;
export type CustomerLocaleSource = (typeof customerLocaleSources)[number];

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
  preferredLocale?: CustomerLocale;
  address?: CustomerAddressInput;
  tags?: string[];
  note?: string;
}>;

export function normalizeCustomerLocale(value: string): CustomerLocale {
  const normalized = value.trim().replaceAll('_', '-').toLowerCase().split('-')[0];
  if (!customerLocales.includes(normalized as CustomerLocale))
    throw new Error('Choose a supported customer language.');
  return normalized as CustomerLocale;
}

export function detectCustomerLocale(acceptLanguage: string | null | undefined): CustomerLocale {
  const candidates = (acceptLanguage ?? '')
    .split(',')
    .map((part, index) => {
      const [rawLocale, ...parameters] = part.trim().split(';');
      const qualityParameter = parameters.find((parameter) => parameter.trim().startsWith('q='));
      const parsedQuality = qualityParameter
        ? Number.parseFloat(qualityParameter.trim().slice(2))
        : 1;
      return {
        rawLocale: rawLocale ?? '',
        quality: Number.isFinite(parsedQuality) ? parsedQuality : 0,
        index,
      };
    })
    .sort((left, right) => right.quality - left.quality || left.index - right.index);

  for (const candidate of candidates) {
    if (candidate.quality <= 0) continue;
    try {
      return normalizeCustomerLocale(candidate.rawLocale);
    } catch {
      // Continue until the first supported storefront locale is found.
    }
  }
  return 'en';
}

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
