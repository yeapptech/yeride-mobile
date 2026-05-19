import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { Ride } from '@domain/entities/Ride';

/**
 * Per-row card for the Activity tab's recent-rides list. Renders a
 * compact summary: status pill, "Trip with {OtherParty}" header,
 * pickup → dropoff endpoints, formatted creation timestamp, and a
 * fare preview.
 *
 * `viewerRole` controls which side of the trip the "Trip with" line
 * names — riders see the driver, drivers see the passenger. (The
 * legacy yeride app rendered different sub-views per role; we collapse
 * that to one component since the diff is one line.)
 *
 * Fare display rule:
 *   - `cancelled` trips: no fare shown. The base fare doesn't reflect
 *     what (if anything) the rider was charged — cancellation may
 *     incur a fee, not the full fare — so it would mislead. Users
 *     tap through to TripDetail for the actual payment breakdown.
 *   - Every other status: render the ride-service `baseFare` prefixed
 *     with "Est. " to mark it as the estimate, not the final charge.
 *     The Ride entity carries no `finalFare`; the authoritative total
 *     lives in the `payments` subcollection and is rendered on
 *     `TripDetailScreen` via `TripPaymentsList`.
 *
 * Wraps in a `Pressable` so the FlatList's onSelect can fire without
 * wrapping every row at the parent level.
 *
 * `testID="trip-card-{rideId}"` for E2E + screen tests.
 */
export interface TripCardProps {
  readonly ride: Ride;
  readonly viewerRole: 'rider' | 'driver';
  readonly onPress: (ride: Ride) => void;
}

function formatTimestamp(d: Date): string {
  // e.g. "May 19, 2026, 10:30 AM"
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function statusLabel(status: Ride['status']): string {
  switch (status) {
    case 'awaiting_driver':
      return 'Awaiting driver';
    case 'scheduled':
    case 'scheduled_driver_accepted':
      return 'Scheduled';
    case 'dispatched':
      return 'En route';
    case 'started':
      return 'In progress';
    case 'payment_requested':
      return 'Payment pending';
    case 'payment_failed':
      return 'Payment failed';
    case 'completed':
      return 'Completed';
    case 'cancelled':
      return 'Cancelled';
  }
}

/**
 * Tailwind classes for the status pill, split into the wrapper-View
 * background and the inner-Text color. NativeWind ignores `bg-*` on
 * Text and `text-*` on View, so applying a combined class to both
 * works but is wasteful — splitting makes the intent explicit. Uses
 * semantic tokens (per docs/DESIGN_SYSTEM.md). No raw hex.
 */
function statusPillBgClass(status: Ride['status']): string {
  switch (status) {
    case 'completed':
      return 'bg-success/10';
    case 'cancelled':
    case 'payment_failed':
      return 'bg-destructive/10';
    case 'payment_requested':
    case 'awaiting_driver':
      return 'bg-muted';
    case 'dispatched':
    case 'started':
      return 'bg-primary/15';
    case 'scheduled':
    case 'scheduled_driver_accepted':
      return 'bg-secondary/15';
  }
}

function statusPillTextClass(status: Ride['status']): string {
  switch (status) {
    case 'completed':
      return 'text-success';
    case 'cancelled':
    case 'payment_failed':
      return 'text-destructive';
    case 'payment_requested':
    case 'awaiting_driver':
      return 'text-muted-foreground';
    case 'dispatched':
    case 'started':
      return 'text-primary';
    case 'scheduled':
    case 'scheduled_driver_accepted':
      return 'text-secondary';
  }
}

function otherPartyLabel(ride: Ride, viewerRole: 'rider' | 'driver'): string {
  if (viewerRole === 'rider') {
    return ride.driver
      ? `Trip with ${ride.driver.name.first}`
      : 'Trip (no driver yet)';
  }
  return `Trip with ${ride.passenger.name.first}`;
}

export const TripCard = memo(function TripCard({
  ride,
  viewerRole,
  onPress,
}: TripCardProps) {
  // See "Fare display rule" in the file-level docstring. `null` => no
  // price chip rendered (cancelled trips).
  const fareText: string | null =
    ride.status === 'cancelled'
      ? null
      : `Est. ${ride.rideService.baseFare.format()}`;
  return (
    <Pressable
      testID={`trip-card-${String(ride.id)}`}
      accessibilityRole="button"
      accessibilityLabel={[
        otherPartyLabel(ride, viewerRole),
        statusLabel(ride.status),
        fareText,
      ]
        .filter((s): s is string => s !== null)
        .join(', ')}
      onPress={() => onPress(ride)}
      className="mb-2 rounded-lg border border-border bg-card p-3 active:opacity-70"
    >
      <View className="flex-row items-start justify-between">
        <View className="flex-1 pr-3">
          <Text className="text-base font-semibold text-foreground">
            {otherPartyLabel(ride, viewerRole)}
          </Text>
          <Text className="mt-0.5 text-xs text-muted-foreground">
            {formatTimestamp(ride.createdAt)}
          </Text>
        </View>
        <View
          className={`rounded-full px-2 py-0.5 ${statusPillBgClass(ride.status)}`}
        >
          <Text
            className={`text-xs font-medium ${statusPillTextClass(ride.status)}`}
          >
            {statusLabel(ride.status)}
          </Text>
        </View>
      </View>

      <View className="mt-2">
        <Text
          className="text-sm text-foreground"
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          From: {ride.pickup.address}
        </Text>
        <Text
          className="text-sm text-foreground"
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          To: {ride.dropoff.address}
        </Text>
      </View>

      <View className="mt-2 flex-row items-center justify-between">
        <Text className="text-xs text-muted-foreground">
          {ride.rideService.name} · {String(ride.rideService.seatCapacity)}{' '}
          seats
        </Text>
        {fareText !== null && (
          <Text className="text-sm font-semibold text-foreground">
            {fareText}
          </Text>
        )}
      </View>
    </Pressable>
  );
});
