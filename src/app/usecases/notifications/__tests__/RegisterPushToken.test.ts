import { Email, PersonName, PhoneNumber } from '@domain/entities';
import { PushToken } from '@domain/entities/PushToken';
import { makeRider, makeDriver } from '@domain/entities/User';
import { NetworkError, ValidationError } from '@domain/errors';
import {
  FakePushNotificationService,
  InMemoryAuthRepository,
  InMemoryUserRepository,
} from '@shared/testing';

import { RegisterPushToken } from '../RegisterPushToken';

const FIXED_NOW = new Date('2026-05-02T00:00:00Z');

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

function token(value = 'ExponentPushToken[abc]') {
  return unwrap(PushToken.create(value));
}

async function setupSignedInRider(
  overrides: Partial<Parameters<typeof makeRider>[0]> = {},
) {
  const authRepo = new InMemoryAuthRepository();
  const email = unwrap(Email.create('rider@yeapp.tech'));
  const signUpR = await authRepo.signUp({ email, password: 'pw1234' });
  const userId = unwrap(signUpR);
  const usersRepo = new InMemoryUserRepository();
  const rider = makeRider({
    id: userId,
    email,
    name: unwrap(PersonName.create({ first: 'Ada', last: 'Lovelace' })),
    phone: unwrap(PhoneNumber.create('+14155550123')),
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  });
  await usersRepo.create(rider);
  return { authRepo, usersRepo, rider };
}

describe('RegisterPushToken', () => {
  it('writes a fresh token to the user doc when none was set', async () => {
    const { authRepo, usersRepo, rider } = await setupSignedInRider();
    const pushService = new FakePushNotificationService();
    pushService.seedToken(token('ExponentPushToken[fresh]'));

    const usecase = new RegisterPushToken(
      authRepo,
      usersRepo,
      pushService,
      () => FIXED_NOW,
    );
    const r = await usecase.execute();

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.written).toBe(true);
      expect(String(r.value.token)).toBe('ExponentPushToken[fresh]');
      expect(r.value.skippedReason).toBeNull();
    }
    const persisted = await usersRepo.getById(rider.id);
    if (persisted.ok) {
      expect(String(persisted.value.pushToken)).toBe(
        'ExponentPushToken[fresh]',
      );
    }
  });

  it('skips the write when the user doc already has the same token (idempotency)', async () => {
    const seededToken = token('ExponentPushToken[same]');
    const { authRepo, usersRepo, rider } = await setupSignedInRider({
      pushToken: seededToken,
    });
    // Snapshot the original updatedAt to assert the no-op.
    const originalUpdatedAt = rider.updatedAt;

    const pushService = new FakePushNotificationService();
    pushService.seedToken(seededToken);

    const usecase = new RegisterPushToken(
      authRepo,
      usersRepo,
      pushService,
      () => new Date('2099-01-01Z'),
    );
    const r = await usecase.execute();

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.written).toBe(false);
      expect(r.value.skippedReason).toBe('no_change');
    }
    const persisted = await usersRepo.getById(rider.id);
    if (persisted.ok) {
      expect(persisted.value.updatedAt).toEqual(originalUpdatedAt);
    }
  });

  it('overwrites a stale on-disk token when the SDK reports a different one', async () => {
    const { authRepo, usersRepo, rider } = await setupSignedInRider({
      pushToken: token('ExponentPushToken[stale]'),
    });
    const pushService = new FakePushNotificationService();
    pushService.seedToken(token('ExponentPushToken[fresh]'));

    const usecase = new RegisterPushToken(
      authRepo,
      usersRepo,
      pushService,
      () => FIXED_NOW,
    );
    const r = await usecase.execute();

    if (r.ok) expect(r.value.written).toBe(true);
    const persisted = await usersRepo.getById(rider.id);
    if (persisted.ok) {
      expect(String(persisted.value.pushToken)).toBe(
        'ExponentPushToken[fresh]',
      );
    }
  });

  it('returns no_token outcome when SDK has no token (permission denied / simulator)', async () => {
    const { authRepo, usersRepo } = await setupSignedInRider();
    const pushService = new FakePushNotificationService();
    // Default seedToken is null — equivalent to the SDK reporting no token yet.

    const usecase = new RegisterPushToken(authRepo, usersRepo, pushService);
    const r = await usecase.execute();

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.token).toBeNull();
      expect(r.value.written).toBe(false);
      expect(r.value.skippedReason).toBe('no_token');
    }
  });

  it('returns AuthorizationError when no user is signed in', async () => {
    const usecase = new RegisterPushToken(
      new InMemoryAuthRepository(),
      new InMemoryUserRepository(),
      new FakePushNotificationService(),
    );
    const r = await usecase.execute();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('authorization');
      expect(r.error.code).toBe('auth_no_current_user');
    }
  });

  it('propagates a NetworkError from the push service getCurrentToken call', async () => {
    const { authRepo, usersRepo } = await setupSignedInRider();
    const pushService = new FakePushNotificationService();
    pushService.failNext({
      method: 'getCurrentToken',
      error: new NetworkError({
        code: 'push_get_token_failed',
        message: 'simulator without APNs',
      }),
    });

    const usecase = new RegisterPushToken(authRepo, usersRepo, pushService);
    const r = await usecase.execute();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('network');
  });

  it('propagates a ValidationError from a malformed SDK token shape', async () => {
    const { authRepo, usersRepo } = await setupSignedInRider();
    const pushService = new FakePushNotificationService();
    pushService.failNext({
      method: 'getCurrentToken',
      error: new ValidationError({
        code: 'push_token_invalid_format',
        message: 'bad shape',
      }),
    });

    const usecase = new RegisterPushToken(authRepo, usersRepo, pushService);
    const r = await usecase.execute();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('validation');
  });

  it('returns NotFoundError when the user doc is missing', async () => {
    // Sign in via auth, but never seed the user doc.
    const authRepo = new InMemoryAuthRepository();
    await authRepo.signUp({
      email: unwrap(Email.create('ghost@yeapp.tech')),
      password: 'pw1234',
    });
    const usersRepo = new InMemoryUserRepository();
    const pushService = new FakePushNotificationService();
    pushService.seedToken(token());

    const usecase = new RegisterPushToken(authRepo, usersRepo, pushService);
    const r = await usecase.execute();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('not_found');
  });

  it('works for drivers too (token is a UserBase field, not role-specific)', async () => {
    const authRepo = new InMemoryAuthRepository();
    const email = unwrap(Email.create('driver@yeapp.tech'));
    const signUpR = await authRepo.signUp({ email, password: 'pw1234' });
    const userId = unwrap(signUpR);
    const usersRepo = new InMemoryUserRepository();
    const driver = makeDriver({
      id: userId,
      email,
      name: unwrap(PersonName.create({ first: 'Grace', last: 'Hopper' })),
      phone: unwrap(PhoneNumber.create('+14155550123')),
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    });
    await usersRepo.create(driver);

    const pushService = new FakePushNotificationService();
    pushService.seedToken(token('ExponentPushToken[driverTok]'));

    const usecase = new RegisterPushToken(authRepo, usersRepo, pushService);
    const r = await usecase.execute();
    if (r.ok) expect(r.value.written).toBe(true);
    const persisted = await usersRepo.getById(driver.id);
    if (persisted.ok) {
      expect(String(persisted.value.pushToken)).toBe(
        'ExponentPushToken[driverTok]',
      );
    }
  });
});
