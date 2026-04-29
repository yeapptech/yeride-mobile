# Phase 6 — Turn 2: HTTP adapter + 13 use cases + DI wiring

The "wire-up" turn for Phase 6 (Payments / Stripe Connect / tipping).
End-to-end coverage of the payment surface from the data layer up
through the DI container — but no UI yet. Wallet / Earnings / tip flow
land in turns 3-5.

End of turn: **132 suites / 1000 tests passing**, **+17 suites / +123
tests** on top of Turn 1's 115/877. typecheck + lint + format + test
all green.

## What's in

### 1. Resolved-at-kickoff issues

Four issues surfaced during reading; resolutions captured here so they
don't drift across future turns.

**Issue A — `PaymentMethod.expiry` is now nullable.** The legacy
`/customer-payment-methods` endpoint doesn't expose `card.exp_month` /
`card.exp_year`, but Turn 1's `PaymentMethod` value object required
non-null `expiry: { month, year }`. Path 3 chosen: soften
`PaymentMethod.expiry` to `PaymentMethodExpiry | null`. The `create`
factory skips expiry validation when null, and `isExpired(now)` returns
`false` (we cannot know without data). Two new tests cover the null
construction + the conservative isExpired behavior. Adapter forward-
compat: `mapPaymentMethod` reads `exp_month` / `exp_year` if present, so
a future additive server change works without an adapter edit.

**Issue B — `Rider.stripeCustomerId` and `Driver.stripeAccountId` are
now branded.** Path 2 chosen (brand both consistently). `Rider` gains
`defaultPaymentMethodId: PaymentMethodId | null` alongside re-typed
`stripeCustomerId: StripeCustomerId | null`; `Driver` gets
`stripeAccountId: StripeAccountId | null`. Four new immutable helpers
on `User.ts`: `setStripeCustomerId`, `setDefaultPaymentMethodId`,
`setStripeAccountId`, `setStripeAccountFlags`. The single existing
caller of `Driver.stripeAccountId` outside the mapper —
`useDriverDispatchViewModel`'s DriverSnapshot construction — was
patched to `String(...)`-stringify at the snapshot boundary
(`DriverSnapshot.stripeAccountId` stays `string` because it's a
denormalized trip-doc payload, not the user-side identity).

**Issue C — `retryWithBackoff` written from scratch.** Kickoff said
"port the GoogleRoutesService retry helper", but that adapter has no
retry. The single existing inline retry lives in
`FirestoreLocationRepository`. Built generic
`src/data/services/_shared/retryWithBackoff.ts` with
`{attempts, delaysMs, shouldRetry, sleep?}` shape — `sleep` injectable
so unit tests don't burn wall-clock time. Seven tests cover the policy
edges (succeed first / succeed-after-N / give-up / never-retry / passes
error to predicate / programmer error on attempts<1 / repeat-last-delay
when delaysMs is shorter than attempts-1).

**Issue D — Default-payment-method plumbing patched in
`useRouteSelectViewModel`, not `CreateRide`.** `CreateRide` takes a
pre-built `PassengerSnapshot`; the snapshot is built one layer up. The
patched line reads `user.defaultPaymentMethodId` (Rider-narrowed) and
stringifies it into `PassengerSnapshot.defaultPaymentMethod`, which the
server-side `completeTrip` Cloud Function uses to charge the right card
on trip completion.

### 2. Real `StripeServerHttpAdapter`

`src/data/services/StripeServerHttpAdapter.ts` — fetch-based,
implements the 11-method `StripeServerService` interface from Turn 1
against the YeRide Stripe microservice. Construction takes
`{baseUrl, apiKey}`; both come from `app.config.ts` `extra` block via
the new `getStripeServerConfig()` helper.

- **Auth** — `Authorization: Bearer ${apiKey}` on every request.
- **Idempotency-Key** — only on `createCustomer`
  (`customer-create-{userId}`), mirroring legacy. The other endpoints
  are read-mostly or rely on user-doc-level deduplication
  (`EnsureStripeConnectAccount` checks the user doc before calling).
- **Retry policy** — 3 attempts (initial + 2 retries) with exponential
  backoff (250 / 500 / 1000 ms). Retries fire only on transport throws
  - 5xx; never on 4xx. Implementation uses an internal
    `TransientHttpError` sentinel that `retryWithBackoff` recognizes —
    4xx errors return `Result.err(...)` directly (no retry path), while
    5xx + transport throws raise the sentinel for retry, then unwrap to a
    domain `NetworkError` if all attempts fail.
- **Error mapping** — HTTP 401/403 → `AuthorizationError` carrying the
  server `errorCode`. HTTP 4xx (other) → `ValidationError` (same
  treatment). HTTP 5xx + transport + JSON parse failure → `NetworkError`.
  HTTP 2xx with `body.success === false` → `ValidationError` (defense
  in depth — the server shouldn't do this but legacy did occasionally).
- **Adapter-private `mapPaymentMethod` / `mapPayout` /
  `mapBalanceTransaction`** narrow free-form server JSON into the
  branded value objects. Malformed individual rows are skipped
  (logged) rather than failing the whole list — punishing the user for
  one bad row would be a regression on legacy behavior.

`StripeServerHttpAdapter.test.ts` — 24 fetch-mocked tests covering:
happy paths for every endpoint, Idempotency-Key header presence /
absence assertion, brand normalization on `listPaymentMethods`, expiry
forward-compat, malformed-row skipping, balance USD-only summing, the
`net = amount - fee` invariant on balance transactions, every error
mapping path, retry-on-5xx-then-success, give-up-after-budget,
transport-throw-then-success, JSON parse failure, body-success-false,
trailing-slash baseUrl trimming.

### 3. `CloudFunctionsService.tipDriver` + `FakeCloudFunctionsService`

- `CloudFunctionsService` extended with
  `tipDriver({tripId, tipAmountDollars}): Promise<Result<TipDriverResult, ...>>`.
  The arg is named `tipAmountDollars` (not `amount`) to make the unit
  explicit at the call site — the function takes dollars even though
  the rewrite represents money in minor units.
- `FakeCloudFunctionsService` (in `@shared/testing`) — programmable
  in-memory wrapper covering `completeTrip` / `cancelTrip` / `tipDriver`
  with `seed*` / `failNext` / `spies` seams. Default tip result is
  `{success: true, paymentId: 'pi_fake_tip'}`; per-trip override via
  `seedTipDriverResult({tripId, result})`.
- New `PaymentCallableService` interface in `@domain/services/`
  abstracting just `tipDriver` (the architectural seam — domain code
  cannot depend on `@data/services/CloudFunctionsService` directly per
  the boundaries rule). Both `CloudFunctionsService` and
  `FakeCloudFunctionsService` satisfy this interface structurally.

`CloudFunctionsService.test.ts` (new) — 4 tests covering `tipDriver`'s
arg shape, permission-denied → AuthorizationError, failed-precondition
→ ValidationError, internal → NetworkError. The pre-existing
`completeTrip` / `cancelTrip` paths are covered through
`FirestoreRideRepository`'s adapter tests.

`FakeCloudFunctionsService.test.ts` — 6 tests covering default + seeded
tip results, spy bookkeeping, `failNext` one-shot semantics, per-method
isolation of `failNext`, `reset()`.

### 4. UserDoc DTO + userMapper extensions

- `RiderDocSchema` gains `defaultPaymentMethodId: z.string().nullish()`.
- `userMapper.toDomain` validates the legacy raw strings into branded
  ids via `parseStripeCustomerId` / `parseStripeAccountId` /
  `parsePaymentMethodId` helpers. **All three fall back to `null` (with
  a `LOG.warn`) on factory rejection rather than crashing the
  hydration.** A malformed Stripe id on a single user doc must not take
  down the auth flow.
- `userMapper.toDoc` stringifies branded ids cleanly via `String(...)`
  for the wire format. Rider docs now write `defaultPaymentMethodId`
  alongside `stripeCustomerId`; driver docs continue to write both the
  flat (canonical) and legacy nested `stripe: {...}` shapes from Turn 1.
- 5 new mapper test fixtures cover: read populated `defaultPaymentMethodId`
  → branded; read missing field → null; read malformed id → null with
  warn; write populated; write null (drops field cleanly on merge).

### 5. The 13 use cases

All in `src/app/usecases/payment/`, each with sibling
`__tests__/<UseCaseName>.test.ts`:

| Use case                      | Auth gate                          | Notes                                                                                                                 |
| ----------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `EnsureStripeCustomer`        | Signed-in rider                    | Idempotent on `rider.stripeCustomerId`. Persists via `setStripeCustomerId`.                                           |
| `CreateSetupIntent`           | Signed-in rider + customerId match | Defense-in-depth ownership check.                                                                                     |
| `ListPaymentMethods`          | Signed-in rider + customerId match | —                                                                                                                     |
| `SetDefaultPaymentMethod`     | Signed-in rider                    | Pure Firestore write, no Stripe call.                                                                                 |
| `DetachPaymentMethod`         | Signed-in rider                    | Clears default FIRST when detaching the default; restores best-effort on server failure.                              |
| `EnsureStripeConnectAccount`  | Signed-in driver                   | Idempotent on `driver.stripeAccountId`. Optional `country` arg.                                                       |
| `CreateConnectOnboardingLink` | Signed-in driver + accountId match | Returns `{url, expiresAt}` for `WebBrowser.openAuthSessionAsync`.                                                     |
| `CreateAccountLoginLink`      | Signed-in driver + accountId match | Express-dashboard URL — Turn 4 surfaces this.                                                                         |
| `RefreshConnectAccountStatus` | Signed-in driver + accountId match | Server read FIRST, doc write SECOND; partial-failure on doc write surfaces NetworkError so the caller knows to retry. |
| `GetDriverBalance`            | Signed-in driver + accountId match | Powers the Earnings tab headline.                                                                                     |
| `ListDriverPayouts`           | Signed-in driver + accountId match | Defaults `{days: 7, limit: 10}` per legacy.                                                                           |
| `ListBalanceTransactions`     | Signed-in driver + accountId match | Defaults `{days: 7, limit: 25}` per legacy.                                                                           |
| `ProcessTip`                  | Signed-in rider, IS the passenger  | Money → dollars at the boundary. $1 floor, whole-dollar requirement.                                                  |

`ProcessTip` enforces 4 client-side checks BEFORE the Cloud Function
call:

1. Currency must be USD.
2. Tip ≥ $1 (stricter than the function's $0.50 — matches legacy UX).
3. Tip is a whole number of dollars (`minorUnits % 100 === 0`)
   so the dollar conversion at the boundary doesn't lose precision.
4. Trip status is `'completed'` (otherwise the function rejects).

The function itself is server-idempotent on `(tripId, customerId)` via
its `payment.tipStatus === 'succeeded'` check, so a client retry after
a network blip is safe — the second call returns the original result
without double-charging.

### 6. DI container + TestContainerProvider

- `Deps` shape gains `stripeServer: StripeServerService` +
  `paymentCallable: PaymentCallableService`.
- `makeUseCases` wires the 13 new use cases in.
- Production branch lazy-`require()`s `StripeServerHttpAdapter` +
  instantiates `CloudFunctionsService`; fakes branch wires
  `FakeStripeServerService` + `FakeCloudFunctionsService`.
- New `buildStripeServerService` helper (mirrors
  `buildRoutesService`): if both `STRIPE_SERVER_URL` and
  `STRIPE_SERVER_API_KEY` env vars resolve, use the real adapter;
  otherwise log a warn and fall back to the fake. So a half-configured
  release build doesn't crash on first Stripe call.
- `TestContainerProvider` gains `stripeServer?` +
  `cloudFunctions?` override knobs. Existing view-model tests pass
  unchanged (no test currently mounts a payment-touching screen).

### 7. Env vars + app.config

- `app.config.ts` `extra` block gains `stripeServerUrl` +
  `stripeServerApiKey`. Both consumed via `expo-constants`'s `extra`
  bag at runtime, NOT prefixed `EXPO_PUBLIC_*` (build-time resolution
  → runtime read keeps the API key out of the bundled string blob).
- `src/shared/env/stripeServer.ts` — new `getStripeServerConfig()`
  helper returning `{url, apiKey} | null`. `null` when EITHER value is
  missing — both are required as a unit so partial config doesn't
  silently degrade to the fake.
- Re-exported from `@shared/env`'s index alongside
  `getGoogleMapsApiKey`.

The env validator (`validateEnv`) does NOT gate on these — they're
read via `extra`, not `process.env`. The DI container's loud `LOG.warn`
on missing config + the fake-with-loud-fail-on-unseeded behavior
together ensure a misconfigured release build fails visibly.

## Why this turn doesn't include

- **`@stripe/stripe-react-native`** — Turn 3 (Wallet UI). The
  `<StripeProvider>` mount, `CardForm`, `confirmSetupIntent`. Adapter
  - use cases land first so Turn 3 is purely UI-shaped work.
- **`expo-web-browser`** — Turn 4 (Connect onboarding). The
  `WebBrowser.openAuthSessionAsync` flow that opens the URL produced by
  `CreateConnectOnboardingLink`.
- **TanStack-Query mutation/query hooks** — Turns 3-5 add the hooks
  the screens they ship need; pre-emptively building them risks
  unused-export churn.
- **Wallet, AddPaymentMethod, Earnings screens** — Turns 3-4.
- **`TipSelector` component on RideReceipt** — Turn 5.

## Risks surfaced

- **Stripe SDK iOS modular-headers under `useFrameworks: 'static'`** —
  not exercised yet (no Stripe SDK in the bundle until Turn 3). Same
  family as the existing `@react-native-firebase` modular-headers fix
  in `scripts/patch-podfile.js`. Watch for it on the first iOS build
  after Turn 3 adds `@stripe/stripe-react-native`.
- **`useStripe()` hook test surface** — when Turn 3 builds the Wallet
  view-model, mock the hook at the `jest.mock('@stripe/stripe-react-native')`
  level exposing `confirmSetupIntent` etc. as `jest.fn()`s. Don't try
  to render `<CardForm/>` in tests.
- **Stripe Connect onboarding deeplink return** — Turn 4. The
  `WebBrowser.openAuthSessionAsync` Promise resolves to `{type, url}`.
  On `cancel`, no-op; on `success`, call `RefreshConnectAccountStatus`.
  Don't depend on URL params for state — re-fetch is the source of
  truth (the user could close the browser tab early).

## Acceptance

`npm run verify` (typecheck + lint + format + test) all green at end of
turn. **132 test suites / 1000 tests** (+17 suites / +123 tests over
Turn 1's 115/877).

A signed-in rider's `useCurrentUser()` returns a `Rider` with
`stripeCustomerId` and `defaultPaymentMethodId` typed as branded ids
(or `null`). Existing legacy drivers continue to hydrate cleanly via
the legacy nested `stripe: {...}` shape. The 13 use cases run end-to-
end against the in-memory fakes via `TestContainerProvider`.

The DI container wires the real `StripeServerHttpAdapter` +
`CloudFunctionsService` when Firebase + Stripe env are configured;
otherwise wires `FakeStripeServerService` + `FakeCloudFunctionsService`
with appropriate warnings.

## Optional integration smoke (manual, skipped in CI)

The HTTP adapter tests use `fetch`-mocking for unit coverage. To smoke
the real adapter against the staging Stripe microservice, set
`STRIPE_SERVER_URL` + `STRIPE_SERVER_API_KEY` and instantiate the
adapter directly:

```ts
import { StripeServerHttpAdapter } from '@data/services/StripeServerHttpAdapter';
const a = new StripeServerHttpAdapter({
  baseUrl: process.env.STRIPE_SERVER_URL!,
  apiKey: process.env.STRIPE_SERVER_API_KEY!,
});
const r = await a.createSetupIntent({
  customerId: /* a real cus_* from staging */,
});
console.log(r);
```

Run before any major adapter change — the 24 fetch-mocked tests cover
shape, but only a real call catches an accidental contract drift on
the server side.
