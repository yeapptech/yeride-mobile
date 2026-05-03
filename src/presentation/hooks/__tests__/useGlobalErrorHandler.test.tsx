import { renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { NetworkError } from '@domain/errors';
import {
  FakeCrashReportingService,
  TestContainerProvider,
} from '@shared/testing';

import { useGlobalErrorHandler } from '../useGlobalErrorHandler';

type GlobalErrorHandler = (error: Error, isFatal?: boolean) => void;

interface FakeErrorUtils {
  current: GlobalErrorHandler | null;
  getGlobalHandler(): GlobalErrorHandler | null;
  setGlobalHandler(handler: GlobalErrorHandler): void;
}

// `ErrorUtils` is a React Native global. `@types/react-native` declares
// it ambient-style in some versions; we typed-cast through `unknown` to
// avoid colliding with whatever shape the platform typings carry.
function setGlobalErrorUtils(eu: FakeErrorUtils | undefined): void {
  (
    globalThis as unknown as { ErrorUtils: FakeErrorUtils | undefined }
  ).ErrorUtils = eu;
}

function getGlobalErrorUtils(): FakeErrorUtils | undefined {
  return (globalThis as unknown as { ErrorUtils?: FakeErrorUtils }).ErrorUtils;
}

function installFakeErrorUtils(initial: GlobalErrorHandler | null = null): {
  errorUtils: FakeErrorUtils;
  initial: GlobalErrorHandler | null;
} {
  const eu: FakeErrorUtils = {
    current: initial,
    getGlobalHandler() {
      return this.current;
    },
    setGlobalHandler(handler: GlobalErrorHandler) {
      this.current = handler;
    },
  };
  setGlobalErrorUtils(eu);
  return { errorUtils: eu, initial };
}

function withTestContainer(crashReporting: FakeCrashReportingService) {
  return ({ children }: { children: ReactNode }) => (
    <TestContainerProvider crashReporting={crashReporting}>
      {children}
    </TestContainerProvider>
  );
}

afterEach(() => {
  // Clear the stub so a test that omits installation doesn't see a
  // leftover from a previous test.
  setGlobalErrorUtils(undefined);
});

describe('useGlobalErrorHandler — wrapper installation', () => {
  it('installs a wrapper on mount', () => {
    const { errorUtils } = installFakeErrorUtils();
    const fake = new FakeCrashReportingService();
    renderHook(() => useGlobalErrorHandler(), {
      wrapper: withTestContainer(fake),
    });
    expect(typeof errorUtils.current).toBe('function');
  });

  it('captures and chains to the previous handler', () => {
    const previous = jest.fn<void, [Error, boolean | undefined]>();
    const { errorUtils } = installFakeErrorUtils(previous);
    const fake = new FakeCrashReportingService();
    renderHook(() => useGlobalErrorHandler(), {
      wrapper: withTestContainer(fake),
    });
    const wrapper = errorUtils.current;
    expect(wrapper).not.toBe(previous);

    const error = new Error('boom');
    wrapper?.(error, false);

    expect(previous).toHaveBeenCalledTimes(1);
    expect(previous).toHaveBeenCalledWith(error, false);
  });

  it('still chains when there is no previous handler', () => {
    installFakeErrorUtils(null);
    const fake = new FakeCrashReportingService();
    renderHook(() => useGlobalErrorHandler(), {
      wrapper: withTestContainer(fake),
    });
    const wrapper = getGlobalErrorUtils()?.current;
    expect(() => {
      wrapper?.(new Error('boom'), false);
    }).not.toThrow();
  });

  it('silently no-ops when ErrorUtils is undefined', () => {
    // No installation call — globalThis.ErrorUtils stays undefined.
    const fake = new FakeCrashReportingService();
    expect(() => {
      renderHook(() => useGlobalErrorHandler(), {
        wrapper: withTestContainer(fake),
      });
    }).not.toThrow();
    // Hook didn't reach the SDK because ErrorUtils wasn't available.
    expect(fake.spies.recordErrorCalls).toBe(0);
    expect(fake.spies.logCalls).toBe(0);
  });
});

describe('useGlobalErrorHandler — recordError + log fan-out', () => {
  it('records non-fatal errors with scope GlobalErrorHandler', async () => {
    const previous = jest.fn<void, [Error, boolean | undefined]>();
    const { errorUtils } = installFakeErrorUtils(previous);
    const fake = new FakeCrashReportingService();
    renderHook(() => useGlobalErrorHandler(), {
      wrapper: withTestContainer(fake),
    });

    const error = new Error('boom');
    errorUtils.current?.(error, false);

    // recordError fires synchronously (the hook is fire-and-forget but
    // the fake's spy increments inside the awaited call). Wait the
    // microtask tick.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fake.spies.recordErrorCalls).toBe(1);
    const recorded = fake.getRecordedErrors();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.error).toBe(error);
    expect(recorded[0]?.name).toBe('GlobalErrorHandler');

    // Non-fatal — the 'Fatal JS error' breadcrumb must NOT fire.
    expect(fake.spies.logCalls).toBe(0);
  });

  it('logs the Fatal JS error breadcrumb when isFatal is true', async () => {
    const previous = jest.fn<void, [Error, boolean | undefined]>();
    const { errorUtils } = installFakeErrorUtils(previous);
    const fake = new FakeCrashReportingService();
    renderHook(() => useGlobalErrorHandler(), {
      wrapper: withTestContainer(fake),
    });

    errorUtils.current?.(new Error('catastrophe'), true);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fake.spies.recordErrorCalls).toBe(1);
    expect(fake.spies.logCalls).toBe(1);
    expect(fake.getBreadcrumbs()).toEqual(['Fatal JS error']);
  });

  it('chains to previous handler even when recordError fails', async () => {
    const previous = jest.fn<void, [Error, boolean | undefined]>();
    const { errorUtils } = installFakeErrorUtils(previous);
    const fake = new FakeCrashReportingService();
    fake.failNext({
      method: 'recordError',
      error: new NetworkError({
        code: 'crashlytics_record_error_failed',
        message: 'native unavailable',
      }),
    });
    renderHook(() => useGlobalErrorHandler(), {
      wrapper: withTestContainer(fake),
    });

    const error = new Error('boom');
    expect(() => {
      errorUtils.current?.(error, false);
    }).not.toThrow();

    // Previous handler ran regardless of telemetry outcome — that's
    // the whole point of the swallow.
    expect(previous).toHaveBeenCalledTimes(1);
    expect(previous).toHaveBeenCalledWith(error, false);
  });
});

describe('useGlobalErrorHandler — cleanup', () => {
  it('restores the previous handler on unmount', () => {
    const previous = jest.fn<void, [Error, boolean | undefined]>();
    const { errorUtils } = installFakeErrorUtils(previous);
    const fake = new FakeCrashReportingService();
    const { unmount } = renderHook(() => useGlobalErrorHandler(), {
      wrapper: withTestContainer(fake),
    });

    expect(errorUtils.current).not.toBe(previous);
    unmount();
    expect(errorUtils.current).toBe(previous);
  });

  it('leaves the wrapper in place if no previous handler was captured', () => {
    installFakeErrorUtils(null);
    const fake = new FakeCrashReportingService();
    const { unmount } = renderHook(() => useGlobalErrorHandler(), {
      wrapper: withTestContainer(fake),
    });

    const wrapperBeforeUnmount = getGlobalErrorUtils()?.current;
    unmount();
    // No previous handler to restore — the wrapper stays. This is
    // the legacy parity behavior (the cleanup early-returns when
    // previousHandler is null) so a subsequent hook mount can still
    // capture this wrapper as its previous.
    expect(getGlobalErrorUtils()?.current).toBe(wrapperBeforeUnmount);
  });
});
