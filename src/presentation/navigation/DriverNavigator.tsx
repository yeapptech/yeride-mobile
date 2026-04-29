import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { UserProfileScreen } from '@presentation/features/auth/screens/UserProfileScreen';
import DriverDispatchScreen from '@presentation/features/driver/screens/DriverDispatchScreen';
import DriverMonitorScreen from '@presentation/features/driver/screens/DriverMonitorScreen';
import VehicleListScreen from '@presentation/features/driver/screens/VehicleListScreen';
import VehicleRegistrationScreen from '@presentation/features/driver/screens/VehicleRegistrationScreen';

import { DriverTabsNavigator } from './DriverTabsNavigator';
import type { DriverStackParamList } from './types';

/**
 * Native-stack hosting the driver tabs + every modal / pushed screen on
 * top. Registers `DriverTabs`, `UserProfile`, `DriverDispatch`, and
 * `DriverMonitor`. Drivers reach `DriverMonitor` via
 * `navigation.replace` from DriverDispatch on accept; the in-progress
 * redirect on DriverHome also lands here on cold launch.
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
      <Stack.Screen
        name="Vehicles"
        component={VehicleListScreen}
        options={{ title: 'My vehicles' }}
      />
      <Stack.Screen
        name="VehicleRegistration"
        component={VehicleRegistrationScreen}
        options={{ title: 'Register vehicle' }}
      />
    </Stack.Navigator>
  );
}
