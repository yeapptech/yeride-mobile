import { useNavigation } from '@react-navigation/native';
import { useMemo } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DevToolsSection } from '@presentation/components/dev/DevToolsSection';
import { TripCard } from '@presentation/components/trip/TripCard';
import { TripList } from '@presentation/components/trip/TripList';
import type { RiderStackNavigation } from '@presentation/navigation/types';
import { useCurrentUserId } from '@presentation/stores/useSessionStore';

import {
  useActivityViewModel,
  type ActivityNavigator,
} from '../view-models/useActivityViewModel';

/**
 * Rider Activity tab. Replaces `ActivityPlaceholderScreen` as of Phase
 * 10 Turn 6.
 *
 * Layout:
 *   ┌─────────────────────────────────────────────┐
 *   │ "Recent rides" header                       │
 *   ├─────────────────────────────────────────────┤
 *   │ TripList (FlatList of TripCards)            │
 *   │  • pull-to-refresh                          │
 *   │  • status-aware row tap                     │
 *   │                                             │
 *   ├─────────────────────────────────────────────┤
 *   │ "Load more" button (when canLoadMore)       │
 *   ├─────────────────────────────────────────────┤
 *   │ <DevToolsSection/>  ← dev only              │
 *   └─────────────────────────────────────────────┘
 *
 * The DevToolsSection moves from the placeholder screen to here so the
 * Crashlytics smoke buttons remain reachable in dev. Production renders
 * nothing.
 */
export default function ActivityScreen() {
  const navigation = useNavigation<RiderStackNavigation>();
  const passengerId = useCurrentUserId();

  const navigator = useMemo<ActivityNavigator>(
    () => ({
      navigateToMonitor: (rideId: string) => {
        navigation.navigate('RideMonitor', { rideId });
      },
      navigateToDetail: (rideId: string) => {
        navigation.navigate('TripDetail', { rideId });
      },
    }),
    [navigation],
  );

  const vm = useActivityViewModel({ passengerId, navigator });

  const footer = (
    <View className="pt-2">
      {vm.canLoadMore && (
        <Pressable
          testID="activity-load-more"
          onPress={vm.onLoadMore}
          disabled={vm.isLoadingMore}
          className="mb-3 items-center rounded-lg border border-border bg-card px-4 py-3 active:opacity-70"
        >
          {vm.isLoadingMore ? (
            <ActivityIndicator />
          ) : (
            <Text className="text-sm font-semibold text-foreground">
              Load more
            </Text>
          )}
        </Pressable>
      )}
      <DevToolsSection />
    </View>
  );

  // Phase 10 turn 7 — rider-side Scheduled section. Renders above the
  // Recent Rides list when at least one scheduled ride exists; hidden
  // when empty (matches legacy `ScheduledTrips` returning null on
  // empty). Lives as a `ListHeaderComponent` on the TripList so
  // pull-to-refresh + the empty-state still work uniformly.
  const scheduledHeader =
    vm.scheduledRides.length > 0 ? (
      <View
        testID="activity-scheduled-section"
        className="border-b border-border px-4 pb-2 pt-3"
      >
        <Text className="mb-2 text-base font-semibold text-foreground">
          Scheduled
        </Text>
        {vm.scheduledRides.map((ride) => (
          <TripCard
            key={String(ride.id)}
            ride={ride}
            viewerRole="rider"
            onPress={vm.onSelectRide}
          />
        ))}
      </View>
    ) : null;

  if (vm.status === 'loading') {
    return (
      <SafeAreaView
        edges={['top']}
        className="flex-1 bg-background"
        testID="activity-screen"
      >
        {/*
          Scheduled section is independent of the recent-rides infinite
          query — it runs off its own live subscription, so it can be
          ready before the history finishes loading. Rendering it here
          (in addition to in the ready/empty branch below) gives the
          rider a faster perceived load when they have scheduled trips.
        */}
        {scheduledHeader}
        <View
          testID="activity-loading"
          className="flex-1 items-center justify-center"
        >
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  if (vm.status === 'error') {
    return (
      <SafeAreaView
        edges={['top']}
        className="flex-1 bg-background"
        testID="activity-screen"
      >
        <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
          {/* Same independence rationale as the loading branch — the
              scheduled section is driven by a separate subscription
              and shouldn't disappear when the history query errors. */}
          {scheduledHeader}
          <View
            testID="activity-error"
            className="flex-1 items-center justify-center p-6"
          >
            <Text className="text-base font-semibold text-destructive">
              Couldn&rsquo;t load your activity
            </Text>
            <Text className="mt-2 text-center text-sm text-muted-foreground">
              {vm.errorMessage ??
                'Pull down to refresh, or check your connection and try again.'}
            </Text>
          </View>
          {footer}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // Empty + ready both render via TripList so pull-to-refresh works
  // even on the empty state.
  return (
    <SafeAreaView
      edges={['top']}
      className="flex-1 bg-background"
      testID="activity-screen"
    >
      {scheduledHeader}
      <View className="border-b border-border px-4 py-3">
        <Text className="text-lg font-semibold text-foreground">
          Recent rides
        </Text>
      </View>
      <TripList
        rides={vm.rides}
        viewerRole="rider"
        onSelectRide={vm.onSelectRide}
        refreshing={vm.isRefreshing}
        onRefresh={() => {
          // Wrap the async VM callback so the prop type is `() => void`
          // — FlatList's RefreshControl doesn't await the promise.
          void vm.onRefresh();
        }}
        ListEmptyComponent={
          <View
            testID="activity-empty"
            className="flex-1 items-center justify-center p-6"
          >
            <Text className="text-base font-semibold text-foreground">
              No recent rides
            </Text>
            <Text className="mt-2 text-center text-sm text-muted-foreground">
              When you take a ride, it will show up here.
            </Text>
          </View>
        }
        ListFooterComponent={footer}
        testID="activity-trip-list"
      />
    </SafeAreaView>
  );
}
