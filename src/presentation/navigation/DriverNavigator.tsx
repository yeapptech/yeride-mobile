import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { UserProfileScreen } from '@presentation/features/auth/screens/UserProfileScreen';
import DriverDispatchScreen from '@presentation/features/driver/screens/DriverDispatchScreen';

import { DriverTabsNavigator } from './DriverTabsNavigator';
import type { DriverStackParamList } from './types';

/**
 * Native-stack hosting the driver tabs + every modal / pushed screen on
 * top. Phase 4 turn 1 mounts the tabs and the modal `UserProfile` only
 * (mirrors the rider stack). Later turns push:
 *   - `DriverDispatch` — incoming-ride accept/decline (Turn 3).
 *   - `DriverMonitor`  — active-trip surface (Turns 4a / 4b).
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
        name="UserProfile"
        component={UserProfileScreen}
        options={{ title: 'Profile' }}
      />
    </Stack.Navigator>
  );
}
