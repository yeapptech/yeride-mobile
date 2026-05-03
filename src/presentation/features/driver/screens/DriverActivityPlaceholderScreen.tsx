import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DevToolsSection } from '@presentation/components/dev/DevToolsSection';

/**
 * Phase 5 placeholder. Real driver ride history lands then.
 *
 * Phase 9 turn 3 sub-turn 3c: hosts the dev-only `<DevToolsSection/>`
 * (Crashlytics smoke entry points). The section renders nothing in
 * production builds, so the placeholder behavior is unchanged for
 * end users.
 */
export default function DriverActivityPlaceholderScreen() {
  return (
    <SafeAreaView className="flex-1 bg-background px-6">
      <ScrollView contentContainerClassName="flex-grow">
        <View className="flex-1 items-center justify-center py-8">
          <Text className="mb-2 text-2xl font-bold text-foreground">
            Activity
          </Text>
          <Text className="text-center text-sm text-muted-foreground">
            Your completed trips will live here. Lands in Phase 5.
          </Text>
        </View>
        <DevToolsSection />
      </ScrollView>
    </SafeAreaView>
  );
}
