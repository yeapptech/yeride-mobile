import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useUseCases } from '@presentation/di';

/**
 * Phase 4 placeholder for driver mode.
 *
 * The full driver experience (DriverHome, DriverDispatch, DriverMonitor,
 * DriverNavigation, GPS lifecycle) lands in Phase 4. Until then a driver
 * who signs in lands here with a friendly "coming soon" + sign-out CTA.
 */
export default function DriverPlaceholderScreen() {
  const { logOutUser } = useUseCases();

  return (
    <SafeAreaView className="flex-1 bg-background px-6">
      <View className="flex-1 items-center justify-center">
        <Text className="mb-2 text-2xl font-bold text-foreground">
          Driver mode
        </Text>
        <Text className="mb-6 text-center text-sm text-muted-foreground">
          Driver flows land in Phase 4. Until then, you can sign out and
          re-register as a rider to use the app.
        </Text>
        <Pressable
          onPress={() => {
            void logOutUser.execute();
          }}
          className="rounded-lg bg-muted px-6 py-3"
          accessibilityRole="button"
        >
          <Text className="font-semibold text-foreground">Sign out</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
