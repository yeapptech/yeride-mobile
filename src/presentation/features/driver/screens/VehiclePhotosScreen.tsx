import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

import type { DriverStackScreenProps } from '@presentation/navigation/types';

import { VehiclePhotoGrid } from '../components/VehiclePhotoGrid';
import { useVehiclePhotosViewModel } from '../view-models/useVehiclePhotosViewModel';

/**
 * `VehiclePhotosScreen` — five-tile vehicle-photo upload surface. The
 * VM owns all orchestration: per-tile state, picker invocation, upload
 * mutation. The screen is a dumb projection of `vm.state`.
 *
 * Header surfaces year/make/model so the driver knows which vehicle
 * they're attaching photos to. The "Done" button navigates back; uploads
 * are durable so leaving mid-tile-upload is safe (the byVin invalidation
 * persists the URL on the doc and the next mount re-derives `attached`).
 *
 * Empty tiles are allowed — legacy doesn't gate approval on photo
 * completeness. The CTA is always enabled.
 */
export default function VehiclePhotosScreen(
  props: DriverStackScreenProps<'VehiclePhotos'>,
) {
  const vm = useVehiclePhotosViewModel({ vin: props.route.params.vin });
  const { bottom } = useSafeAreaInsets();

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 24 + bottom }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="px-4 pt-2 pb-3">
          <Text className="text-xl font-semibold text-foreground">
            Vehicle photos
          </Text>
          <Text className="mt-1 text-xs text-muted-foreground">
            {summaryFor(vm.state)}
          </Text>
        </View>

        {vm.state.kind === 'loading' && <CenteredSpinner />}

        {vm.state.kind === 'error' && (
          <View
            className="mx-4 rounded-lg border border-error/30 bg-error/10 p-4"
            testID="vehicle-photos-error"
          >
            <Text className="text-sm text-error">
              Couldn&apos;t load this vehicle.
            </Text>
            <Text className="mt-1 text-xs text-muted-foreground">
              {vm.state.error.message}
            </Text>
          </View>
        )}

        {vm.state.kind === 'ready' && (
          <>
            <View className="mx-4 mb-4 rounded-lg border border-info/30 bg-info/10 p-3">
              <Text className="text-xs font-medium text-info">
                Photo guidelines (optional)
              </Text>
              <Text className="mt-1 text-xs text-info">
                Photos help riders identify your vehicle. Empty tiles are
                allowed — you can come back later.
              </Text>
            </View>

            <VehiclePhotoGrid
              tiles={vm.state.tiles}
              onPickPhoto={vm.onPickPhoto}
              onClearError={vm.onClearError}
            />

            <View className="mx-4 mt-2">
              <Pressable
                onPress={vm.onDone}
                disabled={vm.anyUploading}
                accessibilityRole="button"
                accessibilityLabel="Done"
                testID="vehicle-photos-done"
                className={`rounded-xl px-6 py-3 ${
                  vm.anyUploading ? 'bg-primary/50' : 'bg-primary'
                }`}
              >
                <Text className="text-center text-base font-semibold text-primary-foreground">
                  Done
                </Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function summaryFor(
  state: ReturnType<typeof useVehiclePhotosViewModel>['state'],
): string {
  if (state.kind === 'ready') {
    const v = state.vehicle;
    const trim = v.trim ? ` ${v.trim}` : '';
    return `${String(v.year)} ${v.make} ${v.model}${trim}`;
  }
  if (state.kind === 'error') return 'Could not load vehicle';
  return 'Loading…';
}

function CenteredSpinner() {
  return (
    <View className="items-center justify-center py-12">
      <ActivityIndicator size="large" />
    </View>
  );
}
