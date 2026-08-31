import { NextResponse } from 'next/server';

import {
  CommerceAccessError,
  CommerceValidationError,
  GenerationAccessError,
  GenerationCreditError,
  FulfillmentAccessError,
  OrderOperationsAccessError,
  OrderTransitionError,
  ProjectConflictError,
} from '@let-it-be/domain';

import { ApiRateLimitError } from './security';

export function handleRouteError(error: unknown): NextResponse {
  if (error instanceof ApiRateLimitError) {
    return NextResponse.json(
      { error: error.message },
      { status: 429, headers: { 'retry-after': '60' } },
    );
  }
  if (error instanceof Error && error.message === 'Authentication is required.') {
    return NextResponse.json({ error: 'Authentication is required.' }, { status: 401 });
  }
  if (error instanceof FulfillmentAccessError || error instanceof OrderOperationsAccessError) {
    return NextResponse.json(
      { error: 'You do not have access to fulfillment operations.' },
      { status: 403 },
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
  if (error instanceof ProjectConflictError) {
    return NextResponse.json({ error: error.message, code: 'STALE_PROJECT' }, { status: 409 });
  }
  if (error instanceof GenerationAccessError) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }
  if (error instanceof GenerationCreditError) {
    return NextResponse.json(
      { error: error.message, code: 'NO_GENERATION_CREDIT' },
      { status: 409 },
    );
  }
  if (error instanceof Error && error.message === 'Project not found.') {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }
  if (error instanceof Error && error.message === 'Invalid email or password.') {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
  if (
    error instanceof Error &&
    /valid email|password|unavailable|Describe your idea|Reference assets|reference assets/.test(
      error.message,
    )
  ) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ error: 'Unable to complete this request.' }, { status: 500 });
}
