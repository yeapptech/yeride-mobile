import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import type { Ride } from '@domain/entities/Ride';
import {
  BottomSheetHeader,
  HeaderIconButton,
} from '@presentation/components/trip/BottomSheetHeader';

/**
 * Status view for `awaiting_driver`. The rider has just submitted a ride
 * request; nobody has accepted yet. We show a "Looking for a driver"
 * spinner with a wall-clock timer (since trip creation), the
 * pickup-address summary, and a cancel button in the header that opens
 * `CancelReasonSheet`.
 *
 * The cancel button lives in the header (not as a big bottom CTA) so
 * the rider's primary read is "we're searching for you" rather than
 * "do you want to cancel?". Mirrors the legacy yeride layout.
 */
interface AwaitingDriverViewProps {
  readonly ride: Ride;
  readonly onPressCancel: () => void;
  readonly cancelDisabled?: boolean;
}

export function AwaitingDriverView({
  ride,
  onPressCancel,
  cancelDisabled,
}: AwaitingDriverViewProps) {
  const elapsed = useElapsedSince(ride.createdAt);

  return (
    <View>
      <BottomSheetHeader
        title="Looking for a driver"
        subtitle={`Submitted ${elapsed} ago`}
        trailing={
          <HeaderIconButton
            label="Cancel ride"
            tone="destructive"
            onPress={onPressCancel}
            disabled={cancelDisabled}
            testID="awaiting-cancel"
          >
            <Text className="text-sm font-semibold text-error">Cancel</Text>
          </HeaderIconButton>
        }
      />

      <View className="items-center px-4 py-6">
        <ActivityIndicator size="large" />
        <Text className="mt-3 text-sm text-muted-foreground">
          Hang tight — we're matching you with a nearby driver.
        </Text>
      </View>

      <View className="border-t border-border px-4 py-3">
        <Text className="text-xs uppercase text-muted-foreground">Pickup</Text>
        <Text className="mt-0.5 text-sm text-foreground" numberOfLines={2}>
          {ride.pickup.placeName ?? ride.pickup.address}
        </Text>
        <Text className="mt-2 text-xs uppercase text-muted-foreground">
          Dropoff
        </Text>
        <Text className="mt-0.5 text-sm text-foreground" numberOfLines={2}>
          {ride.dropoff.placeName ?? ride.dropoff.address}
        </Text>
      </View>
    </View>
  );
}

/**
 * Wall-clock timer relative to a fixed `since` moment. Re-renders every
 * second so the "Submitted Ns ago" label stays current. Cleans up on
 * unmount.
 */
function useElapsedSince(since: Date): string {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const seconds = Math.max(
    0,
    Math.floor((now.getTime() - since.getTime()) / 1000),
  );
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return `${String(minutes)}m ${String(rem).padStart(2, '0')}s`;
}
