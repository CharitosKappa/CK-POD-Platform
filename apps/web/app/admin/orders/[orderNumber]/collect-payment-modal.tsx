'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

import { adminApiFetch } from '../../../../lib/admin-api';

import { OrderActionModal, type OrderActionModalProps } from './order-action-modal';

export type CollectPaymentAttempt = {
  paymentAttemptId: string;
  orderRevisionId: string;
  status: 'PREPARING' | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  amountCents: number;
  currency: 'USD';
  clientSecret: string | null;
  duplicate: boolean;
  developmentSimulationAvailable: boolean;
};

type PaymentFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function createCollectPaymentClient(path: string, fetcher: PaymentFetcher = adminApiFetch) {
  let preparation: Promise<CollectPaymentAttempt> | undefined;
  const request = async (resource: string, init: RequestInit) => {
    const response = await fetcher(resource, init);
    const payload = (await response.json()) as {
      result?: CollectPaymentAttempt | null | { status?: string };
      error?: string;
    };
    if (!response.ok) throw new Error(payload.error ?? 'Could not update the payment.');
    return payload.result ?? null;
  };
  return {
    read: () =>
      request(path, { method: 'GET', cache: 'no-store' }) as Promise<CollectPaymentAttempt | null>,
    prepare: () => {
      if (preparation) return preparation;
      preparation = request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: '{}',
      }) as Promise<CollectPaymentAttempt>;
      return preparation.finally(() => {
        preparation = undefined;
      });
    },
    simulate: () => request(`${path}/fake-confirm`, { method: 'POST' }),
  };
}

export function CollectPaymentModal(props: OrderActionModalProps) {
  const path = `${props.apiBase}/${encodeURIComponent(props.order.orderNumber)}/payments`;
  const client = useRef<ReturnType<typeof createCollectPaymentClient> | undefined>(undefined);
  client.current ??= createCollectPaymentClient(path);
  const callbacks = useRef(props);
  callbacks.current = props;
  const [attempt, setAttempt] = useState<CollectPaymentAttempt | null>();
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string>();
  const savedAttempt = useRef<string | undefined>(undefined);

  const accept = useCallback(async (next: CollectPaymentAttempt | null) => {
    setAttempt(next);
    if (next?.status === 'SUCCEEDED' && savedAttempt.current !== next.paymentAttemptId) {
      savedAttempt.current = next.paymentAttemptId;
      await callbacks.current.onSaved();
    }
    return next;
  }, []);

  const read = useCallback(async () => {
    setError(undefined);
    try {
      return await accept(await client.current!.read());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not check the payment.');
      return null;
    }
  }, [accept]);

  useEffect(() => {
    void read();
  }, [read]);

  async function prepare() {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await accept(await client.current!.prepare());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not prepare the payment.');
    } finally {
      setBusy(false);
    }
  }

  async function simulate() {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await client.current!.simulate();
      await read();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not complete the test payment.');
    } finally {
      setBusy(false);
    }
  }

  async function waitForWebhook() {
    if (waiting) return;
    setWaiting(true);
    setError(undefined);
    for (let check = 0; check < 8; check += 1) {
      const current = await read();
      if (current?.status === 'SUCCEEDED' || current?.status === 'CANCELLED') break;
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
    }
    setWaiting(false);
  }

  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  const terminal = attempt?.status === 'SUCCEEDED';
  const canPrepare = !attempt || attempt.status === 'FAILED' || attempt.status === 'CANCELLED';
  return (
    <OrderActionModal
      title="Collect payment"
      onClose={props.onClose}
      busy={busy || waiting}
      footer={
        <>
          <button
            className="order-action-button"
            type="button"
            disabled={busy || waiting}
            onClick={props.onClose}
          >
            Close
          </button>
          {canPrepare ? (
            <button
              className="order-action-button is-primary"
              type="button"
              disabled={busy || waiting}
              onClick={() => void prepare()}
            >
              {busy ? 'Preparing…' : 'Prepare payment'}
            </button>
          ) : null}
          {attempt?.status === 'PREPARING' ? (
            <button
              className="order-action-button is-primary"
              type="button"
              disabled={busy || waiting}
              onClick={() => void prepare()}
            >
              Resume preparation
            </button>
          ) : null}
          {attempt && !terminal && attempt.status !== 'PREPARING' ? (
            <button
              className="order-action-button"
              type="button"
              disabled={busy || waiting}
              onClick={() => void read()}
            >
              {waiting ? 'Checking…' : 'Check status'}
            </button>
          ) : null}
        </>
      }
    >
      <div className="order-collect-payment">
        <div className="order-action-confirmation">
          <small>Amount due</small>
          <h3>{formatMoney(attempt?.amountCents ?? props.order.amountDueCents)}</h3>
          <p>
            Payment clears the edited balance. Production remains on hold until an authorized
            operator explicitly resumes it.
          </p>
        </div>
        {attempt === undefined ? <p role="status">Loading payment status…</p> : null}
        {attempt?.status === 'PENDING' &&
        attempt.clientSecret &&
        publishableKey &&
        !attempt.developmentSimulationAvailable ? (
          <StripeOrderEditPaymentForm
            publishableKey={publishableKey}
            clientSecret={attempt.clientSecret}
            onSubmitted={() => void waitForWebhook()}
            onError={() =>
              setError('Payment could not be confirmed. Check the payment details and try again.')
            }
          />
        ) : null}
        {attempt?.status === 'PENDING' && attempt.developmentSimulationAvailable ? (
          <div className="order-local-payment-control">
            <small>Local development control</small>
            <button
              className="order-action-button is-primary"
              type="button"
              disabled={busy || waiting}
              onClick={() => void simulate()}
            >
              {busy ? 'Completing…' : 'Complete test payment'}
            </button>
          </div>
        ) : null}
        {attempt?.status === 'PENDING' &&
        !attempt.developmentSimulationAvailable &&
        !publishableKey ? (
          <p role="status">
            Payment preparation is pending. Stripe is not configured in this build.
          </p>
        ) : null}
        {waiting ? (
          <p role="status">Payment submitted. Waiting for verified payment confirmation…</p>
        ) : null}
        {terminal ? (
          <p className="ops-admin-feedback is-success" role="status">
            Payment received. Production is still on hold until Resume production is selected.
          </p>
        ) : null}
        {error ? (
          <p className="ops-admin-feedback is-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </OrderActionModal>
  );
}

export function StripeOrderEditPaymentForm({
  publishableKey,
  clientSecret,
  onSubmitted,
  onError,
}: Readonly<{
  publishableKey: string;
  clientSecret: string;
  onSubmitted: () => void;
  onError: () => void;
}>) {
  const mount = useRef<HTMLDivElement>(null);
  const elements = useRef<StripeElements | undefined>(undefined);
  const element = useRef<{ mount(node: HTMLElement): void; destroy(): void } | undefined>(
    undefined,
  );
  const [ready, setReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-stripe-js]');
    const script =
      existing ??
      Object.assign(document.createElement('script'), {
        src: 'https://js.stripe.com/v3/',
        async: true,
        dataset: { stripeJs: 'true' },
      });
    const initialize = () => {
      const stripeFactory = stripeFromWindow();
      if (!stripeFactory || !mount.current) return;
      const stripe = stripeFactory(publishableKey);
      elements.current = stripe.elements({ clientSecret, appearance: { theme: 'stripe' } });
      element.current = elements.current.create('payment');
      element.current.mount(mount.current);
      setReady(true);
    };
    script.addEventListener('load', initialize, { once: true });
    if (!existing) document.head.appendChild(script);
    else initialize();
    return () => {
      script.removeEventListener('load', initialize);
      element.current?.destroy();
    };
  }, [clientSecret, publishableKey]);

  async function confirm() {
    const stripeFactory = stripeFromWindow();
    if (!stripeFactory || !elements.current || submitting) return;
    setSubmitting(true);
    const result = await stripeFactory(publishableKey).confirmPayment({
      elements: elements.current,
      confirmParams: { return_url: window.location.href },
      redirect: 'if_required',
    });
    setSubmitting(false);
    if (result.error) onError();
    else onSubmitted();
  }

  return (
    <div className="order-stripe-payment">
      <div ref={mount} aria-label="Secure payment details" />
      <button
        className="order-action-button is-primary"
        type="button"
        disabled={!ready || submitting}
        onClick={() => void confirm()}
      >
        {submitting ? 'Submitting…' : 'Pay securely'}
      </button>
    </div>
  );
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

interface StripeElements {
  create(type: 'payment'): { mount(node: HTMLElement): void; destroy(): void };
}
interface StripeInstance {
  elements(options: { clientSecret: string; appearance: { theme: string } }): StripeElements;
  confirmPayment(options: {
    elements: StripeElements;
    confirmParams: { return_url: string };
    redirect: 'if_required';
  }): Promise<{ error?: unknown }>;
}
function stripeFromWindow(): ((key: string) => StripeInstance) | undefined {
  return (window as unknown as { Stripe?: (key: string) => StripeInstance }).Stripe;
}
