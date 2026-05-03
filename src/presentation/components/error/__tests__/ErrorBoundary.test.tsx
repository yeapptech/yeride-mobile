import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Text } from 'react-native';

import {
  FakeCrashReportingService,
  TestContainerProvider,
} from '@shared/testing';

import { ErrorBoundary } from '../ErrorBoundary';

/**
 * Phase 9 turn 6 — `<ErrorBoundary/>`.
 *
 * Render-phase throws are caught synchronously by React; the boundary
 * fans the error out to `crashReporting.recordError(error,
 * 'ErrorBoundary')` and renders a fallback UI. The "Try again" CTA
 * bumps an internal `resetCount` that's passed as `key` to the inner
 * class component, triggering a full unmount + remount of the
 * boundary so children re-render fresh.
 *
 * React's reconciler logs caught errors to `console.error` on its own
 * (independent of our `componentDidCatch`). We silence the spy in each
 * test so the output stays clean.
 */

function withTestContainer(crashReporting: FakeCrashReportingService) {
  return ({ children }: { children: ReactNode }) => (
    <TestContainerProvider crashReporting={crashReporting}>
      {children}
    </TestContainerProvider>
  );
}

/** Drains the microtask queue so async `void`-fired SDK calls land. */
const flushMicrotasks = () => Promise.resolve();

let consoleErrorSpy: jest.SpyInstance;
beforeEach(() => {
  // React 19 logs caught errors via its own console.error path; the
  // `componentDidCatch` `recordError` fan-out is what we're asserting,
  // not React's own logging. Mute the noise.
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  consoleErrorSpy.mockRestore();
});

describe('ErrorBoundary — happy path', () => {
  it('renders children when no error is thrown', () => {
    const fake = new FakeCrashReportingService();
    const { getByText, queryByTestId } = render(
      <ErrorBoundary>
        <Text>hello world</Text>
      </ErrorBoundary>,
      { wrapper: withTestContainer(fake) },
    );
    expect(getByText('hello world')).toBeTruthy();
    expect(queryByTestId('error-boundary-fallback')).toBeNull();
    expect(fake.spies.recordErrorCalls).toBe(0);
  });
});

describe('ErrorBoundary — catches render-phase throws', () => {
  /**
   * Component that always throws on render. React's reconciler will
   * walk up to the nearest error boundary, call
   * `getDerivedStateFromError` synchronously to set the boundary's
   * fallback state, then `componentDidCatch` for side-effects.
   */
  function Throwing(): never {
    throw new Error('render boom');
  }

  it('renders the fallback UI when a child throws', () => {
    const fake = new FakeCrashReportingService();
    const { getByTestId, queryByText } = render(
      <ErrorBoundary>
        <Throwing />
      </ErrorBoundary>,
      { wrapper: withTestContainer(fake) },
    );
    expect(getByTestId('error-boundary-fallback')).toBeTruthy();
    expect(getByTestId('error-boundary-try-again')).toBeTruthy();
    expect(queryByText('Something went wrong')).toBeTruthy();
  });

  it('fires recordError with the actual Error reference and name="ErrorBoundary"', async () => {
    const fake = new FakeCrashReportingService();
    render(
      <ErrorBoundary>
        <Throwing />
      </ErrorBoundary>,
      { wrapper: withTestContainer(fake) },
    );
    await flushMicrotasks();
    expect(fake.spies.recordErrorCalls).toBe(1);
    const recorded = fake.getRecordedErrors();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.name).toBe('ErrorBoundary');
    expect(recorded[0]?.error).toBeInstanceOf(Error);
    expect(recorded[0]?.error.message).toBe('render boom');
  });

  it('logs a breadcrumb carrying the React component stack', async () => {
    const fake = new FakeCrashReportingService();
    render(
      <ErrorBoundary>
        <Throwing />
      </ErrorBoundary>,
      { wrapper: withTestContainer(fake) },
    );
    await flushMicrotasks();
    // The breadcrumb starts with the boundary tag — after the
    // `[ErrorBoundary] component stack:` prefix React appends the
    // synthetic component-stack lines (`\n    at Throwing\n    at
    // ErrorBoundary\n    ...`). We assert on the prefix and a
    // mention of the throwing component's name; the exact stack
    // formatting varies between React versions.
    const breadcrumbs = fake.getBreadcrumbs();
    const componentStackBreadcrumb = breadcrumbs.find((b) =>
      b.startsWith('[ErrorBoundary] component stack:'),
    );
    expect(componentStackBreadcrumb).toBeDefined();
    expect(componentStackBreadcrumb).toContain('Throwing');
  });
});

describe('ErrorBoundary — Try again resets the boundary', () => {
  it('bumping the reset key remounts the subtree; recovered children render', async () => {
    const fake = new FakeCrashReportingService();

    // Closure-controlled flag the throwing child reads. Setting it
    // false before pressing "Try again" lets the subtree mount
    // successfully on the second attempt.
    let shouldThrow = true;
    function MaybeThrow() {
      if (shouldThrow) throw new Error('first attempt');
      return <Text>recovered</Text>;
    }

    const { getByTestId, queryByText, queryByTestId } = render(
      <ErrorBoundary>
        <MaybeThrow />
      </ErrorBoundary>,
      { wrapper: withTestContainer(fake) },
    );

    // 1. Initial render — fallback visible.
    expect(getByTestId('error-boundary-fallback')).toBeTruthy();
    expect(queryByText('recovered')).toBeNull();

    // 2. Stop throwing, then press Try again.
    shouldThrow = false;
    fireEvent.press(getByTestId('error-boundary-try-again'));

    // 3. Subtree remounts; children render successfully.
    await waitFor(() => {
      expect(queryByText('recovered')).toBeTruthy();
    });
    expect(queryByTestId('error-boundary-fallback')).toBeNull();
    // Only the original throw was recorded.
    expect(fake.spies.recordErrorCalls).toBe(1);
  });

  it('if children still throw after Try again, the fallback re-renders + a second recordError fires', async () => {
    const fake = new FakeCrashReportingService();

    function AlwaysThrow(): never {
      throw new Error('persistent boom');
    }

    const { getByTestId } = render(
      <ErrorBoundary>
        <AlwaysThrow />
      </ErrorBoundary>,
      { wrapper: withTestContainer(fake) },
    );

    expect(getByTestId('error-boundary-fallback')).toBeTruthy();
    const initialRecordCalls = fake.spies.recordErrorCalls;
    expect(initialRecordCalls).toBeGreaterThanOrEqual(1);

    fireEvent.press(getByTestId('error-boundary-try-again'));

    // Fallback is back; the new boundary instance caught the throw
    // again. recordError fires at least once more (React in dev may
    // double-invoke `componentDidCatch` on a re-thrown error to
    // surface buggy error-handling logic, so the exact total can be
    // 2 or more — what matters is that the retry produced at least
    // one additional capture).
    expect(getByTestId('error-boundary-fallback')).toBeTruthy();
    await flushMicrotasks();
    expect(fake.spies.recordErrorCalls).toBeGreaterThan(initialRecordCalls);
  });
});

describe('ErrorBoundary — production hides debug details', () => {
  function Throwing(): never {
    throw new Error('detail boom');
  }

  it('shows the dev-only error details panel under __DEV__', () => {
    // jest-expo defaults `__DEV__` to true.
    const fake = new FakeCrashReportingService();
    const { getByTestId } = render(
      <ErrorBoundary>
        <Throwing />
      </ErrorBoundary>,
      { wrapper: withTestContainer(fake) },
    );
    expect(getByTestId('error-boundary-dev-details')).toBeTruthy();
  });

  it('omits the dev-only error details panel when __DEV__ is false', () => {
    const dev = (globalThis as unknown as { __DEV__: boolean }).__DEV__;
    (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
    try {
      const fake = new FakeCrashReportingService();
      const { getByTestId, queryByTestId } = render(
        <ErrorBoundary>
          <Throwing />
        </ErrorBoundary>,
        { wrapper: withTestContainer(fake) },
      );
      // Fallback still renders + recordError still fires; only the
      // dev-only details panel is omitted.
      expect(getByTestId('error-boundary-fallback')).toBeTruthy();
      expect(queryByTestId('error-boundary-dev-details')).toBeNull();
    } finally {
      (globalThis as unknown as { __DEV__: boolean }).__DEV__ = dev;
    }
  });
});
