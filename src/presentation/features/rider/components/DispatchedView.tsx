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
 *     (set by the driver app at dispatch time)
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
  readonly cancelDisabled?: boolean;
}

export function DispatchedView({
  ride,
  onPressCancel,
  onPressChat,
  cancelDisabled,
}: DispatchedViewProps) {
  const driver = ride.driver;
  const directions = ride.pickup.directions;
  const eta = directions ? formatEta(directions.durationSeconds) : null;
  const distance = directions ? directions.distanceText : null;
  const showExitWarning = usePickupExitWarningVisible();

  return (
    <View>
      <BottomSheetHeader
        title={eta ? `Driver arriving in ${eta}` : 'Driver on the way'}
        subtitle={distance ? `${distance} from pickup` : undefined}
        trailing={
          <>
            <HeaderIconButton
              label="Open chat"
              onPress={onPressChat}
              testID="dispatched-chat"
            >
              <Text className="text-sm font-semibold text-foreground">
                Chat
              </Text>
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
