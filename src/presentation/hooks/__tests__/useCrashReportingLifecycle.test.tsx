import { renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { Email } from '@domain/entities/Email';
import { PersonName } from '@domain/entities/PersonName';
import { PhoneNumber } from '@domain/entities/PhoneNumber';
import { makeDriver, makeRider, type User } from '@domain/entities/User';
import { UserId } from '@domain/entities/UserId';
import { NetworkError } from '@domain/errors';
import {
  FakeCrashReportingService,
  TestContainerProvider,
} from '@shared/testing';

import { useCrashReportingLifecycle } from '../useCrashReportingLifecycle';

const FIXED_NOW = new Date('2026-05-02T00:00:00Z');

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

// Firebase UIDs are exactly 28 chars; pad with the role-letter so both
// fixtures stay distinct without colliding with real ids.
const RIDER_UID = `rider${'a'.repeat(23)}`; // 28 chars total
const DRIVER_UID = `drvr${'b'.repeat(24)}`; // 28 chars total

function makeRiderUser(): User {
  return makeRider({
    id: unwrap(UserId.create(RIDER_UID)),
    email: unwrap(Email.create('rider@yeapp.tech')),
    name: unwrap(PersonName.create({ first: 'Ada', last: 'Lovelace' })),
    phone: unwrap(PhoneNumber.create('+14155550123')),
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  });
}

function makeDriverUser(): User {
  return makeDriver({
    id: unwrap(UserId.create(DRIVER_UID)),
    email: unwrap(Email.create('driver@yeapp.tech')),
    name: unwrap(PersonName.create({ first: 'Grace', last: 'Hopper' })),
    phone: unwrap(PhoneNumber.create('+14155550456')),
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  });
}

function withTestContainer(crashReporting: FakeCrashReportingService) {
  return ({ children }: { children: ReactNode }) => (
    <TestContainerProvider crashReporting={crashReporting}>
      {children}
    </TestContainerProvider>
  );
}

describe('useCrashReportingLifecycle — collection toggle', () => {
  it('fires setCollectionEnabled exactly once on mount', async () => {
    const fake = new FakeCrashReportingService();
    renderHook(
      (args: { user: User | null; env: string }) =>
        useCrashReportingLifecycle(args),
      {
        wrapper: withTestContainer(fake),
        initialProps: { user: null as User | null, env: 'stage' },
      },
    );
    await waitFor(() => {
      expect(fake.spies.setCollectionEnabledCalls).toBe(1);
    });
    // jest-expo runs with __DEV__ === true, so the hook calls
    // setCollectionEnabled(!__DEV__ === false). Production builds invert.
    expect(fake.getCollectionEnabled()).toBe(false);
  });

  it('does not re-fire setCollectionEnabled across re-renders', async () => {
    const fake = new FakeCrashReportingService();
    const rider = makeRiderUser();
    const { rerender } = renderHook(
      (args: { user: User | null; env: string }) =>
        useCrashReportingLifecycle(args),
      {
        wrapper: withTestContainer(fake),
        initialProps: { user: null as User | null, env: 'stage' },
      },
    );
    await waitFor(() => {
      expect(fake.spies.setCollectionEnabledCalls).toBe(1);
    });
    rerender({ user: rider, env: 'stage' });
    rerender({ user: null, env: 'stage' });
    rerender({ user: rider, env: 'stage' });
    // Every re-render runs the hook body; the ref-guarded effect must
    // skip the toggle.
    expect(fake.spies.setCollectionEnabledCalls).toBe(1);
  });

  it('logs and swallows a setCollectionEnabled failure', async () => {
    const fake = new FakeCrashReportingService();
    fake.failNext({
      method: 'setCollectionEnabled',
      error: new NetworkError({
        code: 'crashlytics_set_collection_enabled_failed',
        message: 'native unavailable',
      }),
    });
    // The hook must not throw — render succeeds.
    expect(() => {
      renderHook(
        (args: { user: User | null; env: string }) =>
          useCrashReportingLifecycle(args),
        {
          wrapper: withTestContainer(fake),
          initialProps: { user: null as User | null, env: 'stage' },
        },
      );
    }).not.toThrow();
    await waitFor(() => {
      expect(fake.spies.setCollectionEnabledCalls).toBe(1);
    });
    // Failed call still counts a spy hit; failed calls don't update
    // the stored value.
    expect(fake.getCollectionEnabled()).toBe(null);
  });
});

describe('useCrashReportingLifecycle — identity tagging', () => {
  it('does not call setUserId / setAttributes while user is null', async () => {
    const fake = new FakeCrashReportingService();
    renderHook(
      (args: { user: User | null; env: string }) =>
        useCrashReportingLifecycle(args),
      {
        wrapper: withTestContainer(fake),
        initialProps: { user: null as User | null, env: 'stage' },
      },
    );
    // Give the collection effect a tick.
    await waitFor(() => {
      expect(fake.spies.setCollectionEnabledCalls).toBe(1);
    });
    // Wait long enough for any concurrent identity effect that
    // shouldn't fire to surface.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fake.spies.setUserIdCalls).toBe(0);
    expect(fake.spies.setAttributesCalls).toBe(0);
  });

  it('tags user id + attributes after user resolves authenticated', async () => {
    const fake = new FakeCrashReportingService();
    const rider = makeRiderUser();
    const { rerender } = renderHook(
      (args: { user: User | null; env: string }) =>
        useCrashReportingLifecycle(args),
      {
        wrapper: withTestContainer(fake),
        initialProps: { user: null as User | null, env: 'production' },
      },
    );
    await waitFor(() => {
      expect(fake.spies.setCollectionEnabledCalls).toBe(1);
    });
    rerender({ user: rider, env: 'production' });
    await waitFor(() => {
      expect(fake.spies.setUserIdCalls).toBe(1);
    });
    expect(fake.getUserId()).toBe(rider.id);
    await waitFor(() => {
      expect(fake.spies.setAttributesCalls).toBe(1);
    });
    expect(fake.getAttributes()).toEqual({
      role: 'rider',
      env: 'production',
    });
  });

  it('passes role: driver for driver users', async () => {
    const fake = new FakeCrashReportingService();
    const driver = makeDriverUser();
    renderHook(
      (args: { user: User | null; env: string }) =>
        useCrashReportingLifecycle(args),
      {
        wrapper: withTestContainer(fake),
        initialProps: { user: driver as User | null, env: 'stage' },
      },
    );
    await waitFor(() => {
      expect(fake.spies.setAttributesCalls).toBe(1);
    });
    expect(fake.getAttributes()).toEqual({
      role: 'driver',
      env: 'stage',
    });
  });

  it('does not re-tag when the same user re-renders with the same env', async () => {
    const fake = new FakeCrashReportingService();
    const rider = makeRiderUser();
    const { rerender } = renderHook(
      (args: { user: User | null; env: string }) =>
        useCrashReportingLifecycle(args),
      {
        wrapper: withTestContainer(fake),
        initialProps: { user: rider as User | null, env: 'stage' },
      },
    );
    await waitFor(() => {
      expect(fake.spies.setUserIdCalls).toBe(1);
    });
    rerender({ user: rider, env: 'stage' });
    rerender({ user: rider, env: 'stage' });
    // Same identity — composite key matches, ref dedup blocks re-fire.
    expect(fake.spies.setUserIdCalls).toBe(1);
    expect(fake.spies.setAttributesCalls).toBe(1);
  });

  it('re-tags when env changes for the same user', async () => {
    const fake = new FakeCrashReportingService();
    const rider = makeRiderUser();
    const { rerender } = renderHook(
      (args: { user: User | null; env: string }) =>
        useCrashReportingLifecycle(args),
      {
        wrapper: withTestContainer(fake),
        initialProps: { user: rider as User | null, env: 'stage' },
      },
    );
    await waitFor(() => {
      expect(fake.spies.setAttributesCalls).toBe(1);
    });
    rerender({ user: rider, env: 'production' });
    await waitFor(() => {
      expect(fake.spies.setAttributesCalls).toBe(2);
    });
    expect(fake.getAttributes()).toEqual({
      role: 'rider',
      env: 'production',
    });
  });
});

describe('useCrashReportingLifecycle — sign-out', () => {
  it('calls setUserId(null) when user transitions to null', async () => {
    const fake = new FakeCrashReportingService();
    const rider = makeRiderUser();
    const { rerender } = renderHook(
      (args: { user: User | null; env: string }) =>
        useCrashReportingLifecycle(args),
      {
        wrapper: withTestContainer(fake),
        initialProps: { user: rider as User | null, env: 'stage' },
      },
    );
    await waitFor(() => {
      expect(fake.spies.setUserIdCalls).toBe(1);
    });
    rerender({ user: null, env: 'stage' });
    await waitFor(() => {
      expect(fake.spies.setUserIdCalls).toBe(2);
    });
    expect(fake.getUserId()).toBe(null);
    // Attributes are NOT cleared on sign-out (no SDK API to clear).
    expect(fake.getAttributes()).toEqual({
      role: 'rider',
      env: 'stage',
    });
    expect(fake.spies.setAttributesCalls).toBe(1);
  });
});

describe('useCrashReportingLifecycle — failure isolation', () => {
  it('continues to fire setAttributes when setUserId fails', async () => {
    const fake = new FakeCrashReportingService();
    fake.failNext({
      method: 'setUserId',
      error: new NetworkError({
        code: 'crashlytics_set_user_id_failed',
        message: 'native unavailable',
      }),
    });
    const rider = makeRiderUser();
    renderHook(
      (args: { user: User | null; env: string }) =>
        useCrashReportingLifecycle(args),
      {
        wrapper: withTestContainer(fake),
        initialProps: { user: rider as User | null, env: 'stage' },
      },
    );
    await waitFor(() => {
      expect(fake.spies.setAttributesCalls).toBe(1);
    });
    // setUserId failed (didn't store the value) but setAttributes
    // still ran.
    expect(fake.getUserId()).toBe(null);
    expect(fake.getAttributes()).toEqual({
      role: 'rider',
      env: 'stage',
    });
  });

  it('logs and swallows a setAttributes failure', async () => {
    const fake = new FakeCrashReportingService();
    fake.failNext({
      method: 'setAttributes',
      error: new NetworkError({
        code: 'crashlytics_set_attributes_failed',
        message: 'native unavailable',
      }),
    });
    const rider = makeRiderUser();
    expect(() => {
      renderHook(
        (args: { user: User | null; env: string }) =>
          useCrashReportingLifecycle(args),
        {
          wrapper: withTestContainer(fake),
          initialProps: { user: rider as User | null, env: 'stage' },
        },
      );
    }).not.toThrow();
    await waitFor(() => {
      expect(fake.spies.setAttributesCalls).toBe(1);
    });
    expect(fake.getAttributes()).toEqual({});
  });
});
