import { createNativeStackNavigator } from '@react-navigation/native-stack';

import DriverPlaceholderScreen from '@presentation/features/driver/screens/DriverPlaceholderScreen';

import type { DriverStackParamList } from './types';

/**
 * Phase 3 turn 3 driver shell — a single placeholder screen. Phase 4
 * replaces this with DriverTabs (Home / Activity / Earnings / Profile)
 * + DriverDispatch / DriverMonitor / DriverNavigation modals.
 */
const Stack = createNativeStackNavigator<DriverStackParamList>();

export function DriverNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerBackButtonDisplayMode: 'minimal' }}>
      <Stack.Screen
        name="DriverPlaceholder"
        component={DriverPlaceholderScreen}
        options={{ title: 'YeRide Next' }}
      />
    </Stack.Navigator>
  );
}
