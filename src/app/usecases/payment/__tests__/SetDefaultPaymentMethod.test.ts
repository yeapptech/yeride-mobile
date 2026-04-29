import {
  InMemoryAuthRepository,
  InMemoryUserRepository,
} from '@shared/testing';

import { SetDefaultPaymentMethod } from '../SetDefaultPaymentMethod';

import {
  FIXED_NOW,
  pmId,
  setupSignedInDriver,
  setupSignedInRider,
} from './_helpers';

describe('SetDefaultPaymentMethod', () => {
  it('writes a default payment method id onto the rider doc', async () => {
    const { authRepo, usersRepo, rider } = await setupSignedInRider();
    const r = await new SetDefaultPaymentMethod(
      authRepo,
      usersRepo,
      () => FIXED_NOW,
    ).execute({ paymentMethodId: pmId('pm_chosen') });
    expect(r.ok).toBe(true);
    const after = await usersRepo.getById(rider.id);
    if (after.ok && after.value.role === 'rider') {
      expect(String(after.value.defaultPaymentMethodId)).toBe('pm_chosen');
    }
  });

  it('clears the default with explicit null', async () => {
    const { authRepo, usersRepo, rider } = await setupSignedInRider({
      defaultPaymentMethodId: pmId('pm_was'),
    });
    const r = await new SetDefaultPaymentMethod(
      authRepo,
      usersRepo,
      () => FIXED_NOW,
    ).execute({ paymentMethodId: null });
    expect(r.ok).toBe(true);
    const after = await usersRepo.getById(rider.id);
    if (after.ok && after.value.role === 'rider') {
      expect(after.value.defaultPaymentMethodId).toBeNull();
    }
  });

  it('rejects when caller is a driver', async () => {
    const { authRepo, usersRepo } = await setupSignedInDriver();
    const r = await new SetDefaultPaymentMethod(authRepo, usersRepo).execute({
      paymentMethodId: pmId(),
    });
    if (!r.ok) expect(r.error.code).toBe('stripe_set_default_role_not_rider');
  });

  it('rejects when no user is signed in', async () => {
    const r = await new SetDefaultPaymentMethod(
      new InMemoryAuthRepository(),
      new InMemoryUserRepository(),
    ).execute({ paymentMethodId: null });
    if (!r.ok) expect(r.error.code).toBe('auth_no_current_user');
  });
});
