import { NetworkError } from '@domain/errors';
import { FakeStripeServerService } from '@shared/testing';
import {
  InMemoryAuthRepository,
  InMemoryUserRepository,
} from '@shared/testing';

import { RefreshConnectAccountStatus } from '../RefreshConnectAccountStatus';

import {
  acctId,
  FIXED_NOW,
  setupSignedInDriver,
  setupSignedInRider,
} from './_helpers';

describe('RefreshConnectAccountStatus', () => {
  it('refreshes flags from the server and persists onto the user doc', async () => {
    const seeded = acctId('acct_owned');
    const { authRepo, usersRepo, driver } = await setupSignedInDriver({
      stripeAccountId: seeded,
    });
    const stripe = new FakeStripeServerService();
    stripe.seedConnectAccount({
      accountId: seeded,
      chargesEnabled: true,
      payoutsEnabled: false,
    });
    const r = await new RefreshConnectAccountStatus(
      authRepo,
      usersRepo,
      stripe,
      () => FIXED_NOW,
    ).execute({ accountId: seeded });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.chargesEnabled).toBe(true);
      expect(r.value.payoutsEnabled).toBe(false);
    }
    const after = await usersRepo.getById(driver.id);
    if (after.ok && after.value.role === 'driver') {
      expect(after.value.stripeChargesEnabled).toBe(true);
      expect(after.value.stripePayoutsEnabled).toBe(false);
    }
  });

  it('rejects when the driver does not own the accountId', async () => {
    const { authRepo, usersRepo } = await setupSignedInDriver({
      stripeAccountId: acctId('acct_owned'),
    });
    const r = await new RefreshConnectAccountStatus(
      authRepo,
      usersRepo,
      new FakeStripeServerService(),
    ).execute({ accountId: acctId('acct_other') });
    if (!r.ok) expect(r.error.code).toBe('stripe_account_mismatch');
  });

  it('rejects when caller is a rider', async () => {
    const { authRepo, usersRepo } = await setupSignedInRider();
    const r = await new RefreshConnectAccountStatus(
      authRepo,
      usersRepo,
      new FakeStripeServerService(),
    ).execute({ accountId: acctId() });
    if (!r.ok) expect(r.error.code).toBe('stripe_refresh_role_not_driver');
  });

  it('rejects when no user is signed in', async () => {
    const r = await new RefreshConnectAccountStatus(
      new InMemoryAuthRepository(),
      new InMemoryUserRepository(),
      new FakeStripeServerService(),
    ).execute({ accountId: acctId() });
    if (!r.ok) expect(r.error.code).toBe('auth_no_current_user');
  });

  it('propagates a NetworkError from retrieveAccount', async () => {
    const seeded = acctId('acct_owned');
    const { authRepo, usersRepo } = await setupSignedInDriver({
      stripeAccountId: seeded,
    });
    const stripe = new FakeStripeServerService();
    stripe.seedConnectAccount({
      accountId: seeded,
      chargesEnabled: false,
      payoutsEnabled: false,
    });
    stripe.failNext({
      method: 'retrieveAccount',
      error: new NetworkError({ code: 'stripe_down', message: 'down' }),
    });
    const r = await new RefreshConnectAccountStatus(
      authRepo,
      usersRepo,
      stripe,
    ).execute({ accountId: seeded });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('network');
  });
});
