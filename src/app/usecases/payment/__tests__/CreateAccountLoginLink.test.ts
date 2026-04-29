import { FakeStripeServerService } from '@shared/testing';
import {
  InMemoryAuthRepository,
  InMemoryUserRepository,
} from '@shared/testing';

import { CreateAccountLoginLink } from '../CreateAccountLoginLink';

import { acctId, setupSignedInDriver, setupSignedInRider } from './_helpers';

describe('CreateAccountLoginLink', () => {
  it('returns the dashboard URL when the driver owns the account', async () => {
    const seeded = acctId('acct_owned');
    const { authRepo, usersRepo } = await setupSignedInDriver({
      stripeAccountId: seeded,
    });
    const stripe = new FakeStripeServerService();
    stripe.seedAccountLoginLink({
      accountId: seeded,
      url: 'https://stripe/test/login',
    });
    const r = await new CreateAccountLoginLink(
      authRepo,
      usersRepo,
      stripe,
    ).execute({ accountId: seeded });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.url).toBe('https://stripe/test/login');
  });

  it('rejects when caller is a rider', async () => {
    const { authRepo, usersRepo } = await setupSignedInRider();
    const r = await new CreateAccountLoginLink(
      authRepo,
      usersRepo,
      new FakeStripeServerService(),
    ).execute({ accountId: acctId() });
    if (!r.ok) expect(r.error.code).toBe('stripe_login_link_role_not_driver');
  });

  it('rejects when the driver does not own the accountId', async () => {
    const { authRepo, usersRepo } = await setupSignedInDriver({
      stripeAccountId: acctId('acct_a'),
    });
    const r = await new CreateAccountLoginLink(
      authRepo,
      usersRepo,
      new FakeStripeServerService(),
    ).execute({ accountId: acctId('acct_b') });
    if (!r.ok) expect(r.error.code).toBe('stripe_account_mismatch');
  });

  it('rejects when no user is signed in', async () => {
    const r = await new CreateAccountLoginLink(
      new InMemoryAuthRepository(),
      new InMemoryUserRepository(),
      new FakeStripeServerService(),
    ).execute({ accountId: acctId() });
    if (!r.ok) expect(r.error.code).toBe('auth_no_current_user');
  });
});
