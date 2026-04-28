import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { RiderStackScreenProps } from '@presentation/navigation/types';

/**
 * Phase 3 turn 3 placeholder. Turn 3.5 replaces this with the real
 * RideReceipt: route polyline, fare breakdown, charged-card last-4,
 * "Email receipt" stub. For turn 3.3 it just confirms the navigation
 * landed correctly.
 */
export default function RideReceiptScreen({
  route,
  navigation,
}: RiderStackScreenProps<'RideReceipt'>) {
  const { rideId } = route.params;

  return (
    <SafeAreaView className="flex-1 bg-background px-6" edges={['top']}>
      <View className="flex-1 items-center justify-center">
        <Text className="mb-2 text-2xl font-bold text-foreground">Receipt</Text>
        <Text className="mb-4 text-center text-sm text-muted-foreground">
          Phase 3 turn 3 placeholder. Real receipt lands in turn 3.5.
        </Text>
        <Text
          className="mb-6 text-center text-xs text-muted-foreground"
          numberOfLines={1}
          ellipsizeMode="middle"
          testID="ride-receipt-id"
        >
          {rideId}
        </Text>

        <Pressable
          onPress={() => navigation.popToTop()}
          className="rounded-lg bg-primary px-6 py-3"
          accessibilityRole="button"
        >
          <Text className="font-semibold text-primary-foreground">Done</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
