import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

import type { Vehicle } from '@domain/entities/Vehicle';
import {
  VEHICLE_PHOTO_TYPES,
  type VehiclePhotoType,
} from '@domain/entities/VehiclePhotoType';
import type { DriverStackScreenProps } from '@presentation/navigation/types';

import { useVehicleDetailsViewModel } from '../view-models/useVehicleDetailsViewModel';

const PHOTO_LABEL: Readonly<Record<VehiclePhotoType, string>> = {
  front: 'Front',
  back: 'Back',
  left: 'Left',
  right: 'Right',
  interior: 'Interior',
};

/**
 * `VehicleDetailsScreen` — read-only vehicle detail surface. The driver
 * lands here from `VehicleListScreen` (tap a card) and uses the action
 * row to set-active / edit-photos / delete. Editing intrinsic vehicle
 * data (VIN / make / model / year) is intentionally out of scope —
 * legacy supports it but the rewrite goes delete-and-re-register for now.
 *
 * Status badge mirrors `DriverVehicleCard`'s — pending / approved /
 * rejected / suspended / deleted variants, with the `verificationNotes`
 * inline beneath the badge when present (rejection reason).
 *
 * The "Set as active" button is hidden when `canSetActive === false`,
 * which catches both already-active and not-approved cases without
 * needing a separate disabled affordance.
 */
export default function VehicleDetailsScreen(
  props: DriverStackScreenProps<'VehicleDetails'>,
) {
  const vm = useVehicleDetailsViewModel({ vin: props.route.params.vin });
  const { bottom } = useSafeAreaInsets();

  if (vm.state.kind === 'loading') {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size="large" />
      </SafeAreaView>
    );
  }

  if (vm.state.kind === 'error') {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-background px-6">
        <Text className="text-center text-base text-error">
          Couldn&apos;t load this vehicle.
        </Text>
        <Text className="mt-1 text-center text-xs text-muted-foreground">
          {vm.state.error.message}
        </Text>
      </SafeAreaView>
    );
  }

  const { vehicle, isActive, canSetActive } = vm.state;
  const heroUri = vehicle.stockPhoto ?? vehicle.photos.front;
  const label = `${String(vehicle.year)} ${vehicle.make} ${vehicle.model}`;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 + bottom }}>
        {/* Hero image + active badge */}
        <View className="h-48 bg-muted">
          {heroUri !== null && (
            <Image
              source={{ uri: heroUri }}
              className="h-full w-full"
              resizeMode={vehicle.stockPhoto !== null ? 'contain' : 'cover'}
            />
          )}
          {isActive && (
            <View className="absolute right-3 top-3 rounded bg-success/15 px-2 py-0.5">
              <Text
                className="text-xs font-semibold text-success"
                testID="vehicle-details-active-badge"
              >
                ACTIVE
              </Text>
            </View>
          )}
        </View>

        {/* Title + status badge */}
        <View className="px-4 pt-4">
          <Text className="text-2xl font-bold text-foreground">{label}</Text>
          {vehicle.trim !== null && (
            <Text className="text-sm text-muted-foreground">
              {vehicle.trim}
            </Text>
          )}
          <View className="mt-2">
            <StatusBadge status={vehicle.status} />
            {vehicle.verificationNotes !== null &&
              vehicle.status === 'rejected' && (
                <Text className="mt-1 text-xs text-muted-foreground">
                  {vehicle.verificationNotes}
                </Text>
              )}
          </View>
        </View>

        {/* Action row */}
        <View className="mt-4 flex-row gap-3 px-4">
          {canSetActive && (
            <Pressable
              onPress={vm.onSetActive}
              disabled={vm.isMutating}
              accessibilityRole="button"
              testID="vehicle-details-set-active"
              className={`flex-1 rounded-lg py-3 ${
                vm.isMutating ? 'bg-primary/50' : 'bg-primary'
              }`}
            >
              <Text className="text-center font-semibold text-primary-foreground">
                Set as active
              </Text>
            </Pressable>
          )}
          <Pressable
            onPress={vm.onEditPhotos}
            disabled={vm.isMutating}
            accessibilityRole="button"
            testID="vehicle-details-edit-photos"
            className="flex-1 rounded-lg bg-muted py-3"
          >
            <Text className="text-center font-semibold text-foreground">
              {vehicle.photos.front !== null ? 'Update photos' : 'Add photos'}
            </Text>
          </Pressable>
        </View>

        {/* Photo gallery (read-only horizontal scroll) */}
        {hasAnyPhoto(vehicle) && (
          <View className="mt-6 px-4">
            <Text className="mb-2 text-sm font-semibold text-foreground">
              Vehicle photos
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {VEHICLE_PHOTO_TYPES.map((type) => (
                <PhotoTile
                  key={type}
                  label={PHOTO_LABEL[type]}
                  url={vehicle.photos[type]}
                />
              ))}
            </ScrollView>
          </View>
        )}

        {/* Spec section */}
        <View className="mt-6 px-4">
          <Text className="mb-2 text-sm font-semibold text-foreground">
            Vehicle information
          </Text>
          <DetailRow label="VIN" value={String(vehicle.vin)} />
          <DetailRow label="Class" value={vehicle.vehicleClass} />
          {vehicle.bodyClass !== null && (
            <DetailRow label="Body" value={vehicle.bodyClass} />
          )}
          {vehicle.seats !== null && (
            <DetailRow label="Seats" value={String(vehicle.seats)} />
          )}
          {vehicle.doors !== null && (
            <DetailRow label="Doors" value={String(vehicle.doors)} />
          )}
          {vehicle.specs.engine?.fuelType !== undefined && (
            <DetailRow label="Fuel" value={vehicle.specs.engine.fuelType} />
          )}
          {vehicle.specs.transmission?.style !== undefined && (
            <DetailRow
              label="Transmission"
              value={vehicle.specs.transmission.style}
            />
          )}
        </View>

        {/* Eligible-services chips */}
        {vehicle.eligibleServices.length > 0 && (
          <View className="mt-6 px-4">
            <Text className="mb-2 text-sm font-semibold text-foreground">
              Eligible services
            </Text>
            <View className="flex-row flex-wrap">
              {vehicle.eligibleServices.map((service) => (
                <View
                  key={String(service)}
                  className="mb-2 mr-2 rounded bg-info/10 px-3 py-1"
                >
                  <Text className="text-xs capitalize text-info">
                    {String(service)}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Delete (destructive — kept at the bottom) */}
        <View className="mt-8 px-4">
          <Pressable
            onPress={vm.onDelete}
            disabled={vm.isMutating}
            accessibilityRole="button"
            testID="vehicle-details-delete"
            className="self-center"
          >
            <Text className="text-sm text-error">Delete vehicle</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function hasAnyPhoto(vehicle: Vehicle): boolean {
  return VEHICLE_PHOTO_TYPES.some((type) => vehicle.photos[type] !== null);
}

function StatusBadge({ status }: { readonly status: Vehicle['status'] }) {
  const config = (() => {
    switch (status) {
      case 'approved':
        return { label: 'Approved', className: 'bg-success/15 text-success' };
      case 'pending':
        return {
          label: 'Pending review',
          className: 'bg-warning/15 text-warning',
        };
      case 'rejected':
        return { label: 'Rejected', className: 'bg-error/15 text-error' };
      case 'suspended':
        return { label: 'Suspended', className: 'bg-warning/15 text-warning' };
      case 'deleted':
        return {
          label: 'Deleted',
          className: 'bg-muted text-muted-foreground',
        };
    }
  })();
  const split = config.className.split(' ');
  const bg = split[0] ?? '';
  const text = split[1] ?? '';
  return (
    <View className={`self-start rounded ${bg} px-2 py-0.5`}>
      <Text className={`text-xs font-semibold ${text}`}>{config.label}</Text>
    </View>
  );
}

function PhotoTile({
  label,
  url,
}: {
  readonly label: string;
  readonly url: string | null;
}) {
  return (
    <View className="mr-3 w-32">
      <View className="h-24 w-full overflow-hidden rounded-lg bg-muted">
        {url !== null && (
          <Image
            source={{ uri: url }}
            className="h-full w-full"
            resizeMode="cover"
          />
        )}
      </View>
      <Text className="mt-1 text-xs text-muted-foreground">{label}</Text>
    </View>
  );
}

function DetailRow({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <View className="flex-row items-center border-b border-border py-2">
      <Text className="w-28 text-xs text-muted-foreground">{label}</Text>
      <Text className="flex-1 text-sm text-foreground">{value}</Text>
    </View>
  );
}
