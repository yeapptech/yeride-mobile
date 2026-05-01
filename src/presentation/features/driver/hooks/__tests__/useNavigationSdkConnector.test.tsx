import { renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import {
  FakeNavigationSdkClient,
  TestContainerProvider,
} from '@shared/testing';

import { useNavigationSdkConnector } from '../useNavigationSdkConnector';

/**
 * Phase 8 turn 2 — verify the connector hook's mount-push /
 * unmount-clear lifecycle against the SDK's `useNavigation()` context
 * (mocked globally in `jest.setup.ts` to return a shared
 * `mockSharedNavigation` value).
 *
 * The connector hook's contract:
 *
 *   - On mount, push the `{controller, listeners}` pair from the SDK's
 *     `useNavigation()` into the adapter via `setController`.
 *   - On unmount, push `{controller: null, listeners: null}` to
 *     disconnect the adapter.
 *   - Re-applying the same pair across re-renders is harmless (the
 *     effect depends on the SDK context value, which is stable across
 *     renders thanks to React.memoization inside `<NavigationProvider/>`).
 */

function makeWrapper(fake: FakeNavigationSdkClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <TestContainerProvider navigationSdk={fake}>
        {children}
      </TestContainerProvider>
    );
  };
}

describe('useNavigationSdkConnector', () => {
  beforeEach(() => {
    // Reset the shared SDK mock so each test gets a fresh
    // controller/listeners pair (so reference-identity assertions don't
    // leak across tests).
    const sdk = require('@googlemaps/react-native-navigation-sdk') as {
      __resetSharedNavigation: () => void;
    };
    sdk.__resetSharedNavigation();
  });

  it('pushes the SDK controller into the adapter on mount', () => {
    const fake = new FakeNavigationSdkClient();
    const wrapper = makeWrapper(fake);

    renderHook(() => useNavigationSdkConnector(), { wrapper });

    expect(fake.spies.setControllerCalls).toHaveLength(1);
    const firstCall = fake.spies.setControllerCalls[0];
    expect(firstCall).toBeDefined();
    if (!firstCall) throw new Error('setControllerCalls[0] missing');
    expect(firstCall.controller).not.toBeNull();
    expect(firstCall.listeners).not.toBeNull();
  });

  it('pushes the SAME controller the SDK context exposes', () => {
    const fake = new FakeNavigationSdkClient();
    const wrapper = makeWrapper(fake);
    const sdk = require('@googlemaps/react-native-navigation-sdk') as {
      __getSharedNavigation: () => {
        navigationController: unknown;
      };
    };
    const expected = sdk.__getSharedNavigation();

    renderHook(() => useNavigationSdkConnector(), { wrapper });

    const firstCall = fake.spies.setControllerCalls[0];
    if (!firstCall) throw new Error('setControllerCalls[0] missing');
    expect(firstCall.controller).toBe(expected.navigationController);
  });

  it('clears the controller on unmount', () => {
    const fake = new FakeNavigationSdkClient();
    const wrapper = makeWrapper(fake);

    const { unmount } = renderHook(() => useNavigationSdkConnector(), {
      wrapper,
    });

    expect(fake.spies.setControllerCalls).toHaveLength(1);
    unmount();

    expect(fake.spies.setControllerCalls).toHaveLength(2);
    const clear = fake.spies.setControllerCalls[1];
    if (!clear) throw new Error('setControllerCalls[1] missing');
    expect(clear.controller).toBeNull();
    expect(clear.listeners).toBeNull();
  });

  it('does not re-push on a no-op re-render (SDK context is stable)', () => {
    const fake = new FakeNavigationSdkClient();
    const wrapper = makeWrapper(fake);

    const { rerender } = renderHook(
      (_args: undefined) => useNavigationSdkConnector(),
      { wrapper, initialProps: undefined },
    );

    expect(fake.spies.setControllerCalls).toHaveLength(1);
    rerender(undefined);
    rerender(undefined);
    rerender(undefined);

    // SDK context value is reference-stable across renders (the jest
    // mock returns the same `mockSharedNavigation` object), so the
    // effect doesn't re-fire.
    expect(fake.spies.setControllerCalls).toHaveLength(1);
  });

  it('re-pushes when the SDK shared context is reset between mounts', () => {
    const fake = new FakeNavigationSdkClient();
    const wrapper = makeWrapper(fake);
    const sdk = require('@googlemaps/react-native-navigation-sdk') as {
      __resetSharedNavigation: () => void;
      __getSharedNavigation: () => { navigationController: unknown };
    };

    const first = renderHook(() => useNavigationSdkConnector(), { wrapper });
    const firstCtl = sdk.__getSharedNavigation().navigationController;
    first.unmount();

    sdk.__resetSharedNavigation();
    const secondCtl = sdk.__getSharedNavigation().navigationController;
    // Sanity check: the reset minted a new controller.
    expect(secondCtl).not.toBe(firstCtl);

    renderHook(() => useNavigationSdkConnector(), { wrapper });
    // Push, clear, push, (still mounted — no clear yet)
    expect(fake.spies.setControllerCalls).toHaveLength(3);
    const lastCall = fake.spies.setControllerCalls[2];
    if (!lastCall) throw new Error('setControllerCalls[2] missing');
    expect(lastCall.controller).toBe(secondCtl);
  });

  it('tolerates concurrent mounts (each independently pushes)', () => {
    const fake = new FakeNavigationSdkClient();
    const wrapper = makeWrapper(fake);

    const a = renderHook(() => useNavigationSdkConnector(), { wrapper });
    const b = renderHook(() => useNavigationSdkConnector(), { wrapper });

    expect(fake.spies.setControllerCalls).toHaveLength(2);
    a.unmount();
    b.unmount();
    expect(fake.spies.setControllerCalls).toHaveLength(4);
  });
});
