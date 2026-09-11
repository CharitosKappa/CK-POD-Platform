export type MarketingStatus = 'UNKNOWN' | 'NOT_SUBSCRIBED' | 'SUBSCRIBED';
export type CustomerView = 'ALL' | 'NEW' | 'RETURNING' | 'HIGH_VALUE' | 'EMAIL_SUBSCRIBERS';
export type CustomerSort = 'LAST_SEEN_DESC' | 'TOTAL_SPENT_DESC' | 'ORDER_COUNT_DESC' | 'NAME_ASC';

export type CustomerListItem = {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  location: string | null;
  emailMarketingStatus: MarketingStatus;
  smsMarketingStatus: MarketingStatus;
  orderCount: number;
  totalSpentCents: number;
  creditBalance: number;
  lastOrderAt: string | null;
  lastSeenAt: string;
  tags: string[];
};

export type CustomerListResponse = {
  customers: CustomerListItem[];
  total: number;
  page: number;
  limit: number;
  metrics: {
    totalCustomers: number;
    returningPercentage: number;
    averageLifetimeSpendCents: number;
    emailSubscribers: number;
  };
};

export type CustomerDetail = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  name: string;
  customerSince: string;
  lastSeenAt: string;
  source: string;
  orderCount: number;
  totalSpentCents: number;
  averageOrderValueCents: number;
  creditBalance: number;
  lastOrderAt: string | null;
  savedDesignCount: number;
  lastDesignAt: string | null;
  emailMarketingStatus: MarketingStatus;
  smsMarketingStatus: MarketingStatus;
  addresses: Array<{
    id: string;
    recipientName: string;
    line1: string;
    line2: string | null;
    city: string;
    stateCode: string | null;
    postalCode: string;
    countryCode: string;
    phone: string | null;
    isDefault: boolean;
    source: 'PROFILE' | 'SAVED' | 'ORDER';
  }>;
  orders: Array<{
    orderNumber: string;
    status: string;
    itemCount: number;
    totalCents: number;
    createdAt: string;
  }>;
  credits: Array<{
    id: string;
    entryType: string;
    amount: number;
    balanceAfter: number;
    createdAt: string;
  }>;
  tags: string[];
  timeline: Array<{ id: string; eventType: string; body: string | null; createdAt: string }>;
};
