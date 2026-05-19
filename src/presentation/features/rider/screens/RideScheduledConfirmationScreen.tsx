import { useNavigation } from '@react-navigation/native';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type {
  RiderStackNavigation,
  RiderStackScreenProps,
} from '@presentation/navigation/types';

/**
 * One-way confirmation surface shown after a rider successfully
 * creates a scheduled ride. Stateless port of legacy
 * `yeride/src/rider/screens/RideScheduledConfirmation.js`: ✓ icon,
 * formatted pickup datetime, pickup address, reassurance line, "Got
 * it" button that pops the rider back to `RiderTabs > RiderHome`.
 *
 * No live data subscription — the params arrive pre-formatted from
 * `useRouteSelectViewModel` and the trip is already persisted by the
 * time we mount. If the user backgrounds and re-launches the app,
 * they land on RiderHome (initial route) and the Activity tab's
 * Scheduled section surfaces the same trip — no need to deep-link
 * back to this confirmation surface.
 */
export default function RideScheduledConfirmationScreen({
  route,
}: RiderStackScreenProps<'RideScheduledConfirmation'>) {
  const navigation = useNavigation<RiderStackNavigation>();
  const { formattedSchedulePickupAt, pickupAddress } = route.params;

  const handleDone = (): void => {
    navigation.navigate('RiderTabs', { screen: 'RiderHome' });
  };

  return (
    <SafeAreaView
      className="flex-1 bg-background"
      testID="ride-scheduled-confirmation"
    >
      <View className="flex-1 justify-center px-6">
        <View className="mb-6 items-center">
          <View className="mb-4 h-20 w-20 items-center justify-center rounded-full bg-success/10">
            <Text className="text-4xl text-success">✓</Text>
          </View>
          <Text className="text-2xl font-bold text-foreground">
            Ride Scheduled!
          </Text>
        </View>

        <View className="rounded-2xl border border-border bg-card p-5 dark:bg-card-dark">
          <View className="mb-3 flex-row items-center">
            <Text
              testID="ride-scheduled-confirmation-datetime"
              className="text-base font-medium text-foreground"
            >
              {formattedSchedulePickupAt}
            </Text>
          </View>

          {pickupAddress !== null && (
            <View className="flex-row items-center">
              <Text
                testID="ride-scheduled-confirmation-address"
                className="flex-1 text-base text-muted-foreground"
              >
                {pickupAddress}
              </Text>
            </View>
          )}
        </View>

        <Text className="mt-5 text-center text-sm text-muted-foreground">
          We&apos;ll match you with a driver before your pickup time.
        </Text>
      </View>

      <View className="px-6 pb-6">
        <Pressable
          testID="ride-scheduled-confirmation-done"
          accessibilityRole="button"
          accessibilityLabel="Got it"
          onPress={handleDone}
          className="rounded-lg bg-primary px-6 py-3 active:opacity-80"
        >
          <Text className="text-center text-base font-semibold text-primary-foreground">
            Got it
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
