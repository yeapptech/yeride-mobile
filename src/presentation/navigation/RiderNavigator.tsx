import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { UserProfileScreen } from '@presentation/features/auth/screens/UserProfileScreen';
import AddPaymentMethodScreen from '@presentation/features/rider/screens/AddPaymentMethodScreen';
import RideMonitorScreen from '@presentation/features/rider/screens/RideMonitorScreen';
import RideReceiptScreen from '@presentation/features/rider/screens/RideReceiptScreen';
import RouteSearchScreen from '@presentation/features/rider/screens/RouteSearchScreen';
import RouteSelectScreen from '@presentation/features/rider/screens/RouteSelectScreen';

import { RiderTabsNavigator } from './RiderTabsNavigator';
import type { RiderStackParamList } from './types';

/**
 * Native-stack hosting the rider tabs + every modal / pushed screen on
 * top. Tabs are mounted as a single child (`RiderTabs`); RouteSearch,
 * RouteSelect, RideMonitor, RideReceipt, and the modal UserProfile push
 * over them, hiding the tab bar.
 *
 * `headerBackButtonDisplayMode: 'minimal'` matches the convention used
 * in `AuthNavigator` (legacy `headerBackTitleVisible: false` was
 * removed in React Navigation 7).
 */
const Stack = createNativeStackNavigator<RiderStackParamList>();

export function RiderNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="RiderTabs"
      screenOptions={{
        headerBackButtonDisplayMode: 'minimal',
      }}
    >
      <Stack.Screen
        name="RiderTabs"
        component={RiderTabsNavigator}
        options={{ headerShown: false }}
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
      <Stack.Screen
        name="RideMonitor"
        component={RideMonitorScreen}
        options={{ title: 'Your ride', gestureEnabled: false }}
      />
      <Stack.Screen
        name="RideReceipt"
        component={RideReceiptScreen}
        options={{ title: 'Receipt' }}
      />
      <Stack.Screen
        name="UserProfile"
        component={UserProfileScreen}
        options={{ title: 'Profile' }}
      />
      <Stack.Screen
        name="AddPaymentMethod"
        component={AddPaymentMethodScreen}
        options={{ title: 'Add card', presentation: 'modal' }}
      />
    </Stack.Navigator>
  );
}
