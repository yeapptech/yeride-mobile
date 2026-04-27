import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { ForgotPasswordScreen } from '@presentation/features/auth/screens/ForgotPasswordScreen';
import { LogInScreen } from '@presentation/features/auth/screens/LogInScreen';
import { RegisterScreen } from '@presentation/features/auth/screens/RegisterScreen';

import type { AuthStackParamList } from './types';

// IMPORTANT: createNativeStackNavigator() at module scope, not inside the
// component body — see CLAUDE.md (legacy) "Double screen render" troubleshooting.
const Stack = createNativeStackNavigator<AuthStackParamList>();

export function AuthNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="LogIn"
      screenOptions={{
        headerShown: false,
        headerBackButtonDisplayMode: 'minimal',
      }}
    >
      <Stack.Screen name="LogIn" component={LogInScreen} />
      <Stack.Screen name="Register" component={RegisterScreen} />
      <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
    </Stack.Navigator>
  );
}
