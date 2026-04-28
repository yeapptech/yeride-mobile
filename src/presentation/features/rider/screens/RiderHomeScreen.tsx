import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Map, type MapMarkerProps } from '@presentation/components/map';

import { useRiderHomeViewModel } from '../view-models/useRiderHomeViewModel';

/**
 * RiderHomeScreen — full-bleed map with a "Where to?" CTA and (when an
 * in-progress ride exists) an auto-resume redirect via the view-model.
 *
 * Status states (driven by the view-model):
 *
 *   'loading'            — user query or location read in flight. Spinner.
 *   'permission_denied'  — location permission denied. Friendly prompt
 *                          + "Open settings" CTA.
 *   'out_of_coverage'    — rider sits outside every service area we
 *                          know about. Friendly "we don't operate
 *                          here yet" copy.
 *   'ready'              — map renders, "Where to?" enabled.
 *
 * The map shows the rider's location pin (slot reused from the shared
 * Map's "pickup" slot — visually a gold dot is fine for "you are here"
 * in turn 3.3; turn 3.4 stylizes a custom view inside Marker).
 */
export default function RiderHomeScreen() {
  const vm = useRiderHomeViewModel();

  const initialRegion = vm.currentLocation.coordinates
    ? {
        latitude: vm.currentLocation.coordinates.latitude,
        longitude: vm.currentLocation.coordinates.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      }
    : null;

  const youAreHereMarker: MapMarkerProps | null = vm.currentLocation.coordinates
    ? {
        coordinates: vm.currentLocation.coordinates,
        title: 'You are here',
      }
    : null;

  return (
    <View className="flex-1 bg-background">
      <Map
        initialRegion={initialRegion}
        pickup={youAreHereMarker}
        dropoff={null}
        driver={null}
        selectedRoute={null}
        pickupRoute={null}
        alternativeRoutes={[]}
      />

      {/* Top status banner (errors / out-of-coverage / loading) */}
      <SafeAreaView edges={['top']} className="absolute left-0 right-0 top-0">
        {vm.status === 'loading' && (
          <View className="mx-4 mt-2 flex-row items-center gap-2 rounded-full bg-card/95 px-3 py-2 shadow">
            <ActivityIndicator size="small" />
            <Text className="text-sm text-foreground">
              Finding your location…
            </Text>
          </View>
        )}
        {vm.status === 'permission_denied' && (
          <View className="mx-4 mt-2 rounded-lg bg-warning/10 p-3">
            <Text className="text-sm font-medium text-warning">
              Location is off
            </Text>
            <Text className="text-xs text-warning">
              Allow location to see drivers nearby and plan your ride.
            </Text>
            <Pressable
              onPress={() => {
                void vm.refreshLocation();
              }}
              className="mt-2 self-start rounded-md bg-warning/20 px-3 py-1"
              accessibilityRole="button"
            >
              <Text className="text-sm font-medium text-warning">
                Try again
              </Text>
            </Pressable>
          </View>
        )}
        {vm.status === 'out_of_coverage' && (
          <View className="mx-4 mt-2 rounded-lg bg-info/10 p-3">
            <Text className="text-sm font-medium text-info">
              Outside our coverage
            </Text>
            <Text className="text-xs text-info">
              YeRide doesn't operate here yet. Try again from a supported
              region.
            </Text>
          </View>
        )}
        {vm.currentLocation.error && (
          <View className="mx-4 mt-2 rounded-lg bg-error/10 p-3">
            <Text className="text-sm text-error">
              {vm.currentLocation.error}
            </Text>
          </View>
        )}
      </SafeAreaView>

      {/* Bottom action panel */}
      <SafeAreaView
        edges={['bottom']}
        className="absolute left-0 right-0 bottom-0"
      >
        <View className="mx-4 mb-4 rounded-2xl bg-card p-4 shadow-lg">
          {vm.user && (
            <Text className="mb-3 text-base text-foreground">
              Hi, {vm.user.name.first} 👋
            </Text>
          )}
          <Pressable
            onPress={vm.goToRouteSearch}
            disabled={vm.status !== 'ready'}
            accessibilityRole="button"
            accessibilityState={{ disabled: vm.status !== 'ready' }}
            className={`items-center rounded-xl px-4 py-4 ${
              vm.status === 'ready' ? 'bg-primary' : 'bg-muted'
            }`}
            testID="rider-home-where-to"
          >
            <Text
              className={`text-base font-semibold ${
                vm.status === 'ready'
                  ? 'text-primary-foreground'
                  : 'text-muted-foreground'
              }`}
            >
              Where to?
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}
