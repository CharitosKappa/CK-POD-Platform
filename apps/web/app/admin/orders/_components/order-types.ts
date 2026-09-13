// Keep the browser bundle independent from the server-only domain entry point.
// These wire values mirror the API contract and are deliberately colocated with
// the client types so importing this module cannot pull queue/worker dependencies.
export const adminOrderViews = [
  'ALL',
  'OPEN',
  'IN_PROGRESS',
  'COMPLETED',
  'ATTENTION',
  'CANCELLED',
] as const;
export type AdminOrderView = (typeof adminOrderViews)[number];

export const adminOrderSorts = [
  'ORDER_NUMBER_ASC',
  'ORDER_NUMBER_DESC',
  'DATE_ASC',
  'DATE_DESC',
  'CUSTOMER_ASC',
  'CUSTOMER_DESC',
  'ITEMS_ASC',
  'ITEMS_DESC',
  'PAYMENT_ASC',
  'PAYMENT_DESC',
  'FULFILLMENT_ASC',
  'FULFILLMENT_DESC',
  'TOTAL_ASC',
  'TOTAL_DESC',
] as const;
export type AdminOrderSort = (typeof adminOrderSorts)[number];

export const adminPaymentStatuses = ['PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED'] as const;
export type AdminPaymentStatus = (typeof adminPaymentStatuses)[number];

export const adminPrintingStatuses = [
  'NOT_STARTED',
  'PREPRESS_REVIEW',
  'COMPLIANCE_REVIEW',
  'READY_FOR_PRODUCTION',
  'SUBMITTING',
  'SUBMITTED',
  'IN_PRODUCTION',
  'PRINTED',
  'ON_HOLD',
  'FAILED',
  'CANCELLED',
  'PARTIALLY_IN_PRODUCTION',
  'PARTIALLY_PRINTED',
  'NEEDS_ATTENTION',
] as const;
export type AdminPrintingStatus = (typeof adminPrintingStatuses)[number];

export const adminFulfillmentStatuses = [
  'UNFULFILLED',
  'PARTIALLY_FULFILLED',
  'FULFILLED',
  'DELIVERED',
  'CANCELLED',
] as const;
export type AdminFulfillmentStatus = (typeof adminFulfillmentStatuses)[number];

export type AdminOrderListItem = {
  id: string;
  orderNumber: string;
  status: string;
  customerEmail: string;
  customerName: string;
  productName: string;
  itemCount: number;
  totalCents: number;
  paymentStatus: string;
  printingStatus: string;
  fulfillmentStatus: string;
  currency: string;
  createdAt: string;
};

export type AdminOrderListResponse = {
  orders: AdminOrderListItem[];
  total: number;
  page: number;
  limit: number;
};

export type OrderExportSummary = {
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
