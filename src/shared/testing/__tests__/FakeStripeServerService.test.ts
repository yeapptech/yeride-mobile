import { BalanceTransaction } from '@domain/entities/BalanceTransaction';
import { Email } from '@domain/entities/Email';
import { Money } from '@domain/entities/Money';
import { PaymentMethod } from '@domain/entities/PaymentMethod';
import { PaymentMethodId } from '@domain/entities/PaymentMethodId';
import { Payout } from '@domain/entities/Payout';
import { StripeAccountId } from '@domain/entities/StripeAccountId';
import { StripeCustomerId } from '@domain/entities/StripeCustomerId';
import { UserId } from '@domain/entities/UserId';
import { NetworkError } from '@domain/errors';

import { FakeStripeServerService } from '../FakeStripeServerService';

function ok<T, E>(r: { ok: true; value: T } | { ok: false; error: E }): T {
  if (!r.ok) throw new Error('expected ok');
  return r.value;
}

function userId(): UserId {
  return ok(UserId.create('aaaaaaaaaaaaaaaaaaaaaaaaaaaa'));
}

function email(s: string): Email {
  return ok(Email.create(s));
}

function customerId(suffix = 'NQ7VyhkUx9wQYz'): StripeCustomerId {
  return ok(StripeCustomerId.create(`cus_${suffix}`));
}

function accountId(): StripeAccountId {
  return ok(StripeAccountId.create('acct_1ABC234DEFghij5K'));
}

function pm(idStr: string, last4 = '4242'): PaymentMethod {
  const pmId = ok(PaymentMethodId.create(`pm_${idStr}`));
  return ok(
    PaymentMethod.create({
      id: pmId,
      brand: 'visa',
      last4,
      expiry: { month: 12, year: 2030 },
    }),
  );
}

function usd(minor: number): Money {
  return ok(Money.create(minor, 'USD'));
}

describe('FakeStripeServerService', () => {
  let svc: FakeStripeServerService;

  beforeEach(() => {
    svc = new FakeStripeServerService();
  });

  describe('createCustomer', () => {
    it('returns the seeded customer id when called with the seeded email', async () => {
      const id = customerId();
      svc.seedCustomer({ email: email('rider@example.com'), customerId: id });

      const r = await svc.createCustomer({
        userId: userId(),
        name: 'Rider Smith',
        email: email('rider@example.com'),
      });

      expect(r.ok).toBe(true);
      if (r.ok) expect(String(r.value)).toBe(String(id));
    });

    it('mints a fresh deterministic id when no customer is seeded, and returns the same id on repeat call (idempotent)', async () => {
      const r1 = await svc.createCustomer({
        userId: userId(),
        name: 'Rider Smith',
        email: email('rider@example.com'),
      });
      const r2 = await svc.createCustomer({
        userId: userId(),
        name: 'Rider Smith',
        email: email('rider@example.com'),
      });
      expect(r1.ok && r2.ok).toBe(true);
      if (r1.ok && r2.ok) expect(String(r1.value)).toBe(String(r2.value));
    });

    it('records spy calls', async () => {
      await svc.createCustomer({
        userId: userId(),
        name: 'Rider Smith',
        email: email('rider@example.com'),
      });
      expect(svc.spies.createCustomerCalls).toHaveLength(1);
      expect(svc.spies.createCustomerCalls[0]?.email).toBe('rider@example.com');
    });

    it('returns the primed error from failNext, then resumes normal behavior', async () => {
      const err = new NetworkError({
        code: 'stripe_server_5xx',
        message: 'boom',
      });
      svc.failNext({ method: 'createCustomer', error: err });

      const r1 = await svc.createCustomer({
        userId: userId(),
        name: 'X',
        email: email('a@b.com'),
      });
      expect(r1.ok).toBe(false);
      if (!r1.ok) expect(r1.error).toBe(err);

      // Second call after the one-shot failure runs normally.
      const r2 = await svc.createCustomer({
        userId: userId(),
        name: 'X',
        email: email('a@b.com'),
      });
      expect(r2.ok).toBe(true);
    });
  });

  describe('createSetupIntent / listPaymentMethods / detachPaymentMethod', () => {
    it('returns the seeded setup-intent client secret', async () => {
      const cId = customerId();
      svc.seedSetupIntent({ customerId: cId, clientSecret: 'seti_xyz' });
      const r = await svc.createSetupIntent({ customerId: cId });
      expect(r.ok && r.value.clientSecret).toBe('seti_xyz');
    });

    it('lists seeded payment methods and excludes detached ones', async () => {
      const cId = customerId();
      const pm1 = pm('aaa', '1111');
      const pm2 = pm('bbb', '2222');
      svc.seedPaymentMethods({ customerId: cId, methods: [pm1, pm2] });

      const before = ok(await svc.listPaymentMethods({ customerId: cId }));
      expect(before).toHaveLength(2);

      const detach = await svc.detachPaymentMethod({
        paymentMethodId: pm1.id,
      });
      expect(detach.ok).toBe(true);

      const after = ok(await svc.listPaymentMethods({ customerId: cId }));
      expect(after).toHaveLength(1);
      expect(String(after[0]?.id)).toBe(String(pm2.id));
      expect(svc.spies.detachCalls).toHaveLength(1);
    });
  });

  describe('Connect: retrieveAccount / accountLink / loginLink / balance / payouts / txns', () => {
    it('reads back seeded Connect account flags', async () => {
      const aId = accountId();
      svc.seedConnectAccount({
        accountId: aId,
        chargesEnabled: true,
        payoutsEnabled: false,
      });
      const r = ok(await svc.retrieveAccount({ accountId: aId }));
      expect(r).toEqual({ chargesEnabled: true, payoutsEnabled: false });
    });

    it('seeded account link round-trips and is recorded as a spy', async () => {
      const aId = accountId();
      svc.seedConnectAccount({
        accountId: aId,
        chargesEnabled: false,
        payoutsEnabled: false,
      });
      const expiresAt = new Date('2026-04-30T00:00:00Z');
      svc.seedAccountLink({
        accountId: aId,
        url: 'https://connect.stripe.com/setup/abc',
        expiresAt,
      });

      const r = ok(
        await svc.createAccountLink({
          accountId: aId,
          refreshUrl: 'yeridenext-dev://stripe-return',
          returnUrl: 'yeridenext-dev://stripe-return',
        }),
      );
      expect(r.url).toBe('https://connect.stripe.com/setup/abc');
      expect(r.expiresAt.toISOString()).toBe(expiresAt.toISOString());
      expect(svc.spies.createAccountLinkCalls).toHaveLength(1);
    });

    it('seeded balance + payouts + transactions round-trip', async () => {
      const aId = accountId();
      svc.seedBalance({
        accountId: aId,
        available: usd(15000),
        pending: usd(2500),
      });
      const payout = ok(
        Payout.create({
          id: 'po_1',
          amount: usd(15000),
          status: 'paid',
          arrivalDate: new Date('2026-04-15T00:00:00Z'),
        }),
      );
      svc.seedPayouts({ accountId: aId, payouts: [payout] });
      const txn = ok(
        BalanceTransaction.create({
          id: 'txn_1',
          amount: usd(10000),
          fee: usd(290),
          net: usd(9710),
          createdAt: new Date('2026-04-15T12:00:00Z'),
          type: 'charge',
          tripId: 'trip_abc',
        }),
      );
      svc.seedBalanceTransactions({ accountId: aId, transactions: [txn] });

      const balance = ok(await svc.getAccountBalance({ accountId: aId }));
      expect(balance.available.minorUnits).toBe(15000);

      const payouts = ok(
        await svc.listAccountPayouts({ accountId: aId, days: 7, limit: 10 }),
      );
      expect(payouts).toHaveLength(1);

      const txns = ok(
        await svc.listBalanceTransactions({
          accountId: aId,
          days: 7,
          limit: 25,
        }),
      );
      expect(txns).toHaveLength(1);
      expect(txns[0]?.tripId).toBe('trip_abc');

      // Spy bookkeeping captured the args.
      expect(svc.spies.listAccountPayoutsCalls).toEqual([
        { accountId: aId, days: 7, limit: 10 },
      ]);
      expect(svc.spies.listBalanceTransactionsCalls).toEqual([
        { accountId: aId, days: 7, limit: 25 },
      ]);
    });

    it('failNext propagates errors per-method', async () => {
      const aId = accountId();
      svc.seedConnectAccount({
        accountId: aId,
        chargesEnabled: true,
        payoutsEnabled: true,
      });
      const err = new NetworkError({
        code: 'stripe_server_timeout',
        message: 'timeout',
      });
      svc.failNext({ method: 'retrieveAccount', error: err });

      const r = await svc.retrieveAccount({ accountId: aId });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe(err);

      // Only retrieveAccount was primed; getAccountBalance still seeds-fails
      // loud (no balance seeded). That's tested separately in the seeded-
      // balance test above; here we just confirm the failure was one-shot.
      const r2 = await svc.retrieveAccount({ accountId: aId });
      expect(r2.ok).toBe(true);
    });
  });

  describe('reset', () => {
    it('clears all seeded state, spies, and primed failures', async () => {
      svc.seedCustomer({
        email: email('a@b.com'),
        customerId: customerId(),
      });
      svc.failNext({
        method: 'createCustomer',
        error: new NetworkError({ code: 'x', message: 'x' }),
      });
      await svc.createSetupIntent({ customerId: customerId() }); // pollute spies

      svc.reset();

      // Customer no longer seeded → fresh mint.
      const r = ok(
        await svc.createCustomer({
          userId: userId(),
          name: 'X',
          email: email('a@b.com'),
        }),
      );
      expect(String(r)).toMatch(/^cus_fake/);
      expect(svc.spies.createSetupIntentCalls).toHaveLength(0);
    });
  });
});
