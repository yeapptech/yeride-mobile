import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/**
 * @deprecated Phase 6 turn 4 shipped `DriverEarningsScreen.tsx` —
 * `DriverTabsNavigator` no longer mounts this placeholder. The file is
 * retained as a deprecation stub because the sandbox virtiofs blocks
 * `unlink()`; safe to remove in any non-sandbox checkout. Don't import
 * this from new code.
 */
export default function DriverEarningsPlaceholderScreen() {
  return (
    <SafeAreaView className="flex-1 bg-background px-6">
      <View className="flex-1 items-center justify-center">
        <Text className="mb-2 text-2xl font-bold text-foreground">
          Earnings
        </Text>
        <Text className="text-center text-sm text-muted-foreground">
          Deprecated placeholder — see DriverEarningsScreen.tsx (Phase 6 turn
          4).
        </Text>
      </View>
    </SafeAreaView>
  );
}
