import { describe, expect, it } from 'vitest';

import {
  cancellationStatuses,
  orderAdminActions,
  refundDestinations,
  resolveOrderActionEligibility,
  returnStates,
} from './order-admin-actions-contracts.js';

const baseInput = {
  role: 'OPERATIONS' as const,
  paymentState: 'PAID' as const,
  printingStates: ['NOT_STARTED'] as const,
  fulfillmentState: 'UNFULFILLED' as const,
  archived: false,
  refundableCents: 3999,
  returnableQuantity: 0,
  hasShippedQuantity: false,
};

describe('order admin action contracts', () => {
  it('defines the approved action and workflow state values', () => {
    expect(orderAdminActions).toEqual([
      'EDIT',
      'CANCEL',
      'REFUND',
      'RETURN',
      'ARCHIVE',
      'UNARCHIVE',
    ]);
    expect(returnStates).toEqual([
      'REQUESTED',
      'APPROVED',
      'IN_TRANSIT',
      'RECEIVED',
      'CLOSED',
      'REJECTED',
    ]);
    expect(refundDestinations).toEqual(['ORIGINAL_PAYMENT', 'STORE_CREDIT', 'LATER']);
    expect(cancellationStatuses).toEqual([
      'REQUESTED',
      'PROCESSING',
      'SUCCEEDED',
      'PARTIAL',
      'FAILED',
    ]);
  });

  it('enables operations for a paid, unfulfilled order that has not entered production', () => {
    expect(resolveOrderActionEligibility(baseInput)).toMatchObject({
      actions: { edit: true, cancel: true, refund: true, return: false, archive: false },
      editFields: {
        items: true,
        pricing: true,
        shippingAddress: true,
        contact: true,
        notesAndTags: true,
      },
    });
  });

  it('allows an owner to invoke mutating actions', () => {
    expect(resolveOrderActionEligibility({ ...baseInput, role: 'OWNER' }).actions).toMatchObject({
      edit: true,
      cancel: true,
      refund: true,
    });
  });

  it.each(['PARTIALLY_FULFILLED', 'FULFILLED', 'DELIVERED', 'CANCELLED'] as const)(
    'does not allow whole-order cancellation when fulfillment is %s',
    (fulfillmentState) => {
      expect(resolveOrderActionEligibility({ ...baseInput, fulfillmentState }).actions.cancel).toBe(
        false,
      );
    },
  );

  it.each([
    [['SUBMITTING'], false],
    [['SUBMITTED'], true],
    [['IN_PRODUCTION'], false],
    [['PRINTED'], false],
  ] as const)(
    'applies provider cancellation timing to printing groups %#',
    (printingStates, expected) => {
      expect(resolveOrderActionEligibility({ ...baseInput, printingStates }).actions.cancel).toBe(
        expected,
      );
    },
  );

  it('uses each printing group state when a mixed order includes production', () => {
    expect(
      resolveOrderActionEligibility({
        ...baseInput,
        printingStates: ['NOT_STARTED', 'IN_PRODUCTION'],
      }).actions.cancel,
    ).toBe(false);
  });

  it('disables refunds when the refundable balance is zero', () => {
    expect(resolveOrderActionEligibility({ ...baseInput, refundableCents: 0 }).actions.refund).toBe(
      false,
    );
  });

  it('enables returns when fulfilled quantity is returnable', () => {
    expect(
      resolveOrderActionEligibility({
        ...baseInput,
        fulfillmentState: 'FULFILLED',
        returnableQuantity: 2,
      }).actions.return,
    ).toBe(true);
  });

  it.each([
    ['DELIVERED', false, true],
    ['CANCELLED', false, true],
    ['FULFILLED', false, true],
    ['UNFULFILLED', false, false],
    ['DELIVERED', true, false],
  ] as const)(
    'allows archive only for an unarchived %s order (archived=%s)',
    (fulfillmentState, archived, expected) => {
      expect(
        resolveOrderActionEligibility({ ...baseInput, fulfillmentState, archived }).actions.archive,
      ).toBe(expected);
    },
  );

  it('allows unarchive only when the order is archived', () => {
    expect(resolveOrderActionEligibility({ ...baseInput, archived: true }).actions).toMatchObject({
      archive: false,
      unarchive: true,
    });
  });

  it.each(['PREPRESS', 'READ_ONLY'] as const)(
    'makes every action non-mutating for %s staff',
    (role) => {
      expect(resolveOrderActionEligibility({ ...baseInput, role })).toEqual({
        actions: {
          edit: false,
          cancel: false,
          refund: false,
          return: false,
          archive: false,
          unarchive: false,
        },
        editFields: {
          items: false,
          pricing: false,
          shippingAddress: false,
          contact: false,
          notesAndTags: false,
        },
      });
    },
  );

  it.each(['IN_PRODUCTION', 'PRINTED'] as const)(
    'locks item and pricing edits after %s',
    (printingState) => {
      expect(
        resolveOrderActionEligibility({ ...baseInput, printingStates: [printingState] }).editFields,
      ).toMatchObject({ items: false, pricing: false });
    },
  );

  it('locks shipping-address edits after any shipment', () => {
    expect(
      resolveOrderActionEligibility({ ...baseInput, hasShippedQuantity: true }).editFields
        .shippingAddress,
    ).toBe(false);
  });
});
