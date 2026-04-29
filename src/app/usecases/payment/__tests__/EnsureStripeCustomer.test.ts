import { NetworkError } from '@domain/errors';
import { FakeStripeServerService } from '@shared/testing';
import {
  InMemoryAuthRepository,
  InMemoryUserRepository,
} from '@shared/testing';

import { EnsureStripeCustomer } from '../EnsureStripeCustomer';

import {
  cusId,
  email,
  FIXED_NOW,
  setupSignedInDriver,
  setupSignedInRider,
} from './_helpers';

describe('EnsureStripeCustomer', () => {
  it('returns the existing stripeCustomerId when the rider already has one', async () => {
    const seeded = cusId('cus_existing');
    const { authRepo, usersRepo } = await setupSignedInRider({
      stripeCustomerId: seeded,
    });
    const stripe = new FakeStripeServerService();
    const usecase = new EnsureStripeCustomer(
      authRepo,
      usersRepo,
      stripe,
      () => FIXED_NOW,
    );
    const r = await usecase.execute();
    expect(r.ok).toBe(true);
    if (r.ok) expect(String(r.value)).toBe('cus_existing');
    expect(stripe.spies.createCustomerCalls).toHaveLength(0);
  });

  it('mints + persists a fresh customer when none exists yet', async () => {
    const { authRepo, usersRepo, rider } = await setupSignedInRider();
    const stripe = new FakeStripeServerService();
    stripe.seedCustomer({
      email: rider.email,
      customerId: cusId('cus_new'),
    });
    const usecase = new EnsureStripeCustomer(
      authRepo,
      usersRepo,
      stripe,
      () => FIXED_NOW,
    );
    const r = await usecase.execute();
    expect(r.ok).toBe(true);
    if (r.ok) expect(String(r.value)).toBe('cus_new');
    // Persisted on the user doc.
    const persisted = await usersRepo.getById(rider.id);
    if (persisted.ok && persisted.value.role === 'rider') {
      expect(String(persisted.value.stripeCustomerId)).toBe('cus_new');
    }
    expect(stripe.spies.createCustomerCalls).toHaveLength(1);
  });

  it('returns AuthorizationError when no user is signed in', async () => {
    const usecase = new EnsureStripeCustomer(
      new InMemoryAuthRepository(),
      new InMemoryUserRepository(),
      new FakeStripeServerService(),
    );
    const r = await usecase.execute();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('authorization');
      expect(r.error.code).toBe('auth_no_current_user');
    }
  });

  it('rejects when the signed-in user is a driver', async () => {
    const { authRepo, usersRepo } = await setupSignedInDriver();
    const usecase = new EnsureStripeCustomer(
      authRepo,
      usersRepo,
      new FakeStripeServerService(),
    );
    const r = await usecase.execute();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('stripe_customer_role_not_rider');
  });

  it('propagates a NetworkError from createCustomer', async () => {
    const { authRepo, usersRepo } = await setupSignedInRider();
    const stripe = new FakeStripeServerService();
    stripe.failNext({
      method: 'createCustomer',
      error: new NetworkError({
        code: 'stripe_down',
        message: 'down',
      }),
    });
    const usecase = new EnsureStripeCustomer(authRepo, usersRepo, stripe);
    const r = await usecase.execute();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('network');
  });

  it('uses the rider full name when calling the server', async () => {
    const { authRepo, usersRepo, rider } = await setupSignedInRider();
    const stripe = new FakeStripeServerService();
    stripe.seedCustomer({ email: rider.email, customerId: cusId('cus_x') });
    const usecase = new EnsureStripeCustomer(
      authRepo,
      usersRepo,
      stripe,
      () => FIXED_NOW,
    );
    await usecase.execute();
    expect(stripe.spies.createCustomerCalls[0]?.name).toBe('Ada Lovelace');
    expect(stripe.spies.createCustomerCalls[0]?.email).toBe(email().value);
  });
});
