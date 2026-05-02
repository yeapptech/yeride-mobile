import { renderHook, waitFor, act } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { Email } from '@domain/entities/Email';
import { PersonName } from '@domain/entities/PersonName';
import { PhoneNumber } from '@domain/entities/PhoneNumber';
import { PushToken } from '@domain/entities/PushToken';
import { makeRider, type User } from '@domain/entities/User';
import { useNotificationPermissionUiStore } from '@presentation/stores';
import {
  FakePushNotificationService,
  InMemoryAuthRepository,
  InMemoryUserRepository,
  TestContainerProvider,
} from '@shared/testing';

import { usePushTokenRegistration } from '../usePushTokenRegistration';

const FIXED_NOW = new Date('2026-05-02T00:00:00Z');

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

function token(value = 'ExponentPushToken[abc]') {
  return unwrap(PushToken.create(value));
}

interface Setup {
  authRepo: InMemoryAuthRepository;
  usersRepo: InMemoryUserRepository;
  pushService: FakePushNotificationService;
  rider: User;
}

async function setupSeededState(): Promise<Setup> {
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
  });
  await usersRepo.create(rider);
  const pushService = new FakePushNotificationService();
  return { authRepo, usersRepo, pushService, rider };
}

function withTestContainer(setup: Setup) {
  return ({ children }: { children: ReactNode }) => (
    <TestContainerProvider
      auth={setup.authRepo}
      users={setup.usersRepo}
      pushNotifications={setup.pushService}
    >
      {children}
    </TestContainerProvider>
  );
}

beforeEach(() => {
  useNotificationPermissionUiStore.getState().reset();
});

describe('usePushTokenRegistration — Android channel + permission read', () => {
  it('configures the Android channel on mount', async () => {
    const setup = await setupSeededState();
    renderHook(() => usePushTokenRegistration(null), {
      wrapper: withTestContainer(setup),
    });
    await waitFor(() => {
      expect(setup.pushService.isAndroidChannelConfigured()).toBe(true);
    });
  });

  it('mirrors the SDK permission status into the UI store on mount', async () => {
    const setup = await setupSeededState();
    setup.pushService.seedPermission('granted');
    renderHook(() => usePushTokenRegistration(null), {
      wrapper: withTestContainer(setup),
    });
    await waitFor(() => {
      expect(useNotificationPermissionUiStore.getState().permissionStatus).toBe(
        'granted',
      );
    });
  });
});

describe('usePushTokenRegistration — token registration on grant', () => {
  it('does not call RegisterPushToken when no user is signed in', async () => {
    const setup = await setupSeededState();
    setup.pushService.seedPermission('granted');
    setup.pushService.seedToken(token());
    renderHook(() => usePushTokenRegistration(null), {
      wrapper: withTestContainer(setup),
    });
    // Wait long enough for a hypothetical effect chain to fire.
    await new Promise((r) => setTimeout(r, 50));
    expect(setup.pushService.spies.getCurrentTokenCalls).toBe(0);
  });

  it('does not call RegisterPushToken when permission is undetermined', async () => {
    const setup = await setupSeededState();
    setup.pushService.seedToken(token());
    renderHook(() => usePushTokenRegistration(setup.rider), {
      wrapper: withTestContainer(setup),
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(setup.pushService.spies.getCurrentTokenCalls).toBe(0);
  });

  it('writes the token to the user doc when permission is granted', async () => {
    const setup = await setupSeededState();
    setup.pushService.seedPermission('granted');
    setup.pushService.seedToken(token('ExponentPushToken[xyz]'));
    renderHook(() => usePushTokenRegistration(setup.rider), {
      wrapper: withTestContainer(setup),
    });
    await waitFor(() => {
      expect(setup.pushService.spies.getCurrentTokenCalls).toBeGreaterThan(0);
    });
    await waitFor(async () => {
      const persisted = await setup.usersRepo.getById(setup.rider.id);
      if (persisted.ok) {
        expect(String(persisted.value.pushToken)).toBe(
          'ExponentPushToken[xyz]',
        );
      }
    });
  });
});

describe('usePushTokenRegistration — token-refresh subscription', () => {
  it('re-fires RegisterPushToken when the SDK delivers a new token', async () => {
    const setup = await setupSeededState();
    setup.pushService.seedPermission('granted');
    setup.pushService.seedToken(token('ExponentPushToken[v1]'));
    renderHook(() => usePushTokenRegistration(setup.rider), {
      wrapper: withTestContainer(setup),
    });
    // Wait for first registration write.
    await waitFor(async () => {
      const p = await setup.usersRepo.getById(setup.rider.id);
      if (p.ok) expect(String(p.value.pushToken)).toBe('ExponentPushToken[v1]');
    });
    // SDK rotates the token.
    act(() => {
      setup.pushService.emitTokenChange(token('ExponentPushToken[v2]'));
    });
    await waitFor(async () => {
      const p = await setup.usersRepo.getById(setup.rider.id);
      if (p.ok) expect(String(p.value.pushToken)).toBe('ExponentPushToken[v2]');
    });
  });

  it('attaches exactly one underlying subscription regardless of re-renders', async () => {
    const setup = await setupSeededState();
    setup.pushService.seedPermission('granted');
    setup.pushService.seedToken(token());
    const { rerender } = renderHook(
      ({ user }: { user: User | null }) => usePushTokenRegistration(user),
      {
        initialProps: { user: setup.rider as User | null },
        wrapper: withTestContainer(setup),
      },
    );
    rerender({ user: setup.rider });
    rerender({ user: setup.rider });
    expect(setup.pushService.getTokenSubscriberCount()).toBe(1);
  });
});

describe('usePushTokenRegistration — promptForPermission', () => {
  it('flips the mirrored status to whatever the OS prompt resolves to', async () => {
    const setup = await setupSeededState();
    // Seed pre-prompt: undetermined. Caller seeds the post-prompt outcome
    // before calling promptForPermission (mirrors how the real SDK
    // resolves whatever the user picked).
    setup.pushService.seedPermission('undetermined');
    const { result } = renderHook(() => usePushTokenRegistration(setup.rider), {
      wrapper: withTestContainer(setup),
    });
    await waitFor(() => {
      expect(useNotificationPermissionUiStore.getState().permissionStatus).toBe(
        'undetermined',
      );
    });
    setup.pushService.seedPermission('granted');
    let status = '';
    await act(async () => {
      status = await result.current.promptForPermission();
    });
    expect(status).toBe('granted');
    expect(useNotificationPermissionUiStore.getState().permissionStatus).toBe(
      'granted',
    );
  });
});
