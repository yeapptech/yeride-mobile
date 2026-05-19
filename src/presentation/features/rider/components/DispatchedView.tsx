import { Text, View } from 'react-native';

import type { Ride } from '@domain/entities/Ride';
import {
  BottomSheetHeader,
  HeaderIconButton,
} from '@presentation/components/trip/BottomSheetHeader';
import { usePickupExitWarningVisible } from '@presentation/stores';

/**
 * Status view for `dispatched`. The driver has accepted; the rider sees:
 *   - a header with ETA-to-pickup pulled from `ride.pickup.directions`
 *     (set by the driver app at dispatch time) — UPDATED in Phase 10
 *     turn 5 to prefer `liveDurationSeconds` / `liveDistanceMeters`
 *     when present (driver's NavSdk telemetry written to
 *     `users/{driverId}.location.tripTracking`).
 *   - the driver's name + vehicle make/model/color/plate
 *   - cancel + chat-stub buttons in the header
 *   - a geofence-banner slot wired to `useGeofenceUiStore`.
 *     Phase 3 turn 3.4a leaves the setter caller unbuilt — full GPS-
 *     fed banner activation lands in Phase 4 alongside
 *     `BackgroundGeolocationClient`. The banner is testable today
 *     by setting the store flag manually.
 *
 * The chat button is a stub in turn 3.4a (toast or no-op) — full chat
 * lands in Phase 3.5 alongside `ChatRepository` + thread modal.
 */
interface DispatchedViewProps {
  readonly ride: Ride;
  readonly onPressCancel: () => void;
  readonly onPressChat: () => void;
  /** Phase 10 turn 8 — chat unread-dot signal. The rider can receive
   *  messages between dispatch and start, so the dot ships here for
   *  parity with `StartedView`. */
  readonly hasUnread?: boolean;
  readonly cancelDisabled?: boolean;
  /**
   * Phase 10 turn 5 — live ETA fields surfaced by
   * `useRideMonitorViewModel`. When null (no driver doc yet, or no
   * NavSdk telemetry has fired since dispatch), the view falls back
   * to the static `ride.pickup.directions.durationSeconds /
   * .distanceText` — same "Calculating…" feel as legacy yeride.
   */
  readonly liveDurationSeconds?: number | null;
  readonly liveDistanceMeters?: number | null;
}

export function DispatchedView({
  ride,
  onPressCancel,
  onPressChat,
  hasUnread,
  cancelDisabled,
  liveDurationSeconds,
  liveDistanceMeters,
}: DispatchedViewProps) {
  const driver = ride.driver;
  const directions = ride.pickup.directions;
  // Phase 10 turn 5 — prefer live values; fall back to static
  // pickup-directions (set at dispatch time and never updated).
  const effectiveDuration =
    liveDurationSeconds ?? directions?.durationSeconds ?? null;
  const eta = effectiveDuration !== null ? formatEta(effectiveDuration) : null;
  const distance =
    liveDistanceMeters !== null && liveDistanceMeters !== undefined
      ? formatDistanceMeters(liveDistanceMeters)
      : (directions?.distanceText ?? null);
  const showExitWarning = usePickupExitWarningVisible();

  return (
    <View>
      <BottomSheetHeader
        title={eta ? `Driver arriving in ${eta}` : 'Driver on the way'}
        subtitle={distance ? `${distance} from pickup` : undefined}
        trailing={
          <>
            <HeaderIconButton
              label={hasUnread ? 'Open chat (unread)' : 'Open chat'}
              onPress={onPressChat}
              testID="dispatched-chat"
            >
              <View className="flex-row items-center">
                <Text className="text-sm font-semibold text-foreground">
                  Chat
                </Text>
                {hasUnread && (
                  <View
                    className="ml-1 h-2 w-2 rounded-full bg-primary"
                    accessibilityLabel="Unread messages"
                    testID="dispatched-chat-unread"
                  />
                )}
              </View>
            </HeaderIconButton>
            <HeaderIconButton
              label="Cancel ride"
              tone="destructive"
              onPress={onPressCancel}
              disabled={cancelDisabled}
              testID="dispatched-cancel"
            >
              <Text className="text-sm font-semibold text-error">Cancel</Text>
            </HeaderIconButton>
          </>
        }
      />

      {showExitWarning && (
        <View
          className="mx-4 mb-2 rounded-lg bg-warning/10 p-3"
          testID="dispatched-exit-warning"
        >
          <Text className="text-sm font-medium text-warning">
            You've left the pickup area
          </Text>
          <Text className="text-xs text-warning">
            Head back so the driver can find you.
          </Text>
        </View>
      )}

      <View className="border-t border-border px-4 py-3">
        <Text className="text-xs uppercase text-muted-foreground">Driver</Text>
        {driver ? (
          <View>
            <Text className="text-base font-semibold text-foreground">
              {driver.name.first} {driver.name.last.charAt(0)}.
            </Text>
            {driver.vehicle && (
              <Text className="text-sm text-muted-foreground">
                {driver.vehicle.color} {driver.vehicle.year}{' '}
                {driver.vehicle.make} {driver.vehicle.model} ·{' '}
                {driver.vehicle.licensePlate}
              </Text>
            )}
          </View>
        ) : (
          <Text className="text-sm text-muted-foreground">
            Driver details loading…
          </Text>
        )}
      </View>

      <View className="border-t border-border px-4 py-3">
        <Text className="text-xs uppercase text-muted-foreground">Pickup</Text>
        <Text className="mt-0.5 text-sm text-foreground" numberOfLines={2}>
          {ride.pickup.placeName ?? ride.pickup.address}
        </Text>
      </View>
    </View>
  );
}

/**
 * Format a duration in seconds as a short ETA — "2 mins", "12 mins",
 * "1 hr 5m", etc. Mirrors the cadence of Google Routes API's
 * `durationText` so consumers see consistent units.
 */
function formatEta(durationSeconds: number): string {
  if (durationSeconds < 60) return '< 1 min';
  const totalMinutes = Math.round(durationSeconds / 60);
  if (totalMinutes < 60) {
    return `${String(totalMinutes)} min${totalMinutes === 1 ? '' : 's'}`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return `${String(hours)} hr ${String(mins)}m`;
}

/**
 * Phase 10 turn 5 — short distance label for live telemetry. Matches
 * legacy `formatMetersToText` from
 * `yeride/src/api/services/distanceTrackingService.js` so the rewrite
 * UI converges on the legacy text after a live update arrives.
 */
function formatDistanceMeters(meters: number): string {
  const miles = meters / 1609.344;
  if (miles < 0.1) {
    const feet = Math.round(meters * 3.28084);
    return `${String(feet)} ft`;
  }
  return `${miles.toFixed(1)} mi`;
}
