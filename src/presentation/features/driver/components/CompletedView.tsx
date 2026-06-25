import { Text, View } from 'react-native';

import type { Money } from '@domain/entities/Money';
import type { Ride } from '@domain/entities/Ride';
import { FareCalculator } from '@domain/services';
import { BottomSheetHeader } from '@presentation/components/trip/BottomSheetHeader';
import { Button } from '@presentation/components/ui/Button';

/**
 * Status view for `completed`. The Stripe charge succeeded; the trip is
 * done. The view-model auto-resets navigation to DriverTabs on this
 * status, so in practice this view renders for a single frame at most.
 * It's still mounted in the status-router so we have a graceful fallback
 * if the redirect ever races (e.g. the live snapshot arrives a frame
 * before the effect sees it).
 *
 * The driver-side completed surface is intentionally minimal — drivers
 * see authoritative earnings via the (Phase 6) Earnings tab; this is
 * just a visual confirmation that the trip is closed. No tip surface
 * here either: tipping is rider-side (Phase 6).
 */
interface CompletedViewProps {
  readonly ride: Ride;
  readonly onClose: () => void;
}

export function CompletedView({ ride, onClose }: CompletedViewProps) {
  const fare = computeFare(ride);
  const distanceMeters = computeDistanceMeters(ride);
  const durationSeconds = computeDurationSeconds(ride);

  return (
    <View>
      <BottomSheetHeader
        title="Trip complete"
        subtitle="Nice work — the rider has been charged."
      />

      <View className="border-t border-border px-4 py-3">
        <View className="flex-row items-center justify-between">
          <Text className="text-sm text-muted-foreground">Total fare</Text>
          <Text className="text-base font-semibold text-foreground">
            {fare ? fare.format() : '—'}
          </Text>
        </View>
        <View className="mt-2 flex-row items-center justify-between">
          <Text className="text-sm text-muted-foreground">Distance</Text>
          <Text className="text-sm text-foreground">
            {formatDistance(distanceMeters)}
          </Text>
        </View>
        <View className="mt-2 flex-row items-center justify-between">
          <Text className="text-sm text-muted-foreground">Duration</Text>
          <Text className="text-sm text-foreground">
            {formatDuration(durationSeconds)}
          </Text>
        </View>
      </View>

      <View className="border-t border-border px-4 py-3">
        <Text className="text-xs text-muted-foreground">
          Earnings details land in the Earnings tab (Phase 6 wires real
          numbers).
        </Text>
      </View>

      <View className="px-4 pt-4">
        <Button
          label="Close trip"
          onPress={onClose}
          accessibilityLabel="Close trip"
          testID="completed-close"
        />
      </View>
    </View>
  );
}

function computeFare(ride: Ride): Money | null {
  const distanceMeters = computeDistanceMeters(ride);
  const durationSeconds = computeDurationSeconds(ride);
  if (distanceMeters === null || durationSeconds === null) return null;
  const r = FareCalculator.estimate({
    rideService: ride.rideService,
    distanceMeters,
    durationSeconds,
  });
  return r.ok ? r.value : null;
}

function computeDistanceMeters(ride: Ride): number | null {
  const start = ride.pickupTiming.odometerMeters;
  const end = ride.dropoffTiming.odometerMeters;
  if (start !== null && end !== null && end >= start) {
    return end - start;
  }
  return ride.dropoff.directions?.distanceMeters ?? null;
}

function computeDurationSeconds(ride: Ride): number | null {
  const start = ride.pickupTiming.completedAt;
  const end = ride.dropoffTiming.completedAt;
  if (start && end && end.getTime() >= start.getTime()) {
    return Math.round((end.getTime() - start.getTime()) / 1000);
  }
  return ride.dropoff.directions?.durationSeconds ?? null;
}

function formatDistance(meters: number | null): string {
  if (meters === null) return '—';
  const miles = meters / 1609.34;
  return `${miles.toFixed(1)} mi`;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 60) return `${String(Math.round(seconds))}s`;
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 60) return `${String(totalMinutes)} min`;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return `${String(hours)} hr ${String(mins)}m`;
}
