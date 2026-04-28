import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/**
 * Phase 5 placeholder. Real ride history view lands then.
 */
export default function ActivityPlaceholderScreen() {
  return (
    <SafeAreaView className="flex-1 bg-background px-6">
      <View className="flex-1 items-center justify-center">
        <Text className="mb-2 text-2xl font-bold text-foreground">
          Activity
        </Text>
        <Text className="text-center text-sm text-muted-foreground">
          Your ride history will live here. Lands in Phase 5.
        </Text>
      </View>
    </SafeAreaView>
  );
}
