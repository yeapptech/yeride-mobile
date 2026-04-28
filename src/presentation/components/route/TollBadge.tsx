import { Text, View } from 'react-native';

import type { Money } from '@domain/entities/Money';

/**
 * Inline pill that surfaces "this route has tolls" at-a-glance on the
 * RouteSelector list. When `tollPrice` is set, the badge shows the toll
 * amount; when it's `null` (Routes API didn't compute tolls or there are
 * none), nothing renders.
 *
 * The Routes API only returns toll prices when the request opts in via
 * `extraComputations: ['TOLLS']`. Phase 3 turn 2's view-model passes
 * `tolls: true` whenever `useTripDraftStore.avoidTolls === false`, so
 * the rider sees toll prices when relevant.
 */
interface TollBadgeProps {
  readonly tollPrice: Money | null;
}

export function TollBadge({ tollPrice }: TollBadgeProps) {
  if (!tollPrice) return null;
  return (
    <View className="flex-row items-center rounded-full bg-warning/10 px-2 py-1">
      <Text className="text-xs font-medium text-warning">
        Toll · ${tollPrice.majorUnits.toFixed(2)}
      </Text>
    </View>
  );
}
