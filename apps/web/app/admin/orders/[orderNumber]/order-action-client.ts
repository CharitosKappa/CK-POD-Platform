import { adminApiFetch } from '../../../../lib/admin-api';
import type { OrderDetail } from './order-detail-types';

export type OrderActionName = keyof OrderDetail['eligibility']['actions'];
export interface OrderActionOutcome {
  kind: 'success' | 'error' | 'pending' | 'incomplete' | 'uncertain';
  message: string;
  status?: number;
  code?: string;
  result?: Record<string, unknown>;
  current?: Partial<
    Pick<
      OrderDetail,
      'eligibility' | 'returnableItems' | 'returns' | 'refundableCents' | 'amountDueCents'
    >
  >;
  refreshFailed?: boolean;
}

/** Form inputs are decimal strings; the API only receives integer minor units. */
export function centsFromInput(value: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim()))
    throw new Error('Enter an amount with up to two decimal places.');
  const [whole, fraction = ''] = value.trim().split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents > 2_147_483_647)
    throw new Error('Enter a smaller amount.');
  return cents;
}

export function formatOrderMoney(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

export async function submitOrderAction(
  path: string,
  body: unknown,
  options: { idempotencyKey: string; method?: 'POST' | 'DELETE' },
): Promise<OrderActionOutcome> {
  try {
    const response = await adminApiFetch(path, {
      method: options.method ?? 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': options.idempotencyKey },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as Record<string, unknown>;
    const result =
      payload.result && typeof payload.result === 'object'
        ? (payload.result as Record<string, unknown>)
        : undefined;
    const current = Object.fromEntries(
      ['eligibility', 'returnableItems', 'returns', 'refundableCents', 'amountDueCents']
        .filter((key) => payload[key] !== undefined)
        .map((key) => [key, payload[key]]),
    );
    const base = {
      status: response.status,
      ...(result ? { result } : {}),
      current,
      ...(typeof payload.code === 'string' ? { code: payload.code } : {}),
    };
    const refund = result?.refund as { status?: string } | undefined;
    if (
      result?.status === 'SUCCEEDED' &&
      refund &&
      !['SUCCEEDED', 'LATER'].includes(refund.status ?? '')
    ) {
      return {
        ...base,
        kind: refund.status === 'PENDING' ? 'pending' : 'incomplete',
        message: `Order cancelled. Its refund is ${refund.status === 'PENDING' ? 'pending' : 'not completed'}; review settlement before taking another monetary action.`,
      };
    }
    if (response.status === 202)
      return {
        ...base,
        kind: 'pending',
        message:
          'The request is recorded and still processing. Check its status before submitting another action.',
      };
    if (!response.ok)
      return {
        ...base,
        kind: result ? 'incomplete' : response.status >= 500 ? 'uncertain' : 'error',
        message:
          typeof payload.error === 'string'
            ? payload.error
            : response.status === 409
              ? 'The order changed. Review the current details before trying again.'
              : 'Could not complete this action.',
      };
    if (!result)
      return {
        ...base,
        kind: 'uncertain',
        message: 'The server did not confirm the outcome. Check status using this same request.',
      };
    return { ...base, kind: 'success', message: 'Order updated.' };
  } catch {
    return {
      kind: 'uncertain',
      message:
        'The connection was interrupted. The action may have been recorded. Check status using this same request.',
    };
  }
}

/** One modal owns one session. Uncertain requests can only replay their original body/key. */
export function createOrderActionSession(
  path: string,
  options: {
    method?: 'POST' | 'DELETE';
    onSaved?: () => Promise<void> | void;
  } = {},
) {
  let attempt: { fingerprint: string; key: string } | undefined;
  let inFlight: Promise<OrderActionOutcome> | undefined;
  let last: OrderActionOutcome | undefined;
  return {
    submit(body: unknown): Promise<OrderActionOutcome> {
      if (inFlight) return inFlight;
      if (last?.kind === 'success') return Promise.resolve(last);
      const fingerprint = JSON.stringify(body);
      // Explicit retry is a new staff action on the SAME cancellation, never a new
      // cancellation/refund. Pending or transport-uncertain work always keeps its key.
      if (
        path.endsWith('/cancellations') &&
        last?.kind === 'incomplete' &&
        ['PARTIAL', 'FAILED'].includes(String(last.result?.status)) &&
        body &&
        typeof body === 'object' &&
        Object.keys(body).length === 1 &&
        'cancellationId' in body &&
        body.cancellationId === last.result?.cancellationId
      )
        attempt = undefined;
      if (attempt && fingerprint !== attempt.fingerprint && last && last.kind !== 'error') {
        return Promise.resolve({
          ...last,
          message:
            'This request already has a recorded or uncertain outcome. Check its status before changing the form.',
        });
      }
      if (!attempt || fingerprint !== attempt.fingerprint)
        attempt = { fingerprint, key: crypto.randomUUID() };
      const request = attempt;
      inFlight = (async () => {
        last = await submitOrderAction(path, body, {
          idempotencyKey: request.key,
          ...(options.method ? { method: options.method } : {}),
        });
        if (last.kind === 'success') {
          try {
            await options.onSaved?.();
          } catch {
            last = {
              ...last,
              refreshFailed: true,
              message: 'The action was saved. Refresh the page to see the latest order.',
            };
          }
        }
        return last;
      })().finally(() => {
        inFlight = undefined;
      });
      return inFlight;
    },
  };
}
