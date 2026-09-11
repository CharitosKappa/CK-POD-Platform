# Local admin OTP display implementation plan

1. Change `StaffIdentityService.requestCode` to return the generated code for eligible staff requests and `null` for non-eligible requests while retaining the existing challenge hash, expiry, attempts, and non-enumerating behavior.
2. Add a small server-only exposure policy that returns `true` only for `APP_ENV=local` with a non-production Node environment, and cover it with unit tests.
3. Update the admin request-code API to include `developmentCode` only when both the policy permits exposure and the identity service returned an eligible code.
4. Update the admin sign-in client to display, refresh, and clear the optional local code without automatically submitting it.
5. Add restrained sign-in styling, then run format, lint, typecheck, targeted tests, production build, and browser verification.
