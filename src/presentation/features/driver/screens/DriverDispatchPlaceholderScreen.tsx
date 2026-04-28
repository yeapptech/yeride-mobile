import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { DriverStackScreenProps } from '@presentation/navigation/types';

/**
 * Phase 4 turn 2 placeholder. Turn 3 replaces this with the real
 * DriverDispatch screen — incoming-ride accept/decline with the
 * pickup-route preview. For Turn 2 we only need the route registered so
 * `DriverHomeScreen`'s ride-card tap navigates somewhere visible.
 */
export default function DriverDispatchPlaceholderScreen({
  route,
}: DriverStackScreenProps<'DriverDispatch'>) {
  const { rideId } = route.params;
  return (
    <SafeAreaView className="flex-1 bg-background px-6">
      <View className="flex-1 items-center justify-center">
        <Text className="mb-2 text-2xl font-bold text-foreground">
          Dispatch
        </Text>
        <Text className="mb-2 text-center text-sm text-muted-foreground">
          Incoming-ride accept/decline flow lands in Phase 4 Turn 3. For now
          this is a route-registration placeholder so DriverHome navigation
          works end-to-end.
        </Text>
        <Text
          className="text-xs text-muted-foreground"
          accessibilityLabel="ride-id"
        >
          rideId: {rideId}
        </Text>
      </View>
    </SafeAreaView>
  );
}
