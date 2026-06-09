import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import { UserProfileScreen } from '@presentation/features/auth/screens/UserProfileScreen';
import DriverActivityScreen from '@presentation/features/driver/screens/DriverActivityScreen';
import DriverEarningsScreen from '@presentation/features/driver/screens/DriverEarningsScreen';
import DriverHomeScreen from '@presentation/features/driver/screens/DriverHomeScreen';

import type { DriverTabsParamList } from './types';

/**
 * Bottom tabs for the authenticated driver experience. Active rides surface
 * as a list on DriverHome (see `HomeRideSections`), so there is no
 * persistent banner above the tabs.
 *
 * Tab bar styling intentionally minimal — visual design iterates in a
 * later turn.
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
        component={DriverActivityScreen}
        options={{ tabBarLabel: 'Activity' }}
      />
      <Tabs.Screen
        name="Earnings"
        component={DriverEarningsScreen}
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
