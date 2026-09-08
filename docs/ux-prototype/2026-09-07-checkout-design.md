# UX prototype — Step 5: Checkout

## Approved scope

- One continuous, mobile-first checkout flow for the US market in USD.
- The entry point is the generated-design review's `Continue to checkout` action.
- Product, color, size, artwork preview, and price carry into the order summary.
- The checkout is a local simulation only: no payment processing, tax calculation, inventory reservation, cart persistence, or order creation.

## Shopper-facing structure

1. Compact product summary
2. Contact email
3. Delivery address
4. Shipping method
5. Payment-form placeholders with a clear prototype warning
6. Order total and demo-order confirmation

The visual structure is familiar to ecommerce shoppers but is implemented with Let It Be styling and copy. Shopify branding, assets, source code, and proprietary checkout content are not used.

## Shipping fixtures

| Option             | Customer-facing price | Estimated delivery |
| ------------------ | --------------------- | ------------------ |
| Economy            | $3.99                 | 4–8 business days  |
| Standard (default) | $4.75                 | 2–5 business days  |
| Priority           | Calculated later      | 2–3 business days  |

The fixtures reflect the Printify shipping options and Monster Digital's current Priority eligibility. The provider and carrier remain internal: fulfillment selects the carrier based on the destination and availability after an order exists.

## Sources

- [Printify shipping options](https://help.printify.com/hc/en-us/articles/4483626155409-What-are-Printify-s-shipping-options)
- [Printify Priority Shipping eligibility](https://help.printify.com/hc/en-us/articles/20166678471185-How-do-I-upgrade-my-order-to-Priority-Shipping)
- [How Printify determines the shipping carrier](https://help.printify.com/hc/en-us/articles/37646450116113-What-determines-the-shipping-carrier-of-my-orders)
