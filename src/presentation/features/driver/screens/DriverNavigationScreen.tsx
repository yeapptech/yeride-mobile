import { NavigationView } from '@googlemaps/react-native-navigation-sdk';
import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

import { Coordinates } from '@domain/entities/Coordinates';
import type {
  DriverStackNavigation,
  DriverStackScreenProps,
} from '@presentation/navigation/types';

import { useDriverNavigationViewModel } from '../view-models/useDriverNavigationViewModel';

/**
 * Phase 8 turn 2 — driver turn-by-turn navigation surface. Hosts the
 * SDK's `<NavigationView/>` (which fills the screen), an "End
 * Navigation" CTA pinned to the bottom, and (briefly during chain
 * setup or on error) a state overlay.
 *
 * Lifecycle:
 *
 *   1. Screen mounts → `<NavigationView/>` renders. The SDK's
 *      `onMapReady` callback fires once the native view is alive.
 *   2. The screen flips a local `mapReady` flag → the
 *      `useDriverNavigationViewModel` runs `setDestinations` →
 *      `startGuidance`.
 *   3. The VM transitions through `uninitialized → initializing →
 *      guiding`. On final-destination arrival OR an "End Navigation"
 *      tap, it transitions to `arrived`.
 *   4. The screen reads `vm.hasArrived` and calls
 *      `navigation.goBack()` (guarded against double-pop via a ref).
 *   5. On unmount, the VM's effect-cleanup fires fire-and-forget
 *      `stopGuidance()` + `cleanup()`.
 *
 * Why no `useNavigationSdkConnector` here: the connector is mounted
 * by `DriverMonitorScreen`, the parent on the stack. By the time this
 * screen mounts, the controller is already pushed into the adapter
 * (and DriverMonitor's `onLaunchNavigation` has already run `init()`
 * + the terms dialog if needed). This avoids the legacy
 * `getCurrentActivity()` null-after-`<NavigationView/>` quirk on
 * Android.
 *
 * Floating mute / chat / exit buttons (legacy) are deferred to Phase 9
 * polish — kickoff "out" list. The single CTA on this screen is
 * "End Navigation".
 */

export default function DriverNavigationScreen({
  route,
}: DriverStackScreenProps<'DriverNavigation'>) {
  const { title, destination, routeToken, avoidTolls } = route.params;

  // Validate coords once at the screen boundary. If they don't pass,
  // render an inline error — defensive against malformed deep links;
  // the typed param list should normally prevent it.
  const coordsR = Coordinates.create(destination.lat, destination.lng);
  if (!coordsR.ok) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-background px-6">
        <Text className="text-base text-error">
          Invalid navigation destination. Please go back and try again.
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <DriverNavigationContent
      title={title}
      coords={coordsR.value}
      {...(routeToken !== undefined ? { routeToken } : {})}
      {...(avoidTolls !== undefined ? { avoidTolls } : {})}
    />
  );
}

interface DriverNavigationContentProps {
  readonly title: string;
  readonly coords: Coordinates;
  readonly routeToken?: string;
  readonly avoidTolls?: boolean;
}

function DriverNavigationContent({
  title,
  coords,
  routeToken,
  avoidTolls,
}: DriverNavigationContentProps) {
  const reactNavigation = useNavigation<DriverStackNavigation>();
  const [mapReady, setMapReady] = useState(false);
  const { bottom: safeBottom } = useSafeAreaInsets();

  // Connector is mounted at the parent (DriverMonitor) level, not
  // here. See screen JSDoc for the rationale.

  const vm = useDriverNavigationViewModel({
    title,
    coords,
    onMapReady: mapReady,
    ...(routeToken !== undefined ? { routeToken } : {}),
    ...(avoidTolls !== undefined ? { avoidTolls } : {}),
  });

  /* ── Auto-pop on arrival ────────────────────────────────────────── */

  // Guard against firing goBack() twice (auto-pop + a manual end-nav
  // tap could race in theory). Once we've popped, we never pop again.
  const hasNavigatedAwayRef = useRef(false);

  useEffect(() => {
    if (!vm.hasArrived) return;
    if (hasNavigatedAwayRef.current) return;
    hasNavigatedAwayRef.current = true;
    // Microtask defer so the "Arrived" overlay renders for a frame
    // before the pop animation kicks in.
    const t = setTimeout(() => {
      reactNavigation.goBack();
    }, 1200);
    return () => clearTimeout(t);
  }, [vm.hasArrived, reactNavigation]);

  const handleEndNavigation = useCallback(() => {
    vm.onEndNavigation();
  }, [vm]);

  const handleMapReady = useCallback(() => {
    setMapReady(true);
  }, []);

  /* ── Render ─────────────────────────────────────────────────────── */

  return (
    <View className="flex-1 bg-background" testID="driver-navigation-screen">
      <NavigationView
        style={{ flex: 1 }}
        // androidStylingOptions / iOSStylingOptions intentionally
        // omitted — the SDK defaults match the legacy presentation.
        onMapReady={handleMapReady}
      />

      {/* State overlay — only renders during non-guiding states so
          the SDK's full-screen UI shows uninterrupted while the
          driver is actually navigating. */}
      <StateOverlay
        stateKind={vm.state.kind}
        errorMessage={vm.state.kind === 'error' ? vm.state.message : null}
        onRetry={vm.onRetry}
      />

      {/* End Navigation CTA — pinned to the bottom of the screen.
          Visible during guiding (manual end), initializing (cancel
          the chain by popping), and error (back to DriverMonitor).
          Hidden during arrived since the screen will auto-pop. */}
      {vm.state.kind !== 'arrived' && (
        <View
          className="absolute bottom-0 left-0 right-0 px-4"
          style={{ paddingBottom: safeBottom || 16 }}
          pointerEvents="box-none"
        >
          <Pressable
            onPress={handleEndNavigation}
            accessibilityRole="button"
            accessibilityLabel="End navigation"
            className="items-center rounded-xl bg-error px-4 py-4"
            testID="driver-navigation-end"
          >
            <Text className="text-base font-semibold text-primary-foreground">
              End navigation
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

/* ───── State overlay ───── */

interface StateOverlayProps {
  readonly stateKind:
    | 'uninitialized'
    | 'initializing'
    | 'guiding'
    | 'arrived'
    | 'error';
  readonly errorMessage: string | null;
  readonly onRetry: () => void;
}

function StateOverlay({ stateKind, errorMessage, onRetry }: StateOverlayProps) {
  if (stateKind === 'guiding') return null;

  return (
    <View
      className="absolute inset-0 items-center justify-center bg-background/80"
      pointerEvents={stateKind === 'error' ? 'auto' : 'none'}
      testID={`driver-navigation-overlay-${stateKind}`}
    >
      {stateKind === 'uninitialized' || stateKind === 'initializing' ? (
        <View className="items-center">
          <ActivityIndicator size="large" />
          <Text className="mt-3 text-sm text-muted-foreground">
            {stateKind === 'uninitialized'
              ? 'Preparing map…'
              : 'Calculating route…'}
          </Text>
        </View>
      ) : stateKind === 'arrived' ? (
        <View className="items-center px-6">
          <Text className="text-xl font-semibold text-foreground">Arrived</Text>
          <Text className="mt-1 text-sm text-muted-foreground">
            Returning to the trip…
          </Text>
        </View>
      ) : (
        <View className="items-center px-6">
          <Text className="text-base font-semibold text-error">
            Navigation unavailable
          </Text>
          {errorMessage && (
            <Text className="mt-2 text-center text-sm text-muted-foreground">
              {errorMessage}
            </Text>
          )}
          <View className="mt-4 flex-row gap-3">
            <Pressable
              onPress={onRetry}
              accessibilityRole="button"
              accessibilityLabel="Retry navigation"
              className="rounded-xl bg-primary px-4 py-3"
              testID="driver-navigation-retry"
            >
              <Text className="text-sm font-semibold text-primary-foreground">
                Try again
              </Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}
