import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { HomePlaceholderScreen } from '@presentation/features/auth/screens/HomePlaceholderScreen';
import { UserProfileScreen } from '@presentation/features/auth/screens/UserProfileScreen';

import type { MainStackParamList } from './types';

// Phase 1 placeholder main navigator. Phase 3 will replace this with
// RiderStackNavigator + DriverStackNavigator + role-based switching.
const Stack = createNativeStackNavigator<MainStackParamList>();

export function MainNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="Home"
      screenOptions={{
        headerBackButtonDisplayMode: 'minimal',
      }}
    >
      <Stack.Screen
        name="Home"
        component={HomePlaceholderScreen}
        options={{ title: 'YeRide Next' }}
      />
      <Stack.Screen
        name="UserProfile"
        component={UserProfileScreen}
        options={{ title: 'Profile' }}
      />
    </Stack.Navigator>
  );
}
