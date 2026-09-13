import { printingGroupStates, type OrderPrintingState } from './order-detail-contracts';

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
  ...printingGroupStates,
  'PARTIALLY_IN_PRODUCTION',
  'PARTIALLY_PRINTED',
  'NEEDS_ATTENTION',
] as const satisfies readonly OrderPrintingState[];
export type AdminPrintingStatus = (typeof adminPrintingStatuses)[number];

export const adminFulfillmentStatuses = [
  'UNFULFILLED',
  'PARTIALLY_FULFILLED',
  'FULFILLED',
  'DELIVERED',
  'CANCELLED',
] as const;
export type AdminFulfillmentStatus = (typeof adminFulfillmentStatuses)[number];

export type AdminOrderListOptions = Readonly<{
  page?: number;
  limit?: number;
  query?: string;
  view?: AdminOrderView;
  sort?: AdminOrderSort;
  customerId?: string;
  paymentStatus?: AdminPaymentStatus;
  printingStatus?: AdminPrintingStatus;
  fulfillmentStatus?: AdminFulfillmentStatus;
  dateFrom?: string;
  dateTo?: string;
  minTotalCents?: number;
  maxTotalCents?: number;
}>;
