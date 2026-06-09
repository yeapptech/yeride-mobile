import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import { UserProfileScreen } from '@presentation/features/auth/screens/UserProfileScreen';
import ActivityScreen from '@presentation/features/rider/screens/ActivityScreen';
import RiderHomeScreen from '@presentation/features/rider/screens/RiderHomeScreen';
import WalletScreen from '@presentation/features/rider/screens/WalletScreen';

import type { RiderTabsParamList } from './types';

/**
 * Bottom tabs for the authenticated rider experience. Active and scheduled
 * rides surface as a list on RiderHome (see `HomeRideSections`), so there
 * is no persistent banner above the tabs.
 *
 * Tab bar styling intentionally minimal — visual design iterates in a
 * later turn.
 */
const Tabs = createBottomTabNavigator<RiderTabsParamList>();

export function RiderTabsNavigator() {
  return (
    <Tabs.Navigator
      initialRouteName="RiderHome"
      screenOptions={{
        headerShown: false,
        tabBarLabelStyle: { fontSize: 12 },
      }}
    >
      <Tabs.Screen
        name="RiderHome"
        component={RiderHomeScreen}
        options={{ tabBarLabel: 'Home' }}
      />
      <Tabs.Screen
        name="Activity"
        component={ActivityScreen}
        options={{ tabBarLabel: 'Activity' }}
      />
      <Tabs.Screen
        name="Wallet"
        component={WalletScreen}
        options={{ tabBarLabel: 'Wallet' }}
      />
      <Tabs.Screen
        name="Profile"
        component={UserProfileScreen}
        options={{ tabBarLabel: 'Profile' }}
      />
    </Tabs.Navigator>
  );
}
