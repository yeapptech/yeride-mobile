import { Pressable, Text, View } from 'react-native';

import type { Ride } from '@domain/entities/Ride';
import {
  BottomSheetHeader,
  HeaderIconButton,
} from '@presentation/components/trip/BottomSheetHeader';

/**
 * Status view for the driver's `dispatched`-but-not-yet-arrived state.
 * Driver is en route to the rider's pickup. Bottom-sheet content:
 *
 *   - Header with ETA-to-pickup (pulled from `ride.pickup.directions`,
 *     set by the dispatch use case at accept time), a chat button
 *     with unread dot, and a destructive cancel button.
 *   - Sanitized passenger card: first name + last initial only. PII
 *     boundary mirrors the rider-side `DispatchedView` driver card —
 *     no email, no phone, no avatar URL exposure.
 *   - Pickup endpoint card.
 *   - "Open Navigation" CTA — launches the Google Navigation SDK
 *     turn-by-turn surface for the pickup leg (Phase 8 turn 2).
 *     `launchNavigationDisabled` reflects the parent VM's
 *     `isLaunchingNavigation` so a double-tap doesn't double-launch
 *     the init/terms chain.
 *   - Primary CTA "Arrived at pickup" → flips the parent into the
 *     `'at_pickup'` UI state. Phase 7's geofence-entry event will
 *     auto-fire this; until then it's a manual button tap.
 *
 * Phase 10 turn 8 — the header chat button + unread dot are now
 * wired, mirroring the rider-side `DispatchedView`. The deferred
 * "Phase 9 polish" note from the original kickoff has landed.
 */
interface EnRouteToPickupViewProps {
  readonly ride: Ride;
  readonly onArrived: () => void;
  readonly onPressCancel: () => void;
  readonly onPressChat: () => void;
  readonly onLaunchNavigation: () => void;
  readonly hasUnread?: boolean;
  readonly cancelDisabled?: boolean;
  readonly arriveDisabled?: boolean;
  readonly launchNavigationDisabled?: boolean;
}

export function EnRouteToPickupView({
  ride,
  onArrived,
  onPressCancel,
  onPressChat,
  onLaunchNavigation,
  hasUnread,
  cancelDisabled,
  arriveDisabled,
  launchNavigationDisabled,
}: EnRouteToPickupViewProps) {
  const directions = ride.pickup.directions;
  const eta = directions ? formatEta(directions.durationSeconds) : null;
  const distance = directions ? directions.distanceText : null;
  const passenger = ride.passenger;

  return (
    <View>
      <BottomSheetHeader
        title={eta ? `Pickup in ~${eta}` : 'Heading to pickup'}
        subtitle={distance ? `${distance} away` : undefined}
        trailing={
          <>
            <HeaderIconButton
              label={hasUnread ? 'Open chat (unread)' : 'Open chat'}
              onPress={onPressChat}
              testID="en-route-chat"
            >
              <View className="flex-row items-center">
                <Text className="text-sm font-semibold text-foreground">
                  Chat
                </Text>
                {hasUnread && (
                  <View
                    className="ml-1 h-2 w-2 rounded-full bg-primary"
                    accessibilityLabel="Unread messages"
                    testID="en-route-chat-unread"
                  />
                )}
              </View>
            </HeaderIconButton>
            <HeaderIconButton
              label="Cancel ride"
              tone="destructive"
              onPress={onPressCancel}
              disabled={cancelDisabled}
              testID="en-route-cancel"
            >
              <Text className="text-sm font-semibold text-error">Cancel</Text>
            </HeaderIconButton>
          </>
        }
      />

      <View className="border-t border-border px-4 py-3">
        <Text className="text-xs uppercase text-muted-foreground">
          Passenger
        </Text>
        <Text className="mt-0.5 text-base font-semibold text-foreground">
          {passenger.name.first} {passenger.name.last.charAt(0)}.
        </Text>
      </View>

      <View className="border-t border-border px-4 py-3">
        <Text className="text-xs uppercase text-muted-foreground">Pickup</Text>
        <Text className="mt-0.5 text-sm text-foreground" numberOfLines={2}>
          {ride.pickup.placeName ?? ride.pickup.address}
        </Text>
      </View>

      <View className="gap-2 px-4 pb-2 pt-4">
        <Pressable
          onPress={onLaunchNavigation}
          disabled={launchNavigationDisabled}
          accessibilityRole="button"
          accessibilityLabel="Open navigation"
          accessibilityState={{ disabled: launchNavigationDisabled }}
          className={`items-center rounded-xl border border-primary px-4 py-3 ${
            launchNavigationDisabled ? 'opacity-60' : ''
          }`}
          testID="en-route-launch-navigation"
        >
          <Text className="text-base font-semibold text-primary">
            Open navigation
          </Text>
        </Pressable>
      </View>
      <View className="px-4 pb-4">
        <Pressable
          onPress={onArrived}
          disabled={arriveDisabled}
          accessibilityRole="button"
          accessibilityLabel="Arrived at pickup"
          accessibilityState={{ disabled: arriveDisabled }}
          className={`items-center rounded-xl px-4 py-4 ${
            arriveDisabled ? 'bg-primary/60' : 'bg-primary'
          }`}
          testID="en-route-arrived"
        >
          <Text className="text-base font-semibold text-primary-foreground">
            Arrived at pickup
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Format a duration in seconds as a short ETA — "2 mins", "12 mins",
 * "1 hr 5m", etc. Same cadence as the rider-side `DispatchedView`.
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
