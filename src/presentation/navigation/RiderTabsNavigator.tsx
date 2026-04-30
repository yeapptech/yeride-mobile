import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import { UserProfileScreen } from '@presentation/features/auth/screens/UserProfileScreen';
import ActivityPlaceholderScreen from '@presentation/features/rider/screens/ActivityPlaceholderScreen';
import RiderHomeScreen from '@presentation/features/rider/screens/RiderHomeScreen';
import WalletScreen from '@presentation/features/rider/screens/WalletScreen';

import type { RiderTabsParamList } from './types';

/**
 * Bottom tabs for the authenticated rider experience. Phase 6 turn 3
 * promotes `Wallet` from placeholder to the real screen; `Activity` is
 * still a Phase 5 placeholder pending the rider Activity surface.
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
        component={ActivityPlaceholderScreen}
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
