# Customer notification language

## Outcome

Customer language is a persisted commerce preference, not presentation copy. It is available to the admin customer profile and attached to lifecycle email deliveries so transactional and promotional templates can select the correct translation.

## Detection and precedence

- The checkout address request maps the browser `Accept-Language` header to a supported storefront locale.
- English (`en`) is the only supported storefront and notification locale for the USA launch; every unsupported or missing value falls back to English.
- Automatic checkout detection is stored with source `BROWSER`.
- An explicit customer choice or admin choice has higher precedence and cannot be overwritten by a later browser detection.
- Existing customers are backfilled to English with source `DEFAULT`; their preference can be corrected by an admin or updated by a later checkout detection.

## Persistence

`app.customer_profiles` owns:

- `preferred_locale`
- `preferred_locale_source` (`DEFAULT`, `BROWSER`, `CUSTOMER`, or `ADMIN`)
- `preferred_locale_updated_at`

The customer detail API exposes the locale and source. Editing the language in Admin records an `ADMIN` preference and adds the change to the customer timeline through the existing profile-update event.

## Messaging boundary

Before a lifecycle delivery is persisted or sent, the orchestrator resolves the customer profile locale by normalized email. The resolved locale is:

- snapshotted in the delivery payload for auditability;
- passed explicitly to the messaging adapter;
- written as `preferred_locale` on the Klaviyo profile event boundary.

If no customer profile is available, the messaging boundary falls back to English. Consent and marketing suppression rules remain independent and unchanged.

## Admin experience

The sidebar displays `Will receive notifications in English` from persisted data. The contact-information modal and the full add/edit customer form expose English as the sole language value. The compact typography matches the remaining sidebar metadata.
