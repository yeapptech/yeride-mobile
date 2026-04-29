import { BalanceTransaction } from '@domain/entities/BalanceTransaction';
import { Money } from '@domain/entities/Money';
import { FakeStripeServerService } from '@shared/testing';
import {
  InMemoryAuthRepository,
  InMemoryUserRepository,
} from '@shared/testing';

import { ListBalanceTransactions } from '../ListBalanceTransactions';

import {
  acctId,
  setupSignedInDriver,
  setupSignedInRider,
  unwrap,
} from './_helpers';

function txn(id: string): BalanceTransaction {
  return unwrap(
    BalanceTransaction.create({
      id,
      amount: unwrap(Money.create(1000, 'USD')),
      fee: unwrap(Money.create(30, 'USD')),
      net: unwrap(Money.create(970, 'USD')),
      createdAt: new Date('2026-04-01Z'),
      type: 'charge',
      tripId: null,
    }),
  );
}

describe('ListBalanceTransactions', () => {
  it('returns the seeded transactions and uses default {days:7, limit:25}', async () => {
    const seeded = acctId('acct_owned');
    const { authRepo, usersRepo } = await setupSignedInDriver({
      stripeAccountId: seeded,
    });
    const stripe = new FakeStripeServerService();
    stripe.seedBalanceTransactions({
      accountId: seeded,
      transactions: [txn('txn_1')],
    });
    const r = await new ListBalanceTransactions(
      authRepo,
      usersRepo,
      stripe,
    ).execute({ accountId: seeded });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toHaveLength(1);
    expect(stripe.spies.listBalanceTransactionsCalls[0]?.days).toBe(7);
    expect(stripe.spies.listBalanceTransactionsCalls[0]?.limit).toBe(25);
  });

  it('rejects when caller is a rider', async () => {
    const { authRepo, usersRepo } = await setupSignedInRider();
    const r = await new ListBalanceTransactions(
      authRepo,
      usersRepo,
      new FakeStripeServerService(),
    ).execute({ accountId: acctId() });
    if (!r.ok) expect(r.error.code).toBe('stripe_txns_role_not_driver');
  });

  it('rejects on accountId ownership mismatch', async () => {
    const { authRepo, usersRepo } = await setupSignedInDriver({
      stripeAccountId: acctId('acct_a'),
    });
    const r = await new ListBalanceTransactions(
      authRepo,
      usersRepo,
      new FakeStripeServerService(),
    ).execute({ accountId: acctId('acct_b') });
    if (!r.ok) expect(r.error.code).toBe('stripe_account_mismatch');
  });

  it('rejects when no user is signed in', async () => {
    const r = await new ListBalanceTransactions(
      new InMemoryAuthRepository(),
      new InMemoryUserRepository(),
      new FakeStripeServerService(),
    ).execute({ accountId: acctId() });
    if (!r.ok) expect(r.error.code).toBe('auth_no_current_user');
  });
});
