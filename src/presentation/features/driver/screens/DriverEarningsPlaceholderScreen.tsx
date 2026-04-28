import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/**
 * Phase 6 placeholder. Real earnings (Stripe Connect balance + payouts)
 * lands then.
 */
export default function DriverEarningsPlaceholderScreen() {
  return (
    <SafeAreaView className="flex-1 bg-background px-6">
      <View className="flex-1 items-center justify-center">
        <Text className="mb-2 text-2xl font-bold text-foreground">
          Earnings
        </Text>
        <Text className="text-center text-sm text-muted-foreground">
          Your Stripe Connect balance and payouts will live here. Lands in Phase
          6.
        </Text>
      </View>
    </SafeAreaView>
  );
}
