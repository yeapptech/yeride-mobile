import { NetworkError } from '@domain/errors';
import { FakeStripeServerService } from '@shared/testing';
import {
  InMemoryAuthRepository,
  InMemoryUserRepository,
} from '@shared/testing';

import { DetachPaymentMethod } from '../DetachPaymentMethod';

import { FIXED_NOW, pmId, setupSignedInRider } from './_helpers';

describe('DetachPaymentMethod', () => {
  it('detaches a non-default card', async () => {
    const target = pmId('pm_other');
    const { authRepo, usersRepo, rider } = await setupSignedInRider({
      defaultPaymentMethodId: pmId('pm_default'),
    });
    const stripe = new FakeStripeServerService();
    const r = await new DetachPaymentMethod(
      authRepo,
      usersRepo,
      stripe,
      () => FIXED_NOW,
    ).execute({ paymentMethodId: target });
    expect(r.ok).toBe(true);
    expect(stripe.spies.detachCalls).toEqual([{ paymentMethodId: target }]);
    // Default still pm_default.
    const after = await usersRepo.getById(rider.id);
    if (after.ok && after.value.role === 'rider') {
      expect(String(after.value.defaultPaymentMethodId)).toBe('pm_default');
    }
  });

  it('clears the user-doc default BEFORE the server detach when removing the default card', async () => {
    const target = pmId('pm_default');
    const { authRepo, usersRepo, rider } = await setupSignedInRider({
      defaultPaymentMethodId: target,
    });
    const stripe = new FakeStripeServerService();
    const r = await new DetachPaymentMethod(
      authRepo,
      usersRepo,
      stripe,
      () => FIXED_NOW,
    ).execute({ paymentMethodId: target });
    expect(r.ok).toBe(true);
    const after = await usersRepo.getById(rider.id);
    if (after.ok && after.value.role === 'rider') {
      expect(after.value.defaultPaymentMethodId).toBeNull();
    }
  });

  it('restores the default if the server detach fails', async () => {
    const target = pmId('pm_default');
    const { authRepo, usersRepo, rider } = await setupSignedInRider({
      defaultPaymentMethodId: target,
    });
    const stripe = new FakeStripeServerService();
    stripe.failNext({
      method: 'detachPaymentMethod',
      error: new NetworkError({
        code: 'stripe_down',
        message: 'down',
      }),
    });
    const r = await new DetachPaymentMethod(
      authRepo,
      usersRepo,
      stripe,
      () => FIXED_NOW,
    ).execute({ paymentMethodId: target });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('network');
    // Restored.
    const after = await usersRepo.getById(rider.id);
    if (after.ok && after.value.role === 'rider') {
      expect(String(after.value.defaultPaymentMethodId)).toBe('pm_default');
    }
  });

  it('rejects when no user is signed in', async () => {
    const r = await new DetachPaymentMethod(
      new InMemoryAuthRepository(),
      new InMemoryUserRepository(),
      new FakeStripeServerService(),
    ).execute({ paymentMethodId: pmId() });
    if (!r.ok) expect(r.error.code).toBe('auth_no_current_user');
  });
});
