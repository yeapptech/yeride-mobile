import { FakeStripeServerService } from '@shared/testing';
import {
  InMemoryAuthRepository,
  InMemoryUserRepository,
} from '@shared/testing';

import { CreateConnectOnboardingLink } from '../CreateConnectOnboardingLink';

import { acctId, setupSignedInDriver, setupSignedInRider } from './_helpers';

describe('CreateConnectOnboardingLink', () => {
  it('returns the URL when the driver owns the account', async () => {
    const seeded = acctId('acct_owned');
    const { authRepo, usersRepo } = await setupSignedInDriver({
      stripeAccountId: seeded,
    });
    const stripe = new FakeStripeServerService();
    stripe.seedAccountLink({
      accountId: seeded,
      url: 'https://stripe/test/onboard',
      expiresAt: new Date('2030-01-01Z'),
    });
    const r = await new CreateConnectOnboardingLink(
      authRepo,
      usersRepo,
      stripe,
    ).execute({
      accountId: seeded,
      refreshUrl: 'yeridenext-dev://stripe-refresh',
      returnUrl: 'yeridenext-dev://stripe-return',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.url).toBe('https://stripe/test/onboard');
  });

  it('rejects when caller is a rider', async () => {
    const { authRepo, usersRepo } = await setupSignedInRider();
    const r = await new CreateConnectOnboardingLink(
      authRepo,
      usersRepo,
      new FakeStripeServerService(),
    ).execute({
      accountId: acctId('acct_x'),
      refreshUrl: 'r',
      returnUrl: 'r',
    });
    if (!r.ok) expect(r.error.code).toBe('stripe_link_role_not_driver');
  });

  it('rejects when the driver does not own the accountId', async () => {
    const { authRepo, usersRepo } = await setupSignedInDriver({
      stripeAccountId: acctId('acct_owned'),
    });
    const r = await new CreateConnectOnboardingLink(
      authRepo,
      usersRepo,
      new FakeStripeServerService(),
    ).execute({
      accountId: acctId('acct_someone'),
      refreshUrl: 'r',
      returnUrl: 'r',
    });
    if (!r.ok) expect(r.error.code).toBe('stripe_account_mismatch');
  });

  it('rejects when no user is signed in', async () => {
    const r = await new CreateConnectOnboardingLink(
      new InMemoryAuthRepository(),
      new InMemoryUserRepository(),
      new FakeStripeServerService(),
    ).execute({
      accountId: acctId('acct_x'),
      refreshUrl: 'r',
      returnUrl: 'r',
    });
    if (!r.ok) expect(r.error.code).toBe('auth_no_current_user');
  });
});
