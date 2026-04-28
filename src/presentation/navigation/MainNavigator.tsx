import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { HomePlaceholderScreen } from '@presentation/features/auth/screens/HomePlaceholderScreen';
import { UserProfileScreen } from '@presentation/features/auth/screens/UserProfileScreen';
import RouteSearchScreen from '@presentation/features/rider/screens/RouteSearchScreen';
import RouteSelectScreen from '@presentation/features/rider/screens/RouteSelectScreen';

import type { MainStackParamList } from './types';

// Phase 1 placeholder main navigator. Phase 3 turn 3 will replace it with
// the full RiderTabsNavigator + DriverNavigator role-based switch. Turn 3.2
// extends the placeholder with RouteSearch + RouteSelect so the rider flow
// is reachable end-to-end against seeded data.
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
      <Stack.Screen
        name="RouteSearch"
        component={RouteSearchScreen}
        options={{ title: 'Where to?' }}
      />
      <Stack.Screen
        name="RouteSelect"
        component={RouteSelectScreen}
        options={{ title: 'Choose your ride' }}
      />
    </Stack.Navigator>
  );
}
