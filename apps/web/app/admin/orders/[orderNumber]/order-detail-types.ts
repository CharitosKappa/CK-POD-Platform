export type LayerTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export interface OrderAddress {
  recipientName: string;
  line1: string;
  line2: string | null;
  city: string;
  stateCode: string;
  postalCode: string;
  countryCode: string;
}

export interface OrderItem {
  id: string;
  productName: string;
  color: string;
  size: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  sku: string;
  projectId: string;
  projectVersionId: string;
  mockupId: string;
}

export interface OrderShipment {
  id: string;
  carrier: string | null;
  service: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  state: string;
  shippedAt: string | null;
  deliveredAt: string | null;
}

export interface OrderGroup {
  id: string;
  providerName: string;
  externalOrderId: string | null;
  printingState: string;
  fulfillmentState: string;
  itemCount: number;
  shippingMethod: string | null;
  attentionRequired: boolean;
  lastProviderSyncAt: string | null;
  items: OrderItem[];
  shipments: OrderShipment[];
}

export interface OrderNote {
  id: string;
  body: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrderDetail {
  orderNumber: string;
  createdAt: string;
  salesChannel: string;
  paymentState: string;
  printingState: string;
  fulfillmentState: string;
  customer: {
    id: string | null;
    name: string;
    email: string;
    phone: string | null;
    orderCount: number;
  };
  shippingAddress: OrderAddress;
  billingAddress: OrderAddress;
  billingMatchesShipping: boolean;
  financials: {
    subtotalCents: number;
    discountCents: number;
    shippingCents: number;
    taxCents: number;
    totalCents: number;
    paidCents: number;
    refundedCents: number;
    currency: 'USD';
  };
  groups: OrderGroup[];
  notes: OrderNote[];
  tags: string[];
}

export interface PrintingGroupDetail {
  id: string;
  orderNumber: string;
  providerName: string;
  externalOrderId: string | null;
  printingState: string;
  fulfillmentState: string;
  createdAt: string;
  submittedAt: string | null;
  lastProviderSyncAt: string | null;
  stale: boolean;
  readiness: { ready: boolean | null; blockers: string[]; evaluatedAt: string | null };
  economics: {
    retailRevenueCents: number;
    productionCostCents: number | null;
    providerShippingCostCents: number | null;
    providerFeesCents: number | null;
    grossMarginCents: number | null;
    grossMarginBasisPoints: number | null;
  };
  items: Array<
    OrderItem & { prepressStatus: string; derivativeReady: boolean; proofApproved: boolean }
  >;
  shipments: OrderShipment[];
  events: Array<{
    id: string;
    fromState: string | null;
    toState: string;
    source: string;
    disposition: string;
    createdAt: string;
  }>;
  permittedActions: string[];
}

export interface OrderTimelineEvent {
  id: string;
  type: string;
  occurredAt: string;
  source: string;
  actorName: string | null;
  description: string;
  details: Record<string, string | number | boolean | null>;
}

export interface OrderTimelinePage {
  events: OrderTimelineEvent[];
  nextCursor: string | null;
}
