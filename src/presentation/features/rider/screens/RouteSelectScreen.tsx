import { useNavigation } from '@react-navigation/native';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  Map,
  type MapMarkerProps,
  type MapRoute,
} from '@presentation/components/map';
import {
  EndpointSummary,
  RideServicesList,
  RouteSelector,
} from '@presentation/components/route';
import { ScheduleDatetimePicker } from '@presentation/components/trip/ScheduleDatetimePicker';
import { Button } from '@presentation/components/ui/Button';
import type { RiderStackNavigation } from '@presentation/navigation/types';

import { useRouteSelectViewModel } from '../view-models/useRouteSelectViewModel';

/**
 * RouteSelectScreen — top half map (current pickup + dropoff + route
 * alternatives), bottom half scrollable card with:
 *   - pickup/dropoff summary
 *   - avoid-tolls toggle
 *   - horizontal route alternative selector
 *   - vertical ride-service tier list with fare estimates
 *   - Confirm button (turn 3.2 just routes back; turn 3.3 calls CreateRide)
 *
 * Loading + error states are hoisted into a single status banner above the
 * scroll content so the layout doesn't jump when transitions happen.
 */
export default function RouteSelectScreen() {
  const vm = useRouteSelectViewModel();
  const navigation = useNavigation<RiderStackNavigation>();
  const [pickerVisible, setPickerVisible] = useState<boolean>(false);

  const initialRegion = vm.pickup
    ? {
        latitude: vm.pickup.location.latitude,
        longitude: vm.pickup.location.longitude,
        latitudeDelta: 0.1,
        longitudeDelta: 0.1,
      }
    : null;

  const pickupMarker: MapMarkerProps | null = vm.pickup
    ? { coordinates: vm.pickup.location, title: 'Pickup' }
    : null;
  const dropoffMarker: MapMarkerProps | null = vm.dropoff
    ? { coordinates: vm.dropoff.location, title: 'Dropoff' }
    : null;

  const selectedRouteForMap: MapRoute | null = vm.selectedRoute
    ? {
        id: vm.selectedRoute.routeToken || 'selected',
        encodedPolyline: vm.selectedRoute.encodedPolyline,
      }
    : null;

  const alternativeRoutesForMap: readonly MapRoute[] = vm.routes
    .map((route, index) =>
      index === vm.selectedRouteIndex
        ? null
        : {
            id: route.routeToken || `alt-${String(index)}`,
            encodedPolyline: route.encodedPolyline,
          },
    )
    .filter((m): m is MapRoute => m !== null);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <View className="flex-1">
        <View style={{ height: '40%' }}>
          <Map
            initialRegion={initialRegion}
            pickup={pickupMarker}
            dropoff={dropoffMarker}
            driver={null}
            selectedRoute={selectedRouteForMap}
            pickupRoute={null}
            alternativeRoutes={alternativeRoutesForMap}
          />
        </View>

        <ScrollView
          className="flex-1 bg-background"
          keyboardShouldPersistTaps="handled"
        >
          <View className="px-4 pt-3">
            <EndpointSummary endpoint={vm.pickup} kind="pickup" />
            <EndpointSummary endpoint={vm.dropoff} kind="dropoff" />
          </View>

          <View className="flex-row items-center justify-between px-4 py-3">
            <View>
              <Text className="text-sm font-medium text-foreground">
                Avoid tolls
              </Text>
              <Text className="text-xs text-muted-foreground">
                Re-fetches route options.
              </Text>
            </View>
            <Switch
              value={vm.avoidTolls}
              onValueChange={vm.setAvoidTolls}
              testID="avoid-tolls-switch"
            />
          </View>

          {vm.status === 'loading' && (
            <View
              className="mx-4 my-3 flex-row items-center gap-2 rounded-lg bg-muted/30 px-3 py-2"
              testID="route-loading-banner"
            >
              <ActivityIndicator size="small" />
              <Text className="text-sm text-muted-foreground">
                Computing routes…
              </Text>
            </View>
          )}

          {vm.status === 'error' && (
            <View
              className="mx-4 my-3 rounded-lg bg-error/10 p-3"
              testID="route-error-banner"
            >
              <Text className="mb-2 text-sm text-error">
                {vm.error ?? 'Unknown error'}
              </Text>
              <Pressable
                onPress={vm.retry}
                className="self-start rounded-md bg-error/20 px-3 py-1"
                accessibilityRole="button"
              >
                <Text className="text-sm font-medium text-error">
                  Try again
                </Text>
              </Pressable>
            </View>
          )}

          {vm.routes.length > 0 && (
            <View>
              <Text className="px-4 pt-2 text-xs uppercase text-muted-foreground">
                Route options
              </Text>
              <RouteSelector
                routes={vm.routes}
                selectedIndex={vm.selectedRouteIndex}
                onSelect={vm.selectRoute}
              />
            </View>
          )}

          <View>
            <Text className="px-4 pt-2 text-xs uppercase text-muted-foreground">
              Ride options
            </Text>
            <RideServicesList
              services={vm.services}
              selectedId={vm.selectedRideServiceId}
              fareById={vm.fareById}
              onSelect={vm.selectRideService}
            />
          </View>

          {/*
            Schedule-pickup row (Phase 10 turn 7). When no schedule is
            set the row prompts the rider to pick a future time; when set
            it shows the formatted datetime + a Clear control. Tap opens
            ScheduleDatetimePicker.
          */}
          <View className="border-t border-border px-4 pt-4">
            <Pressable
              testID="route-select-schedule-row"
              accessibilityRole="button"
              accessibilityLabel={
                vm.scheduledPickupAt
                  ? `Scheduled for ${vm.formattedSchedulePickupAt ?? ''}`
                  : 'Schedule pickup for later'
              }
              onPress={() => setPickerVisible(true)}
              className="flex-row items-center justify-between rounded-lg bg-muted/40 p-3"
            >
              <Text className="text-base font-medium text-foreground">
                {vm.scheduledPickupAt
                  ? vm.formattedSchedulePickupAt
                  : 'Schedule pickup for later'}
              </Text>
              {vm.scheduledPickupAt && (
                <Pressable
                  testID="route-select-schedule-clear"
                  accessibilityRole="button"
                  accessibilityLabel="Clear scheduled pickup"
                  onPress={() => vm.setScheduledPickupAt(null)}
                  hitSlop={12}
                >
                  <Text className="text-sm font-medium text-muted-foreground">
                    Clear
                  </Text>
                </Pressable>
              )}
            </Pressable>
          </View>
        </ScrollView>

        <View className="border-t border-border px-4 py-3">
          {vm.submitError && (
            <Text
              className="mb-2 text-center text-sm text-error"
              testID="route-select-submit-error"
            >
              {vm.submitError}
            </Text>
          )}
          <Button
            label={vm.scheduledPickupAt ? 'Schedule ride' : 'Confirm ride'}
            onPress={() => {
              void (async () => {
                const result = await vm.confirm();
                if (!result) return;
                if (result.isScheduled) {
                  // `confirm()` returns the formatted datetime + pickup
                  // address inline on the scheduled branch, snapshotted
                  // before `reset()` clears the trip-draft store. Reads
                  // from the typed result — no stale-closure trick over
                  // `vm.*` that would resolve to null after the mutation
                  // settled.
                  navigation.replace('RideScheduledConfirmation', {
                    formattedSchedulePickupAt: result.formattedSchedulePickupAt,
                    pickupAddress: result.pickupAddress,
                  });
                } else {
                  navigation.replace('RideMonitor', {
                    rideId: String(result.rideId),
                  });
                }
              })();
            }}
            disabled={!vm.canConfirm}
            loading={vm.isSubmitting}
            testID="route-select-confirm"
          />
        </View>

        <ScheduleDatetimePicker
          visible={pickerVisible}
          initialDate={vm.scheduledPickupAt ?? new Date()}
          onClose={() => setPickerVisible(false)}
          onSchedule={(date) => {
            vm.setScheduledPickupAt(date);
          }}
        />
      </View>
    </SafeAreaView>
  );
}
