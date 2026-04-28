import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { RiderStackScreenProps } from '@presentation/navigation/types';

/**
 * Phase 3 turn 3 placeholder. Turn 3.4a replaces this with the real
 * RideMonitor: top map, bottom-sheet harness, status-router that
 * dispatches to AwaitingDriverView / DispatchedView / StartedView /
 * CompletedView / PaymentFailedView.
 *
 * Turn 3.3 ships only this stub so the navigation chain is reachable
 * end-to-end (RouteSelect → CreateRide → RideMonitor) and a real ride
 * doc lands in Firestore against the seeded driver flow.
 */
export default function RideMonitorScreen({
  route,
  navigation,
}: RiderStackScreenProps<'RideMonitor'>) {
  const { rideId } = route.params;

  return (
    <SafeAreaView className="flex-1 bg-background px-6" edges={['top']}>
      <View className="flex-1 items-center justify-center">
        <Text className="mb-2 text-2xl font-bold text-foreground">
          Ride created
        </Text>
        <Text className="mb-4 text-center text-sm text-muted-foreground">
          Phase 3 turn 3 placeholder. Live map + status views land in turn 3.4.
          Your ride doc:
        </Text>
        <Text
          className="mb-6 text-center text-xs text-muted-foreground"
          numberOfLines={1}
          ellipsizeMode="middle"
          testID="ride-monitor-id"
        >
          {rideId}
        </Text>

        <Pressable
          onPress={() => navigation.replace('RideReceipt', { rideId })}
          className="mb-3 rounded-lg bg-muted px-6 py-3"
          accessibilityRole="button"
        >
          <Text className="font-semibold text-foreground">
            Skip to receipt (preview)
          </Text>
        </Pressable>
        <Pressable
          onPress={() => navigation.popToTop()}
          accessibilityRole="button"
        >
          <Text className="text-info">Back to home</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
