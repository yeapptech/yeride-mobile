import { useCallback } from 'react';
import type { ReactNode } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';

import type { Ride } from '@domain/entities/Ride';

import { TripCard } from './TripCard';

/**
 * Thin FlatList wrapper presenting a list of rides via `TripCard`.
 *
 * Props are deliberately presentational only — the parent screen
 * supplies the rides, the empty / footer slots, and the selection
 * callback. The component does no data-fetching and never reads from
 * stores. This keeps `TripList` reusable across Activity tab, Wallet
 * (future), and trip-detail screens.
 *
 * Pull-to-refresh and load-more pagination are exposed via optional
 * `onRefresh` / `refreshing` props; when omitted, the list is a plain
 * scrollable FlatList. The footer slot is the standard place to mount
 * a "Load more" button or the `<DevToolsSection/>` (Activity tab does
 * the latter).
 */
export interface TripListProps {
  readonly rides: readonly Ride[];
  readonly viewerRole: 'rider' | 'driver';
  readonly onSelectRide: (ride: Ride) => void;
  readonly ListEmptyComponent?: ReactNode;
  readonly ListFooterComponent?: ReactNode;
  readonly refreshing?: boolean;
  readonly onRefresh?: () => void;
  readonly testID?: string;
}

export function TripList({
  rides,
  viewerRole,
  onSelectRide,
  ListEmptyComponent,
  ListFooterComponent,
  refreshing,
  onRefresh,
  testID,
}: TripListProps) {
  const renderItem = useCallback(
    ({ item }: { item: Ride }) => (
      <TripCard ride={item} viewerRole={viewerRole} onPress={onSelectRide} />
    ),
    [viewerRole, onSelectRide],
  );
  return (
    <FlatList
      testID={testID ?? 'trip-list'}
      data={rides}
      keyExtractor={(item) => String(item.id)}
      renderItem={renderItem}
      ListEmptyComponent={
        ListEmptyComponent ? () => <>{ListEmptyComponent}</> : undefined
      }
      ListFooterComponent={
        ListFooterComponent ? () => <>{ListFooterComponent}</> : undefined
      }
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing ?? false}
            onRefresh={onRefresh}
          />
        ) : undefined
      }
      contentContainerStyle={
        rides.length === 0 ? { flexGrow: 1, padding: 8 } : { padding: 8 }
      }
      ItemSeparatorComponent={() => <View className="h-0" />}
    />
  );
}
