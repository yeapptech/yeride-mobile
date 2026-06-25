import { Image, Pressable, Text, View } from 'react-native';

import type { Vehicle } from '@domain/entities/Vehicle';
import type { Vin } from '@domain/entities/Vin';

interface DriverVehicleCardProps {
  readonly vehicle: Vehicle;
  readonly isActive: boolean;
  readonly onSelect: (vin: Vin) => void;
  readonly onDelete: (vin: Vin, vehicleLabel: string) => void;
}

/**
 * Vehicle row card for `VehicleListScreen`. Shows the stock photo when
 * NHTSA returned one (or the front uploaded photo as a fallback), the
 * year/make/model line, status badge, ACTIVE indicator, eligible-services
 * chips, and a trash button on the right.
 *
 * Interactions (Phase 5 turn 4):
 *   - Tapping the card body navigates to `VehicleDetails` (set-active
 *     happens there). The active highlight is informational only.
 *   - Tapping the trash icon dispatches `onDelete(vin, label)`. The parent
 *     view-model wraps that in an `Alert.alert` confirmation.
 *
 * Styling uses the design-token palette (`bg-card`, `text-primary`, etc.)
 * — no raw hex except where Tailwind doesn't reach.
 */
export function DriverVehicleCard({
  vehicle,
  isActive,
  onSelect,
  onDelete,
}: DriverVehicleCardProps) {
  const label = `${String(vehicle.year)} ${vehicle.make} ${vehicle.model}`;
  const photoUri = vehicle.stockPhoto ?? vehicle.photos.front;

  return (
    <Pressable
      onPress={() => onSelect(vehicle.vin)}
      accessibilityRole="button"
      accessibilityLabel={`Vehicle ${label}`}
      accessibilityState={{ selected: isActive }}
      testID={`vehicle-card-${String(vehicle.vin)}`}
      className={`mb-3 rounded-2xl bg-card p-4 ${
        isActive ? 'border-2 border-primary' : 'border border-border'
      }`}
    >
      <View className="flex-row">
        {/* Photo / placeholder. */}
        <View className="mr-4 h-20 w-20 overflow-hidden rounded-lg bg-muted">
          {photoUri !== null && (
            <Image
              source={{ uri: photoUri }}
              className="h-full w-full"
              resizeMode={vehicle.stockPhoto !== null ? 'contain' : 'cover'}
            />
          )}
        </View>

        <View className="flex-1">
          <View className="flex-row items-center justify-between">
            <Text className="text-base font-semibold text-foreground">
              {label}
            </Text>
            {isActive && (
              <View className="rounded-full bg-honey px-2 py-0.5">
                <Text className="text-[10px] font-bold uppercase text-honey-foreground">
                  Active
                </Text>
              </View>
            )}
          </View>

          {(vehicle.trim ?? vehicle.bodyClass) !== null && (
            <Text className="mt-0.5 text-xs text-muted-foreground">
              {vehicle.trim ?? vehicle.bodyClass}
            </Text>
          )}

          <View className="mt-1 flex-row items-center">
            <StatusBadge status={vehicle.status} />
            {vehicle.verificationNotes !== null &&
              vehicle.status === 'rejected' && (
                <Text className="ml-2 text-xs text-muted-foreground">
                  ({vehicle.verificationNotes})
                </Text>
              )}
          </View>

          {vehicle.eligibleServices.length > 0 && (
            <View className="mt-2 flex-row flex-wrap">
              {vehicle.eligibleServices.map((service) => (
                <View
                  key={String(service)}
                  className="mb-1 mr-1 rounded bg-muted px-2 py-0.5"
                >
                  <Text className="text-[10px] text-muted-foreground">
                    {String(service)}
                  </Text>
                </View>
              ))}
            </View>
          )}

          <View className="mt-2 flex-row items-center justify-end">
            <Pressable
              onPress={() => onDelete(vehicle.vin, label)}
              accessibilityRole="button"
              accessibilityLabel={`Delete ${label}`}
              testID={`vehicle-card-delete-${String(vehicle.vin)}`}
              className="px-2 py-1"
              hitSlop={8}
            >
              <Text className="text-sm font-medium text-error">Delete</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

function StatusBadge({ status }: { readonly status: Vehicle['status'] }) {
  const { label, className } = (() => {
    switch (status) {
      case 'approved':
        return { label: 'Approved', className: 'text-success' };
      case 'pending':
        return { label: 'Pending', className: 'text-warning' };
      case 'rejected':
        return { label: 'Rejected', className: 'text-error' };
      case 'suspended':
        return { label: 'Suspended', className: 'text-warning' };
      case 'deleted':
        return { label: 'Deleted', className: 'text-muted-foreground' };
    }
  })();
  return <Text className={`text-xs capitalize ${className}`}>{label}</Text>;
}
