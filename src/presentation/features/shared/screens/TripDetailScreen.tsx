import { useMemo } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

import type { Ride } from '@domain/entities/Ride';
import { RideId } from '@domain/entities/RideId';
import { TripPaymentsList } from '@presentation/components/trip/TripPaymentsList';
import type { RiderStackScreenProps } from '@presentation/navigation/types';
import { useCurrentUserId } from '@presentation/stores/useSessionStore';

import { useTripDetailViewModel } from '../view-models/useTripDetailViewModel';

// Both stacks (rider + driver) register a `TripDetail: { rideId: string }`
// route with the same param shape. Picking either screen-props type gives
// us the right `route.params` typing; we use `RiderStackScreenProps` for
// brevity. The driver stack works because `RiderStackParamList` and
// `DriverStackParamList` are unioned at the root level (see
// `RootStackParamList` in `navigation/types.ts`).
type Props = RiderStackScreenProps<'TripDetail'>;

/**
 * Role-agnostic trip-detail surface. Reached from Activity tab row taps
 * on terminal-status trips (`completed` / `cancelled`). Mounted on
 * BOTH the rider and driver stacks; the screen body derives the viewer
 * role from `useCurrentUserId()` matching `ride.passenger.id` /
 * `ride.driver.id`.
 *
 * Renders:
 *   - Header: role-flipped party label, status copy, formatted creation
 *     timestamp.
 *   - Route summary: pickup → dropoff addresses + ride-service name.
 *   - Per-trip payments (`TripPaymentsList`) — folded in from the audit
 *     §3.6 finding.
 *   - Per-trip events — a chronological timeline (matches legacy
 *     `Events.js`).
 *
 * Tip re-entry is NOT wired here in Turn 6 — the rider's
 * `RideReceiptScreen` already owns the tip UX (with PDF generation +
 * Stripe wallet integration). The Activity-tap path is for arbitrary-
 * time drill-in; if the rider wants to add a tip they can navigate to
 * the receipt screen from there (a follow-up turn can add a "Tip your
 * driver" CTA on this screen if needed).
 */
export default function TripDetailScreen({ route }: Props) {
  // `route.params.rideId` is the wire-string form (matching navigation
  // types.ts). The Activity-tab navigator hands us a vetted string from
  // an existing `ride.id`, but other entry points (deep links, push-
  // notification responses via `useNotificationResponseHandler`) can
  // route here with any string. Run it through `RideId.create()` and
  // render the not-found state on validation failure rather than
  // letting a malformed id reach the repository. The VM is only
  // mounted on the valid path.
  const rideIdResult = useMemo(
    () => RideId.create(route.params.rideId),
    [route.params.rideId],
  );

  if (!rideIdResult.ok) {
    return (
      <SafeAreaView
        edges={['top']}
        className="flex-1 bg-background"
        testID="trip-detail-screen"
      >
        <View
          testID="trip-detail-not-found"
          className="flex-1 items-center justify-center p-6"
        >
          <Text className="text-base font-semibold text-foreground">
            Trip not found
          </Text>
          <Text className="mt-2 text-center text-sm text-muted-foreground">
            This link refers to a trip we couldn&rsquo;t recognize.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return <TripDetailScreenBody rideId={rideIdResult.value} />;
}

/**
 * Inner body that runs the view-model. Split out so the conditional
 * `RideId.create()` fallback above doesn't violate the Rules of Hooks
 * (the VM would otherwise sit behind an early return).
 */
function TripDetailScreenBody({ rideId }: { rideId: RideId }) {
  const vm = useTripDetailViewModel({ rideId });
  const currentUserId = useCurrentUserId();
  const { bottom } = useSafeAreaInsets();

  if (vm.status === 'loading') {
    return (
      <SafeAreaView
        edges={['top']}
        className="flex-1 bg-background"
        testID="trip-detail-screen"
      >
        <View
          testID="trip-detail-loading"
          className="flex-1 items-center justify-center"
        >
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  if (vm.status === 'not-found' || vm.ride === null) {
    return (
      <SafeAreaView
        edges={['top']}
        className="flex-1 bg-background"
        testID="trip-detail-screen"
      >
        <View
          testID="trip-detail-not-found"
          className="flex-1 items-center justify-center p-6"
        >
          <Text className="text-base font-semibold text-foreground">
            Trip not found
          </Text>
          <Text className="mt-2 text-center text-sm text-muted-foreground">
            This trip may have been removed.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (vm.status === 'error') {
    return (
      <SafeAreaView
        edges={['top']}
        className="flex-1 bg-background"
        testID="trip-detail-screen"
      >
        <View
          testID="trip-detail-error"
          className="flex-1 items-center justify-center p-6"
        >
          <Text className="text-base font-semibold text-error">
            Couldn&rsquo;t load this trip
          </Text>
          <Text className="mt-2 text-center text-sm text-muted-foreground">
            {vm.errorMessage ?? 'Please try again later.'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const ride = vm.ride;
  const viewerRole: 'rider' | 'driver' =
    currentUserId !== null &&
    ride.driver !== null &&
    String(ride.driver.id) === String(currentUserId)
      ? 'driver'
      : 'rider';

  return (
    <SafeAreaView
      edges={['top']}
      className="flex-1 bg-background"
      testID="trip-detail-screen"
    >
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 16 + bottom }}
      >
        <Section title={partyHeader(ride, viewerRole)}>
          <DetailRow label="Status" value={statusLabel(ride.status)} />
          <DetailRow label="When" value={formatTimestamp(ride.createdAt)} />
          <DetailRow
            label="Service"
            value={`${ride.rideService.name} · ${String(ride.rideService.seatCapacity)} seats`}
          />
        </Section>

        <Section title="Route">
          <DetailRow label="Pickup" value={ride.pickup.address} multiline />
          <DetailRow label="Dropoff" value={ride.dropoff.address} multiline />
        </Section>

        <Section title="Payments">
          <TripPaymentsList payments={vm.payments} />
        </Section>

        <Section title="Trip events" testID="trip-detail-events">
          {vm.events.length === 0 ? (
            <Text className="text-sm text-muted-foreground">
              No events recorded for this trip yet.
            </Text>
          ) : (
            vm.events.map((e) => (
              <View
                key={e.id}
                testID={`trip-event-${e.id}`}
                className="flex-row items-start justify-between border-b border-border py-2 last:border-b-0"
              >
                <View className="flex-1 pr-3">
                  <Text className="text-sm font-medium text-foreground">
                    {e.event}
                  </Text>
                </View>
                <Text className="text-xs text-muted-foreground">
                  {formatTimestamp(e.createdAt)}
                </Text>
              </View>
            ))
          )}
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

function partyHeader(ride: Ride, viewerRole: 'rider' | 'driver'): string {
  if (viewerRole === 'rider') {
    return ride.driver
      ? `Trip with ${ride.driver.name.first} ${ride.driver.name.last}`
      : 'Trip (no driver)';
  }
  return `Trip with ${ride.passenger.name.first} ${ride.passenger.name.last}`;
}

function statusLabel(status: Ride['status']): string {
  switch (status) {
    case 'completed':
      return 'Completed';
    case 'cancelled':
      return 'Cancelled';
    case 'payment_failed':
      return 'Payment failed';
    default:
      return status;
  }
}

function formatTimestamp(d: Date): string {
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function Section({
  title,
  children,
  testID,
}: {
  title: string;
  children: React.ReactNode;
  testID?: string;
}) {
  return (
    <View testID={testID} className="mb-4">
      <Text className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </Text>
      <View className="rounded-lg border border-border bg-card p-3">
        {children}
      </View>
    </View>
  );
}

function DetailRow({
  label,
  value,
  multiline,
}: {
  label: string;
  value: string;
  multiline?: boolean;
}) {
  return (
    <View
      className={multiline ? 'mb-2 last:mb-0' : 'flex-row justify-between py-1'}
    >
      <Text
        className={
          multiline
            ? 'text-xs uppercase tracking-wide text-muted-foreground'
            : 'text-sm text-muted-foreground'
        }
      >
        {label}
      </Text>
      <Text
        className={
          multiline
            ? 'mt-0.5 text-sm text-foreground'
            : 'text-sm text-foreground'
        }
        numberOfLines={multiline ? undefined : 1}
      >
        {value}
      </Text>
    </View>
  );
}
