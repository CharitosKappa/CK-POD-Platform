# Passwordless Sign-in — UX Prototype Design

## Goal

Add a mobile-first, passwordless account-access flow to the existing full-screen menu. A customer uses an emailed six-digit code rather than a password. A successful first sign-in creates the customer account invisibly; account creation is never a separate shopper task.

## Scope

- The existing menu `Sign in` control opens a full-screen account page.
- The page has two local-only stages: email entry and verification-code entry.
- The UI describes the account as passwordless and explains that a first-time email creates an account automatically after verification.
- The prototype preserves the current cart and in-progress design throughout the flow.
- On a successful verification, menu account status changes from `Sign in` to the signed-in email with a `Sign out` action.

No email is sent, no account is persisted, and no backend, newsletter, order, or payment system is connected in this prototype.

## Shopper flow

1. In the full-screen menu, the shopper selects `Sign in`.
2. The email screen presents a back control, the LET IT BE wordmark, an email field, and `Continue with email`.
3. A valid email advances to the code screen and focuses the code field.
4. The code screen shows the email, an explicit `Change email` action, resend affordance, expiry copy, and a passwordless label.
5. Any complete six-digit numeric code succeeds in this isolated prototype. Fewer than six digits show the shared inline reminder styling.
6. Success returns to the menu with the shopper visibly signed in. Signing out only clears this browser-local state.

## OTP autofill

The code UI displays six visual slots but is driven by one native text input. That input uses:

```html
<input
  autocomplete="one-time-code"
  inputmode="numeric"
  maxlength="6"
  pattern="[0-9]*"
/>
```

The browser or operating system can offer a received OTP above the mobile keyboard. Selecting it fills the one native input, and the component mirrors its value into the six visible slots. This preserves the native autofill path, supports typing and paste, and avoids six independent inputs that can interfere with the one-time-code suggestion. Autofill availability remains device, browser, mail-client, and platform dependent; the manual entry path is always available.

When live email delivery is added, the provider should send a clear, single six-digit code, expire and invalidate it after use, and apply rate limiting and attempt limits server-side.

## Components and state

- `PasswordlessSignInPage` is a presentational full-screen overlay.
- Parent-local state owns: `accountOpen`, `authStage`, `authEmail`, `verificationCode`, and `signedInEmail`.
- `PasswordlessSignInPage` receives explicit callbacks for close, email continuation, change email, code updates, verification, and sign-out. It neither reads nor mutates cart/design data.
- `NavigationDrawer` receives signed-in status and the sign-in/open-account callback. It remains responsible only for navigation presentation.

## Visual and accessibility rules

- Retain the warm background, editorial serif headline, compact LET IT BE wordmark, red primary action, and the existing error/reminder system.
- Back returns to the menu; close/escape returns focus to the original menu trigger.
- The code input is labelled `Verification code`, uses a numeric keyboard, and remains natively focusable and screen-reader accessible. The six slots are decorative mirrors.
- `Change email` returns to the email stage without losing the entered address. `Resend code` gives a brief local confirmation without claiming an actual email was sent.

## Verification

1. Menu `Sign in` opens the email screen and back returns to the menu.
2. Invalid email uses the common inline feedback style; valid email advances and focuses the OTP field.
3. Typing, pasting, or native one-time-code autofill fills all six visual slots.
4. A short code shows a reminder; six numeric digits sign in, retain cart/design state, and update the menu status.
5. Change email, resend confirmation, sign-out, Escape, focus return, format, lint, typecheck, and mobile browser smoke checks work.
