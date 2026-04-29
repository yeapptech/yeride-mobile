import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Vehicle } from '@domain/entities/Vehicle';

import { DriverVehicleCard } from '../components/DriverVehicleCard';
import { useVehicleListViewModel } from '../view-models/useVehicleListViewModel';

/**
 * `VehicleListScreen` — driver-facing list of registered vehicles. Live
 * subscription via the VM. Tap a non-active card to activate; tap Delete
 * to soft-delete (Alert-confirmed by the VM).
 *
 * Empty state and error state are full-screen rather than inline. The
 * empty state is the primary entry point for first-time drivers — the
 * Register CTA is the only meaningful action.
 *
 * Dumb: pulls from the view-model only, no `useUseCases` or query calls.
 */
export default function VehicleListScreen() {
  const vm = useVehicleListViewModel();

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <View className="flex-row items-center justify-between px-4 pt-2 pb-3">
        <View>
          <Text className="text-xl font-semibold text-foreground">
            My vehicles
          </Text>
          <Text className="text-xs text-muted-foreground">
            {summaryFor(vm.state)}
          </Text>
        </View>
        <Pressable
          onPress={vm.onAddVehicle}
          accessibilityRole="button"
          accessibilityLabel="Add vehicle"
          testID="vehicle-list-add"
          className="rounded-full bg-primary px-4 py-2"
        >
          <Text className="text-sm font-semibold text-primary-foreground">
            + Add vehicle
          </Text>
        </Pressable>
      </View>

      {vm.state.kind === 'loading' && <CenteredSpinner />}

      {vm.state.kind === 'error' && (
        <View
          className="mx-4 rounded-lg border border-error/30 bg-error/10 p-4"
          testID="vehicle-list-error"
        >
          <Text className="text-sm text-error">
            Couldn&apos;t load your vehicles. Pull to refresh or try again
            later.
          </Text>
          <Text className="mt-1 text-xs text-muted-foreground">
            {vm.state.error.message}
          </Text>
        </View>
      )}

      {vm.state.kind === 'empty' && (
        <EmptyState onAddVehicle={vm.onAddVehicle} />
      )}

      {vm.state.kind === 'ready' && (
        <FlatList
          testID="vehicle-list"
          data={vm.state.vehicles}
          keyExtractor={(v: Vehicle) => String(v.vin)}
          contentContainerStyle={{ padding: 16 }}
          renderItem={({ item }) => (
            <DriverVehicleCard
              vehicle={item}
              isActive={
                vm.state.kind === 'ready' &&
                vm.state.activeVin !== null &&
                String(item.vin) === vm.state.activeVin
              }
              onSelect={vm.onSelectVehicle}
              onDelete={vm.onDelete}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

function summaryFor(
  state: ReturnType<typeof useVehicleListViewModel>['state'],
): string {
  if (state.kind === 'ready') {
    const n = state.vehicles.length;
    return `${String(n)} ${n === 1 ? 'vehicle' : 'vehicles'} registered`;
  }
  if (state.kind === 'empty') return 'No vehicles registered';
  if (state.kind === 'error') return 'Error loading vehicles';
  return 'Loading…';
}

function CenteredSpinner() {
  return (
    <View className="flex-1 items-center justify-center">
      <ActivityIndicator size="large" />
    </View>
  );
}

function EmptyState({ onAddVehicle }: { readonly onAddVehicle: () => void }) {
  return (
    <View
      className="flex-1 items-center justify-center px-6"
      testID="vehicle-list-empty"
    >
      <Text className="text-lg font-semibold text-foreground">
        No vehicles registered
      </Text>
      <Text className="mt-1 text-center text-sm text-muted-foreground">
        Register a vehicle to start accepting rides.
      </Text>
      <Pressable
        onPress={onAddVehicle}
        accessibilityRole="button"
        testID="vehicle-list-empty-cta"
        className="mt-4 rounded-xl bg-primary px-6 py-3"
      >
        <Text className="text-base font-semibold text-primary-foreground">
          Register your first vehicle
        </Text>
      </Pressable>
    </View>
  );
}
