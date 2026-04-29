import type { BalanceTransaction } from '../entities/BalanceTransaction';
import type { Email } from '../entities/Email';
import type { Money } from '../entities/Money';
import type { PaymentMethod } from '../entities/PaymentMethod';
import type { PaymentMethodId } from '../entities/PaymentMethodId';
import type { Payout } from '../entities/Payout';
import type { StripeAccountId } from '../entities/StripeAccountId';
import type { StripeCustomerId } from '../entities/StripeCustomerId';
import type { UserId } from '../entities/UserId';
import type {
  AuthorizationError,
  NetworkError,
  ValidationError,
} from '../errors';
import type { Result } from '../shared/Result';

/**
 * Abstraction over the YeRide Stripe microservice (`yeride-stripe-server`).
 * The data layer's `StripeServerHttpAdapter` (Phase 6 turn 2) speaks HTTPS
 * against the deployed Cloud Run service using a Bearer token from env.
 *
 * Endpoint coverage mirrors the legacy `paymentProcessor.js` surface area
 * the rewrite needs:
 *
 *   /customers-create                  → createCustomer
 *   /create-setup-intent               → createSetupIntent
 *   /customer-payment-methods          → listPaymentMethods
 *   /detach-payment-method             → detachPaymentMethod
 *   /accounts-create                   → createConnectAccount
 *   /account-links-create              → createAccountLink
 *   /create-login-link                 → createAccountLoginLink
 *   /accounts-retrieve                 → retrieveAccount
 *   /account-balance                   → getAccountBalance
 *   /account-payouts                   → listAccountPayouts
 *   /account-balance-transactions      → listBalanceTransactions
 *
 * Tipping does NOT live here — `tipDriver` is a Cloud Functions callable
 * (orchestration of charge + driver notification + TripPayment write
 * happens server-side in `yeride-functions`), not a direct Stripe-server
 * call. See `CloudFunctionsService.tipDriver` (Phase 6 turn 2).
 *
 * Error semantics:
 *   - `NetworkError`        — transport failure or 5xx (transient).
 *     Kicks the "Couldn't connect — tap to retry" UI surface.
 *   - `AuthorizationError`  — 401/403 from the server. Means the
 *     `STRIPE_SERVER_API_KEY` Bearer was rejected, or the rider/driver
 *     doesn't own the resource they're addressing. Surface as a
 *     non-recoverable hard error in the UI; user-facing fix is "sign out
 *     and back in".
 *   - `ValidationError`     — 4xx from the server (excl. auth). Means the
 *     payload was malformed; the adapter mapped a field-level Stripe error
 *     to a domain code. Surface as a form-level error.
 */
export interface StripeServerService {
  /**
   * Idempotently create (or return existing) a Stripe Customer for a
   * rider. Mirrors the `customers-create` endpoint's de-dupe-by-email
   * behavior — the server returns the existing customer if one already
   * exists for `email`.
   *
   * Idempotency key (server-side request header): `customer-create-{userId}`.
   */
  createCustomer(args: {
    userId: UserId;
    name: string;
    email: Email;
  }): Promise<
    Result<
      StripeCustomerId,
      NetworkError | AuthorizationError | ValidationError
    >
  >;

  /**
   * Create a SetupIntent for the rider's customer. The returned
   * `clientSecret` is fed into `confirmSetupIntent({clientSecret})` on the
   * device by `@stripe/stripe-react-native` to attach a card.
   */
  createSetupIntent(args: {
    customerId: StripeCustomerId;
  }): Promise<
    Result<
      { clientSecret: string },
      NetworkError | AuthorizationError | ValidationError
    >
  >;

  /**
   * List the rider's saved payment methods. Returned in Stripe's order
   * (most-recently-attached first); the rewrite's view-models can re-sort
   * by default-payment-method indicator.
   */
  listPaymentMethods(args: {
    customerId: StripeCustomerId;
  }): Promise<
    Result<
      readonly PaymentMethod[],
      NetworkError | AuthorizationError | ValidationError
    >
  >;

  /**
   * Detach a payment method from the rider's customer. Permanent —
   * Stripe's resource is destroyed from the customer's perspective. The
   * rewrite's view-model handles the "is-this-the-default?" pre-check.
   */
  detachPaymentMethod(args: {
    paymentMethodId: PaymentMethodId;
  }): Promise<
    Result<void, NetworkError | AuthorizationError | ValidationError>
  >;

  /**
   * Create a Stripe Connect account for a driver. Server-side controller
   * setup is `controller.losses.payments = 'stripe'`, `controller.fees.payer
   * = 'account'`, full Express dashboard. Idempotency is the SERVER's
   * responsibility — the rewrite's `EnsureStripeConnectAccount` use case
   * checks the user doc first and only calls this when no account id
   * exists.
   *
   * `country` defaults to `'US'` server-side if omitted.
   */
  createConnectAccount(args: {
    userId: UserId;
    email: Email;
    country?: string;
  }): Promise<
    Result<StripeAccountId, NetworkError | AuthorizationError | ValidationError>
  >;

  /**
   * Create a one-shot URL the driver opens (in a `WebBrowser` auth-session
   * tab) to fill out KYC paperwork. URL expires per Stripe's policy.
   * `refreshUrl` and `returnUrl` are deeplinks back into the app — both
   * resolve to the same Earnings-tab refresh path.
   */
  createAccountLink(args: {
    accountId: StripeAccountId;
    refreshUrl: string;
    returnUrl: string;
  }): Promise<
    Result<
      { url: string; expiresAt: Date },
      NetworkError | AuthorizationError | ValidationError
    >
  >;

  /**
   * Create a one-shot login URL into the driver's Express dashboard.
   * Surfaced behind a "View Express dashboard" affordance.
   */
  createAccountLoginLink(args: {
    accountId: StripeAccountId;
  }): Promise<
    Result<{ url: string }, NetworkError | AuthorizationError | ValidationError>
  >;

  /**
   * Re-fetch the driver's Connect account flags from Stripe. Consumed by
   * `RefreshConnectAccountStatus` after the `WebBrowser` onboarding session
   * returns, to update the user doc's flat `stripeChargesEnabled /
   * stripePayoutsEnabled` fields.
   */
  retrieveAccount(args: {
    accountId: StripeAccountId;
  }): Promise<
    Result<
      { chargesEnabled: boolean; payoutsEnabled: boolean },
      NetworkError | AuthorizationError | ValidationError
    >
  >;

  /**
   * Available + pending balance on the driver's Connect account. Powers
   * the headline number on the Earnings tab.
   */
  getAccountBalance(args: {
    accountId: StripeAccountId;
  }): Promise<
    Result<
      { available: Money; pending: Money },
      NetworkError | AuthorizationError | ValidationError
    >
  >;

  /**
   * Recent payouts (transfers from the Connect balance to the driver's
   * external bank account). `days` and `limit` mirror the legacy
   * `getAccountPayouts` defaults (7 / 10).
   */
  listAccountPayouts(args: {
    accountId: StripeAccountId;
    days: number;
    limit: number;
  }): Promise<
    Result<
      readonly Payout[],
      NetworkError | AuthorizationError | ValidationError
    >
  >;

  /**
   * Recent balance-transaction ledger rows. The microservice handles
   * `metadata.tripId` traversal across the source-transfer chain so the
   * rewrite consumes pre-resolved `tripId` values.
   */
  listBalanceTransactions(args: {
    accountId: StripeAccountId;
    days: number;
    limit: number;
  }): Promise<
    Result<
      readonly BalanceTransaction[],
      NetworkError | AuthorizationError | ValidationError
    >
  >;
}
