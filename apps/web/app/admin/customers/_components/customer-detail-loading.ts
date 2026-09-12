import type { CustomerDetail } from './customer-types';

export async function loadCustomerDetail({
  customerId,
  signal,
  setCustomer,
  setError,
  setLoading,
}: {
  customerId: string;
  signal?: AbortSignal;
  setCustomer: (customer: CustomerDetail) => void;
  setError: (error: string | undefined) => void;
  setLoading: (loading: boolean) => void;
}): Promise<boolean> {
  setLoading(true);
  setError(undefined);
  try {
    const response = await fetch(`/api/admin/customers/${encodeURIComponent(customerId)}`, {
      ...(signal ? { signal } : {}),
    });
    const payload = (await response.json()) as { customer?: CustomerDetail; error?: string };
    if (!response.ok || !payload.customer)
      throw new Error(payload.error ?? 'Could not load customer.');
    setCustomer(payload.customer);
    return true;
  } catch (reason) {
    if (reason instanceof DOMException && reason.name === 'AbortError') return false;
    setError(reason instanceof Error ? reason.message : 'Could not load customer.');
    return false;
  } finally {
    if (!signal?.aborted) setLoading(false);
  }
}

export async function refreshCustomerAfterSave(
  message: string,
  load: () => Promise<boolean>,
  setFeedback: (message: string | undefined) => void,
) {
  setFeedback(undefined);
  if (!(await load()))
    throw new Error(
      'The update was saved, but customer details could not be refreshed. Please retry.',
    );
  setFeedback(message);
}
