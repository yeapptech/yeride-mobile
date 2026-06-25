import { Pressable, Text, View } from 'react-native';

import type { Money } from '@domain/entities/Money';
import type { RideService } from '@domain/entities/RideService';
import type { RideServiceId } from '@domain/entities/RideServiceId';

import { FareEstimate } from './FareEstimate';

/**
 * Vertical list of ride-service tiers, each row showing the tier name,
 * seat capacity, an optional description, and the fare estimate for the
 * currently-selected route. Tapping a row flips
 * `useTripDraftStore.selectedRideServiceId`.
 *
 * The fares map is computed in the view-model rather than here so
 * recalculations stay scoped to the route/avoid-tolls inputs that
 * actually changed.
 */
interface RideServicesListProps {
  readonly services: readonly RideService[];
  readonly selectedId: RideServiceId | null;
  readonly fareById: ReadonlyMap<string, Money | null>;
  readonly onSelect: (id: RideServiceId) => void;
}

export function RideServicesList({
  services,
  selectedId,
  fareById,
  onSelect,
}: RideServicesListProps) {
  if (services.length === 0) {
    return (
      <View className="px-4 py-3">
        <Text className="text-sm text-muted-foreground">
          No services in this area.
        </Text>
      </View>
    );
  }
  return (
    <View className="px-4">
      {services.map((service) => {
        const isSelected = service.id === selectedId;
        const fare = fareById.get(String(service.id)) ?? null;
        return (
          <Pressable
            key={String(service.id)}
            onPress={() => onSelect(service.id)}
            className={`mb-2 flex-row items-center gap-3 rounded-2xl border px-4 py-3 ${
              isSelected ? 'border-primary bg-primary/10' : 'border-border'
            }`}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            testID={`ride-service-${String(service.id)}`}
          >
            <View className="h-10 w-10 items-center justify-center rounded-full bg-honey">
              <Text className="text-lg">🚗</Text>
            </View>
            <View className="flex-1">
              <View className="flex-row items-center gap-2">
                <Text className="text-base font-semibold text-foreground">
                  {service.name}
                </Text>
                <Text className="text-xs text-muted-foreground">
                  · {String(service.seatCapacity)} seats
                </Text>
              </View>
              {service.description.length > 0 && (
                <Text
                  className="text-xs text-muted-foreground"
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {service.description}
                </Text>
              )}
            </View>
            <FareEstimate fare={fare} />
          </Pressable>
        );
      })}
    </View>
  );
}
