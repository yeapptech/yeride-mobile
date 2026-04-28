import { Text, View } from 'react-native';

import type { Ride } from '@domain/entities/Ride';
import {
  BottomSheetHeader,
  HeaderIconButton,
} from '@presentation/components/trip/BottomSheetHeader';

/**
 * Status view for `started`. The driver has picked up the rider; the trip
 * is in motion. We show:
 *   - ETA-to-dropoff from `ride.dropoff.directions` (set at trip create
 *     time by the rider's RouteSelect view-model)
 *   - cancel + chat-stub buttons (cancel is still allowed mid-trip)
 *   - a chat-unread dot when `hasUnread` is true
 *   - the dropoff endpoint (so the rider knows where they're going)
 *   - the driver/vehicle card (read-only — they're already in the car)
 *
 * Geofence banner is intentionally NOT rendered here: pickup-exit only
 * matters during `dispatched`. The `useRideMonitorViewModel` clears the
 * flag on every status that isn't `dispatched`.
 */
interface StartedViewProps {
  readonly ride: Ride;
  readonly hasUnread?: boolean;
  readonly onPressCancel: () => void;
  readonly onPressChat: () => void;
  readonly cancelDisabled?: boolean;
}

export function StartedView({
  ride,
  hasUnread,
  onPressCancel,
  onPressChat,
  cancelDisabled,
}: StartedViewProps) {
  const driver = ride.driver;
  const directions = ride.dropoff.directions;
  const eta = directions ? formatEta(directions.durationSeconds) : null;
  const distance = directions ? directions.distanceText : null;

  return (
    <View>
      <BottomSheetHeader
        title={eta ? `Arriving in ${eta}` : 'On the way'}
        subtitle={distance ? `${distance} to dropoff` : undefined}
        trailing={
          <>
            <HeaderIconButton
              label={hasUnread ? 'Open chat (unread)' : 'Open chat'}
              onPress={onPressChat}
              testID="started-chat"
            >
              <View className="flex-row items-center">
                <Text className="text-sm font-semibold text-foreground">
                  Chat
                </Text>
                {hasUnread && (
                  <View
                    className="ml-1 h-2 w-2 rounded-full bg-primary"
                    accessibilityLabel="Unread messages"
                    testID="started-chat-unread"
                  />
                )}
              </View>
            </HeaderIconButton>
            <HeaderIconButton
              label="Cancel ride"
              tone="destructive"
              onPress={onPressCancel}
              disabled={cancelDisabled}
              testID="started-cancel"
            >
              <Text className="text-sm font-semibold text-error">Cancel</Text>
            </HeaderIconButton>
          </>
        }
      />

      <View className="border-t border-border px-4 py-3">
        <Text className="text-xs uppercase text-muted-foreground">Dropoff</Text>
        <Text className="mt-0.5 text-sm text-foreground" numberOfLines={2}>
          {ride.dropoff.placeName ?? ride.dropoff.address}
        </Text>
      </View>

      {driver && (
        <View className="border-t border-border px-4 py-3">
          <Text className="text-xs uppercase text-muted-foreground">
            Driver
          </Text>
          <Text className="text-base font-semibold text-foreground">
            {driver.name.first} {driver.name.last.charAt(0)}.
          </Text>
          {driver.vehicle && (
            <Text className="text-sm text-muted-foreground">
              {driver.vehicle.color} {driver.vehicle.year} {driver.vehicle.make}{' '}
              {driver.vehicle.model} · {driver.vehicle.licensePlate}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

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
