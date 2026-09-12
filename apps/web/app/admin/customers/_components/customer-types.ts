export type MarketingStatus = 'UNKNOWN' | 'NOT_SUBSCRIBED' | 'SUBSCRIBED';
export type CustomerLocale = 'en';
export type CustomerLocaleSource = 'DEFAULT' | 'BROWSER' | 'CUSTOMER' | 'ADMIN';
export type CustomerView =
  | 'ALL'
  | 'RECENTLY_ADDED'
  | 'PROSPECTS'
  | 'FIRST_TIME'
  | 'RETURNING'
  | 'HIGH_VALUE'
  | 'EMAIL_SUBSCRIBERS';
export type CustomerSort =
  | 'LAST_SEEN_DESC'
  | 'NAME_ASC'
  | 'NAME_DESC'
  | 'EMAIL_ASC'
  | 'EMAIL_DESC'
  | 'EMAIL_MARKETING_ASC'
  | 'EMAIL_MARKETING_DESC'
  | 'LOCATION_ASC'
  | 'LOCATION_DESC'
  | 'ORDER_COUNT_ASC'
  | 'ORDER_COUNT_DESC'
  | 'TOTAL_SPENT_ASC'
  | 'TOTAL_SPENT_DESC'
  | 'LAST_ORDER_ASC'
  | 'LAST_ORDER_DESC'
  | 'TAGS_ASC'
  | 'TAGS_DESC'
  | 'CUSTOMER_ADDED_ASC'
  | 'CUSTOMER_ADDED_DESC'
  | 'CUSTOMER_UPDATED_ASC'
  | 'CUSTOMER_UPDATED_DESC';

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
  createdAt: string;
  updatedAt: string;
  tags: string[];
};

export type CustomerListResponse = {
  customers: CustomerListItem[];
  total: number;
  page: number;
  limit: number;
  metrics: {
    totalCustomers: number;
    repeatCustomerRate: number;
    averageLifetimeSpendCents: number;
    emailSubscribers: number;
  };
};

export type CustomerExportSummary = {
  id: string;
  status: 'QUEUED' | 'PROCESSING' | 'READY' | 'FAILED' | 'EXPIRED';
  totalCount: number;
  processedCount: number;
  fileName: string;
  failureReason: string | null;
  expiresAt: string | null;
  createdAt: string;
  completedAt: string | null;
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
  returnRate: number;
  creditBalance: number;
  storeCreditBalanceCents: number;
  storeCreditCurrency: 'USD';
  storeCreditTransactionCount: number;
  lastOrderAt: string | null;
  savedDesignCount: number;
  lastDesignAt: string | null;
  emailMarketingStatus: MarketingStatus;
  smsMarketingStatus: MarketingStatus;
  preferredLocale: CustomerLocale;
  preferredLocaleSource: CustomerLocaleSource;
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
    paymentStatus: string;
    itemCount: number;
    totalCents: number;
    createdAt: string;
    items: Array<{
      productName: string;
      color: string;
      size: string;
      quantity: number;
      unitPriceCents: number;
      imageUrl: string | null;
    }>;
  }>;
  credits: Array<{
    id: string;
    entryType: string;
    amount: number;
    balanceAfter: number;
    createdAt: string;
  }>;
  tags: string[];
  timeline: Array<{
    id: string;
    eventType: string;
    body: string | null;
    metadata: Record<string, unknown>;
    actorLabel: string | null;
    createdAt: string;
  }>;
};

export type StoreCreditLedgerEntry = {
  id: string;
  entryType: 'CREDIT' | 'DEBIT';
  amountCents: number;
  balanceAfterCents: number;
  reason: 'REFUND' | 'PROMOTION' | 'CUSTOMER_SERVICE' | 'OTHER';
  note: string | null;
  actorLabel: string;
  createdAt: string;
};

export type StoreCreditLedger = {
  balanceCents: number;
  currency: 'USD';
  total: number;
  page: number;
  limit: number;
  entries: StoreCreditLedgerEntry[];
};
