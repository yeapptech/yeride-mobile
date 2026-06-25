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
import { TripList } from '@presentation/components/trip/TripList';
import type { DriverStackNavigation } from '@presentation/navigation/types';
import { useCurrentUserId } from '@presentation/stores/useSessionStore';

import {
  useDriverActivityViewModel,
  type DriverActivityNavigator,
} from '../view-models/useDriverActivityViewModel';

/**
 * Driver Activity tab. Replaces `DriverActivityPlaceholderScreen` as of
 * Phase 10 Turn 6. Mirror of the rider `ActivityScreen` — same layout,
 * same DevToolsSection footer, status-aware navigation goes to
 * `DriverMonitor` (active) or `TripDetail` (terminal).
 */
export default function DriverActivityScreen() {
  const navigation = useNavigation<DriverStackNavigation>();
  const driverId = useCurrentUserId();

  const navigator = useMemo<DriverActivityNavigator>(
    () => ({
      navigateToMonitor: (rideId: string) => {
        navigation.navigate('DriverMonitor', { rideId });
      },
      navigateToDetail: (rideId: string) => {
        navigation.navigate('TripDetail', { rideId });
      },
    }),
    [navigation],
  );

  const vm = useDriverActivityViewModel({ driverId, navigator });

  const footer = (
    <View className="pt-2">
      {vm.canLoadMore && (
        <Pressable
          testID="driver-activity-load-more"
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

  if (vm.status === 'loading') {
    return (
      <SafeAreaView
        edges={['top']}
        className="flex-1 bg-background"
        testID="driver-activity-screen"
      >
        <View
          testID="driver-activity-loading"
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
        testID="driver-activity-screen"
      >
        <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
          <View
            testID="driver-activity-error"
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

  return (
    <SafeAreaView
      edges={['top']}
      className="flex-1 bg-background"
      testID="driver-activity-screen"
    >
      <View className="border-b border-border px-4 py-3">
        <Text className="text-lg font-semibold text-foreground">
          Recent rides
        </Text>
      </View>
      <TripList
        rides={vm.rides}
        viewerRole="driver"
        onSelectRide={vm.onSelectRide}
        refreshing={vm.isRefreshing}
        onRefresh={() => {
          // Wrap the async VM callback so the prop type is `() => void`
          // — FlatList's RefreshControl doesn't await the promise.
          void vm.onRefresh();
        }}
        ListEmptyComponent={
          <View
            testID="driver-activity-empty"
            className="flex-1 items-center justify-center p-6"
          >
            <Text className="text-base font-semibold text-foreground">
              No recent rides
            </Text>
            <Text className="mt-2 text-center text-sm text-muted-foreground">
              Rides you accept will show up here.
            </Text>
          </View>
        }
        ListFooterComponent={footer}
        testID="driver-activity-trip-list"
      />
    </SafeAreaView>
  );
}
