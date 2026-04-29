import { BalanceTransaction } from '@domain/entities/BalanceTransaction';
import type { Email } from '@domain/entities/Email';
import { Money } from '@domain/entities/Money';
import {
  PaymentMethod,
  normalizeCardBrand,
} from '@domain/entities/PaymentMethod';
import { PaymentMethodId } from '@domain/entities/PaymentMethodId';
import { Payout, type PayoutStatus } from '@domain/entities/Payout';
import { StripeAccountId } from '@domain/entities/StripeAccountId';
import { StripeCustomerId } from '@domain/entities/StripeCustomerId';
import type { UserId } from '@domain/entities/UserId';
import {
  AuthorizationError,
  NetworkError,
  ValidationError,
} from '@domain/errors';
import type { StripeServerService } from '@domain/services';
import { Result } from '@domain/shared/Result';
import { LOG } from '@shared/logger';

import { retryWithBackoff } from './_shared/retryWithBackoff';

const logger = LOG.extend('StripeServer');

/**
 * Concrete `StripeServerService` backed by the YeRide Stripe microservice
 * (`yeride-stripe-server`, deployed to Cloud Run). Speaks raw `fetch` —
 * the microservice exposes a small custom API rather than mirroring
 * Stripe's SDK shape, so a generic Stripe client wouldn't help.
 *
 * Construction:
 *   new StripeServerHttpAdapter({ baseUrl, apiKey })
 *
 * Both come from `app.config.ts` `extra` (resolved at app start via
 * `getStripeServerConfig` in `@shared/env`). Without them, the DI
 * container falls back to `FakeStripeServerService` instead of
 * instantiating this class.
 *
 * Auth: every request carries `Authorization: Bearer ${apiKey}`. The
 * server validates against `VALID_API_KEYS` (see
 * `yeride-stripe-server/middleware/auth.js`).
 *
 * Idempotency-Key: only on `createCustomer`
 * (`customer-create-{userId}`) — mirrors legacy. The other endpoints
 * are read-mostly or rely on server-side de-dupe (Connect account
 * creation goes through the use-case-level user-doc check, not
 * idempotency keys).
 *
 * Retry policy: 3 attempts (initial + 2 retries) with exponential
 * backoff (250 / 500 / 1000 ms). Retries fire only on transport throws
 * + 5xx responses; never on 4xx. Implemented via the shared
 * `retryWithBackoff` helper.
 *
 * Error mapping:
 *   - HTTP 401 / 403                      → AuthorizationError
 *   - HTTP 4xx (other)                    → ValidationError
 *   - HTTP 5xx + transport throw + JSON   → NetworkError
 *   - HTTP 2xx with body.success === false → ValidationError
 *
 * The adapter never throws domain errors — every failure is `Result.err(...)`.
 * Programming errors (a malformed response shape that crashes one of the
 * `parse*` helpers below) bubble up as plain `Error`.
 */
export interface StripeServerHttpAdapterConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
}

type AnyStripeServerError = NetworkError | AuthorizationError | ValidationError;

const RETRY_DELAYS_MS = [250, 500, 1000] as const;

export class StripeServerHttpAdapter implements StripeServerService {
  private readonly baseUrl: string;

  constructor(private readonly config: StripeServerHttpAdapterConfig) {
    // Trim a trailing slash so url composition stays clean.
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
  }

  async createCustomer(args: {
    userId: UserId;
    name: string;
    email: Email;
  }): Promise<Result<StripeCustomerId, AnyStripeServerError>> {
    const responseR = await this.postJson('/customers-create', {
      body: {
        userId: String(args.userId),
        name: args.name,
        email: args.email.value,
      },
      idempotencyKey: `customer-create-${String(args.userId)}`,
    });
    if (!responseR.ok) return responseR;

    const data = (responseR.value as { data?: { id?: unknown } }).data;
    const id = data?.id;
    if (typeof id !== 'string') {
      return Result.err(invalidShape('customers-create', 'data.id'));
    }
    const idR = StripeCustomerId.create(id);
    if (!idR.ok) {
      return Result.err(invalidShape('customers-create', 'data.id', idR.error));
    }
    return Result.ok(idR.value);
  }

  async createSetupIntent(args: {
    customerId: StripeCustomerId;
  }): Promise<Result<{ clientSecret: string }, AnyStripeServerError>> {
    const responseR = await this.postJson('/create-setup-intent', {
      body: { customerId: String(args.customerId) },
    });
    if (!responseR.ok) return responseR;

    const clientSecret = (responseR.value as { clientSecret?: unknown })
      .clientSecret;
    if (typeof clientSecret !== 'string' || clientSecret.length === 0) {
      return Result.err(invalidShape('create-setup-intent', 'clientSecret'));
    }
    return Result.ok({ clientSecret });
  }

  async listPaymentMethods(args: {
    customerId: StripeCustomerId;
  }): Promise<Result<readonly PaymentMethod[], AnyStripeServerError>> {
    const responseR = await this.postJson('/customer-payment-methods', {
      body: { customer: String(args.customerId) },
    });
    if (!responseR.ok) return responseR;

    const data = (responseR.value as { data?: unknown }).data;
    if (!Array.isArray(data)) {
      return Result.err(invalidShape('customer-payment-methods', 'data'));
    }
    const out: PaymentMethod[] = [];
    for (const raw of data) {
      const mapped = mapPaymentMethod(raw);
      if (mapped === null) {
        // Skip malformed rows (e.g. a non-card method type without an id);
        // failing the whole call would punish the user for one bad row.
        continue;
      }
      out.push(mapped);
    }
    return Result.ok(out);
  }

  async detachPaymentMethod(args: {
    paymentMethodId: PaymentMethodId;
  }): Promise<Result<void, AnyStripeServerError>> {
    const responseR = await this.postJson('/detach-payment-method', {
      body: { paymentMethodId: String(args.paymentMethodId) },
    });
    if (!responseR.ok) return responseR;
    return Result.ok(undefined);
  }

  async createConnectAccount(args: {
    userId: UserId;
    email: Email;
    country?: string;
  }): Promise<Result<StripeAccountId, AnyStripeServerError>> {
    const body: Record<string, unknown> = {
      userId: String(args.userId),
      email: args.email.value,
    };
    if (args.country !== undefined) body['country'] = args.country;
    const responseR = await this.postJson('/accounts-create', { body });
    if (!responseR.ok) return responseR;

    const data = (responseR.value as { data?: { id?: unknown } }).data;
    const id = data?.id;
    if (typeof id !== 'string') {
      return Result.err(invalidShape('accounts-create', 'data.id'));
    }
    const idR = StripeAccountId.create(id);
    if (!idR.ok) {
      return Result.err(invalidShape('accounts-create', 'data.id', idR.error));
    }
    return Result.ok(idR.value);
  }

  async createAccountLink(args: {
    accountId: StripeAccountId;
    refreshUrl: string;
    returnUrl: string;
  }): Promise<Result<{ url: string; expiresAt: Date }, AnyStripeServerError>> {
    const responseR = await this.postJson('/account-links-create', {
      body: {
        account: String(args.accountId),
        refresh_url: args.refreshUrl,
        return_url: args.returnUrl,
      },
    });
    if (!responseR.ok) return responseR;

    const data = (
      responseR.value as { data?: { url?: unknown; expires_at?: unknown } }
    ).data;
    const url = data?.url;
    const expiresAt = data?.expires_at;
    if (typeof url !== 'string' || url.length === 0) {
      return Result.err(invalidShape('account-links-create', 'data.url'));
    }
    if (typeof expiresAt !== 'number') {
      return Result.err(
        invalidShape('account-links-create', 'data.expires_at'),
      );
    }
    return Result.ok({ url, expiresAt: new Date(expiresAt * 1000) });
  }

  async createAccountLoginLink(args: {
    accountId: StripeAccountId;
  }): Promise<Result<{ url: string }, AnyStripeServerError>> {
    const responseR = await this.postJson('/create-login-link', {
      body: { account: String(args.accountId) },
    });
    if (!responseR.ok) return responseR;

    const data = (responseR.value as { data?: { url?: unknown } }).data;
    const url = data?.url;
    if (typeof url !== 'string' || url.length === 0) {
      return Result.err(invalidShape('create-login-link', 'data.url'));
    }
    return Result.ok({ url });
  }

  async retrieveAccount(args: {
    accountId: StripeAccountId;
  }): Promise<
    Result<
      { chargesEnabled: boolean; payoutsEnabled: boolean },
      AnyStripeServerError
    >
  > {
    const responseR = await this.postJson('/accounts-retrieve', {
      body: { account: String(args.accountId) },
    });
    if (!responseR.ok) return responseR;

    const data = (
      responseR.value as {
        data?: { charges_enabled?: unknown; payouts_enabled?: unknown };
      }
    ).data;
    const chargesEnabled = Boolean(data?.charges_enabled);
    const payoutsEnabled = Boolean(data?.payouts_enabled);
    return Result.ok({ chargesEnabled, payoutsEnabled });
  }

  async getAccountBalance(args: {
    accountId: StripeAccountId;
  }): Promise<
    Result<{ available: Money; pending: Money }, AnyStripeServerError>
  > {
    const responseR = await this.postJson('/account-balance', {
      body: { account: String(args.accountId) },
    });
    if (!responseR.ok) return responseR;

    const body = responseR.value as {
      available?: unknown;
      pending?: unknown;
    };
    const available = sumUsdMinorUnits(body.available);
    const pending = sumUsdMinorUnits(body.pending);
    if (available === null || pending === null) {
      return Result.err(
        invalidShape('account-balance', 'available/pending currency'),
      );
    }
    const availableR = Money.create(available, 'USD');
    const pendingR = Money.create(pending, 'USD');
    if (!availableR.ok) {
      return Result.err(
        invalidShape('account-balance', 'available', availableR.error),
      );
    }
    if (!pendingR.ok) {
      return Result.err(
        invalidShape('account-balance', 'pending', pendingR.error),
      );
    }
    return Result.ok({ available: availableR.value, pending: pendingR.value });
  }

  async listAccountPayouts(args: {
    accountId: StripeAccountId;
    days: number;
    limit: number;
  }): Promise<Result<readonly Payout[], AnyStripeServerError>> {
    const responseR = await this.postJson('/account-payouts', {
      body: {
        account: String(args.accountId),
        days: args.days,
        limit: args.limit,
      },
    });
    if (!responseR.ok) return responseR;

    const data = (responseR.value as { data?: unknown }).data;
    if (!Array.isArray(data)) {
      return Result.err(invalidShape('account-payouts', 'data'));
    }
    const out: Payout[] = [];
    for (const raw of data) {
      const mapped = mapPayout(raw);
      if (mapped !== null) out.push(mapped);
    }
    return Result.ok(out);
  }

  async listBalanceTransactions(args: {
    accountId: StripeAccountId;
    days: number;
    limit: number;
  }): Promise<Result<readonly BalanceTransaction[], AnyStripeServerError>> {
    const responseR = await this.postJson('/account-balance-transactions', {
      body: {
        account: String(args.accountId),
        days: args.days,
        limit: args.limit,
      },
    });
    if (!responseR.ok) return responseR;

    const data = (responseR.value as { data?: unknown }).data;
    if (!Array.isArray(data)) {
      return Result.err(invalidShape('account-balance-transactions', 'data'));
    }
    const out: BalanceTransaction[] = [];
    for (const raw of data) {
      const mapped = mapBalanceTransaction(raw);
      if (mapped !== null) out.push(mapped);
    }
    return Result.ok(out);
  }

  /* ───── transport ───── */

  /**
   * POST a JSON body, retry transient failures, map the response into a
   * domain error or the parsed body.
   *
   * `idempotencyKey`, when supplied, is sent as the `Idempotency-Key`
   * header (canonical Stripe casing — the server accepts case-insensitive,
   * but we send the canonical form so a fetch-mock spy is asserting the
   * string we expect).
   */
  private async postJson(
    path: string,
    args: { body: Record<string, unknown>; idempotencyKey?: string },
  ): Promise<Result<unknown, AnyStripeServerError>> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.config.apiKey}`,
    };
    if (args.idempotencyKey !== undefined) {
      headers['Idempotency-Key'] = args.idempotencyKey;
    }
    const init: RequestInit = {
      method: 'POST',
      headers,
      body: JSON.stringify(args.body),
    };

    try {
      return await retryWithBackoff(() => this.attempt(url, init, path), {
        attempts: RETRY_DELAYS_MS.length + 1,
        delaysMs: [...RETRY_DELAYS_MS],
        shouldRetry: isTransientError,
      });
    } catch (e) {
      // The helper rethrows the LAST attempt's error. If it's already a
      // domain error wrapped in our sentinel, unwrap; otherwise this is an
      // unexpected programmer-error throw.
      if (e instanceof TransientHttpError) {
        return Result.err(e.toDomainError());
      }
      throw e;
    }
  }

  /**
   * One pump of the request. Resolves with `Result.ok(parsed json body)`
   * or `Result.err(domain error)` for non-transient failures. Throws a
   * `TransientHttpError` for transient failures so `retryWithBackoff` can
   * re-attempt; that wrapper carries the domain error to surface if all
   * retries exhaust.
   */
  private async attempt(
    url: string,
    init: RequestInit,
    path: string,
  ): Promise<Result<unknown, AnyStripeServerError>> {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (cause) {
      logger.warn('fetch threw', { path });
      throw new TransientHttpError(
        new NetworkError({
          code: 'stripe_server_request_failed',
          message: `Stripe server ${path} request failed`,
          cause,
        }),
      );
    }

    // 4xx (non-auth) — non-transient; map immediately.
    if (response.status >= 400 && response.status < 500) {
      const parsedBody = await tryReadJson(response);
      if (response.status === 401 || response.status === 403) {
        return Result.err(
          new AuthorizationError({
            code: extractServerCode(parsedBody, 'stripe_server_unauthorized'),
            message: extractServerMessage(
              parsedBody,
              `Stripe server ${path} returned HTTP ${String(response.status)}`,
            ),
          }),
        );
      }
      return Result.err(
        new ValidationError({
          code: extractServerCode(parsedBody, 'stripe_server_validation'),
          message: extractServerMessage(
            parsedBody,
            `Stripe server ${path} returned HTTP ${String(response.status)}`,
          ),
        }),
      );
    }

    // 5xx — transient; throw so retryWithBackoff re-attempts. The wrapper
    // carries the domain error we'll surface if all retries fail.
    if (response.status >= 500) {
      throw new TransientHttpError(
        new NetworkError({
          code: 'stripe_server_server_error',
          message: `Stripe server ${path} returned HTTP ${String(response.status)}`,
        }),
      );
    }

    // 2xx — parse + apply the body.success === false defense-in-depth check.
    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      return Result.err(
        new NetworkError({
          code: 'stripe_server_response_invalid_json',
          message: `Stripe server ${path} returned non-JSON`,
          cause,
        }),
      );
    }
    if (
      typeof body === 'object' &&
      body !== null &&
      'success' in body &&
      (body as { success?: unknown }).success === false
    ) {
      return Result.err(
        new ValidationError({
          code: extractServerCode(body, 'stripe_server_unsuccessful'),
          message: extractServerMessage(
            body,
            `Stripe server ${path} reported success: false`,
          ),
        }),
      );
    }
    return Result.ok(body);
  }
}

/* ───── helpers ───── */

/**
 * Wraps a transient domain error so `retryWithBackoff` can recognize it as
 * "retry me, please" via `isTransientError`. The wrapper's `toDomainError`
 * is what surfaces if every attempt fails.
 */
class TransientHttpError extends Error {
  constructor(private readonly inner: NetworkError) {
    super(inner.message);
    this.name = 'TransientHttpError';
  }
  toDomainError(): NetworkError {
    return this.inner;
  }
}

function isTransientError(e: unknown): boolean {
  return e instanceof TransientHttpError;
}

async function tryReadJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function extractServerCode(body: unknown, fallback: string): string {
  if (
    typeof body === 'object' &&
    body !== null &&
    'errorCode' in body &&
    typeof (body as { errorCode: unknown }).errorCode === 'string'
  ) {
    return (body as { errorCode: string }).errorCode;
  }
  if (
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    typeof (body as { error: unknown }).error === 'string'
  ) {
    return (body as { error: string }).error;
  }
  return fallback;
}

function extractServerMessage(body: unknown, fallback: string): string {
  if (
    typeof body === 'object' &&
    body !== null &&
    'message' in body &&
    typeof (body as { message: unknown }).message === 'string'
  ) {
    return (body as { message: string }).message;
  }
  return fallback;
}

function invalidShape(
  endpoint: string,
  field: string,
  cause?: unknown,
): NetworkError {
  return new NetworkError({
    code: 'stripe_server_response_invalid_shape',
    message: `Stripe server ${endpoint}: missing or invalid ${field}`,
    cause,
  });
}

/**
 * `/account-balance` returns Stripe's `available` / `pending` arrays, each
 * an array of `{amount, currency}` rows (one per currency). The rewrite
 * supports USD only; sum the USD rows. Returns null if any USD row has a
 * non-integer amount, or no rows are present.
 */
function sumUsdMinorUnits(raw: unknown): number | null {
  if (!Array.isArray(raw)) return null;
  let total = 0;
  let saw = false;
  for (const row of raw) {
    if (typeof row !== 'object' || row === null) continue;
    const r = row as { amount?: unknown; currency?: unknown };
    if (typeof r.currency !== 'string') continue;
    if (r.currency.toLowerCase() !== 'usd') continue;
    if (typeof r.amount !== 'number' || !Number.isInteger(r.amount)) {
      return null;
    }
    total += r.amount;
    saw = true;
  }
  // If the array was empty or had no USD rows, treat as 0.
  return saw ? total : 0;
}

function mapPaymentMethod(raw: unknown): PaymentMethod | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as {
    id?: unknown;
    brand?: unknown;
    last4?: unknown;
    exp_month?: unknown;
    exp_year?: unknown;
  };
  if (typeof r.id !== 'string') return null;
  if (typeof r.last4 !== 'string') return null;
  const idR = PaymentMethodId.create(r.id);
  if (!idR.ok) return null;
  // The legacy server doesn't expose expiry; tolerate both shapes so a
  // future additive change to the server works without an adapter edit.
  let expiry: { month: number; year: number } | null = null;
  if (
    typeof r.exp_month === 'number' &&
    typeof r.exp_year === 'number' &&
    Number.isInteger(r.exp_month) &&
    Number.isInteger(r.exp_year)
  ) {
    expiry = { month: r.exp_month, year: r.exp_year };
  }
  const pmR = PaymentMethod.create({
    id: idR.value,
    brand: normalizeCardBrand(typeof r.brand === 'string' ? r.brand : null),
    last4: r.last4,
    expiry,
  });
  if (!pmR.ok) return null;
  return pmR.value;
}

const PAYOUT_STATUSES: ReadonlySet<PayoutStatus> = new Set<PayoutStatus>([
  'paid',
  'pending',
  'in_transit',
  'failed',
  'canceled',
]);

function mapPayout(raw: unknown): Payout | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as {
    id?: unknown;
    amount?: unknown;
    currency?: unknown;
    status?: unknown;
    arrival_date?: unknown;
  };
  if (typeof r.id !== 'string' || r.id.length === 0) return null;
  if (typeof r.amount !== 'number' || !Number.isInteger(r.amount)) return null;
  if (typeof r.currency !== 'string' || r.currency.toLowerCase() !== 'usd') {
    return null;
  }
  const status =
    typeof r.status === 'string' &&
    PAYOUT_STATUSES.has(r.status as PayoutStatus)
      ? (r.status as PayoutStatus)
      : null;
  if (status === null) return null;
  if (typeof r.arrival_date !== 'number') return null;
  const moneyR = Money.create(r.amount, 'USD');
  if (!moneyR.ok) return null;
  const payoutR = Payout.create({
    id: r.id,
    amount: moneyR.value,
    status,
    arrivalDate: new Date(r.arrival_date * 1000),
  });
  if (!payoutR.ok) return null;
  return payoutR.value;
}

function mapBalanceTransaction(raw: unknown): BalanceTransaction | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as {
    id?: unknown;
    amount?: unknown;
    fee?: unknown;
    net?: unknown;
    type?: unknown;
    currency?: unknown;
    created?: unknown;
    tripId?: unknown;
  };
  if (typeof r.id !== 'string' || r.id.length === 0) return null;
  if (typeof r.type !== 'string' || r.type.length === 0) return null;
  if (typeof r.currency !== 'string' || r.currency.toLowerCase() !== 'usd') {
    return null;
  }
  if (typeof r.amount !== 'number' || !Number.isInteger(r.amount)) return null;
  if (typeof r.fee !== 'number' || !Number.isInteger(r.fee)) return null;
  if (typeof r.net !== 'number' || !Number.isInteger(r.net)) return null;
  if (typeof r.created !== 'number') return null;
  const amountR = Money.create(r.amount, 'USD');
  const feeR = Money.create(r.fee, 'USD');
  const netR = Money.create(r.net, 'USD');
  if (!amountR.ok || !feeR.ok || !netR.ok) return null;
  const txnR = BalanceTransaction.create({
    id: r.id,
    amount: amountR.value,
    fee: feeR.value,
    net: netR.value,
    createdAt: new Date(r.created * 1000),
    type: r.type,
    tripId: typeof r.tripId === 'string' ? r.tripId : null,
  });
  if (!txnR.ok) return null;
  return txnR.value;
}
