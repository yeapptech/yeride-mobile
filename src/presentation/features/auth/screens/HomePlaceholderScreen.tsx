import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useUseCases } from '@presentation/di';
import type { MainStackScreenProps } from '@presentation/navigation/types';

/**
 * Phase 1 placeholder for the home screen. Real rider/driver tab navigators
 * land in Phase 3+. This screen exists so a signed-in user has somewhere to
 * land and a way to reach UserProfile + sign out.
 */
export function HomePlaceholderScreen({
  navigation,
}: MainStackScreenProps<'Home'>) {
  const { logOutUser } = useUseCases();

  return (
    <SafeAreaView className="flex-1 bg-background px-6">
      <View className="flex-1 items-center justify-center">
        <Text className="text-3xl font-bold text-primary mb-2">
          You're signed in
        </Text>
        <Text className="text-base text-muted-foreground mb-8 text-center">
          Phase 3 placeholder home. Full RiderTabsNavigator + DriverNavigator
          land in turn 3.3.
        </Text>

        <Pressable
          onPress={() => {
            navigation.navigate('RouteSearch');
          }}
          className="bg-primary rounded-lg px-6 py-3 mb-3 active:opacity-70"
          testID="open-route-search"
        >
          <Text className="text-primary-foreground font-semibold">
            Plan a ride
          </Text>
        </Pressable>

        <Pressable
          onPress={() => {
            navigation.navigate('UserProfile');
          }}
          className="bg-muted rounded-lg px-6 py-3 mb-4 active:opacity-70"
        >
          <Text className="font-semibold text-foreground">Edit profile</Text>
        </Pressable>

        <Pressable
          onPress={() => {
            void logOutUser.execute();
          }}
        >
          <Text className="text-info text-sm">Sign out</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
