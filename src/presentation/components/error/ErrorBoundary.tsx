import { Component, useState, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { CrashReportingService } from '@domain/services';
import { useCrashReporting } from '@presentation/di';
import { LOG } from '@shared/logger';

const logger = LOG.extend('ErrorBoundary');

/**
 * App-root React error boundary. Phase 9 turn 6.
 *
 * Catches render-phase throws anywhere in the React tree, fans the
 * error out to Crashlytics' non-fatal `recordError` pipeline, and
 * renders a recoverable fallback UI in place of the crashing subtree.
 *
 * **What this catches:**
 *   - Errors thrown during render of any descendant component.
 *   - Errors thrown from `componentDidMount` / `componentDidUpdate` /
 *     `useEffect` setup (the synchronous parts).
 *   - Errors thrown from class lifecycle methods.
 *
 * **What this does NOT catch** (React's documented limitation):
 *   - Throws inside event handlers — those reach the global error
 *     handler hook (`useGlobalErrorHandler`) instead.
 *   - Throws inside async callbacks / `setTimeout` / promise chains —
 *     same: covered by the global error handler.
 *   - Throws inside the boundary's own render — would propagate up to
 *     the next boundary (none here, so it would unmount the app).
 *   - SSR errors (irrelevant — RN doesn't SSR).
 *
 * **Mounting rule:** mounted exactly once at app root, inside
 * `<ContainerProvider/>` so `useCrashReporting()` resolves. The
 * `<ContainerProvider/>` itself constructs the container synchronously
 * via `useMemo`, so a throw during container build would land ABOVE
 * this boundary. That's an acceptable trade-off — the alternative
 * (boundary above the provider) would require a separate path to
 * record the error, and `buildContainer()` has no failure modes today.
 *
 * **Reset semantics:** the "Try again" CTA bumps a `resetCount` in
 * the wrapper's React state, which is passed as the inner
 * `<ErrorBoundaryClass key={resetCount} />`. Bumping the `key`
 * triggers a full unmount + remount of the boundary, clearing the
 * caught-error state and re-rendering children fresh. This is the
 * React-recommended pattern (see React docs on resetting error
 * boundaries) — preferred over conditionally clearing state inside
 * the class because remounting also resets any sibling state that
 * might have gotten into a bad shape.
 *
 * **Why class component + function wrapper:** React's error-boundary
 * lifecycle (`getDerivedStateFromError`, `componentDidCatch`) is only
 * available on class components — there is no hook equivalent. The
 * function wrapper is the only way to read `useCrashReporting()` from
 * the DI container; it passes the adapter into the class as a prop.
 */

interface ErrorBoundaryProps {
  readonly children: ReactNode;
}

interface ErrorBoundaryClassProps {
  readonly children: ReactNode;
  readonly crashReporting: CrashReportingService;
  readonly onReset: () => void;
}

interface ErrorBoundaryClassState {
  readonly caughtError: Error | null;
}

class ErrorBoundaryClass extends Component<
  ErrorBoundaryClassProps,
  ErrorBoundaryClassState
> {
  override state: ErrorBoundaryClassState = { caughtError: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryClassState {
    // Fires synchronously during render. Returning a state update
    // schedules a re-render with the fallback UI in place of the
    // crashing subtree.
    return { caughtError: error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Fires after `getDerivedStateFromError`. Side-effects belong here.
    // Both Crashlytics calls are fire-and-forget (`Promise<Result<...>>`
    // returned, not awaited). Per project convention, telemetry must
    // never block user flow — the fallback UI renders independently.
    try {
      void this.props.crashReporting.recordError(error, 'ErrorBoundary');
      // The component stack is React-specific context that helps
      // Firebase Console group + triage issues. We send it as a
      // separate breadcrumb (the recordError call only takes the
      // Error itself).
      const componentStack = errorInfo.componentStack;
      if (componentStack !== null && componentStack !== undefined) {
        void this.props.crashReporting.log(
          `[ErrorBoundary] component stack:${componentStack}`,
        );
      }
    } catch (telemetryError) {
      // Defensive — swallow any synchronous throw from the SDK shim
      // so the fallback UI still renders. Logged via LOG so a
      // CompositeTransport's other (non-Crashlytics) consumers see it.
      logger.warn('telemetry capture failed', telemetryError);
    }
    // Always log the catch event for the local Metro / Xcode console.
    // The Crashlytics breadcrumb above carries the same info; this
    // line is for live developer visibility.
    logger.error('caught render-phase error', error);
  }

  override render(): ReactNode {
    if (this.state.caughtError !== null) {
      return (
        <FallbackUI
          error={this.state.caughtError}
          onReset={this.props.onReset}
        />
      );
    }
    return this.props.children;
  }
}

export function ErrorBoundary({ children }: ErrorBoundaryProps) {
  const crashReporting = useCrashReporting();
  const [resetCount, setResetCount] = useState(0);

  // Bumping `resetCount` is passed as `key` to the class component.
  // React responds by unmounting + remounting the entire boundary,
  // which clears `caughtError` and re-attempts to render children
  // fresh. If the children still throw, the new instance catches
  // again immediately — no special handling needed.
  const onReset = (): void => {
    setResetCount((n) => n + 1);
  };

  return (
    <ErrorBoundaryClass
      key={resetCount}
      crashReporting={crashReporting}
      onReset={onReset}
    >
      {children}
    </ErrorBoundaryClass>
  );
}

interface FallbackUIProps {
  readonly error: Error;
  readonly onReset: () => void;
}

/**
 * Generic recoverable-error UI. Production builds show only the copy
 * + Try-again CTA. Dev builds also surface the error name + message
 * for debugging — production hides them because (a) they're noise to
 * end users and (b) some error messages embed internal context (URLs,
 * IDs, stack frames) that shouldn't reach the user-facing surface.
 */
function FallbackUI({ error, onReset }: FallbackUIProps) {
  return (
    <View
      testID="error-boundary-fallback"
      className="flex-1 items-center justify-center bg-background p-6"
    >
      <View className="w-full max-w-md rounded-2xl border border-border bg-card p-6">
        <Text className="mb-2 text-xl font-bold text-foreground">
          Something went wrong
        </Text>
        <Text className="mb-6 text-base text-muted-foreground">
          An unexpected error happened. You can try again or restart the app if
          it keeps happening.
        </Text>

        {__DEV__ ? (
          <View
            testID="error-boundary-dev-details"
            className="mb-6 rounded-xl border border-border bg-muted p-3"
          >
            <Text className="mb-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Dev only — error details
            </Text>
            <Text selectable className="font-mono text-xs text-foreground">
              {error.name}: {error.message}
            </Text>
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Try again"
          onPress={onReset}
          testID="error-boundary-try-again"
          className="items-center rounded-xl bg-primary px-4 py-3"
        >
          <Text className="text-base font-semibold text-primary-foreground">
            Try again
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
