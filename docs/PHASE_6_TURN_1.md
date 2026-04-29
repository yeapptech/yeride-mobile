# Phase 6 — Turn 1: Domain + DTO + in-memory fakes

The opening turn of Phase 6 (Payments / Stripe Connect / tipping). Pure
domain + data-layer work — no Firebase, no Stripe SDK, no use cases, no
UI. Establishes every type and contract subsequent turns will lean on:

- `StripeCustomerId`, `StripeAccountId`, `PaymentMethodId` — three
  branded ID types
- `PaymentMethod`, `Payout`, `BalanceTransaction`, `StripeAccountStatus`
  — four payment value objects
- `StripeServerService` interface (11 methods)
- `FakeStripeServerService` in `@shared/testing`
- `UserDoc` DTO + `userMapper` patched to read/write the legacy nested
  `stripe: { id, charges_enabled, payouts_enabled }` shape alongside the
  canonical flat fields

End of turn: **115 suites / 877 tests passing**, **+8 suites / +78 tests**
on top of Phase 5 turn 4's 107/799. typecheck + lint + format + test all
green.

## What's in

### Domain layer

**`StripeCustomerId`** (`src/domain/entities/StripeCustomerId.ts`) —
branded `Brand<string, 'StripeCustomerId'>`. Factory enforces the
literal `cus_` prefix + a 1..255-char alphanumeric body. Used to address
a rider's Stripe customer record.

**`StripeAccountId`** (`src/domain/entities/StripeAccountId.ts`) —
branded `Brand<string, 'StripeAccountId'>`. Factory enforces the literal
`acct_` prefix + a 1..255-char alphanumeric body. Used to address a
driver's Stripe Connect account.

**`PaymentMethodId`** (`src/domain/entities/PaymentMethodId.ts`) —
branded `Brand<string, 'PaymentMethodId'>`. Factory enforces the literal
`pm_` prefix + a 1..255-char alphanumeric body. Used to address a saved
card on a rider's customer.

The three IDs are deliberately distinct branded types — Stripe routes
each through different endpoints on the microservice (`cus_*` to
customer endpoints, `acct_*` to Connect endpoints, `pm_*` to
payment-method endpoints) and mixing them is a class of bug the type
system should catch.

**`PaymentMethod`** (`src/domain/entities/PaymentMethod.ts`) — value
object over a saved card. Fields: `id: PaymentMethodId`, `brand:
CardBrand`, `last4: string`, `expiry: { month, year }`. Closed
`CardBrand` union (`visa | mastercard | amex | discover | diners | jcb |
unionpay | unknown`); Stripe brand strings outside the closed set land
at `'unknown'` rather than rejecting (so the wallet renders every
method, even if Stripe adds a new brand). `normalizeCardBrand(raw)` is
the coercion helper; the adapter calls it before constructing the value
object. Validation rejects last4 not exactly 4 digits, month out of 1-12,
year not a 4-digit number 2000..2099. Does NOT reject already-expired
cards — Stripe exposes them in the saved-methods list and the rider may
want to update the expiry; `isExpired(now)` is provided as a
presentation helper, with a December → next-January cutover boundary.

**`Payout`** (`src/domain/entities/Payout.ts`) — value object over a
Stripe payout (transfer to a driver's external bank account). Fields:
`id: string` (opaque `po_*`), `amount: Money`, `status: PayoutStatus`,
`arrivalDate: Date`. `PayoutStatus` is the closed union `'paid' |
'pending' | 'in_transit' | 'failed' | 'canceled'` matching Stripe's
documented states. Validation rejects empty id, unknown status, invalid
Date.

**`BalanceTransaction`** (`src/domain/entities/BalanceTransaction.ts`)
— value object over a Stripe balance-transaction ledger row. Fields:
`id: string` (opaque `txn_*`), `amount: Money`, `fee: Money`, `net:
Money`, `createdAt: Date`, `type: string`, `tripId: string | null`.
Invariant enforced at construction: **`net = amount - fee`** (Stripe
guarantees this server-side; we re-check at the boundary so a buggy
adapter can't construct a malformed row). `type` is left as a free-form
string because Stripe adds types over time; `tripId` resolution is the
microservice's job (it traverses the `source.source_transfer
.source_transaction.metadata.tripId` chain in
`yeride-stripe-server/stripe/routes.js`).

**`StripeAccountStatus`** (`src/domain/entities/StripeAccountStatus.ts`)
— discriminated union over the four states a driver's Connect
onboarding can be in:

```
{ kind: 'no_account' }                                  - no stripeAccountId yet
{ kind: 'pending', accountId: StripeAccountId }         - account exists, charges/payouts not both true
{ kind: 'enabled', accountId: StripeAccountId }         - both flags true
```

`disabled` is intentionally NOT modelled today — Stripe's
`requirements.disabled_reason` (KYC failure, fraud review) folds into
`pending` for now and surfaces "Continue setup" in the UI. Add a
dedicated `disabled` arm if the UI grows distinct copy. The pure
helper `deriveStripeAccountStatus({accountId, chargesEnabled,
payoutsEnabled})` is a total function over the inputs — no Result, no
factory ceremony.

### `StripeServerService` interface

`src/domain/services/StripeServerService.ts` — 11-method interface
abstracting the YeRide Stripe microservice. Every method returns
`Promise<Result<X, NetworkError | AuthorizationError | ValidationError>>`.

| Method                    | Maps to legacy endpoint        |
| ------------------------- | ------------------------------ |
| `createCustomer`          | `customers-create`             |
| `createSetupIntent`       | `create-setup-intent`          |
| `listPaymentMethods`      | `customer-payment-methods`     |
| `detachPaymentMethod`     | `detach-payment-method`        |
| `createConnectAccount`    | `accounts-create`              |
| `createAccountLink`       | `account-links-create`         |
| `createAccountLoginLink`  | `create-login-link`            |
| `retrieveAccount`         | `accounts-retrieve`            |
| `getAccountBalance`       | `account-balance`              |
| `listAccountPayouts`      | `account-payouts`              |
| `listBalanceTransactions` | `account-balance-transactions` |

Tipping does NOT live here — `tipDriver` is a Cloud Functions callable
(orchestration of charge + driver notification + TripPayment write
happens server-side in `yeride-functions/handlers/tip-driver.js`), so
Phase 6 turn 2 extends `CloudFunctionsService` rather than
`StripeServerService`.

Error semantics:

- `NetworkError` — transport failure or 5xx (transient). UI surfaces
  "Couldn't connect — tap to retry".
- `AuthorizationError` — 401/403. Either the `STRIPE_SERVER_API_KEY`
  Bearer was rejected, or the rider/driver doesn't own the resource.
  Non-recoverable in the UI.
- `ValidationError` — 4xx (excl. auth). Adapter mapped a field-level
  Stripe error to a domain code. Form-level error in the UI.

### `FakeStripeServerService`

`src/shared/testing/FakeStripeServerService.ts` — programmable in-memory
implementation. Default behavior is "fail loudly with an unprimed-
method error" so tests must explicitly seed the data they expect to
read.

Seed seams: `seedCustomer`, `seedSetupIntent`, `seedPaymentMethods`,
`seedConnectAccount`, `seedBalance`, `seedPayouts`,
`seedBalanceTransactions`, `seedAccountLink`, `seedAccountLoginLink`.

Spy seams (read-only `.spies` getter): `createCustomerCalls`,
`createSetupIntentCalls`, `listPaymentMethodsCalls`, `detachCalls`,
`createConnectCalls`, `createAccountLinkCalls`,
`createAccountLoginLinkCalls`, `retrieveAccountCalls`,
`getAccountBalanceCalls`, `listAccountPayoutsCalls`,
`listBalanceTransactionsCalls`.

Failure injection: `failNext({ method, error })` primes the next call
to `method` to return `Result.err(error)`. One-shot — subsequent calls
run the seeded path again.

Idempotency: `createCustomer` mirrors the real `/customers-create`
endpoint by returning the seeded customer when called twice with the
same email. If no customer is seeded for the email, a fresh
deterministic id is minted (`cus_fake{counter}`) and remembered so
repeat calls return the same id.

`reset()` clears all seeded state, spies, and primed failures —
covered by a dedicated test case.

12 unit tests covering: idempotent createCustomer (seeded path), mint-
and-remember on first miss, spy bookkeeping, failNext one-shot
propagation, setup-intent round-trip, list/detach symmetry, Connect
retrieveAccount round-trip, account-link round-trip + spy capture,
balance + payouts + transactions round-trip + spy capture, failNext
per-method isolation, full reset.

### Data layer: legacy nested `stripe` shape

**Critical pre-Phase-6 hygiene fix.** Legacy yeride writes the Stripe
Connect account to the user doc as a NESTED object — the full Stripe
`accounts.create` response is spread into `user.stripe`:

```js
// legacy auth/screens/Register.js:455
setUser({ ...user, stripe: { ...stripeData } });
```

So existing legacy drivers have `users/{uid}.stripe = { id: 'acct_...',
charges_enabled: true, payouts_enabled: false, country: 'US', ... }`.
The rewrite's `DriverDocSchema` previously only declared the flat
canonical fields (`stripeAccountId / stripeChargesEnabled /
stripePayoutsEnabled`), so every existing legacy driver would have
appeared "no Connect account" to the rewrite and Phase 6 use cases would
have triggered duplicate Connect-account creation on first launch.

Two coupled fixes:

1. **`UserDoc` DTO** (`src/data/dto/UserDoc.ts`) — `DriverDocSchema`
   gains an optional `stripe: LegacyStripeDriverNestedSchema.nullish()`
   field that accepts the legacy nested object via `passthrough()`. The
   nested schema declares `id` (required), `charges_enabled`,
   `payouts_enabled` and lets every other Stripe field round-trip
   without affecting the parse.

2. **`userMapper`** (`src/data/mappers/userMapper.ts`) —
   - `toDomain`: prefers the flat fields; falls back to `doc.stripe?.id
?? null`, `doc.stripe?.charges_enabled ?? false`,
     `doc.stripe?.payouts_enabled ?? false` if the flat fields are
     absent.
   - `toDoc`: emits **both** shapes for driver users — flat fields
     (canonical, what the rewrite reads efficiently) **and** a nested
     `stripe: { id, charges_enabled, payouts_enabled }` for legacy
     yeride compatibility. Uses `setDoc { merge: true }` semantics so
     fields neither side tracks survive. Writes `null` for both shapes
     when no Stripe Connect account exists yet, so `setDoc { merge:
true }` doesn't create an empty `stripe: {}` object.

Four new mapper test cases:

- Reads the legacy nested shape when flat fields are absent (existing
  legacy driver surfaces correctly).
- Prefers flat fields when both are present (rewrite has won the
  cleanup; flat is canonical).
- Writes both shapes for a driver with a Stripe account (legacy yeride
  keeps reading state).
- Omits both shapes (`null`) when the driver has no account yet.

A future cleanup migration can drop the nested shape once legacy yeride
is retired; until then the dual-write is the cheapest co-existence
strategy.

### Index re-exports

- `src/domain/entities/index.ts` — adds `StripeCustomerId`,
  `StripeAccountId`, `PaymentMethodId`, `PaymentMethod` (+ helpers /
  types), `Payout`, `BalanceTransaction`, `StripeAccountStatus`.
- `src/domain/services/index.ts` — adds `StripeServerService` type.
- `src/shared/testing/index.ts` — adds `FakeStripeServerService` and
  `FakeStripeServerSpies` type.

## Why this turn doesn't include

- **`StripeServerHttpAdapter`** — Phase 6 turn 2. Real `fetch`-backed
  implementation with Bearer-token auth, structured error mapping,
  retry policy. No-deps for turn 1; turn 2 adds the adapter file and
  smoke tests.
- **`CloudFunctionsService.tipDriver` extension** — Phase 6 turn 2.
  Same callable shape as `completeTrip` / `cancelTrip`.
- **12 use cases** — Phase 6 turn 2. `EnsureStripeCustomer`,
  `CreateSetupIntent`, `ListPaymentMethods`, `DetachPaymentMethod`,
  `SetDefaultPaymentMethod`, `EnsureStripeConnectAccount`,
  `CreateConnectOnboardingLink`, `RefreshConnectAccountStatus`,
  `GetDriverBalance`, `ListDriverPayouts`, `ListBalanceTransactions`,
  `ProcessTip`. Each tests against the in-memory fake.
- **DI container wiring** — Phase 6 turn 2. Lazy-`require()` of the
  HTTP adapter in the production branch; `FakeStripeServerService` in
  the fakes branch.
- **`@stripe/stripe-react-native` dependency + `expo-web-browser`** —
  Phase 6 turn 3 (Wallet UI), turn 4 (Connect onboarding). No native
  config touched in turn 1.
- **App.tsx `<StripeProvider>` mount** — Phase 6 turn 3.

## Risks surfaced

- **`@stripe/stripe-react-native` modular-headers under `useFrameworks:
'static'`** — same family as the existing `@react-native-firebase`
  modular-headers fix in `scripts/patch-podfile.js`. The Stripe SDK
  ships its own modular headers, but its dependency `Stripe-iOS` may
  need a `:modular_headers => true` pin. Mitigation: include a Stripe
  SDK smoke (mount the `<StripeProvider/>`, log a publishable-key
  check) in turn 3's dual-mode boot; if the build fails, extend
  `scripts/patch-podfile.js` with the right pin before moving to the
  Wallet UI. No turn-1 surface.
- **Tip-amount unit mismatch** — `yeride-functions/handlers/tip-driver.js`
  takes `tipAmount` in dollars (not cents) with a $0.50 minimum, while
  legacy `processTipPayment` (direct-charge path) uses cents with a $1
  minimum. The rewrite's domain `Money` is in minor units. Phase 6
  turn 5 will need a `Money → dollars` adaptation at the `ProcessTip`
  use case → callable boundary, and the rewrite enforces the $1 floor
  itself (matching legacy UX, stricter than the function). Called out
  here so it doesn't surprise turn 5.
- **`FakeStripeServerService` over-strict on unseeded reads** — methods
  like `createConnectAccount`, `createAccountLink`,
  `createAccountLoginLink`, `retrieveAccount`, `getAccountBalance`
  throw rather than return `Result.err` when called without prior
  seeding. Deliberate — surfacing forgot-to-seed loudly in a test is
  cheaper than silently inventing values. Use cases in turn 2 will
  exercise the seeded paths; if a turn-2 test wants to assert "fails
  cleanly when the network is down", it uses `failNext` to inject a
  primed `NetworkError`.

## Acceptance

A signed-in driver who has an existing legacy `users/{uid}.stripe = {id,
charges_enabled, payouts_enabled}` document hydrates correctly into the
rewrite's `Driver` entity:

```ts
driver.stripeAccountId === legacyDoc.stripe.id;
driver.stripeChargesEnabled === legacyDoc.stripe.charges_enabled ?? false;
driver.stripePayoutsEnabled === legacyDoc.stripe.payouts_enabled ?? false;
```

When the rewrite later writes that driver's user doc back, BOTH the
flat fields AND the nested `stripe: {...}` shape are emitted, so legacy
yeride continues to read state. None of this is wired through a use
case yet — the assertion is on the mapper round-trip, exercised by
the four new test fixtures in
`src/data/mappers/__tests__/userMapper.test.ts`.

`FakeStripeServerService` is wireable but not yet wired through the DI
container. That happens in turn 2, when the use cases that consume it
land.

`npm run verify` (typecheck + lint + format + test) green.
