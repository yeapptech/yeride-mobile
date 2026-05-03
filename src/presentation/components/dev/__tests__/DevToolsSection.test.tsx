import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { NetworkError } from '@domain/errors';
import {
  FakeCrashReportingService,
  TestContainerProvider,
} from '@shared/testing';

import { DevToolsSection } from '../DevToolsSection';

/**
 * Phase 9 turn 3 sub-turn 3c — `DevToolsSection`.
 *
 * The section is gated on `__DEV__`. jest-expo defaults to
 * `__DEV__ === true`, so the bulk of the tests run with the section
 * visible. The production-build path (`__DEV__ === false`) is
 * exercised in its own test that flips the global before mounting and
 * restores it after.
 *
 * `crash()` on the fake flips a flag instead of raising a fatal
 * exception — so the force-crash button can be exercised without
 * taking the Jest worker down. Asserts use `fake.didCrash()`.
 */

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

const mockedToast = jest.requireMock('react-native-toast-message').default as {
  show: jest.Mock;
  hide: jest.Mock;
};

function withTestContainer(crashReporting: FakeCrashReportingService) {
  return ({ children }: { children: ReactNode }) => (
    <TestContainerProvider crashReporting={crashReporting}>
      {children}
    </TestContainerProvider>
  );
}

describe('DevToolsSection — visibility', () => {
  beforeEach(() => {
    mockedToast.show.mockClear();
  });

  it('renders all three buttons under __DEV__', () => {
    const fake = new FakeCrashReportingService();
    const { getByTestId } = render(<DevToolsSection />, {
      wrapper: withTestContainer(fake),
    });
    expect(getByTestId('dev-tools-section')).toBeTruthy();
    expect(getByTestId('dev-tools-toggle-collection')).toBeTruthy();
    expect(getByTestId('dev-tools-record-non-fatal')).toBeTruthy();
    expect(getByTestId('dev-tools-force-crash')).toBeTruthy();
  });

  it('renders nothing when __DEV__ is false', () => {
    // jest-expo defaults `__DEV__` to true; flip it for this test
    // only and restore in `finally`.
    const dev = (globalThis as unknown as { __DEV__: boolean }).__DEV__;
    (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
    try {
      const fake = new FakeCrashReportingService();
      const { queryByTestId } = render(<DevToolsSection />, {
        wrapper: withTestContainer(fake),
      });
      expect(queryByTestId('dev-tools-section')).toBeNull();
      expect(queryByTestId('dev-tools-toggle-collection')).toBeNull();
      expect(queryByTestId('dev-tools-record-non-fatal')).toBeNull();
      expect(queryByTestId('dev-tools-force-crash')).toBeNull();
    } finally {
      (globalThis as unknown as { __DEV__: boolean }).__DEV__ = dev;
    }
  });
});

describe('DevToolsSection — Toggle Crashlytics collection on', () => {
  beforeEach(() => {
    mockedToast.show.mockClear();
  });

  it('calls setCollectionEnabled(true) on tap and shows success Toast', async () => {
    const fake = new FakeCrashReportingService();
    const { getByTestId } = render(<DevToolsSection />, {
      wrapper: withTestContainer(fake),
    });

    fireEvent.press(getByTestId('dev-tools-toggle-collection'));

    await waitFor(() => {
      expect(fake.spies.setCollectionEnabledCalls).toBe(1);
    });
    expect(fake.getCollectionEnabled()).toBe(true);
    expect(mockedToast.show).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        text1: 'Crashlytics collection enabled',
      }),
    );
  });

  it('shows error Toast when setCollectionEnabled rejects', async () => {
    const fake = new FakeCrashReportingService();
    fake.failNext({
      method: 'setCollectionEnabled',
      error: new NetworkError({
        code: 'crashlytics_set_collection_enabled_failed',
        message: 'native unavailable',
      }),
    });
    const { getByTestId } = render(<DevToolsSection />, {
      wrapper: withTestContainer(fake),
    });

    fireEvent.press(getByTestId('dev-tools-toggle-collection'));

    await waitFor(() => {
      expect(mockedToast.show).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          text1: "Couldn't enable Crashlytics collection",
        }),
      );
    });
    // Failure should NOT have flipped the fake's collection state.
    expect(fake.getCollectionEnabled()).toBeNull();
  });
});

describe('DevToolsSection — Record non-fatal error', () => {
  beforeEach(() => {
    mockedToast.show.mockClear();
  });

  it('calls recordError with name="DevTools" on tap and shows success Toast', async () => {
    const fake = new FakeCrashReportingService();
    const { getByTestId } = render(<DevToolsSection />, {
      wrapper: withTestContainer(fake),
    });

    fireEvent.press(getByTestId('dev-tools-record-non-fatal'));

    await waitFor(() => {
      expect(fake.spies.recordErrorCalls).toBe(1);
    });
    const recorded = fake.getRecordedErrors();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.error.message).toBe('DEV: smoke recordError');
    expect(recorded[0]?.name).toBe('DevTools');
    expect(mockedToast.show).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        text1: 'Non-fatal recorded',
      }),
    );
  });

  it('shows error Toast when recordError rejects', async () => {
    const fake = new FakeCrashReportingService();
    fake.failNext({
      method: 'recordError',
      error: new NetworkError({
        code: 'crashlytics_record_error_failed',
        message: 'native unavailable',
      }),
    });
    const { getByTestId } = render(<DevToolsSection />, {
      wrapper: withTestContainer(fake),
    });

    fireEvent.press(getByTestId('dev-tools-record-non-fatal'));

    await waitFor(() => {
      expect(mockedToast.show).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          text1: "Couldn't record non-fatal error",
        }),
      );
    });
  });
});

describe('DevToolsSection — Force crash', () => {
  beforeEach(() => {
    mockedToast.show.mockClear();
  });

  it('calls crashReporting.crash() on tap', () => {
    const fake = new FakeCrashReportingService();
    const { getByTestId } = render(<DevToolsSection />, {
      wrapper: withTestContainer(fake),
    });

    expect(fake.didCrash()).toBe(false);
    fireEvent.press(getByTestId('dev-tools-force-crash'));
    expect(fake.didCrash()).toBe(true);
    expect(fake.spies.crashCalls).toBe(1);
    // No Toast for force-crash — it's intentionally an unrecoverable
    // signal, no UX feedback expected.
    expect(mockedToast.show).not.toHaveBeenCalled();
  });
});
