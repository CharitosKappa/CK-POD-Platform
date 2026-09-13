import type { OrderExportSelection } from '@let-it-be/domain';
import type { OrderSelectionState } from './order-selection';
import type { OrderListUrlState } from './order-list-url-state';

type ExportFilterState = Pick<
  OrderListUrlState,
  | 'query'
  | 'view'
  | 'paymentStatus'
  | 'printingStatus'
  | 'fulfillmentStatus'
  | 'dateFrom'
  | 'dateTo'
  | 'minTotal'
  | 'maxTotal'
  | 'customerId'
>;

export function activeOrderExportSelection(
  state: OrderSelectionState,
  value: ExportFilterState,
): OrderExportSelection {
  if (!state.allMatchingSelected) return { type: 'IDS', orderIds: [...state.selected] };
  const minTotalCents = dollarsToCents(value.minTotal);
  const maxTotalCents = dollarsToCents(value.maxTotal);
  return {
    type: 'FILTER',
    filters: {
      view: value.view,
      ...(value.query ? { query: value.query } : {}),
      ...(value.customerId ? { customerId: value.customerId } : {}),
      ...(value.paymentStatus ? { paymentStatus: value.paymentStatus } : {}),
      ...(value.printingStatus ? { printingStatus: value.printingStatus } : {}),
      ...(value.fulfillmentStatus ? { fulfillmentStatus: value.fulfillmentStatus } : {}),
      ...(value.dateFrom ? { dateFrom: value.dateFrom } : {}),
      ...(value.dateTo ? { dateTo: value.dateTo } : {}),
      ...(minTotalCents !== undefined ? { minTotalCents } : {}),
      ...(maxTotalCents !== undefined ? { maxTotalCents } : {}),
    },
    ...(state.excluded.size ? { excludedOrderIds: [...state.excluded] } : {}),
  };
}
function dollarsToCents(value: string) {
  if (!value) return undefined;
  return Math.round(Number(value) * 100);
}
