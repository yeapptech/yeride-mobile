import type { BalanceTransaction } from '@domain/entities/BalanceTransaction';
import type { Email } from '@domain/entities/Email';
import type { Money } from '@domain/entities/Money';
import type { PaymentMethod } from '@domain/entities/PaymentMethod';
import type { PaymentMethodId } from '@domain/entities/PaymentMethodId';
import type { Payout } from '@domain/entities/Payout';
import type { StripeAccountId } from '@domain/entities/StripeAccountId';
import { StripeCustomerId } from '@domain/entities/StripeCustomerId';
import type { UserId } from '@domain/entities/UserId';
import type {
  AuthorizationError,
  NetworkError,
  ValidationError,
} from '@domain/errors';
import type { StripeServerService } from '@domain/services';
import { Result } from '@domain/shared/Result';

/**
 * Programmable in-memory `StripeServerService` for tests. Default behavior
 * is "fail loudly with an unprimed-method error" so tests must explicitly
 * seed the data they expect to read.
 *
 * Seed seams (set up state):
 *   - `seedCustomer({ email, customerId })` — pre-register a customer that
 *     `createCustomer` returns idempotently when called with the same email.
 *   - `seedSetupIntent({ customerId, clientSecret })` — what
 *     `createSetupIntent` will return for that customer.
 *   - `seedPaymentMethods({ customerId, methods })` — list returned by
 *     `listPaymentMethods`.
 *   - `seedConnectAccount({ accountId, chargesEnabled, payoutsEnabled })`
 *     — one Connect account; `retrieveAccount` reads from this.
 *   - `seedBalance({ accountId, available, pending })`.
 *   - `seedPayouts({ accountId, payouts })`.
 *   - `seedBalanceTransactions({ accountId, transactions })`.
 *   - `seedAccountLink({ accountId, url, expiresAt })`.
 *   - `seedAccountLoginLink({ accountId, url })`.
 *
 * Spy seams (read-only, asserted by tests):
 *   - `spies.createCustomerCalls`, `spies.detachCalls`,
 *     `spies.createConnectCalls`, etc.
 *
 * Failure injection:
 *   - `failNext({ method, error })` — the next call to `method` returns
 *     `Result.err(error)` instead of running the seeded path. One-shot.
 *
 * Idempotency: `createCustomer` mirrors the real
 * `/customers-create` endpoint by returning the seeded customer when called
 * twice with the same email. If no customer is seeded for the email, a
 * fresh deterministic id is minted (`cus_fake_{counter}`) and remembered
 * for subsequent calls.
 */

type StripeServerMethod =
  | 'createCustomer'
  | 'createSetupIntent'
  | 'listPaymentMethods'
  | 'detachPaymentMethod'
  | 'createConnectAccount'
  | 'createAccountLink'
  | 'createAccountLoginLink'
  | 'retrieveAccount'
  | 'getAccountBalance'
  | 'listAccountPayouts'
  | 'listBalanceTransactions';

type AnyStripeServerError = NetworkError | AuthorizationError | ValidationError;

interface ConnectAccountState {
  readonly accountId: StripeAccountId;
  readonly chargesEnabled: boolean;
  readonly payoutsEnabled: boolean;
}

interface AccountLinkState {
  readonly url: string;
  readonly expiresAt: Date;
}

export interface FakeStripeServerSpies {
  readonly createCustomerCalls: ReadonlyArray<{
    userId: UserId;
    name: string;
    email: string;
  }>;
  readonly createSetupIntentCalls: ReadonlyArray<{
    customerId: StripeCustomerId;
  }>;
  readonly listPaymentMethodsCalls: ReadonlyArray<{
    customerId: StripeCustomerId;
  }>;
  readonly detachCalls: ReadonlyArray<{ paymentMethodId: PaymentMethodId }>;
  readonly createConnectCalls: ReadonlyArray<{
    userId: UserId;
    email: string;
    country: string | undefined;
  }>;
  readonly createAccountLinkCalls: ReadonlyArray<{
    accountId: StripeAccountId;
    refreshUrl: string;
    returnUrl: string;
  }>;
  readonly createAccountLoginLinkCalls: ReadonlyArray<{
    accountId: StripeAccountId;
  }>;
  readonly retrieveAccountCalls: ReadonlyArray<{ accountId: StripeAccountId }>;
  readonly getAccountBalanceCalls: ReadonlyArray<{
    accountId: StripeAccountId;
  }>;
  readonly listAccountPayoutsCalls: ReadonlyArray<{
    accountId: StripeAccountId;
    days: number;
    limit: number;
  }>;
  readonly listBalanceTransactionsCalls: ReadonlyArray<{
    accountId: StripeAccountId;
    days: number;
    limit: number;
  }>;
}

export class FakeStripeServerService implements StripeServerService {
  // ─── seeded state ──────────────────────────────────────────────
  private customersByEmail = new Map<string, StripeCustomerId>();
  private setupIntentsByCustomer = new Map<string, string>();
  private paymentMethodsByCustomer = new Map<
    string,
    readonly PaymentMethod[]
  >();
  private connectAccount: ConnectAccountState | null = null;
  private balanceByAccount = new Map<
    string,
    { available: Money; pending: Money }
  >();
  private payoutsByAccount = new Map<string, readonly Payout[]>();
  private balanceTxnsByAccount = new Map<
    string,
    readonly BalanceTransaction[]
  >();
  private accountLinkByAccount = new Map<string, AccountLinkState>();
  private accountLoginLinkByAccount = new Map<string, string>();

  private detachedPaymentMethods = new Set<string>();
  private customerCounter = 0;

  // ─── failure injection ────────────────────────────────────────
  private nextFailures = new Map<StripeServerMethod, AnyStripeServerError>();

  // ─── spies ────────────────────────────────────────────────────
  private readonly _spies = {
    createCustomerCalls: [] as Array<{
      userId: UserId;
      name: string;
      email: string;
    }>,
    createSetupIntentCalls: [] as Array<{ customerId: StripeCustomerId }>,
    listPaymentMethodsCalls: [] as Array<{ customerId: StripeCustomerId }>,
    detachCalls: [] as Array<{ paymentMethodId: PaymentMethodId }>,
    createConnectCalls: [] as Array<{
      userId: UserId;
      email: string;
      country: string | undefined;
    }>,
    createAccountLinkCalls: [] as Array<{
      accountId: StripeAccountId;
      refreshUrl: string;
      returnUrl: string;
    }>,
    createAccountLoginLinkCalls: [] as Array<{ accountId: StripeAccountId }>,
    retrieveAccountCalls: [] as Array<{ accountId: StripeAccountId }>,
    getAccountBalanceCalls: [] as Array<{ accountId: StripeAccountId }>,
    listAccountPayoutsCalls: [] as Array<{
      accountId: StripeAccountId;
      days: number;
      limit: number;
    }>,
    listBalanceTransactionsCalls: [] as Array<{
      accountId: StripeAccountId;
      days: number;
      limit: number;
    }>,
  };

  get spies(): FakeStripeServerSpies {
    return this._spies;
  }

  // ─── seed helpers ─────────────────────────────────────────────

  seedCustomer(args: { email: Email; customerId: StripeCustomerId }): void {
    this.customersByEmail.set(args.email.value, args.customerId);
  }

  seedSetupIntent(args: {
    customerId: StripeCustomerId;
    clientSecret: string;
  }): void {
    this.setupIntentsByCustomer.set(String(args.customerId), args.clientSecret);
  }

  seedPaymentMethods(args: {
    customerId: StripeCustomerId;
    methods: readonly PaymentMethod[];
  }): void {
    this.paymentMethodsByCustomer.set(String(args.customerId), args.methods);
  }

  seedConnectAccount(args: {
    accountId: StripeAccountId;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
  }): void {
    this.connectAccount = {
      accountId: args.accountId,
      chargesEnabled: args.chargesEnabled,
      payoutsEnabled: args.payoutsEnabled,
    };
  }

  seedBalance(args: {
    accountId: StripeAccountId;
    available: Money;
    pending: Money;
  }): void {
    this.balanceByAccount.set(String(args.accountId), {
      available: args.available,
      pending: args.pending,
    });
  }

  seedPayouts(args: {
    accountId: StripeAccountId;
    payouts: readonly Payout[];
  }): void {
    this.payoutsByAccount.set(String(args.accountId), args.payouts);
  }

  seedBalanceTransactions(args: {
    accountId: StripeAccountId;
    transactions: readonly BalanceTransaction[];
  }): void {
    this.balanceTxnsByAccount.set(String(args.accountId), args.transactions);
  }

  seedAccountLink(args: {
    accountId: StripeAccountId;
    url: string;
    expiresAt: Date;
  }): void {
    this.accountLinkByAccount.set(String(args.accountId), {
      url: args.url,
      expiresAt: args.expiresAt,
    });
  }

  seedAccountLoginLink(args: {
    accountId: StripeAccountId;
    url: string;
  }): void {
    this.accountLoginLinkByAccount.set(String(args.accountId), args.url);
  }

  /**
   * Prime the next call to `method` to return `Result.err(error)`. One-shot
   * — subsequent calls run the normal seeded path again.
   */
  failNext(args: {
    method: StripeServerMethod;
    error: AnyStripeServerError;
  }): void {
    this.nextFailures.set(args.method, args.error);
  }

  reset(): void {
    this.customersByEmail.clear();
    this.setupIntentsByCustomer.clear();
    this.paymentMethodsByCustomer.clear();
    this.connectAccount = null;
    this.balanceByAccount.clear();
    this.payoutsByAccount.clear();
    this.balanceTxnsByAccount.clear();
    this.accountLinkByAccount.clear();
    this.accountLoginLinkByAccount.clear();
    this.detachedPaymentMethods.clear();
    this.nextFailures.clear();
    this.customerCounter = 0;
    this._spies.createCustomerCalls.length = 0;
    this._spies.createSetupIntentCalls.length = 0;
    this._spies.listPaymentMethodsCalls.length = 0;
    this._spies.detachCalls.length = 0;
    this._spies.createConnectCalls.length = 0;
    this._spies.createAccountLinkCalls.length = 0;
    this._spies.createAccountLoginLinkCalls.length = 0;
    this._spies.retrieveAccountCalls.length = 0;
    this._spies.getAccountBalanceCalls.length = 0;
    this._spies.listAccountPayoutsCalls.length = 0;
    this._spies.listBalanceTransactionsCalls.length = 0;
  }

  // ─── StripeServerService implementation ───────────────────────

  async createCustomer(args: {
    userId: UserId;
    name: string;
    email: Email;
  }): Promise<Result<StripeCustomerId, AnyStripeServerError>> {
    this._spies.createCustomerCalls.push({
      userId: args.userId,
      name: args.name,
      email: args.email.value,
    });
    const failure = this.takeFailure('createCustomer');
    if (failure) return Result.err(failure);

    const existing = this.customersByEmail.get(args.email.value);
    if (existing) return Result.ok(existing);

    // Mint a fresh deterministic id and remember it for the next call.
    this.customerCounter += 1;
    const minted = StripeCustomerId.create(`cus_fake${this.customerCounter}`);
    if (!minted.ok) {
      throw new Error(
        `FakeStripeServerService: failed to mint customer id: ${minted.error.message}`,
      );
    }
    this.customersByEmail.set(args.email.value, minted.value);
    return Result.ok(minted.value);
  }

  async createSetupIntent(args: {
    customerId: StripeCustomerId;
  }): Promise<Result<{ clientSecret: string }, AnyStripeServerError>> {
    this._spies.createSetupIntentCalls.push({ customerId: args.customerId });
    const failure = this.takeFailure('createSetupIntent');
    if (failure) return Result.err(failure);

    const seeded = this.setupIntentsByCustomer.get(String(args.customerId));
    if (seeded) return Result.ok({ clientSecret: seeded });

    // No seeded value → mint a deterministic one keyed on the customer id.
    return Result.ok({ clientSecret: `seti_fake_${String(args.customerId)}` });
  }

  async listPaymentMethods(args: {
    customerId: StripeCustomerId;
  }): Promise<Result<readonly PaymentMethod[], AnyStripeServerError>> {
    this._spies.listPaymentMethodsCalls.push({ customerId: args.customerId });
    const failure = this.takeFailure('listPaymentMethods');
    if (failure) return Result.err(failure);

    const seeded =
      this.paymentMethodsByCustomer.get(String(args.customerId)) ?? [];
    // Filter out any methods that were detached after seeding.
    const visible = seeded.filter(
      (pm) => !this.detachedPaymentMethods.has(String(pm.id)),
    );
    return Result.ok(visible);
  }

  async detachPaymentMethod(args: {
    paymentMethodId: PaymentMethodId;
  }): Promise<Result<void, AnyStripeServerError>> {
    this._spies.detachCalls.push({ paymentMethodId: args.paymentMethodId });
    const failure = this.takeFailure('detachPaymentMethod');
    if (failure) return Result.err(failure);

    this.detachedPaymentMethods.add(String(args.paymentMethodId));
    return Result.ok(undefined);
  }

  async createConnectAccount(args: {
    userId: UserId;
    email: Email;
    country?: string;
  }): Promise<Result<StripeAccountId, AnyStripeServerError>> {
    this._spies.createConnectCalls.push({
      userId: args.userId,
      email: args.email.value,
      country: args.country,
    });
    const failure = this.takeFailure('createConnectAccount');
    if (failure) return Result.err(failure);

    if (this.connectAccount) {
      // The test seeded a Connect account; return that id. (Real server
      // does not de-dupe by email, but the rewrite use case checks the
      // user doc first — this is just so a test can pre-stage the id
      // before exercising createConnectAccount via failNext.)
      return Result.ok(this.connectAccount.accountId);
    }
    // No seeded account → return an unrecoverable network error so the
    // test forgot-to-seed path is loud rather than silently invented.
    throw new Error(
      'FakeStripeServerService.createConnectAccount: no account seeded; call seedConnectAccount() first',
    );
  }

  async createAccountLink(args: {
    accountId: StripeAccountId;
    refreshUrl: string;
    returnUrl: string;
  }): Promise<Result<{ url: string; expiresAt: Date }, AnyStripeServerError>> {
    this._spies.createAccountLinkCalls.push({
      accountId: args.accountId,
      refreshUrl: args.refreshUrl,
      returnUrl: args.returnUrl,
    });
    const failure = this.takeFailure('createAccountLink');
    if (failure) return Result.err(failure);

    const seeded = this.accountLinkByAccount.get(String(args.accountId));
    if (seeded) {
      return Result.ok({ url: seeded.url, expiresAt: seeded.expiresAt });
    }
    throw new Error(
      'FakeStripeServerService.createAccountLink: no link seeded; call seedAccountLink() first',
    );
  }

  async createAccountLoginLink(args: {
    accountId: StripeAccountId;
  }): Promise<Result<{ url: string }, AnyStripeServerError>> {
    this._spies.createAccountLoginLinkCalls.push({ accountId: args.accountId });
    const failure = this.takeFailure('createAccountLoginLink');
    if (failure) return Result.err(failure);

    const seeded = this.accountLoginLinkByAccount.get(String(args.accountId));
    if (seeded) return Result.ok({ url: seeded });
    throw new Error(
      'FakeStripeServerService.createAccountLoginLink: no link seeded; call seedAccountLoginLink() first',
    );
  }

  async retrieveAccount(args: {
    accountId: StripeAccountId;
  }): Promise<
    Result<
      { chargesEnabled: boolean; payoutsEnabled: boolean },
      AnyStripeServerError
    >
  > {
    this._spies.retrieveAccountCalls.push({ accountId: args.accountId });
    const failure = this.takeFailure('retrieveAccount');
    if (failure) return Result.err(failure);

    if (
      this.connectAccount &&
      String(this.connectAccount.accountId) === String(args.accountId)
    ) {
      return Result.ok({
        chargesEnabled: this.connectAccount.chargesEnabled,
        payoutsEnabled: this.connectAccount.payoutsEnabled,
      });
    }
    throw new Error(
      'FakeStripeServerService.retrieveAccount: no account seeded for that id; call seedConnectAccount() first',
    );
  }

  async getAccountBalance(args: {
    accountId: StripeAccountId;
  }): Promise<
    Result<{ available: Money; pending: Money }, AnyStripeServerError>
  > {
    this._spies.getAccountBalanceCalls.push({ accountId: args.accountId });
    const failure = this.takeFailure('getAccountBalance');
    if (failure) return Result.err(failure);

    const seeded = this.balanceByAccount.get(String(args.accountId));
    if (seeded) return Result.ok(seeded);
    throw new Error(
      'FakeStripeServerService.getAccountBalance: no balance seeded; call seedBalance() first',
    );
  }

  async listAccountPayouts(args: {
    accountId: StripeAccountId;
    days: number;
    limit: number;
  }): Promise<Result<readonly Payout[], AnyStripeServerError>> {
    this._spies.listAccountPayoutsCalls.push({
      accountId: args.accountId,
      days: args.days,
      limit: args.limit,
    });
    const failure = this.takeFailure('listAccountPayouts');
    if (failure) return Result.err(failure);

    return Result.ok(this.payoutsByAccount.get(String(args.accountId)) ?? []);
  }

  async listBalanceTransactions(args: {
    accountId: StripeAccountId;
    days: number;
    limit: number;
  }): Promise<Result<readonly BalanceTransaction[], AnyStripeServerError>> {
    this._spies.listBalanceTransactionsCalls.push({
      accountId: args.accountId,
      days: args.days,
      limit: args.limit,
    });
    const failure = this.takeFailure('listBalanceTransactions');
    if (failure) return Result.err(failure);

    return Result.ok(
      this.balanceTxnsByAccount.get(String(args.accountId)) ?? [],
    );
  }

  // ─── internals ─────────────────────────────────────────────────

  private takeFailure(method: StripeServerMethod): AnyStripeServerError | null {
    const f = this.nextFailures.get(method);
    if (!f) return null;
    this.nextFailures.delete(method);
    return f;
  }
}
