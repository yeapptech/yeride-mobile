import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import Toast from 'react-native-toast-message';

import { useCrashReporting } from '@presentation/di';
import { LOG } from '@shared/logger';

const logger = LOG.extend('DevTools');

/**
 * Dev-only "Developer tools" section. Phase 9 turn 3 sub-turn 3c.
 *
 * Mounted under both the rider and driver Activity placeholder screens,
 * gated on `__DEV__`. Renders three buttons that exercise the
 * Crashlytics pipeline end-to-end against a real device + Firebase
 * Console:
 *
 *   1. **Toggle Crashlytics collection on** — overrides the lifecycle
 *      hook's `setCollectionEnabled(!__DEV__)` (which is `false` in
 *      dev) so dev-mode crashes upload to Firebase Console without a
 *      stage rebuild. The button stays visible after success so the
 *      tester can tell the override is active.
 *
 *   2. **Record non-fatal error** — fires a sample
 *      `crashReporting.recordError(...)` so the smoke can prove the
 *      non-fatal pipeline independently of the force-crash. Useful
 *      because a non-fatal arrives in Firebase Console within ~1 min
 *      whereas a fatal needs the user to re-open the app first.
 *
 *   3. **Force crash** — calls `crashReporting.crash()`, which raises
 *      a fatal native exception immediately. The next app launch
 *      uploads the queued crash. No confirmation dialog: the SDK is
 *      unrecoverable after `crash()`, so a confirm step wouldn't help.
 *
 * IMPORTANT — documented exception to the `useCrashReporting()`
 * mounting rule. The `<ContainerProvider/>`'s JSDoc states "Screens
 * and view-models DO NOT consume this directly." That rule applies to
 * production sites (lifecycle hook, global error handler, logger
 * transport — sub-turns 3a + 3b). The dev-tools section is the
 * deliberate exception: direct invocation of the SDK methods is the
 * entire point.
 *
 * Production builds drop the entire section via the `__DEV__` early
 * return below — the buttons are never reachable outside a dev /
 * dev-client build.
 */
export function DevToolsSection() {
  // Hooks called unconditionally so the rule-of-hooks linter is happy.
  // `__DEV__` is constant per JS runtime, so the early-return below
  // is consistent across renders within a given build.
  const crashReporting = useCrashReporting();
  const [collectionState, setCollectionState] = useState<
    'idle' | 'enabling' | 'enabled' | 'failed'
  >('idle');
  const [isRecording, setIsRecording] = useState(false);

  const handleToggleCollectionOn = async () => {
    setCollectionState('enabling');
    const result = await crashReporting.setCollectionEnabled(true);
    if (result.ok) {
      setCollectionState('enabled');
      Toast.show({
        type: 'success',
        text1: 'Crashlytics collection enabled',
        text2: 'Subsequent crashes will upload to Firebase Console.',
      });
    } else {
      setCollectionState('failed');
      logger.warn('setCollectionEnabled(true) failed', result.error);
      Toast.show({
        type: 'error',
        text1: "Couldn't enable Crashlytics collection",
        text2: result.error.message,
      });
    }
  };

  const handleRecordNonFatal = async () => {
    setIsRecording(true);
    const result = await crashReporting.recordError(
      new Error('DEV: smoke recordError'),
      'DevTools',
    );
    setIsRecording(false);
    if (result.ok) {
      Toast.show({
        type: 'success',
        text1: 'Non-fatal recorded',
        text2: 'Check Firebase Console > Crashlytics > Issues.',
      });
    } else {
      logger.warn('recordError failed', result.error);
      Toast.show({
        type: 'error',
        text1: "Couldn't record non-fatal error",
        text2: result.error.message,
      });
    }
  };

  const handleForceCrash = () => {
    // No try/catch — the SDK's `crash()` is intentionally unrecoverable.
    // The fake (used in tests) flips a flag instead of throwing so the
    // Jest worker stays alive.
    crashReporting.crash();
  };

  if (!__DEV__) return null;

  return (
    <View
      testID="dev-tools-section"
      className="mt-8 rounded-2xl border border-border bg-card p-4"
    >
      <Text className="mb-1 text-sm font-bold uppercase tracking-wider text-muted-foreground">
        Developer tools
      </Text>
      <Text className="mb-4 text-xs text-muted-foreground">
        Visible only in development builds. Crashlytics smoke entry points.
      </Text>

      <DevButton
        accessibilityLabel="Toggle Crashlytics collection on"
        onPress={
          collectionState === 'enabling'
            ? undefined
            : () => {
                void handleToggleCollectionOn();
              }
        }
        disabled={collectionState === 'enabling'}
        spinning={collectionState === 'enabling'}
        testID="dev-tools-toggle-collection"
      >
        {collectionState === 'enabled'
          ? 'Crashlytics collection ON'
          : 'Toggle Crashlytics collection on'}
      </DevButton>

      <DevButton
        accessibilityLabel="Record non-fatal error"
        onPress={
          isRecording
            ? undefined
            : () => {
                void handleRecordNonFatal();
              }
        }
        disabled={isRecording}
        spinning={isRecording}
        testID="dev-tools-record-non-fatal"
      >
        Record non-fatal error
      </DevButton>

      <DevButton
        accessibilityLabel="Force crash"
        onPress={handleForceCrash}
        destructive
        testID="dev-tools-force-crash"
      >
        Force crash
      </DevButton>
    </View>
  );
}

interface DevButtonProps {
  readonly accessibilityLabel: string;
  readonly onPress: (() => void) | undefined;
  readonly disabled?: boolean;
  readonly spinning?: boolean;
  readonly destructive?: boolean;
  readonly testID: string;
  readonly children: ReactNode;
}

/**
 * Compact button styled to match the design system. The destructive
 * variant uses the `error` semantic token (#dc2626) since "destructive"
 * isn't a defined token in tailwind.config.js — `bg-error` is the
 * closest mapped equivalent.
 */
function DevButton(props: DevButtonProps) {
  const { destructive, disabled, spinning, children } = props;
  const baseClasses = 'mb-2 items-center rounded-xl px-4 py-3';
  const bgClasses = destructive
    ? disabled
      ? 'bg-error/60'
      : 'bg-error'
    : disabled
      ? 'bg-primary/60'
      : 'bg-primary';
  const textClasses = destructive ? 'text-white' : 'text-primary-foreground';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      onPress={props.onPress}
      disabled={disabled}
      testID={props.testID}
      className={`${baseClasses} ${bgClasses}`}
    >
      {spinning ? (
        <ActivityIndicator color="#000" />
      ) : (
        <Text className={`text-base font-semibold ${textClasses}`}>
          {children}
        </Text>
      )}
    </Pressable>
  );
}
