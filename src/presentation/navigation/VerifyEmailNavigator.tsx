import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { EmailVerificationScreen } from '@presentation/features/auth/screens/EmailVerificationScreen';

import type { VerifyEmailStackParamList } from './types';

// Single-screen native stack mounted by `RootNavigator` when session status
// is 'needs-verification'. We use a stack (not just the bare screen) so the
// screen gets the standard SafeArea + header treatment and so future
// "view-our-email-tips" or "trouble verifying?" sub-screens can land on
// top without a refactor.
const Stack = createNativeStackNavigator<VerifyEmailStackParamList>();

export function VerifyEmailNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="EmailVerification"
      screenOptions={{
        headerShown: false,
        headerBackButtonDisplayMode: 'minimal',
      }}
    >
      <Stack.Screen
        name="EmailVerification"
        component={EmailVerificationScreen}
      />
    </Stack.Navigator>
  );
}
