import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import { UserProfileScreen } from '@presentation/features/auth/screens/UserProfileScreen';
import DriverActivityPlaceholderScreen from '@presentation/features/driver/screens/DriverActivityPlaceholderScreen';
import DriverEarningsPlaceholderScreen from '@presentation/features/driver/screens/DriverEarningsPlaceholderScreen';
import DriverHomeScreen from '@presentation/features/driver/screens/DriverHomeScreen';

import type { DriverTabsParamList } from './types';

/**
 * Bottom tabs for the authenticated driver experience. Phase 4 turn 1
 * mounts placeholder screens for Home / Activity / Earnings while reusing
 * the shared `UserProfileScreen` for the Profile tab — same pattern as
 * `RiderTabsNavigator`.
 *
 * Turn 2 replaces `DriverHomePlaceholderScreen` with the real DriverHome
 * (map + ListAvailableRides). The Activity (Phase 5) and Earnings
 * (Phase 6) tabs stay as placeholders until their respective phases land.
 *
 * Tab bar styling intentionally minimal here — visual design is a
 * follow-up turn once the legacy app's tab labels and icon set port
 * cleanly. The focus right now is "the harness works".
 */
const Tabs = createBottomTabNavigator<DriverTabsParamList>();

export function DriverTabsNavigator() {
  return (
    <Tabs.Navigator
      initialRouteName="DriverHome"
      screenOptions={{
        headerShown: false,
        tabBarLabelStyle: { fontSize: 12 },
      }}
    >
      <Tabs.Screen
        name="DriverHome"
        component={DriverHomeScreen}
        options={{ tabBarLabel: 'Home' }}
      />
      <Tabs.Screen
        name="Activity"
        component={DriverActivityPlaceholderScreen}
        options={{ tabBarLabel: 'Activity' }}
      />
      <Tabs.Screen
        name="Earnings"
        component={DriverEarningsPlaceholderScreen}
        options={{ tabBarLabel: 'Earnings' }}
      />
      <Tabs.Screen
        name="Profile"
        component={UserProfileScreen}
        options={{ tabBarLabel: 'Profile' }}
      />
    </Tabs.Navigator>
  );
}
