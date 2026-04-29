import { PaymentMethod } from '@domain/entities/PaymentMethod';
import { FakeStripeServerService } from '@shared/testing';
import {
  InMemoryAuthRepository,
  InMemoryUserRepository,
} from '@shared/testing';

import { ListPaymentMethods } from '../ListPaymentMethods';

import {
  cusId,
  pmId,
  setupSignedInDriver,
  setupSignedInRider,
  unwrap,
} from './_helpers';

function pm(id: string, last4 = '4242'): PaymentMethod {
  return unwrap(
    PaymentMethod.create({
      id: pmId(id),
      brand: 'visa',
      last4,
      expiry: null,
    }),
  );
}

describe('ListPaymentMethods', () => {
  it('returns the seeded methods when the rider owns the customer', async () => {
    const seeded = cusId('cus_owned');
    const { authRepo, usersRepo } = await setupSignedInRider({
      stripeCustomerId: seeded,
    });
    const stripe = new FakeStripeServerService();
    stripe.seedPaymentMethods({
      customerId: seeded,
      methods: [pm('pm_one'), pm('pm_two', '5555')],
    });
    const r = await new ListPaymentMethods(authRepo, usersRepo, stripe).execute(
      { customerId: seeded },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toHaveLength(2);
  });

  it('rejects when caller is a driver', async () => {
    const { authRepo, usersRepo } = await setupSignedInDriver();
    const r = await new ListPaymentMethods(
      authRepo,
      usersRepo,
      new FakeStripeServerService(),
    ).execute({ customerId: cusId() });
    if (!r.ok) expect(r.error.code).toBe('stripe_list_methods_role_not_rider');
  });

  it('rejects when the rider does not own the customerId', async () => {
    const { authRepo, usersRepo } = await setupSignedInRider({
      stripeCustomerId: cusId('cus_owned'),
    });
    const r = await new ListPaymentMethods(
      authRepo,
      usersRepo,
      new FakeStripeServerService(),
    ).execute({ customerId: cusId('cus_other') });
    if (!r.ok) expect(r.error.code).toBe('stripe_customer_mismatch');
  });

  it('returns AuthorizationError on no signed-in user', async () => {
    const r = await new ListPaymentMethods(
      new InMemoryAuthRepository(),
      new InMemoryUserRepository(),
      new FakeStripeServerService(),
    ).execute({ customerId: cusId() });
    if (!r.ok) expect(r.error.code).toBe('auth_no_current_user');
  });
});
