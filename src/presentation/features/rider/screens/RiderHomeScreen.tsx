import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Ride } from '@domain/entities/Ride';
import { Map, type MapMarkerProps } from '@presentation/components/map';
import { HomeRideSections } from '@presentation/components/trip/HomeRideSections';

import { useRiderHomeViewModel } from '../view-models/useRiderHomeViewModel';

/**
 * RiderHomeScreen — Uber-familiar home: a full-bleed map with a bottom sheet
 * that holds a greeting, a "Where to?" search field, the rider's in-progress +
 * scheduled rides (`HomeRideSections`), and their saved places (Home / Work).
 * Tapping a saved place prefills it as the dropoff and opens RouteSearch;
 * tapping a ride row opens its live monitor. No auto-resume redirect — the
 * rider chooses when to enter the monitor.
 *
 * Status states (driven by the view-model):
 *
 *   'loading'            — user query or location read in flight. Spinner.
 *   'permission_denied'  — location permission denied. Friendly prompt
 *                          + "Try again" CTA.
 *   'out_of_coverage'    — rider sits outside every service area we
 *                          know about. Friendly "we don't operate
 *                          here yet" copy.
 *   'ready'              — map renders, "Where to?" enabled.
 */
export default function RiderHomeScreen() {
  const vm = useRiderHomeViewModel();
  const { height: windowHeight } = useWindowDimensions();

  const greeting = timeOfDayGreeting();

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

      {/* Bottom sheet */}
      <SafeAreaView edges={['bottom']} className="absolute inset-x-0 bottom-0">
        <View className="rounded-t-3xl bg-card shadow-lg">
          {/* Grab handle */}
          <View className="items-center pb-1 pt-3">
            <View className="h-1 w-10 rounded-full bg-border" />
          </View>
          <ScrollView
            style={{ maxHeight: windowHeight * 0.62 }}
            contentContainerStyle={{
              paddingHorizontal: 20,
              paddingTop: 8,
              paddingBottom: 20,
            }}
            showsVerticalScrollIndicator={false}
          >
            {vm.user && (
              <Text className="mb-3 text-xl font-extrabold tracking-tight text-brand-deep">
                {greeting}, {vm.user.name.first} 🐝
              </Text>
            )}

            {/* "Where to?" search field */}
            <Pressable
              onPress={vm.goToRouteSearch}
              disabled={vm.status !== 'ready'}
              accessibilityRole="button"
              accessibilityState={{ disabled: vm.status !== 'ready' }}
              className={`flex-row items-center gap-3 rounded-2xl bg-muted px-4 py-4 ${
                vm.status === 'ready' ? '' : 'opacity-60'
              }`}
              testID="rider-home-where-to"
            >
              <Text className="text-base">🔍</Text>
              <Text className="flex-1 text-base font-semibold text-muted-foreground">
                Where to?
              </Text>
            </Pressable>

            <HomeRideSections
              inProgressRides={vm.inProgressRides}
              scheduledRides={vm.scheduledRides}
              viewerRole="rider"
              onSelectRide={(ride: Ride) => vm.resumeRide(String(ride.id))}
            />

            {vm.savedPlaces.length > 0 && (
              <View className="mt-4">
                <View className="mb-2 h-px bg-border" />
                <Text className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Saved places
                </Text>
                {vm.savedPlaces.map((place) => (
                  <Pressable
                    key={String(place.id)}
                    onPress={() => vm.goToSavedPlace(place)}
                    accessibilityRole="button"
                    testID={`rider-home-saved-place-${String(place.id)}`}
                    className="flex-row items-center gap-3 py-3"
                  >
                    <View className="h-9 w-9 items-center justify-center rounded-full bg-honey">
                      <Text className="text-base text-honey-foreground">
                        {savedPlaceIcon(place.label)}
                      </Text>
                    </View>
                    <View className="flex-1">
                      <Text className="text-[15px] font-bold text-foreground">
                        {place.label}
                      </Text>
                      <Text
                        numberOfLines={1}
                        className="text-xs text-muted-foreground"
                      >
                        {place.address.label}
                      </Text>
                    </View>
                    <Text className="text-lg text-muted-foreground">›</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </ScrollView>
        </View>
      </SafeAreaView>
    </View>
  );
}

function timeOfDayGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function savedPlaceIcon(label: string): string {
  const l = label.toLowerCase();
  if (l.includes('home')) return '🏠';
  if (l.includes('work') || l.includes('office')) return '💼';
  return '📍';
}
