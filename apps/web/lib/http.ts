import { NextResponse } from 'next/server';

import {
  CommerceAccessError,
  CommerceValidationError,
  AdminCommerceValidationError,
  AccountValidationError,
  GenerationAccessError,
  GenerationCreditError,
  InvalidEmailCodeError,
  FulfillmentAccessError,
  OrderOperationsAccessError,
  OrderTransitionError,
  OrderDetailAccessError,
  OrderDetailDataError,
  CustomerOperationsAccessError,
  CustomerOperationsConflictError,
  CustomerOperationsValidationError,
  CustomerExportAccessError,
  CustomerExportValidationError,
  OrderExportAccessError,
  OrderExportValidationError,
  StaffAuthenticationError,
  StoreCreditAccessError,
  StoreCreditConflictError,
  StoreCreditValidationError,
  ProjectConflictError,
  ProjectValidationError,
  ReferenceAssetValidationError,
  OrderAdminActionAccessError,
  OrderAdminActionValidationError,
  OrderAdminActionNotFoundError,
  OrderAdminActionConflictError,
  FulfillmentIntegrationError,
  EditedOrderBalanceAttributionError,
} from '@let-it-be/domain';

import { ApiRateLimitError } from './security';

export function handleRouteError(error: unknown): NextResponse {
  if (error instanceof OrderAdminActionAccessError) {
    return NextResponse.json(
      { error: 'You do not have access to order actions.', code: 'ORDER_ACTION_FORBIDDEN' },
      { status: 403 },
    );
  }
  if (error instanceof OrderAdminActionValidationError) {
    return NextResponse.json(
      { error: error.message, code: 'INVALID_ORDER_ACTION' },
      { status: 400 },
    );
  }
  if (error instanceof OrderAdminActionNotFoundError) {
    return NextResponse.json(
      { error: 'Order or action not found.', code: 'ORDER_ACTION_NOT_FOUND' },
      { status: 404 },
    );
  }
  if (error instanceof OrderAdminActionConflictError) {
    return NextResponse.json(
      {
        error: error.message,
        code: 'ORDER_ACTION_CONFLICT',
        ...(error.eligibility ? { eligibility: error.eligibility } : {}),
      },
      { status: 409 },
    );
  }
  if (error instanceof ApiRateLimitError) {
    return NextResponse.json(
      { error: error.message },
      { status: 429, headers: { 'retry-after': '60' } },
    );
  }
  if (error instanceof Error && error.message === 'Authentication is required.') {
    return NextResponse.json({ error: 'Authentication is required.' }, { status: 401 });
  }
  if (error instanceof StaffAuthenticationError) {
    return NextResponse.json(
      { error: error.message },
      { status: /valid email/i.test(error.message) ? 400 : 401 },
    );
  }
  if (error instanceof StoreCreditAccessError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  if (error instanceof StoreCreditConflictError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof StoreCreditValidationError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.message === 'Customer not found.' ? 404 : 400 },
    );
  }
  if (error instanceof CustomerOperationsAccessError) {
    return NextResponse.json(
      { error: 'You do not have access to customer operations.' },
      { status: 403 },
    );
  }
  if (error instanceof CustomerExportAccessError) {
    return NextResponse.json(
      { error: 'You do not have access to customer exports.' },
      { status: 403 },
    );
  }
  if (error instanceof CustomerExportValidationError) {
    return NextResponse.json(
      { error: error.message },
      { status: /not found/i.test(error.message) ? 404 : 400 },
    );
  }
  if (error instanceof OrderExportAccessError) {
    return NextResponse.json(
      { error: 'You do not have access to order exports.' },
      { status: 403 },
    );
  }
  if (error instanceof OrderExportValidationError) {
    return NextResponse.json(
      { error: error.message },
      { status: /not found/i.test(error.message) ? 404 : 400 },
    );
  }
  if (error instanceof CustomerOperationsConflictError) {
    return NextResponse.json(
      { error: error.message, customerId: error.customerId },
      { status: 409 },
    );
  }
  if (error instanceof FulfillmentAccessError || error instanceof OrderOperationsAccessError) {
    return NextResponse.json(
      { error: 'You do not have access to fulfillment operations.' },
      { status: 403 },
    );
  }
  if (error instanceof OrderDetailAccessError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  if (error instanceof OrderDetailDataError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.message === 'Order not found.' ? 404 : 400 },
    );
  }
  if (error instanceof OrderTransitionError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof CommerceAccessError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof CommerceValidationError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof AdminCommerceValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof AccountValidationError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof CustomerOperationsValidationError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.message === 'Customer not found.' ? 404 : 400 },
    );
  }
  if (error instanceof ProjectConflictError) {
    return NextResponse.json({ error: error.message, code: 'STALE_PROJECT' }, { status: 409 });
  }
  if (error instanceof ProjectValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof ReferenceAssetValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof GenerationAccessError) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }
  if (error instanceof GenerationCreditError) {
    return NextResponse.json(
      { error: 'No design credits are currently available.', code: 'NO_GENERATION_CREDIT' },
      { status: 409 },
    );
  }
  if (error instanceof InvalidEmailCodeError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof Error && error.message === 'Project not found.') {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }
  if (error instanceof Error && error.message === 'Invalid email or password.') {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
  if (
    error instanceof Error &&
    /valid email|unavailable|Describe your idea|Reference assets|reference assets/.test(
      error.message,
    )
  ) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ error: 'Unable to complete this request.' }, { status: 500 });
}

/** Provider errors are normalized only for the staff action API surface. */
export function handleOrderActionRouteError(error: unknown): NextResponse {
  if (error instanceof CommerceAccessError) {
    return NextResponse.json(
      {
        error:
          'The selected items cannot currently be supplied to this destination. Refresh the order and review its items and shipping address.',
        code: 'ORDER_ACTION_CONFLICT',
      },
      { status: 409 },
    );
  }
  if (error instanceof FulfillmentIntegrationError) {
    return NextResponse.json(
      {
        error:
          'The printing provider could not complete the action. Review its status before retrying.',
        code: 'ORDER_PROVIDER_FAILURE',
        providerCode: error.code,
        retryable: error.retryable,
      },
      { status: 409 },
    );
  }
  if (error instanceof Error && error.message === 'Tax calculation could not be completed.') {
    return NextResponse.json(
      {
        error: 'Tax calculation could not be completed. The order was not changed.',
        code: 'ORDER_PROVIDER_FAILURE',
      },
      { status: 409 },
    );
  }
  if (
    error instanceof OrderAdminActionAccessError ||
    error instanceof OrderAdminActionValidationError ||
    error instanceof OrderAdminActionNotFoundError ||
    error instanceof OrderAdminActionConflictError ||
    error instanceof OrderDetailAccessError ||
    error instanceof OrderDetailDataError ||
    error instanceof OrderOperationsAccessError ||
    error instanceof OrderTransitionError ||
    error instanceof StoreCreditAccessError ||
    error instanceof StoreCreditValidationError ||
    error instanceof StoreCreditConflictError ||
    error instanceof CommerceValidationError ||
    error instanceof StaffAuthenticationError ||
    error instanceof ApiRateLimitError
  )
    return handleRouteError(error);
  return NextResponse.json({ error: 'Unable to complete this request.' }, { status: 500 });
}

/** The shared refund service retains legacy errors for its existing CX callers. */
export function handleOrderRefundRouteError(error: unknown): NextResponse {
  if (error instanceof Error && error.message === 'Stripe could not process the refund.') {
    return NextResponse.json(
      {
        error: 'The payment provider could not complete the refund.',
        code: 'ORDER_PROVIDER_FAILURE',
      },
      { status: 409 },
    );
  }
  const refundConflicts = [
    'Order payment is unavailable.',
    'Refund exceeds the captured payment.',
    'Refund idempotency key belongs to another order.',
    'Refund reservation is unavailable.',
    'Store Credit refunds require a USD order payment.',
    'Order customer is unavailable.',
  ];
  if (
    error instanceof EditedOrderBalanceAttributionError ||
    (error instanceof Error && refundConflicts.includes(error.message))
  ) {
    return NextResponse.json(
      {
        error:
          'The refund is not available for the current order balance or state. Refresh the order before continuing.',
        code: 'ORDER_ACTION_CONFLICT',
      },
      { status: 409 },
    );
  }
  return handleOrderActionRouteError(error);
}
