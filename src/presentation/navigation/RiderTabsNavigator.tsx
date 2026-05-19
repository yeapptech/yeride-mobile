import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import { UserProfileScreen } from '@presentation/features/auth/screens/UserProfileScreen';
import ActivityScreen from '@presentation/features/rider/screens/ActivityScreen';
import RiderHomeScreen from '@presentation/features/rider/screens/RiderHomeScreen';
import WalletScreen from '@presentation/features/rider/screens/WalletScreen';

import type { RiderTabsParamList } from './types';

/**
 * Bottom tabs for the authenticated rider experience. Phase 10 Turn 6
 * promotes `Activity` from placeholder to the real screen — recent-
 * rides list with status-aware navigation. `Wallet` is real since
 * Phase 6 Turn 3; `Home` and `Profile` have been real since Phase 3.
 *
 * Tab bar styling intentionally minimal — we'll iterate visual design in
 * a later turn once the legacy app's tab labels and icon set port
 * cleanly. For now the focus is "the harness works".
 */
const Tabs = createBottomTabNavigator<RiderTabsParamList>();

export function RiderTabsNavigator() {
  return (
    <Tabs.Navigator
      initialRouteName="RiderHome"
      screenOptions={{
        headerShown: false,
        // Native-stack-style icons + labels stylized in a follow-up turn.
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
