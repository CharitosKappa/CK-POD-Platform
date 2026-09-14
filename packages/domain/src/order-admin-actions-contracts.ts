import type {
  FulfillmentState,
  PaymentState,
  PrintingGroupState,
} from './order-detail-contracts.js';
import type { StaffRole } from './staff-identity.js';

export const orderAdminActions = [
  'EDIT',
  'CANCEL',
  'REFUND',
  'RETURN',
  'ARCHIVE',
  'UNARCHIVE',
] as const;
export const returnStates = [
  'REQUESTED',
  'APPROVED',
  'IN_TRANSIT',
  'RECEIVED',
  'CLOSED',
  'REJECTED',
] as const;
export const refundDestinations = ['ORIGINAL_PAYMENT', 'STORE_CREDIT', 'LATER'] as const;
export const cancellationStatuses = [
  'REQUESTED',
  'PROCESSING',
  'SUCCEEDED',
  'PARTIAL',
  'FAILED',
] as const;

export type OrderAdminAction = (typeof orderAdminActions)[number];
export type ReturnState = (typeof returnStates)[number];
export type RefundDestination = (typeof refundDestinations)[number];
export type CancellationStatus = (typeof cancellationStatuses)[number];

const returnTransitionMap: Record<ReturnState, readonly ReturnState[]> = {
  REQUESTED: ['APPROVED', 'REJECTED'],
  APPROVED: ['IN_TRANSIT', 'REJECTED'],
  IN_TRANSIT: ['RECEIVED'],
  RECEIVED: ['CLOSED'],
  CLOSED: [],
  REJECTED: [],
};

/** One shared transition authority for the write service and read-model UI capabilities. */
export function allowedReturnTransitions(state: ReturnState): readonly ReturnState[] {
  return returnTransitionMap[state];
}

export interface OrderActionEligibilityInput {
  role: StaffRole;
  paymentState: PaymentState;
  printingStates: readonly PrintingGroupState[];
  fulfillmentState: FulfillmentState;
  archived: boolean;
  refundableCents: number;
  returnableQuantity: number;
  hasShippedQuantity: boolean;
}

export interface OrderEditFieldEligibility {
  items: boolean;
  pricing: boolean;
  shippingAddress: boolean;
  contact: boolean;
  notesAndTags: boolean;
}

export interface OrderActionEligibility {
  actions: Record<Lowercase<OrderAdminAction>, boolean>;
  editFields: OrderEditFieldEligibility;
}

export function resolveOrderActionEligibility(
  input: OrderActionEligibilityInput,
): OrderActionEligibility {
  const canMutate = input.role === 'OWNER' || input.role === 'OPERATIONS';
  const productionLocked = input.printingStates.some((state) =>
    ['IN_PRODUCTION', 'PRINTED'].includes(state),
  );
  const cancellationLocked = input.printingStates.some((state) =>
    ['SUBMITTING', 'IN_PRODUCTION', 'PRINTED'].includes(state),
  );
  const fulfilled = ['FULFILLED', 'DELIVERED'].includes(input.fulfillmentState);
  const fullyUnfulfilled = input.fulfillmentState === 'UNFULFILLED';

  return {
    actions: {
      edit: canMutate,
      cancel: canMutate && fullyUnfulfilled && !cancellationLocked,
      refund: canMutate && input.refundableCents > 0,
      return: canMutate && input.returnableQuantity > 0,
      archive:
        canMutate && !input.archived && (fulfilled || input.fulfillmentState === 'CANCELLED'),
      unarchive: canMutate && input.archived,
    },
    editFields: {
      items: canMutate && !productionLocked,
      pricing: canMutate && !productionLocked,
      shippingAddress: canMutate && !input.hasShippedQuantity,
      contact: canMutate,
      notesAndTags: canMutate,
    },
  };
}
