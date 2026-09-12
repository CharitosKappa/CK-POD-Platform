import type { StoreCreditLedger } from './customer-types';

export const STORE_CREDIT_LEDGER_PAGE_SIZE = 20;

export async function loadStoreCreditLedger(
  customerId: string,
  page: number,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<StoreCreditLedger> {
  const response = await fetcher(
    `/api/admin/customers/${encodeURIComponent(customerId)}/store-credit-ledger?page=${page}&limit=${STORE_CREDIT_LEDGER_PAGE_SIZE}`,
    signal ? { signal } : {},
  );
  const payload = (await response.json()) as { ledger?: StoreCreditLedger; error?: string };
  if (!response.ok || !payload.ledger)
    throw new Error(payload.error ?? 'Could not load Store Credit activity.');
  return payload.ledger;
}
