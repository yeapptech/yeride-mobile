import { Money } from '@domain/entities/Money';
import { Payout } from '@domain/entities/Payout';
import { FakeStripeServerService } from '@shared/testing';
import {
  InMemoryAuthRepository,
  InMemoryUserRepository,
} from '@shared/testing';

import { ListDriverPayouts } from '../ListDriverPayouts';

import {
  acctId,
  setupSignedInDriver,
  setupSignedInRider,
  unwrap,
} from './_helpers';

function payout(id: string): Payout {
  return unwrap(
    Payout.create({
      id,
      amount: unwrap(Money.create(2000, 'USD')),
      status: 'paid',
      arrivalDate: new Date('2026-04-01Z'),
    }),
  );
}

describe('ListDriverPayouts', () => {
  it('returns the seeded payouts and uses default {days:7, limit:10}', async () => {
    const seeded = acctId('acct_owned');
    const { authRepo, usersRepo } = await setupSignedInDriver({
      stripeAccountId: seeded,
    });
    const stripe = new FakeStripeServerService();
    stripe.seedPayouts({
      accountId: seeded,
      payouts: [payout('po_1'), payout('po_2')],
    });
    const r = await new ListDriverPayouts(authRepo, usersRepo, stripe).execute({
      accountId: seeded,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toHaveLength(2);
    expect(stripe.spies.listAccountPayoutsCalls[0]?.days).toBe(7);
    expect(stripe.spies.listAccountPayoutsCalls[0]?.limit).toBe(10);
  });

  it('honors caller-supplied days/limit', async () => {
    const seeded = acctId('acct_owned');
    const { authRepo, usersRepo } = await setupSignedInDriver({
      stripeAccountId: seeded,
    });
    const stripe = new FakeStripeServerService();
    stripe.seedPayouts({ accountId: seeded, payouts: [] });
    await new ListDriverPayouts(authRepo, usersRepo, stripe).execute({
      accountId: seeded,
      days: 30,
      limit: 50,
    });
    expect(stripe.spies.listAccountPayoutsCalls[0]?.days).toBe(30);
    expect(stripe.spies.listAccountPayoutsCalls[0]?.limit).toBe(50);
  });

  it('rejects when caller is a rider', async () => {
    const { authRepo, usersRepo } = await setupSignedInRider();
    const r = await new ListDriverPayouts(
      authRepo,
      usersRepo,
      new FakeStripeServerService(),
    ).execute({ accountId: acctId() });
    if (!r.ok) expect(r.error.code).toBe('stripe_payouts_role_not_driver');
  });

  it('rejects on accountId ownership mismatch', async () => {
    const { authRepo, usersRepo } = await setupSignedInDriver({
      stripeAccountId: acctId('acct_a'),
    });
    const r = await new ListDriverPayouts(
      authRepo,
      usersRepo,
      new FakeStripeServerService(),
    ).execute({ accountId: acctId('acct_b') });
    if (!r.ok) expect(r.error.code).toBe('stripe_account_mismatch');
  });

  it('rejects when no user is signed in', async () => {
    const r = await new ListDriverPayouts(
      new InMemoryAuthRepository(),
      new InMemoryUserRepository(),
      new FakeStripeServerService(),
    ).execute({ accountId: acctId() });
    if (!r.ok) expect(r.error.code).toBe('auth_no_current_user');
  });
});
