import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useGpsStore } from '@presentation/stores';
import {
  FakeBackgroundGeolocationClient,
  TestContainerProvider,
} from '@shared/testing';

import { usePermissionRefresh } from '../usePermissionRefresh';

// react-native-toast-message: the hook fires `Toast.show(...)` on the
// grant-edge transition. Mirror the rider VM's mock pattern (jest.fn()
// inside the factory; grab handle via jest.requireMock to avoid
// hoisting-with-outer-references issues).
jest.mock('react-native-toast-message', () => {
  const show = jest.fn();
  const hide = jest.fn();
  function ToastComponent() {
    return null;
  }
  ToastComponent.show = show;
  ToastComponent.hide = hide;
  return { __esModule: true, default: ToastComponent };
});

const mockToast = jest.requireMock('react-native-toast-message') as {
  default: { show: jest.Mock; hide: jest.Mock };
};
const mockToastShow = mockToast.default.show;

function makeWrapper(bg: FakeBackgroundGeolocationClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <TestContainerProvider bgGeolocation={bg}>
        {children}
      </TestContainerProvider>
    );
  };
}

describe('usePermissionRefresh', () => {
  let registeredHandler: ((s: AppStateStatus) => void) | null = null;
  let removeMock: jest.Mock;
  let addEventListenerSpy: jest.SpyInstance;

  beforeEach(() => {
    useGpsStore.getState().reset();
    mockToastShow.mockClear();
    registeredHandler = null;
    removeMock = jest.fn();
    addEventListenerSpy = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((evt, cb) => {
        if (evt === 'change') {
          registeredHandler = cb as (s: AppStateStatus) => void;
        }
        return { remove: removeMock } as never;
      });
  });

  afterEach(() => {
    addEventListenerSpy.mockRestore();
  });

  it("registers an AppState 'change' listener on mount and removes on unmount", () => {
    const bg = new FakeBackgroundGeolocationClient();
    const { unmount } = renderHook(
      () => usePermissionRefresh({ enabled: true }),
      { wrapper: makeWrapper(bg) },
    );

    expect(addEventListenerSpy).toHaveBeenCalledWith(
      'change',
      expect.any(Function),
    );
    expect(removeMock).not.toHaveBeenCalled();

    unmount();
    expect(removeMock).toHaveBeenCalledTimes(1);
  });

  it("ignores AppState transitions other than 'active'", async () => {
    const bg = new FakeBackgroundGeolocationClient();
    bg.seedAuthorization('always');
    renderHook(() => usePermissionRefresh({ enabled: true }), {
      wrapper: makeWrapper(bg),
    });

    await act(async () => {
      registeredHandler?.('background');
      registeredHandler?.('inactive');
      await Promise.resolve();
    });

    expect(bg.spies.requestAuthorizationCalls).toBe(0);
    expect(bg.spies.startCalls).toBe(0);
    expect(mockToastShow).not.toHaveBeenCalled();
  });

  it("re-polls the SDK and writes the store on AppState 'active'", async () => {
    const bg = new FakeBackgroundGeolocationClient();
    bg.seedAuthorization('always');
    renderHook(() => usePermissionRefresh({ enabled: true }), {
      wrapper: makeWrapper(bg),
    });

    await act(async () => {
      registeredHandler?.('active');
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(bg.spies.requestAuthorizationCalls).toBe(1);
    });
    expect(useGpsStore.getState().permissionStatus).toBe('always');
  });

  it('does NOT toast on the initial-mount poll (no prior status)', async () => {
    const bg = new FakeBackgroundGeolocationClient();
    bg.seedAuthorization('always');
    renderHook(() => usePermissionRefresh({ enabled: true }), {
      wrapper: makeWrapper(bg),
    });

    await act(async () => {
      registeredHandler?.('active');
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(useGpsStore.getState().permissionStatus).toBe('always');
    });

    expect(mockToastShow).not.toHaveBeenCalled();
  });

  it('toasts + calls start() on the denied → granted edge when enabled', async () => {
    const bg = new FakeBackgroundGeolocationClient();
    // First poll seeds the previousStatusRef with 'denied' and writes
    // 'denied' to the store.
    bg.seedAuthorization('denied');
    renderHook(() => usePermissionRefresh({ enabled: true }), {
      wrapper: makeWrapper(bg),
    });

    await act(async () => {
      registeredHandler?.('active');
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(useGpsStore.getState().permissionStatus).toBe('denied');
    });
    expect(mockToastShow).not.toHaveBeenCalled();

    // User grants via Settings; second poll returns 'always'.
    bg.seedAuthorization('always');
    await act(async () => {
      registeredHandler?.('active');
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(useGpsStore.getState().permissionStatus).toBe('always');
    });

    expect(mockToastShow).toHaveBeenCalledTimes(1);
    expect(mockToastShow).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        text1: expect.stringContaining('Location access enabled'),
      }),
    );
    expect(bg.spies.startCalls).toBe(1);
  });

  it('toasts but does NOT call start() on the grant edge when enabled === false', async () => {
    const bg = new FakeBackgroundGeolocationClient();
    bg.seedAuthorization('denied');
    const { rerender } = renderHook(
      (args: { enabled: boolean }) => usePermissionRefresh(args),
      { wrapper: makeWrapper(bg), initialProps: { enabled: false } },
    );

    await act(async () => {
      registeredHandler?.('active');
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(useGpsStore.getState().permissionStatus).toBe('denied');
    });

    // Grant comes in while still disabled (e.g. signed-out user grants
    // permission then later signs in). Toast still fires (the user did
    // a thing, acknowledge it), but start() is gated on enabled — the
    // useGpsLifecycle hook will start the SDK on the next sign-in
    // transition.
    bg.seedAuthorization('always');
    rerender({ enabled: false });
    await act(async () => {
      registeredHandler?.('active');
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(useGpsStore.getState().permissionStatus).toBe('always');
    });
    expect(mockToastShow).toHaveBeenCalledTimes(1);
    expect(bg.spies.startCalls).toBe(0);
  });

  it('does not toast when the status stays granted across polls', async () => {
    const bg = new FakeBackgroundGeolocationClient();
    bg.seedAuthorization('always');
    renderHook(() => usePermissionRefresh({ enabled: true }), {
      wrapper: makeWrapper(bg),
    });

    await act(async () => {
      registeredHandler?.('active');
      await Promise.resolve();
    });
    await act(async () => {
      registeredHandler?.('active');
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(bg.spies.requestAuthorizationCalls).toBe(2);
    });
    expect(mockToastShow).not.toHaveBeenCalled();
  });
});
