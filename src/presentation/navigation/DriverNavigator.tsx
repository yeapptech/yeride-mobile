import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { UserProfileScreen } from '@presentation/features/auth/screens/UserProfileScreen';
import DriverDispatchScreen from '@presentation/features/driver/screens/DriverDispatchScreen';
import DriverMonitorScreen from '@presentation/features/driver/screens/DriverMonitorScreen';

import { DriverTabsNavigator } from './DriverTabsNavigator';
import type { DriverStackParamList } from './types';

/**
 * Native-stack hosting the driver tabs + every modal / pushed screen on
 * top. Phase 4:
 *   - Turn 1: tabs + `UserProfile` modal (mirrors the rider stack).
 *   - Turn 3: `DriverDispatch` (incoming-ride accept/decline).
 *   - Turn 4a: `DriverMonitor` (active-trip surface). Drivers
 *     `navigation.replace` here from DriverDispatch on accept; the
 *     in-progress redirect on DriverHome lands here on cold launch.
 *
 * `headerBackButtonDisplayMode: 'minimal'` matches the convention used in
 * `AuthNavigator` and `RiderNavigator` (legacy `headerBackTitleVisible:
 * false` was removed in React Navigation 7).
 */
const Stack = createNativeStackNavigator<DriverStackParamList>();

export function DriverNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="DriverTabs"
      screenOptions={{
        headerBackButtonDisplayMode: 'minimal',
      }}
    >
      <Stack.Screen
        name="DriverTabs"
        component={DriverTabsNavigator}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="DriverDispatch"
        component={DriverDispatchScreen}
        options={{ title: 'Incoming ride' }}
      />
      <Stack.Screen
        name="DriverMonitor"
        component={DriverMonitorScreen}
        options={{ title: 'Active ride', headerBackVisible: false }}
      />
      <Stack.Screen
        name="UserProfile"
        component={UserProfileScreen}
        options={{ title: 'Profile' }}
      />
    </Stack.Navigator>
  );
}
