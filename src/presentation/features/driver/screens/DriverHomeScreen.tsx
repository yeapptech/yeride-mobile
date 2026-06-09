import { ActivityIndicator, Image, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Map, type MapMarkerProps } from '@presentation/components/map';
import { PermissionDeniedBanner } from '@presentation/components/permission';
import { HomeRideSections } from '@presentation/components/trip/HomeRideSections';

import { DriverRideCardStack } from '../components/DriverRideCardStack';
import { useDriverHomeViewModel } from '../view-models/useDriverHomeViewModel';

/**
 * DriverHomeScreen — full-bleed map with an online/offline toggle and a
 * stack of incoming-ride cards (visible when online).
 *
 * Status states (driven by the view-model):
 *   'loading'            — user query or location read in flight. Spinner.
 *   'permission_denied'  — friendly prompt + "Open settings" CTA.
 *   'out_of_coverage'    — driver sits outside every service area we
 *                          know about. We don't show the online toggle —
 *                          there's nothing to advertise to.
 *   'ready'              — map renders, online-toggle enabled.
 *
 * The bottom panel renders the driver's in-progress rides as a tappable
 * list (`HomeRideSections`, tap → DriverMonitor) above the mode-dependent
 * controls:
 *   - 'offline':        toggle button "Go online" + tagline.
 *   - 'online_idle':    toggle button "Go offline" + DriverRideCardStack.
 * There is no auto-redirect mid-trip — the driver taps the in-progress
 * row to return to DriverMonitor.
 */
export default function DriverHomeScreen() {
  const vm = useDriverHomeViewModel();

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

  const isOnline = vm.mode !== 'offline';
  // Phase 9 turn 10. The online toggle requires (a) the foreground
  // location read to have resolved (status === 'ready') AND (b) the
  // background-geolocation SDK permission to NOT be explicitly denied
  // — if it is, the banner above the panel surfaces an "Open settings"
  // CTA and the toggle stays disabled (the VM additionally guards
  // `goOnline` defensively).
  const canToggle = vm.status === 'ready' && !vm.bgPermissionDenied;

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

      {/* Top status banner — same shape as RiderHome */}
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
              Allow location to receive ride requests near you.
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
              YeRide doesn't operate here yet. Drive into a supported region to
              start receiving requests.
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
          <HomeRideSections
            inProgressRides={vm.inProgressRides}
            scheduledRides={vm.scheduledRides}
            viewerRole="driver"
            onSelectRide={vm.onSelectHomeRide}
          />
          {vm.user && !isOnline && (
            <Text className="mb-3 text-base text-foreground">
              Hi, {vm.user.name.first} 👋
            </Text>
          )}

          {/* Phase 9 turn 10. Background-geolocation permission denied —
              banner with "Open settings" CTA + the online toggle below
              stays disabled. Mounted inside the bottom panel so it's
              visually grouped with the toggle it gates. */}
          {vm.bgPermissionDenied && (
            <View className="mb-3" testID="driver-home-bg-permission-banner">
              <PermissionDeniedBanner
                title="Location access is off"
                message="YeRide needs background location access to receive ride requests and to track your trip. Tap below to enable it in Settings."
                onOpenSettings={vm.onOpenSettings}
              />
            </View>
          )}

          {/* No active vehicle: empty-state prompt instead of online toggle. */}
          {vm.noActiveVehicle && (
            <View testID="driver-home-no-vehicle-prompt">
              <Text className="text-base font-semibold text-foreground">
                Register a vehicle to start
              </Text>
              <Text className="mt-1 mb-3 text-xs text-muted-foreground">
                You need an active vehicle before you can accept rides.
              </Text>
              <Pressable
                onPress={vm.onRegisterVehicle}
                accessibilityRole="button"
                accessibilityLabel="Register a vehicle"
                testID="driver-home-register-vehicle"
                className="items-center rounded-xl bg-primary px-4 py-4"
              >
                <Text className="text-base font-semibold text-primary-foreground">
                  Register a vehicle
                </Text>
              </Pressable>
            </View>
          )}

          {/* Active vehicle: surface stock photo + thumbnail above toggle. */}
          {!vm.noActiveVehicle && vm.activeVehicle !== null && !isOnline && (
            <View
              className="mb-3 flex-row items-center"
              testID="driver-home-active-vehicle"
            >
              <View className="mr-3 h-12 w-16 overflow-hidden rounded-lg bg-muted">
                {(vm.activeVehicle.stockPhoto ??
                  vm.activeVehicle.photos.front) !== null && (
                  <Image
                    source={{
                      uri:
                        vm.activeVehicle.stockPhoto ??
                        vm.activeVehicle.photos.front ??
                        '',
                    }}
                    className="h-full w-full"
                    resizeMode={
                      vm.activeVehicle.stockPhoto !== null ? 'contain' : 'cover'
                    }
                  />
                )}
              </View>
              <View className="flex-1">
                <Text className="text-xs text-muted-foreground">
                  Active vehicle
                </Text>
                <Text className="text-sm font-medium text-foreground">
                  {String(vm.activeVehicle.year)} {vm.activeVehicle.make}{' '}
                  {vm.activeVehicle.model}
                </Text>
              </View>
            </View>
          )}

          {isOnline && (
            <View className="mb-3">
              <DriverRideCardStack
                rides={vm.availableRides}
                driverLocation={vm.currentLocation.coordinates}
                onSelectRide={vm.onSelectRide}
              />
            </View>
          )}

          {!vm.noActiveVehicle && (
            <Pressable
              onPress={vm.onToggleOnline}
              disabled={!canToggle}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canToggle }}
              accessibilityLabel={isOnline ? 'Go offline' : 'Go online'}
              className={`items-center rounded-xl px-4 py-4 ${
                !canToggle ? 'bg-muted' : isOnline ? 'bg-muted' : 'bg-primary'
              }`}
              testID="driver-home-online-toggle"
            >
              <Text
                className={`text-base font-semibold ${
                  !canToggle
                    ? 'text-muted-foreground'
                    : isOnline
                      ? 'text-foreground'
                      : 'text-primary-foreground'
                }`}
              >
                {isOnline ? 'Go offline' : 'Go online'}
              </Text>
            </Pressable>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}
