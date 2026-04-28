import { Pressable, Text, View } from 'react-native';

import type { Route } from '@domain/entities/Route';

import { TollBadge } from './TollBadge';

/**
 * Horizontal-scrolling card per route alternative on RouteSelectScreen.
 * The selected card has a primary border + gold background tint; the
 * non-selected ones are neutral.
 *
 * Each card shows:
 *   - Duration (`route.durationText`, e.g. "12 mins")
 *   - Distance (`route.distanceText`, e.g. "3.2 mi")
 *   - Description (`route.description`, e.g. "via I-95")
 *   - TollBadge if tolls are present
 *   - Route labels (e.g. "Fastest", "Toll-free") when Google sets them
 *
 * Tapping a card calls `onPress(index)` so the parent can flip
 * `useTripDraftStore.selectedRouteIndex`.
 */
interface RouteSelectorProps {
  readonly routes: readonly Route[];
  readonly selectedIndex: number;
  readonly onSelect: (index: number) => void;
}

export function RouteSelector({
  routes,
  selectedIndex,
  onSelect,
}: RouteSelectorProps) {
  if (routes.length === 0) {
    return (
      <View className="px-4 py-3">
        <Text className="text-sm text-muted-foreground">
          No routes available.
        </Text>
      </View>
    );
  }
  return (
    <View className="flex-row flex-wrap gap-2 px-4 py-3">
      {routes.map((route, index) => (
        <Pressable
          key={route.routeToken || `route-${String(index)}`}
          onPress={() => onSelect(index)}
          className={`min-w-[150px] rounded-xl border px-3 py-2 ${
            index === selectedIndex
              ? 'border-primary bg-primary/10'
              : 'border-border'
          }`}
          accessibilityRole="button"
          accessibilityState={{ selected: index === selectedIndex }}
          testID={`route-option-${String(index)}`}
        >
          <Text className="text-base font-semibold text-foreground">
            {route.durationText}
          </Text>
          <Text className="text-xs text-muted-foreground">
            {route.distanceText}
          </Text>
          {route.description.length > 0 && (
            <Text
              className="mt-1 text-xs text-muted-foreground"
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {route.description}
            </Text>
          )}
          {(route.tollPrice || route.routeLabels.length > 0) && (
            <View className="mt-2 flex-row flex-wrap items-center gap-1">
              <TollBadge tollPrice={route.tollPrice} />
              {route.routeLabels
                .filter((label) => label !== 'DEFAULT_ROUTE')
                .map((label) => (
                  <View
                    key={label}
                    className="rounded-full bg-info/10 px-2 py-1"
                  >
                    <Text className="text-xs font-medium text-info">
                      {humanizeLabel(label)}
                    </Text>
                  </View>
                ))}
            </View>
          )}
        </Pressable>
      ))}
    </View>
  );
}

function humanizeLabel(label: string): string {
  // 'FUEL_EFFICIENT' → 'Fuel efficient'
  return label
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
}
