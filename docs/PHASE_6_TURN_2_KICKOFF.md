# Phase 6 — Turn 2 Kickoff Prompt — Real adapter + 12 use cases + DI wiring

Paste below the cut into a fresh Claude session against the
`/Users/papagallo/yeapptech/dev/yeride-mobile/` repo.

---

You're picking up YeRide-Next at `/Users/papagallo/yeapptech/dev/yeride-mobile/`
mid-Phase 6 (Payments / Stripe Connect / tipping). Turn 1 shipped the pure
domain + data-layer foundation: 3 branded Stripe IDs (`StripeCustomerId`,
`StripeAccountId`, `PaymentMethodId`), 4 payment value objects
(`PaymentMethod` + `normalizeCardBrand` + `isExpired`, `Payout`,
`BalanceTransaction` enforcing `net = amount - fee`, `StripeAccountStatus`
4-arm union + `deriveStripeAccountStatus`), the 11-method `StripeServerService`
interface, the seed/spy/failNext-equipped `FakeStripeServerService`, and a
critical hygiene fix to `UserDoc` + `userMapper` so the rewrite reads AND
writes the legacy nested `stripe: { id, charges_enabled, payouts_enabled }`
shape alongside the canonical flat fields. End of Turn 1: 115 suites / 877
tests, all verify gates green. Your job this session is **Turn 2**: build the
real HTTP adapter, extend `CloudFunctionsService` with `tipDriver`, ship 12
use cases against the in-memory fake, and wire everything through the DI
container. No UI work — that's Turns 3–5. Read carefully before writing
any code.

## Required reading (in order)

1. `CLAUDE.md` — current state, layered architecture, conventions, file map.
   Phase 6 Turn 1 is now ✅; Turn 2 is Next.
2. `docs/PHASE_6_TURN_1.md` — what Turn 1 shipped, what's deferred to Turn 2,
   risks surfaced (Stripe iOS modular-headers, tip-amount unit mismatch,
   fake's loud-fail-on-unseeded behavior).
3. `docs/PHASE_6_KICKOFF.md` — overall Phase 6 plan (scope, locked
   decisions, risks, suggested turn breakdown).
4. `src/domain/services/StripeServerService.ts` — the 11-method interface
   the real adapter must implement.
5. `src/shared/testing/FakeStripeServerService.ts` — programmable fake the
   use case tests will run against.
6. `src/data/services/CloudFunctionsService.ts` — the existing wrapper for
   `completeTrip` / `cancelTrip` callables; you'll add a third method
   (`tipDriver`).
7. `src/data/services/GoogleRoutesService.ts` — closest model for the new
   `StripeServerHttpAdapter`. Look at the Bearer-token header construction,
   error mapping, and retry-with-backoff helper (port the helper into a
   shared utility if not already shared).
8. `src/data/services/NhtsaVinDecoderService.ts` — second model. Look at
   how the adapter narrows free-form HTTP responses into domain value
   objects via factory `Result` checks.
9. Legacy `yeride-stripe-server/stripe/routes.js` — actual endpoint
   implementations. Read the request bodies, response shapes, and error
   paths for every endpoint listed in the `StripeServerService` interface.
   The microservice is deployed and shared with legacy; do NOT change its
   API contract.
10. Legacy `yeride-functions/handlers/tip-driver.js` — the Cloud Function
    `tipDriver` you'll call. Note: it takes `tipAmount` in **dollars**
    (not cents) with a $0.50 minimum. The rewrite's `Money` is in minor
    units; the use case is responsible for converting at the boundary AND
    enforcing a $1 minimum (matching legacy UX, stricter than the
    function).
11. `src/app/usecases/vehicle/RegisterVehicle.ts` and
    `src/app/usecases/vehicle/SetActiveVehicle.ts` — reference for the
    rewrite's use-case shape: `execute(args): Promise<Result<T, E>>`,
    auth-gated where applicable, `if (!r.ok) return r;` early-return, and
    full unit coverage against in-memory fakes.
12. `src/presentation/di/container.ts` — the composition root. New
    branches for `stripeServer` get added here, lazy-`require()` of the
    HTTP adapter in the production path; `FakeStripeServerService` in the
    fakes path.
13. `src/shared/testing/TestContainerProvider.tsx` — gains a
    `stripeServer?` override knob for view-model tests in Turn 3.
14. `src/domain/entities/User.ts` and `src/data/dto/UserDoc.ts` — minor
    Turn-2 extension: a new `defaultPaymentMethodId: PaymentMethodId | null`
    field on `Rider` (`SetDefaultPaymentMethod` writes here; legacy
    yeride ignores the field). See decision 6 below.
15. `src/domain/entities/PassengerSnapshot.ts` — the `defaultPaymentMethod`
    field that the snapshot bakes into trips at `CreateRide` time. It
    should be populated from the user's `defaultPaymentMethodId` once
    the rewrite has Turn 2's `SetDefaultPaymentMethod` wired in.
16. Legacy `yeride/src/api/stripe/paymentProcessor.js` — full reference
    for idempotency-key conventions (`customer-create-{userId}`,
    `tip-{tripId}`). Mirror these exactly.

## Starting state — what's already built (Turn 1)

- **Domain.** Three branded Stripe IDs, four payment value objects,
  `StripeServerService` interface, `deriveStripeAccountStatus` helper.
  All exported from `src/domain/entities/index.ts` and
  `src/domain/services/index.ts`.
- **Testing.** `FakeStripeServerService` exported from
  `src/shared/testing/index.ts`. Default behavior is "fail loudly with
  an unprimed-method error" so tests must explicitly seed.
- **Data layer.** `UserDoc` DTO accepts BOTH the canonical flat Stripe
  fields AND the legacy nested `stripe: { id, charges_enabled,
payouts_enabled }` shape. `userMapper` reads either (prefers flat) and
  writes both for legacy yeride co-existence under `setDoc { merge: true }`.
- **Cloud Functions.** `CloudFunctionsService` wraps
  `completeTrip` / `cancelTrip` (us-east1). The class shape is the
  reference for adding `tipDriver`.

## Scope decisions (locked at Turn 2 kickoff — confirm or override)

1. **`StripeServerHttpAdapter` is a single file in `src/data/services/`.**
   `fetch`-based, Bearer-token auth via `Authorization: Bearer ${apiKey}`
   header read from `Constants.expoConfig.extra.stripeServerApiKey`.
   Base URL from `extra.stripeServerUrl`. Both threaded through
   `app.config.ts` from `.env.{development,stage,production}` files.
   Confirm both env keys are added to the env validator
   (`src/shared/env/validateEnv.ts`) — currently they are not.

2. **Idempotency keys.** Mirror legacy exactly:
   - `createCustomer` → `customer-create-{userId}`
   - `createConnectAccount` → no idempotency key (legacy doesn't set one;
     the use case's "check user doc first" is the dedupe path)
   - `createSetupIntent`, `listPaymentMethods`, `detachPaymentMethod`,
     `retrieveAccount`, `getAccountBalance`, `listAccountPayouts`,
     `listBalanceTransactions`, `createAccountLink`,
     `createAccountLoginLink` → no idempotency key (these are read-mostly
     or terminal one-shots).
   - `tipDriver` callable → idempotency at the Cloud Function level
     (server-side already idempotent; `ProcessTip` use case passes
     `{ tripId, tipAmount }` straight through. Don't generate a separate
     idempotency token client-side; the trip itself bounds at-most-once.
     If a network blip leaves the rewrite uncertain whether a tip
     succeeded, the user re-tap is safe because the function is
     server-idempotent on `(tripId, customerId)`).

3. **Retry policy.** Port the `GoogleRoutesService` retry helper into
   `src/data/services/_shared/retryWithBackoff.ts` (or whatever the
   existing helper file is — read first; if it's inline, extract). Apply
   to ALL `StripeServerHttpAdapter` calls, retry only on transport
   failure / 5xx (NetworkError), never on 4xx. 3 attempts with
   exponential backoff (250ms / 500ms / 1000ms — same as
   `GoogleRoutesService`).

4. **Error mapping.** The microservice returns
   `{ success: false, errorCode, message }` for non-2xx. Adapter maps:
   - HTTP 401 / 403 → `AuthorizationError({ code:
'stripe_server_unauthorized', message })`
   - HTTP 4xx (other) → `ValidationError({ code: data.errorCode ??
'stripe_server_validation', message: data.message ?? '...' })`
   - HTTP 5xx + transport failures + JSON parse errors → `NetworkError(
{ code: 'stripe_server_*', message, cause })`
   - HTTP 2xx but `body.success === false` → `ValidationError` (defense
     in depth; the server shouldn't do this but legacy did occasionally).
     Stripe error type mapping (`card_error`, `insufficient_funds`, etc.)
     propagates via the `errorCode` string from the server — domain code
     via `getApiErrorType` lives server-side; the rewrite consumes the
     resolved string.

5. **`tipDriver` Cloud Function callable** — extends
   `CloudFunctionsService`. Takes `{ tripId: string, tipAmount: number }`
   in **dollars** (matching the function signature). The `ProcessTip`
   use case is responsible for: (a) converting the rewrite's
   `Money` minor units to dollars, (b) enforcing the $1 floor BEFORE the
   call, (c) returning the `Result.ok(void)` shape after — the new
   `TripPayment` row appears via the existing `useObserveTripPaymentsSubscription`
   pipeline, not from the function's return value.

6. **`SetDefaultPaymentMethod` writes a new field on the rider doc.** Add
   `defaultPaymentMethodId: PaymentMethodId | null` to the `Rider`
   interface in `src/domain/entities/User.ts` and to `RiderDocSchema` in
   `src/data/dto/UserDoc.ts`. Persist via the existing
   `UserRepository.update` method. Legacy yeride doesn't read this field
   (it stores the default in React Context only) — the dual-write
   pattern from Turn 1 means legacy ignores and the rewrite reads on
   cold start. Update `userMapper.toDomain` and `toDoc` to round-trip
   the field. Add 1 mapper test fixture.

7. **`PassengerSnapshot.defaultPaymentMethod` is populated from
   `Rider.defaultPaymentMethodId`** when `CreateRide` builds the
   snapshot. This wiring is not strictly part of Turn 2 (no use case
   change), but if `CreateRide` currently passes `null` here,
   `SetDefaultPaymentMethod`'s side effect (charging the right card on
   trip completion) won't actually work. Confirm by reading
   `src/app/usecases/ride/CreateRide.ts`. If `CreateRide` doesn't read
   `user.defaultPaymentMethodId`, add a one-line patch to plumb it
   through — flagged as part of Turn 2 even though the field name lives
   on `Ride`. Otherwise `defaultPaymentMethod` stays `null`, the trip's
   `defaultPaymentMethod` is null, and the `completeTrip` Cloud Function
   has no card to charge.

8. **`RefreshConnectAccountStatus` is the only use case that updates the
   user doc as a side effect.** Reads via `StripeServerService.retrieveAccount`,
   then writes the flat fields (`stripeChargesEnabled`,
   `stripePayoutsEnabled`) via `UserRepository.update` (or whatever the
   existing method is). The legacy nested `stripe.charges_enabled` /
   `stripe.payouts_enabled` get the dual-write treatment from
   `userMapper.toDoc` automatically. The use case's `Result` is `Result<void>`;
   the caller re-reads via `useCurrentUserQuery` invalidation in Turn 3.

9. **Reuse the existing `UserRepository` interface — do NOT add a new
   `PaymentRepository`.** `EnsureStripeCustomer`,
   `EnsureStripeConnectAccount`, `SetDefaultPaymentMethod`,
   `RefreshConnectAccountStatus` all just need `UserRepository.update`.
   Adding a wrapper is ceremony.

10. **Use cases live in `src/app/usecases/payment/`.** Twelve files,
    one per use case. Each takes its dependencies via constructor; each
    is `execute(args): Promise<Result<T, DomainError>>` (or
    `Promise<Result<void, DomainError>>` for side-effecting ones).
    Auth-gate every use case where the rewrite is acting on behalf of a
    specific user (every one except `ListBalanceTransactions` if it's
    an admin path — but for the driver Earnings tab, even that needs to
    verify the caller IS the driver).

11. **Test view of the 12 use cases.** Each gets a unit-test file under
    `src/app/usecases/payment/__tests__/`. Tests run against
    `FakeStripeServerService` + `InMemoryUserRepository` (the existing
    fake). Cover: happy path, every distinct error branch, idempotency
    where it applies, auth rejection where it applies. Estimate ~6–10
    tests per use case ≈ 80–120 new tests across 12 suites.

12. **DI container wiring.** Add `stripeServer: StripeServerService` to
    the `Deps` shape, thread through `makeUseCases({...})`. Production
    branch lazy-`require()`s `StripeServerHttpAdapter`; fakes branch
    wires `FakeStripeServerService`. Update
    `src/presentation/di/container.ts` and add `stripeServer?:
StripeServerService` to `TestContainerProvider`'s override knobs.

## Scope (in / out)

**In:**

- `src/data/services/StripeServerHttpAdapter.ts` — real HTTPS adapter
  (the 11 `StripeServerService` methods).
- `src/data/services/_shared/retryWithBackoff.ts` (or extend the
  existing helper) — extracted retry-with-backoff for transient
  failures.
- `src/data/services/CloudFunctionsService.ts` — extend with
  `tipDriver({ tripId, tipAmount })`.
- `src/data/services/__tests__/StripeServerHttpAdapter.test.ts` —
  fetch-mocked tests covering happy path, 4xx (auth + validation), 5xx
  (retry + final NetworkError), JSON parse error, idempotency-key
  header threading, base URL composition.
- `src/data/services/__tests__/CloudFunctionsService.test.ts` if it
  exists — extend with tipDriver test; create if it doesn't.
- `src/app/usecases/payment/EnsureStripeCustomer.ts` — idempotent: if
  `user.stripeCustomerId !== null` returns it; otherwise calls
  `StripeServerService.createCustomer`, persists, returns. Auth: caller
  must be the rider.
- `src/app/usecases/payment/CreateSetupIntent.ts` — auth-gated wrap of
  `StripeServerService.createSetupIntent`.
- `src/app/usecases/payment/ListPaymentMethods.ts` — auth-gated wrap.
- `src/app/usecases/payment/DetachPaymentMethod.ts` — auth-gated wrap.
  If the detached card is the rider's default, also clears
  `defaultPaymentMethodId` (one Firestore write inside the same use
  case).
- `src/app/usecases/payment/SetDefaultPaymentMethod.ts` — auth-gated;
  pure Firestore write to `users/{uid}.defaultPaymentMethodId`.
- `src/app/usecases/payment/EnsureStripeConnectAccount.ts` —
  idempotent: if `driver.stripeAccountId !== null` returns it; otherwise
  calls `StripeServerService.createConnectAccount`, persists, returns.
  Auth: caller must be the driver.
- `src/app/usecases/payment/CreateConnectOnboardingLink.ts` —
  auth-gated wrap of `createAccountLink`. Returns the URL the app
  opens in `WebBrowser.openAuthSessionAsync` in Turn 4.
- `src/app/usecases/payment/RefreshConnectAccountStatus.ts` —
  auth-gated; calls `retrieveAccount` then `UserRepository.update` to
  persist the flags.
- `src/app/usecases/payment/GetDriverBalance.ts` — auth-gated wrap.
- `src/app/usecases/payment/ListDriverPayouts.ts` — auth-gated wrap.
- `src/app/usecases/payment/ListBalanceTransactions.ts` — auth-gated
  wrap.
- `src/app/usecases/payment/ProcessTip.ts` — converts `Money` minor
  units → dollars, enforces $1 floor (returns
  `Result.err(ValidationError)` below the floor), calls
  `CloudFunctionsService.tipDriver`. Auth-gated on the rider being the
  trip's passenger.
- `src/domain/entities/User.ts` — add
  `defaultPaymentMethodId: PaymentMethodId | null` to `Rider`. Update
  `makeRider` factory to default to `null`.
- `src/data/dto/UserDoc.ts` — add `defaultPaymentMethodId: z.string().nullish()`
  to `RiderDocSchema`. The existing legacy yeride doesn't write this
  field; the rewrite owns it.
- `src/data/mappers/userMapper.ts` — round-trip the field in `toDomain` /
  `toDoc`. 1 new mapper test fixture.
- `src/app/usecases/ride/CreateRide.ts` — populate
  `passenger.defaultPaymentMethod` from `rider.defaultPaymentMethodId`
  when present (one-line patch; see decision 7).
- `src/presentation/di/container.ts` — `stripeServer` dep added,
  lazy-`require()` of `StripeServerHttpAdapter` in the production
  branch, `FakeStripeServerService` in the fakes branch.
- `src/shared/testing/TestContainerProvider.tsx` — `stripeServer?`
  override knob.
- 12 unit-test files in `src/app/usecases/payment/__tests__/`.

**Out (deferred to Turns 3–5):**

- `@stripe/stripe-react-native` dependency + `<StripeProvider>` mount —
  Turn 3.
- `expo-web-browser` dep + `WebBrowser.openAuthSessionAsync` flow —
  Turn 4.
- Wallet, AddPaymentMethod, Earnings screens — Turns 3–4.
- `TipSelector` component on RideReceipt — Turn 5.
- View-models for any of the above — Turns 3–5.
- TanStack-Query mutation/query hooks for the new use cases — Turns 3–5
  (each turn adds the hooks the screens it ships need; pre-emptively
  building them risks unused-export churn).
- Apple Pay / Google Pay — Phase 9 polish.
- In-app refund initiation — never (admin-only via Stripe dashboard).

## Risks + mitigations

- **`StripeServerHttpAdapter` test surface.** Mocking `fetch` works for
  unit tests but doesn't catch real Stripe-server behavior. Mitigation:
  add a single `it.skip`-able integration test under
  `__tests__/integration/StripeServerHttpAdapter.integration.test.ts`
  that hits the staging server when `STRIPE_SERVER_URL` is in the env;
  default-skipped in CI. Run manually after major adapter changes. Same
  pattern as the `NhtsaVinDecoderService` integration smoke (if that
  exists; if not, document the manual test in `docs/PHASE_6_TURN_2.md`
  when the turn lands).

- **Idempotency-Key header case sensitivity.** Per legacy server code,
  `getStripeRequestOptions` accepts both `Idempotency-Key` and
  `idempotency-key`. Use the canonical case (`Idempotency-Key`).
  Confirm with a fetch-mock spy assertion.

- **`tipDriver` race on retry.** A network failure between client send
  and client response leaves the rewrite uncertain whether the tip
  charged. The Cloud Function is server-idempotent on
  `(tripId, customerId)` per `handlers/tip-driver.js` (it
  re-reads the trip's existing tip payment before re-charging). So a
  user-initiated retry is safe. Don't add client-side replay protection;
  document the property in `ProcessTip`'s comment block.

- **`DetachPaymentMethod` of the default card.** Rider taps trash on
  their default card. The use case must: (a) call the server detach,
  (b) clear `defaultPaymentMethodId` if that was the default, (c) NOT
  fail-after-detach if the user-doc update fails (the card is gone
  Stripe-side; we'd be lying to the UI about the state). Solution:
  do the user-doc update FIRST (cheap, reversible), then the server
  detach. If the server detach fails, restore the user-doc field. This
  is a 6-line transaction-y pattern; cover with a test.

- **`RefreshConnectAccountStatus` partial-failure.** Server returns
  flags successfully; the user-doc update fails. The use case must
  return `Result.err(NetworkError)` rather than silently succeeding —
  the caller in Turn 4 needs to know to retry. Cover the order
  (server read → doc write) and the failure mode.

- **`Money → dollars` rounding in `ProcessTip`.** `Money.fromMajor(2.5,
'USD')` round-trips cleanly because the minor units land on integers.
  But if a future caller passes minor units that don't divide evenly by
  100 (won't happen with the preset chips $1/$3/$5, but a future
  custom-tip input could), `ProcessTip` should reject. Decision:
  enforce `tipAmount.minorUnits % 100 === 0` in the use case as a
  ValidationError. The Cloud Function takes dollars; passing fractional
  dollars is a programmer error.

- **Env validator doesn't gate on Stripe keys.** Currently
  `validateEnv` doesn't require `STRIPE_SERVER_URL` /
  `STRIPE_SERVER_API_KEY`. Add them as required for production builds,
  optional for development (where the use cases run against the fake).
  Without this, a missing env in a release build fails silently at
  first Stripe call instead of at boot.

## Acceptance for end of Turn 2

A signed-in rider's `useCurrentUser()` returns a `Rider` with
`defaultPaymentMethodId` populated when the user has previously set
one. A unit-test exercise of the 12 use cases against the in-memory
fakes:

```ts
const customer = await ensureStripeCustomer.execute({ userId, name, email });
expect(customer.ok).toBe(true);
const setup = await createSetupIntent.execute({ customerId: customer.value });
const methods = await listPaymentMethods.execute({
  customerId: customer.value,
});
const detached = await detachPaymentMethod.execute({ paymentMethodId });
// Connect:
const account = await ensureStripeConnectAccount.execute({ userId, email });
const link = await createConnectOnboardingLink.execute({
  accountId: account.value,
});
const refreshed = await refreshConnectAccountStatus.execute({
  accountId: account.value,
});
const balance = await getDriverBalance.execute({ accountId: account.value });
const payouts = await listDriverPayouts.execute({ accountId: account.value });
const txns = await listBalanceTransactions.execute({
  accountId: account.value,
});
// Tipping:
const tip = await processTip.execute({
  tripId,
  tipAmount: Money.fromMajor(3, 'USD').value,
});
```

…all return `Result.ok(...)`. Auth-gate rejections, network-failure
rejections, and idempotent-skip behavior are each covered by at least
one test.

`StripeServerHttpAdapter` smoke-tests cleanly against the staging
server (run the optional integration test once before declaring done;
keep it `skip`'d in CI). The DI container wires the real adapter when
`isFirebaseConfigured()` is true and the env vars are present;
otherwise wires `FakeStripeServerService`. `TestContainerProvider`
exposes a `stripeServer?` override knob; existing view-model tests in
the rider/driver tabs still pass without changes (they don't touch
Stripe yet).

`npm run verify` (typecheck + lint + format + test) green. Test
delta target: ≥ 13 new suites (1 adapter + 12 use cases) and ≥ 80 new
tests (≈ 6–8 per use case + ≈ 10 for the adapter). Net should land
around **128 suites / ≈ 960 tests**.

## Conventions (non-negotiable — same as Phases 3–5 + Turn 1)

- `Result.ok` / `Result.err` for every expected failure. Never throw
  for domain errors. Programming errors still throw (bad inputs to
  fakes, etc.).
- The in-memory fake (`FakeStripeServerService`) is the contract truth
  for the use cases. The real adapter must satisfy the same interface
  byte-for-byte.
- Server state goes through TanStack Query (in Turn 3); no Stripe-y
  Zustand store. Don't pre-emptively build TanStack hooks here — Turn 3
  builds them alongside the Wallet UI that consumes them.
- Each use case gets a sibling unit-test file in `__tests__/`.
- Logger only: `LOG.extend('STRIPE')` for the adapter,
  `LOG.extend('PAYMENT')` for the use cases. Never `console.*`.
- Idempotency keys mirror legacy exactly. Don't invent new schemes.
- Run `npm run verify` before declaring done.

## Suggested ordering

- **Step 1 — Adapter.** Build `StripeServerHttpAdapter` against
  `fetch`-mocked tests. Use `FakeStripeServerService` test cases as a
  contract reference (the adapter must produce equivalent
  `Result<...>` shapes). Verify the retry policy by mocking 5xx →
  5xx → 200.
- **Step 2 — `tipDriver` callable.** Extend `CloudFunctionsService`
  with the third method. Same error-mapping pattern as the existing
  two.
- **Step 3 — Domain field extension.** Add `defaultPaymentMethodId` to
  `Rider`, `RiderDocSchema`, and `userMapper`. New mapper test fixture.
- **Step 4 — Use cases, in dependency order.** `EnsureStripeCustomer`
  first (other rider use cases depend on it conceptually);
  `EnsureStripeConnectAccount` second (driver use cases);
  `SetDefaultPaymentMethod` and `DetachPaymentMethod` together (they
  share the user-doc-update pattern and the default-card invariant);
  then the read-only ones (`ListPaymentMethods`, `GetDriverBalance`,
  `ListDriverPayouts`, `ListBalanceTransactions`); then
  `CreateSetupIntent`, `CreateConnectOnboardingLink`,
  `RefreshConnectAccountStatus`. `ProcessTip` last — it needs the
  unit-conversion logic and the auth-on-passenger check.
- **Step 5 — `CreateRide` plumbing.** One-line patch to read
  `rider.defaultPaymentMethodId` and pass it as
  `passenger.defaultPaymentMethod`.
- **Step 6 — DI wiring + TestContainerProvider.** Lazy require, fakes
  branch, override knob. Boot smoke (real config + fakes config).
- **Step 7 — Optional integration test.** Document the manual run
  procedure in `docs/PHASE_6_TURN_2.md` even if you skip running it
  yourself.
- **Step 8 — `npm run verify` + commit + write `docs/PHASE_6_TURN_2.md`.**

## Start with

Read `CLAUDE.md`, then `docs/PHASE_6_TURN_1.md`, then
`docs/PHASE_6_KICKOFF.md`. Then read
`src/data/services/GoogleRoutesService.ts` end-to-end (it's the closest
model for the new HTTP adapter). Then read
`yeride-stripe-server/stripe/routes.js` for the actual endpoint
implementations the adapter must speak to. Then propose **Turn 2 scope
as a numbered punch list** (files to create, files to touch, tests to
add — in the same shape as the Turn 1 punch list) and wait for
confirmation before writing code.

Tip: this kickoff has the same shape as Turn 1's. Mirror that
structure for Turn 3's kickoff (Rider Wallet + AddPaymentMethod
screens) when Turn 2 lands.
