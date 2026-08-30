'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

interface Cart {
  id: string;
  proofApproved: boolean;
  item: {
    projectId: string;
    previewAssetId: string;
    productName: string;
    colorCode: string;
    colorName: string;
    size: string;
    quantity: number;
  } | null;
}
interface Checkout {
  id: string;
  status: string;
  amountCents: number;
  clientSecret: string | null;
  pricing: {
    unitRetailCents: number;
    quantity: number;
    discountCents: number;
    subtotalCents: number;
    customerShippingCents: number;
    freeShippingApplied: boolean;
    taxCents: number;
    totalCents: number;
  };
  shipping: {
    method: string;
    estimatedDeliveryMinDays: number | null;
    estimatedDeliveryMaxDays: number | null;
    provisional: boolean;
  };
}

export function CheckoutClient() {
  const projectId = useSearchParams().get('project');
  const [size, setSize] = useState('M');
  const [quantity, setQuantity] = useState(1);
  const [cart, setCart] = useState<Cart>();
  const [addressId, setAddressId] = useState<string>();
  const [checkout, setCheckout] = useState<Checkout>();
  const [orderNumber, setOrderNumber] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const stripePublishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  const previewUrl = useMemo(
    () =>
      cart?.item
        ? `/api/projects/${encodeURIComponent(cart.item.projectId)}/assets/${encodeURIComponent(cart.item.previewAssetId)}/preview`
        : null,
    [cart],
  );

  if (!projectId)
    return (
      <main>
        <section className="foundation-card">
          <p>Open checkout from a print-ready project.</p>
        </section>
      </main>
    );
  const request = async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    const body = (await response.json()) as T & { error?: string };
    if (!response.ok) throw new Error(body.error ?? 'Something went wrong.');
    return body;
  };
  const createCart = async () => {
    setBusy(true);
    setError(undefined);
    try {
      setCart(
        (
          await request<{ cart: Cart }>('/api/carts', {
            method: 'POST',
            body: JSON.stringify({ projectId, size, quantity }),
          })
        ).cart,
      );
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  };
  const approveProof = async () => {
    if (!cart) return;
    setBusy(true);
    setError(undefined);
    try {
      await request(`/api/carts/${cart.id}/proof`, { method: 'POST', body: '{}' });
      setCart({ ...cart, proofApproved: true });
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  };
  const saveAddress = async (form: HTMLFormElement) => {
    if (!cart) return;
    setBusy(true);
    setError(undefined);
    try {
      const values = Object.fromEntries(new FormData(form));
      const result = await request<{ addressId: string }>(`/api/carts/${cart.id}/address`, {
        method: 'POST',
        body: JSON.stringify(values),
      });
      setAddressId(result.addressId);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  };
  const startCheckout = async () => {
    if (!cart || !addressId) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await request<{ checkout: Checkout }>(`/api/carts/${cart.id}/checkout`, {
        method: 'POST',
        body: JSON.stringify({ addressId, idempotencyKey: crypto.randomUUID() }),
      });
      setCheckout(result.checkout);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  };
  const pay = async () => {
    if (!checkout) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await request<{ orderNumber: string | null }>(
        `/api/checkout/${checkout.id}/fake-confirm`,
        { method: 'POST', body: JSON.stringify({ outcome: 'SUCCEEDED' }) },
      );
      setOrderNumber(result.orderNumber ?? undefined);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  };

  if (orderNumber)
    return (
      <main className="checkout-page">
        <section className="checkout-card checkout-confirmation">
          <p className="eyebrow">Payment received</p>
          <h1>Thank you.</h1>
          <p>
            Your order <strong>{orderNumber}</strong> is being reviewed for production. Payment does
            not send a design to production automatically.
          </p>
          <p>
            We’ll use your approved proof and selected T-shirt details for the next review step.
          </p>
        </section>
      </main>
    );
  return (
    <main className="checkout-page">
      <section className="checkout-card">
        <header className="checkout-heading">
          <p className="eyebrow">Your T-shirt</p>
          <h1>Review before you pay</h1>
          <p>We’ll review your paid order before anything is sent to production.</p>
        </header>
        {!cart ? (
          <section className="checkout-step">
            <h2>1. Choose size and quantity</h2>
            <div className="checkout-controls">
              <label>
                Size
                <select value={size} onChange={(event) => setSize(event.target.value)}>
                  {['S', 'M', 'L', 'XL'].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              <label>
                Quantity
                <input
                  type="number"
                  min="1"
                  max="99"
                  value={quantity}
                  onChange={(event) => setQuantity(Number(event.target.value))}
                />
              </label>
            </div>
            <button
              className="continue"
              type="button"
              disabled={busy}
              onClick={() => void createCart()}
            >
              {busy ? 'Preparing…' : 'Review my T-shirt'}
            </button>
            <p className="checkout-note">
              Sizes and prices are development configuration until commercial catalog approval.
            </p>
          </section>
        ) : null}
        {cart?.item ? (
          <>
            <section className="checkout-review">
              <figure className="checkout-proof">
                <img
                  src={previewUrl ?? ''}
                  alt={`Your design on the ${cart.item.colorName} ${cart.item.productName}`}
                />
                <figcaption>Product proof</figcaption>
              </figure>
              <div>
                <h2>{cart.item.productName}</h2>
                <p>
                  {cart.item.colorName} · {cart.item.size} · Quantity {cart.item.quantity}
                </p>
                <p className="checkout-note">
                  This controlled product proof shows the approved design on your selected shirt.
                  Production files stay private.
                </p>
                <p className="checkout-note">
                  Garment photography is DEVELOPMENT / UNQUALIFIED and will be replaced with
                  licensed launch photography before production release.
                </p>
              </div>
            </section>
            {!cart.proofApproved ? (
              <section className="checkout-step">
                <h2>2. Approve your proof</h2>
                <p>Check the design placement and print-quality notes before you continue.</p>
                <label className="proof-acknowledgement">
                  <input
                    type="checkbox"
                    aria-label="Approve proof"
                    onChange={(event) => {
                      if (event.target.checked) void approveProof();
                    }}
                    disabled={busy}
                  />{' '}
                  I have reviewed and approve this design for production.
                </label>
              </section>
            ) : null}
            {cart.proofApproved && !addressId ? (
              <section className="checkout-step">
                <h2>3. Shipping</h2>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveAddress(event.currentTarget);
                  }}
                  className="checkout-address"
                >
                  <label>
                    Name
                    <input name="recipientName" required />
                  </label>
                  <label>
                    Email
                    <input name="email" type="email" required />
                  </label>
                  <label>
                    Address
                    <input name="line1" required />
                  </label>
                  <label>
                    Apartment, suite, etc. (optional)
                    <input name="line2" />
                  </label>
                  <label>
                    City
                    <input name="city" required />
                  </label>
                  <label>
                    State
                    <select name="stateCode" defaultValue="" required>
                      <option value="" disabled>
                        Select state
                      </option>
                      {usaStates.map((state) => (
                        <option key={state}>{state}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    ZIP code
                    <input name="postalCode" inputMode="numeric" required />
                  </label>
                  <input name="countryCode" value="US" readOnly hidden />
                  <button className="continue" disabled={busy}>
                    {busy ? 'Saving…' : 'Continue to delivery'}
                  </button>
                </form>
              </section>
            ) : null}
            {addressId && !checkout ? (
              <section className="checkout-step">
                <h2>4. Delivery and payment</h2>
                <p>We’ll calculate your final shipping, tax, and total securely before payment.</p>
                <button
                  className="continue"
                  type="button"
                  disabled={busy}
                  onClick={() => void startCheckout()}
                >
                  {busy ? 'Calculating…' : 'Review total'}
                </button>
              </section>
            ) : null}
            {checkout ? (
              <section className="checkout-step">
                <h2>4. Payment</h2>
                <CheckoutSummary checkout={checkout} />
                <p className="checkout-delivery">{deliveryCopy(checkout.shipping)}</p>
                {stripePublishableKey && checkout.clientSecret ? (
                  <StripePaymentForm
                    publishableKey={stripePublishableKey}
                    clientSecret={checkout.clientSecret}
                    onError={setError}
                  />
                ) : (
                  <>
                    <p className="checkout-note">
                      Card, Apple Pay, and Google Pay use Stripe where configured. This local
                      checkout uses deterministic fake payment.
                    </p>
                    <button
                      className="continue"
                      type="button"
                      disabled={busy}
                      onClick={() => void pay()}
                    >
                      {busy ? 'Processing…' : `Pay ${money(checkout.pricing.totalCents)}`}
                    </button>
                  </>
                )}
              </section>
            ) : null}
          </>
        ) : null}
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    </main>
  );
}
function CheckoutSummary({ checkout }: { checkout: Checkout }) {
  const p = checkout.pricing;
  return (
    <dl className="checkout-summary">
      <div>
        <dt>Items</dt>
        <dd>{money(p.unitRetailCents * p.quantity)}</dd>
      </div>
      {p.discountCents ? (
        <div>
          <dt>Quantity saving</dt>
          <dd>−{money(p.discountCents)}</dd>
        </div>
      ) : null}
      <div>
        <dt>Shipping</dt>
        <dd>{p.freeShippingApplied ? 'Free' : money(p.customerShippingCents)}</dd>
      </div>
      <div>
        <dt>Tax</dt>
        <dd>{money(p.taxCents)}</dd>
      </div>
      <div className="checkout-total">
        <dt>Total</dt>
        <dd>{money(p.totalCents)}</dd>
      </div>
    </dl>
  );
}
function money(cents: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}
function deliveryCopy(shipping: Checkout['shipping']) {
  return shipping.estimatedDeliveryMinDays && shipping.estimatedDeliveryMaxDays
    ? `Estimated delivery: about ${shipping.estimatedDeliveryMinDays}–${shipping.estimatedDeliveryMaxDays} business days. This is an estimate, not a guarantee.`
    : 'Delivery timing will be confirmed after review.';
}
function message(reason: unknown) {
  return reason instanceof Error ? reason.message : 'Something went wrong. Please try again.';
}
const usaStates = [
  'AL',
  'AK',
  'AZ',
  'AR',
  'CA',
  'CO',
  'CT',
  'DE',
  'FL',
  'GA',
  'HI',
  'ID',
  'IL',
  'IN',
  'IA',
  'KS',
  'KY',
  'LA',
  'ME',
  'MD',
  'MA',
  'MI',
  'MN',
  'MS',
  'MO',
  'MT',
  'NE',
  'NV',
  'NH',
  'NJ',
  'NM',
  'NY',
  'NC',
  'ND',
  'OH',
  'OK',
  'OR',
  'PA',
  'RI',
  'SC',
  'SD',
  'TN',
  'TX',
  'UT',
  'VT',
  'VA',
  'WA',
  'WV',
  'WI',
  'WY',
  'DC',
];

function StripePaymentForm({
  publishableKey,
  clientSecret,
  onError,
}: {
  publishableKey: string;
  clientSecret: string;
  onError: (message: string) => void;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const elements = useRef<StripeElements | undefined>(undefined);
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
      if (!window.Stripe || !mount.current) return;
      const stripe = window.Stripe(publishableKey);
      elements.current = stripe.elements({ clientSecret, appearance: { theme: 'stripe' } });
      elements.current.create('payment').mount(mount.current);
      setReady(true);
    };
    script.addEventListener('load', initialize, { once: true });
    if (!existing) document.head.appendChild(script);
    else initialize();
    return () => script.removeEventListener('load', initialize);
  }, [clientSecret, publishableKey]);
  const confirm = async () => {
    if (!window.Stripe || !elements.current) return;
    setSubmitting(true);
    const stripe = window.Stripe(publishableKey);
    const result = await stripe.confirmPayment({
      elements: elements.current,
      confirmParams: { return_url: window.location.href },
      redirect: 'if_required',
    });
    setSubmitting(false);
    if (result.error?.message) onError(result.error.message);
  };
  return (
    <div className="stripe-payment">
      <p className="checkout-note">
        Secure card payment. Apple Pay and Google Pay appear here when supported by Stripe and your
        device.
      </p>
      <div ref={mount} aria-label="Secure payment details" />
      <button
        className="continue"
        type="button"
        disabled={!ready || submitting}
        onClick={() => void confirm()}
      >
        {submitting ? 'Processing…' : 'Pay securely'}
      </button>
    </div>
  );
}

interface StripeElements {
  create(type: 'payment'): { mount(element: HTMLElement): void };
}
interface StripeInstance {
  elements(options: { clientSecret: string; appearance: { theme: string } }): StripeElements;
  confirmPayment(options: {
    elements: StripeElements;
    confirmParams: { return_url: string };
    redirect: 'if_required';
  }): Promise<{ error?: { message?: string } }>;
}
declare global {
  interface Window {
    Stripe?: (key: string) => StripeInstance;
  }
}
