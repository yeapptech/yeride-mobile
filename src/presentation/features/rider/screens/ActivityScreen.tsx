import { useNavigation } from '@react-navigation/native';
import { useMemo } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  SectionList,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Ride } from '@domain/entities/Ride';
import { DevToolsSection } from '@presentation/components/dev/DevToolsSection';
import { TripCard } from '@presentation/components/trip/TripCard';
import { Button } from '@presentation/components/ui/Button';
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
        <Button
          label="Load more"
          variant="secondary"
          onPress={vm.onLoadMore}
          loading={vm.isLoadingMore}
          testID="activity-load-more"
          className="mb-3"
        />
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
            <Text className="text-base font-semibold text-error">
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
      <SectionList
        testID="activity-trip-list"
        sections={groupRidesByDay(vm.rides)}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <TripCard ride={item} viewerRole="rider" onPress={vm.onSelectRide} />
        )}
        renderSectionHeader={({ section }) => (
          <Text className="bg-background px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {section.title}
          </Text>
        )}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={
          vm.rides.length === 0 ? { flexGrow: 1, padding: 8 } : { padding: 8 }
        }
        refreshControl={
          <RefreshControl
            refreshing={vm.isRefreshing}
            onRefresh={() => {
              // RefreshControl doesn't await; wrap the async VM callback.
              void vm.onRefresh();
            }}
          />
        }
        ListEmptyComponent={
          <View
            testID="activity-empty"
            className="flex-1 items-center justify-center p-6"
          >
            <View className="mb-3 h-16 w-16 items-center justify-center rounded-full bg-honey">
              <Text className="text-3xl">🚗</Text>
            </View>
            <Text className="text-base font-semibold text-foreground">
              No recent rides
            </Text>
            <Text className="mt-2 text-center text-sm text-muted-foreground">
              When you take a ride, it will show up here.
            </Text>
          </View>
        }
        ListFooterComponent={footer}
      />
    </SafeAreaView>
  );
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Group rides into date sections (Today / Yesterday / "Mon D") for the
 * Activity SectionList, preserving the incoming newest-first order.
 */
function groupRidesByDay(
  rides: readonly Ride[],
): { title: string; data: Ride[] }[] {
  const today = startOfDay(new Date());
  const yesterday = startOfDay(new Date(today.getTime() - 86_400_000));
  const sections: { title: string; data: Ride[] }[] = [];
  for (const ride of rides) {
    const day = startOfDay(ride.createdAt);
    const title =
      day.getTime() === today.getTime()
        ? 'Today'
        : day.getTime() === yesterday.getTime()
          ? 'Yesterday'
          : day.toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
            });
    const last = sections[sections.length - 1];
    if (last !== undefined && last.title === title) {
      last.data.push(ride);
    } else {
      sections.push({ title, data: [ride] });
    }
  }
  return sections;
}
