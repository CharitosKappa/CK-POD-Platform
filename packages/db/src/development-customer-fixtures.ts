export type DevelopmentCustomerFixture = Readonly<{
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  stateCode: string;
  postalCode: string;
  countryCode: 'US';
  preferredLocale: 'en';
  emailMarketingStatus: 'NOT_SUBSCRIBED' | 'SUBSCRIBED' | 'UNSUBSCRIBED';
  smsMarketingStatus: 'NOT_SUBSCRIBED' | 'SUBSCRIBED' | 'UNSUBSCRIBED';
  tags: readonly string[];
  note?: string;
  firstSeenDaysAgo: number;
  lastSeenHoursAgo: number;
}>;

export function isPricedDevelopmentOrder(order: Readonly<{ totalCents: string | null }>): boolean {
  return typeof order.totalCents === 'string' && /^[1-9]\d*$/.test(order.totalCents);
}

let developmentCustomerSequence = 0;

export const developmentCustomerFixtures: readonly DevelopmentCustomerFixture[] = [
  customer(
    'Avery',
    'Morgan',
    'New York',
    'NY',
    '10001',
    240,
    3,
    ['VIP', 'Repeat buyer'],
    'Prefers minimal monochrome designs.',
  ),
  customer('Jordan', 'Lee', 'Los Angeles', 'CA', '90012', 190, 8, ['High value']),
  customer('Taylor', 'Davis', 'Chicago', 'IL', '60601', 120, 14, ['Newsletter']),
  customer('Riley', 'Wilson', 'Austin', 'TX', '78701', 90, 26, ['Repeat buyer']),
  customer('Casey', 'Martinez', 'Seattle', 'WA', '98101', 75, 32, ['VIP', 'Newsletter']),
  customer('Cameron', 'Anderson', 'Miami', 'FL', '33101', 62, 45, ['High value']),
  customer('Parker', 'Thomas', 'Denver', 'CO', '80202', 48, 52, ['Newsletter']),
  customer('Quinn', 'Jackson', 'Boston', 'MA', '02108', 41, 66, ['Repeat buyer']),
  customer('Reese', 'White', 'Portland', 'OR', '97205', 34, 72, ['Prospect']),
  customer('Rowan', 'Harris', 'Atlanta', 'GA', '30303', 29, 84, ['Newsletter']),
  customer('Emery', 'Clark', 'Nashville', 'TN', '37219', 24, 96, ['Prospect']),
  customer('Finley', 'Lewis', 'San Francisco', 'CA', '94103', 20, 110, ['VIP']),
  customer('Dakota', 'Walker', 'Phoenix', 'AZ', '85004', 17, 124, ['Newsletter']),
  customer('Skyler', 'Hall', 'San Diego', 'CA', '92101', 14, 138, ['Prospect']),
  customer('Hayden', 'Allen', 'Dallas', 'TX', '75201', 11, 152, ['Newsletter']),
  customer('Sidney', 'Young', 'Philadelphia', 'PA', '19103', 9, 166, ['Prospect']),
  customer('Payton', 'King', 'Charlotte', 'NC', '28202', 7, 180, ['Newsletter']),
  customer('Alexis', 'Wright', 'Detroit', 'MI', '48226', 5, 194, ['Prospect']),
  customer('Kendall', 'Scott', 'Minneapolis', 'MN', '55401', 3, 208, ['Newsletter']),
  customer(
    'Robin',
    'Green',
    'New Orleans',
    'LA',
    '70112',
    1,
    2,
    ['New customer'],
    'First order needs a delivery follow-up.',
  ),
];

function customer(
  firstName: string,
  lastName: string,
  city: string,
  stateCode: string,
  postalCode: string,
  firstSeenDaysAgo: number,
  lastSeenHoursAgo: number,
  tags: readonly string[],
  note?: string,
): DevelopmentCustomerFixture {
  const slug = `${firstName}.${lastName}`.toLowerCase();
  const index = developmentCustomerSequence++;
  return {
    firstName,
    lastName,
    email: `${slug}@demo.letitbe.test`,
    phone: `+1 555 ${String(110 + index).padStart(3, '0')} ${String(2100 + index).padStart(4, '0')}`,
    line1: `${120 + index * 17} Market Street`,
    line2: index % 4 === 0 ? `Apt ${index + 2}` : null,
    city,
    stateCode,
    postalCode,
    countryCode: 'US',
    preferredLocale: 'en',
    emailMarketingStatus:
      index % 3 === 0 ? 'SUBSCRIBED' : index % 3 === 1 ? 'NOT_SUBSCRIBED' : 'UNSUBSCRIBED',
    smsMarketingStatus:
      index % 4 === 0 ? 'SUBSCRIBED' : index % 4 === 1 ? 'NOT_SUBSCRIBED' : 'UNSUBSCRIBED',
    tags,
    ...(note ? { note } : {}),
    firstSeenDaysAgo,
    lastSeenHoursAgo,
  };
}

export function assertDevelopmentCustomerResetTarget(
  connectionString: string,
  environment: Readonly<{ INTEGRATION_TEST_DATABASE?: string }>,
) {
  if (environment.INTEGRATION_TEST_DATABASE === '1')
    throw new Error('Customer fixture reset is unavailable in an integration test process.');
  const target = new URL(connectionString);
  if (!['localhost', '127.0.0.1', '::1'].includes(target.hostname.toLowerCase()))
    throw new Error('Customer fixture reset requires local PostgreSQL.');
  const databaseName = decodeURIComponent(target.pathname.replace(/^\//, ''));
  if (databaseName !== 'letitbe')
    throw new Error('Customer fixture reset is restricted to the letitbe development database.');
}
