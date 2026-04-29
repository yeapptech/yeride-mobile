import { FakeStripeServerService } from '@shared/testing';
import {
  InMemoryAuthRepository,
  InMemoryUserRepository,
} from '@shared/testing';

import { CreateSetupIntent } from '../CreateSetupIntent';

import { cusId, setupSignedInDriver, setupSignedInRider } from './_helpers';

describe('CreateSetupIntent', () => {
  it('returns the clientSecret when the rider owns the customer', async () => {
    const seeded = cusId('cus_owned');
    const { authRepo, usersRepo } = await setupSignedInRider({
      stripeCustomerId: seeded,
    });
    const stripe = new FakeStripeServerService();
    stripe.seedSetupIntent({
      customerId: seeded,
      clientSecret: 'seti_secret',
    });
    const r = await new CreateSetupIntent(authRepo, usersRepo, stripe).execute({
      customerId: seeded,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.clientSecret).toBe('seti_secret');
  });

  it('rejects when no user is signed in', async () => {
    const r = await new CreateSetupIntent(
      new InMemoryAuthRepository(),
      new InMemoryUserRepository(),
      new FakeStripeServerService(),
    ).execute({ customerId: cusId() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('auth_no_current_user');
  });

  it('rejects when the caller is a driver', async () => {
    const { authRepo, usersRepo } = await setupSignedInDriver();
    const r = await new CreateSetupIntent(
      authRepo,
      usersRepo,
      new FakeStripeServerService(),
    ).execute({ customerId: cusId() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('stripe_setup_intent_role_not_rider');
  });

  it('rejects when the rider does not own the customerId', async () => {
    const { authRepo, usersRepo } = await setupSignedInRider({
      stripeCustomerId: cusId('cus_owned'),
    });
    const r = await new CreateSetupIntent(
      authRepo,
      usersRepo,
      new FakeStripeServerService(),
    ).execute({ customerId: cusId('cus_someoneelse') });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('stripe_customer_mismatch');
  });

  it('rejects when the rider has no stripeCustomerId at all', async () => {
    const { authRepo, usersRepo } = await setupSignedInRider();
    const r = await new CreateSetupIntent(
      authRepo,
      usersRepo,
      new FakeStripeServerService(),
    ).execute({ customerId: cusId('cus_x') });
    if (!r.ok) expect(r.error.code).toBe('stripe_customer_mismatch');
  });
});
