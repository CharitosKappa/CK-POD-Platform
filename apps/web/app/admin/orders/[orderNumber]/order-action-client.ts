import { adminApiFetch } from '../../../../lib/admin-api';
import type { OrderDetail } from './order-detail-types';

export type OrderActionName = keyof OrderDetail['eligibility']['actions'] | 'recoverCancellation';
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

type JournalStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type ActionMethod = 'POST' | 'DELETE';
interface ActionJournal {
  version: 1;
  path: string;
  method: ActionMethod;
  key: string;
  fingerprint: string;
  outcome: OrderActionOutcome;
}
const uncertainOutcome: OrderActionOutcome = {
  kind: 'uncertain',
  message:
    'A previous request needs confirmation. Check its status using the recorded request before starting another action.',
};
function journalKey(path: string, method: ActionMethod) {
  return `admin-order-action:v1:${method}:${path}`;
}
function journalStorage(provided?: JournalStorage): JournalStorage {
  return provided ?? globalThis.sessionStorage;
}
function readJournal(
  path: string,
  method: ActionMethod,
  provided?: JournalStorage,
): ActionJournal | undefined {
  const raw = journalStorage(provided).getItem(journalKey(path, method));
  if (!raw) return undefined;
  const entry = JSON.parse(raw) as ActionJournal;
  if (
    entry.version !== 1 ||
    entry.path !== path ||
    entry.method !== method ||
    typeof entry.key !== 'string' ||
    entry.key.length < 12 ||
    entry.key.length > 120 ||
    typeof entry.fingerprint !== 'string' ||
    !entry.outcome ||
    !['pending', 'uncertain', 'incomplete', 'success', 'error'].includes(entry.outcome.kind)
  )
    throw new Error('Invalid action journal.');
  const body = JSON.parse(entry.fingerprint) as unknown;
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new Error('Invalid recorded request.');
  return entry;
}
export function hasOrderActionJournal(path: string, method: ActionMethod = 'POST'): boolean {
  try {
    return journalStorage().getItem(journalKey(path, method)) !== null;
  } catch {
    return false;
  }
}
export function orderActionPath(apiBase: string, orderNumber: string, action: OrderActionName) {
  const resources = {
    edit: 'edits',
    cancel: 'cancellations',
    recoverCancellation: 'cancellations',
    refund: 'refunds',
    return: 'returns',
    archive: 'archive',
    unarchive: 'archive',
  };
  return `${apiBase}/${encodeURIComponent(orderNumber)}/${resources[action]}`;
}
export function pendingOrderActions(apiBase: string, orderNumber: string): OrderActionName[] {
  return (['edit', 'cancel', 'refund', 'return', 'archive', 'unarchive'] as const).filter(
    (action) =>
      hasOrderActionJournal(
        orderActionPath(apiBase, orderNumber, action),
        action === 'unarchive' ? 'DELETE' : 'POST',
      ),
  );
}

function journalOutcome(outcome: OrderActionOutcome): OrderActionOutcome {
  const result = outcome.result
    ? Object.fromEntries(
        [
          'status',
          'cancellationId',
          'refundId',
          'amountCents',
          'succeededAmountCents',
          'failedAmountCents',
          'destination',
          'refund',
        ]
          .filter((key) => outcome.result![key] !== undefined)
          .map((key) => [key, outcome.result![key]]),
      )
    : undefined;
  return {
    kind: outcome.kind,
    message: outcome.message,
    ...(outcome.status ? { status: outcome.status } : {}),
    ...(outcome.code ? { code: outcome.code } : {}),
    ...(result ? { result } : {}),
  };
}
function terminalActionOutcome(outcome: OrderActionOutcome): boolean {
  const refund = outcome.result?.refund as { status?: string } | undefined;
  return (
    outcome.kind === 'success' ||
    (outcome.kind === 'error' && [400, 403, 404, 409].includes(outcome.status ?? 0)) ||
    (outcome.result?.status === 'SUCCEEDED' &&
      (refund?.status === 'FAILED' || refund?.status === 'PARTIAL')) ||
    (outcome.result?.status === 'PARTIAL' &&
      typeof outcome.result.refundId === 'string' &&
      !outcome.result.cancellationId) ||
    (outcome.result?.status === 'FAILED' &&
      typeof outcome.result.refundId === 'string' &&
      !outcome.result.cancellationId)
  );
}

/** Persist BEFORE dispatch. Dismissal/reload cannot turn an uncertain mutation into a new request. */
export function createOrderActionSession(
  path: string,
  options: {
    method?: 'POST' | 'DELETE';
    onSaved?: () => Promise<void> | void;
    storage?: JournalStorage;
  } = {},
) {
  const method = options.method ?? 'POST';
  let attempt: { fingerprint: string; key: string } | undefined;
  let inFlight: Promise<OrderActionOutcome> | undefined;
  let last: OrderActionOutcome | undefined;
  let journal: ActionJournal | undefined;
  let journalReadFailed = false;
  try {
    journal = readJournal(path, method, options.storage);
    if (journal) {
      attempt = journal;
      last = journal.outcome;
    }
  } catch {
    journalReadFailed = true;
  }
  const session = {
    snapshot(): { body: Record<string, unknown>; outcome: OrderActionOutcome } | undefined {
      return journal
        ? {
            body: JSON.parse(journal.fingerprint) as Record<string, unknown>,
            outcome: last ?? journal.outcome,
          }
        : undefined;
    },
    resume(): Promise<OrderActionOutcome> {
      return attempt
        ? session.submit(JSON.parse(attempt.fingerprint), true)
        : Promise.resolve({
            kind: 'error',
            code: 'ACTION_JOURNAL_UNAVAILABLE',
            message:
              'The recorded request could not be recovered. Review the order timeline before attempting another action.',
          });
    },
    submit(body: unknown, preserveIdentity = false): Promise<OrderActionOutcome> {
      if (inFlight) return inFlight;
      if (last?.kind === 'success') return Promise.resolve(last);
      if (journalReadFailed)
        return Promise.resolve({
          kind: 'error',
          code: 'ACTION_JOURNAL_UNAVAILABLE',
          message:
            'Secure request recovery is unavailable in this tab. No new action was sent. Restore browser storage or review the order timeline.',
        });
      const fingerprint = JSON.stringify(body);
      // Explicit retry is a new staff action on the SAME cancellation, never a new
      // cancellation/refund. Pending or transport-uncertain work always keeps its key.
      if (
        !preserveIdentity &&
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
      const previousJournal = journal;
      const pending: ActionJournal = {
        version: 1,
        path,
        method,
        key: request.key,
        fingerprint,
        outcome: uncertainOutcome,
      };
      try {
        journalStorage(options.storage).setItem(journalKey(path, method), JSON.stringify(pending));
        journal = pending;
      } catch {
        return Promise.resolve({
          kind: previousJournal ? 'uncertain' : 'error',
          code: 'ACTION_JOURNAL_UNAVAILABLE',
          message:
            'The request could not be saved for safe recovery. No action was sent. Restore browser storage before continuing.',
        });
      }
      inFlight = (async () => {
        last = await submitOrderAction(path, body, {
          idempotencyKey: request.key,
          ...(options.method ? { method: options.method } : {}),
        });
        // A rejected check is not proof that an earlier ambiguous request did not
        // commit. Keep its original identity until a durable result confirms it.
        if (last.kind === 'error' && (previousJournal || last.code === 'ORDER_PROVIDER_FAILURE')) {
          last = {
            ...last,
            kind: 'uncertain',
            message: `${last.message} The recorded request is still unconfirmed; check it again before starting another action.`,
          };
        }
        journal = { ...pending, outcome: journalOutcome(last) };
        try {
          journalStorage(options.storage).setItem(
            journalKey(path, method),
            JSON.stringify(journal),
          );
          if (terminalActionOutcome(last)) {
            journalStorage(options.storage).removeItem(journalKey(path, method));
            journal = undefined;
          }
        } catch {
          /* The pre-dispatch journal still guarantees replay with the same key. */
        }
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
  return session;
}
