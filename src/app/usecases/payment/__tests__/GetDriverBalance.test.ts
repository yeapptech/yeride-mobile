import { Money } from '@domain/entities/Money';
import { FakeStripeServerService } from '@shared/testing';
import {
  InMemoryAuthRepository,
  InMemoryUserRepository,
} from '@shared/testing';

import { GetDriverBalance } from '../GetDriverBalance';

import {
  acctId,
  setupSignedInDriver,
  setupSignedInRider,
  unwrap,
} from './_helpers';

describe('GetDriverBalance', () => {
  it('returns the seeded balance when the driver owns the account', async () => {
    const seeded = acctId('acct_owned');
    const { authRepo, usersRepo } = await setupSignedInDriver({
      stripeAccountId: seeded,
    });
    const stripe = new FakeStripeServerService();
    stripe.seedBalance({
      accountId: seeded,
      available: unwrap(Money.create(1234, 'USD')),
      pending: unwrap(Money.create(500, 'USD')),
    });
    const r = await new GetDriverBalance(authRepo, usersRepo, stripe).execute({
      accountId: seeded,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.available.minorUnits).toBe(1234);
      expect(r.value.pending.minorUnits).toBe(500);
    }
  });

  it('rejects when caller is a rider', async () => {
    const { authRepo, usersRepo } = await setupSignedInRider();
    const r = await new GetDriverBalance(
      authRepo,
      usersRepo,
      new FakeStripeServerService(),
    ).execute({ accountId: acctId() });
    if (!r.ok) expect(r.error.code).toBe('stripe_balance_role_not_driver');
  });

  it('rejects when the driver does not own the accountId', async () => {
    const { authRepo, usersRepo } = await setupSignedInDriver({
      stripeAccountId: acctId('acct_a'),
    });
    const r = await new GetDriverBalance(
      authRepo,
      usersRepo,
      new FakeStripeServerService(),
    ).execute({ accountId: acctId('acct_b') });
    if (!r.ok) expect(r.error.code).toBe('stripe_account_mismatch');
  });

  it('rejects when no user is signed in', async () => {
    const r = await new GetDriverBalance(
      new InMemoryAuthRepository(),
      new InMemoryUserRepository(),
      new FakeStripeServerService(),
    ).execute({ accountId: acctId() });
    if (!r.ok) expect(r.error.code).toBe('auth_no_current_user');
  });
});
