import { NetworkError } from '@domain/errors';
import { FakeStripeServerService } from '@shared/testing';
import {
  InMemoryAuthRepository,
  InMemoryUserRepository,
} from '@shared/testing';

import { EnsureStripeConnectAccount } from '../EnsureStripeConnectAccount';

import {
  acctId,
  FIXED_NOW,
  setupSignedInDriver,
  setupSignedInRider,
} from './_helpers';

describe('EnsureStripeConnectAccount', () => {
  it('returns the existing stripeAccountId when present', async () => {
    const seeded = acctId('acct_existing');
    const { authRepo, usersRepo } = await setupSignedInDriver({
      stripeAccountId: seeded,
    });
    const stripe = new FakeStripeServerService();
    const r = await new EnsureStripeConnectAccount(
      authRepo,
      usersRepo,
      stripe,
      () => FIXED_NOW,
    ).execute();
    expect(r.ok).toBe(true);
    if (r.ok) expect(String(r.value)).toBe('acct_existing');
    expect(stripe.spies.createConnectCalls).toHaveLength(0);
  });

  it('creates and persists a fresh account when none exists', async () => {
    const { authRepo, usersRepo, driver } = await setupSignedInDriver();
    const stripe = new FakeStripeServerService();
    stripe.seedConnectAccount({
      accountId: acctId('acct_new'),
      chargesEnabled: false,
      payoutsEnabled: false,
    });
    const r = await new EnsureStripeConnectAccount(
      authRepo,
      usersRepo,
      stripe,
      () => FIXED_NOW,
    ).execute();
    expect(r.ok).toBe(true);
    if (r.ok) expect(String(r.value)).toBe('acct_new');
    const after = await usersRepo.getById(driver.id);
    if (after.ok && after.value.role === 'driver') {
      expect(String(after.value.stripeAccountId)).toBe('acct_new');
    }
  });

  it('passes the country override into the server call', async () => {
    const { authRepo, usersRepo } = await setupSignedInDriver();
    const stripe = new FakeStripeServerService();
    stripe.seedConnectAccount({
      accountId: acctId('acct_x'),
      chargesEnabled: false,
      payoutsEnabled: false,
    });
    await new EnsureStripeConnectAccount(authRepo, usersRepo, stripe).execute({
      country: 'CA',
    });
    expect(stripe.spies.createConnectCalls[0]?.country).toBe('CA');
  });

  it('rejects when caller is a rider', async () => {
    const { authRepo, usersRepo } = await setupSignedInRider();
    const r = await new EnsureStripeConnectAccount(
      authRepo,
      usersRepo,
      new FakeStripeServerService(),
    ).execute();
    if (!r.ok) expect(r.error.code).toBe('stripe_connect_role_not_driver');
  });

  it('rejects when no user is signed in', async () => {
    const r = await new EnsureStripeConnectAccount(
      new InMemoryAuthRepository(),
      new InMemoryUserRepository(),
      new FakeStripeServerService(),
    ).execute();
    if (!r.ok) expect(r.error.code).toBe('auth_no_current_user');
  });

  it('propagates a NetworkError from createConnectAccount', async () => {
    const { authRepo, usersRepo } = await setupSignedInDriver();
    const stripe = new FakeStripeServerService();
    // Don't seed a connect account; instead fail the call with a primed error
    // (so we hit the failure branch before the fake's "no seed" throw).
    stripe.failNext({
      method: 'createConnectAccount',
      error: new NetworkError({ code: 'stripe_down', message: 'down' }),
    });
    const r = await new EnsureStripeConnectAccount(
      authRepo,
      usersRepo,
      stripe,
    ).execute();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('network');
  });
});
