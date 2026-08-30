import { Suspense } from 'react';

import { CheckoutClient } from './checkout-client';

export default function CheckoutPage() {
  return (
    <Suspense
      fallback={
        <main>
          <p role="status">Loading checkout…</p>
        </main>
      }
    >
      <CheckoutClient />
    </Suspense>
  );
}
