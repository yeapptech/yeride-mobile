import { ActivityIndicator, Text, View } from 'react-native';

import { useSessionStatus } from '@presentation/stores';

import { AuthNavigator } from './AuthNavigator';
import { MainNavigator } from './MainNavigator';
import { VerifyEmailNavigator } from './VerifyEmailNavigator';

/**
 * Conditional routing based on session status. The status flips are driven
 * by `AppContent`'s auth listener.
 *
 * `initializing` lasts at most 5 seconds (a safety timeout in `AppContent`
 * forces a fallback to `unauthenticated` if Firestore is unreachable). This
 * matches the legacy app's behavior — see CLAUDE.md "Auth Initialization
 * Flow".
 *
 * `needs-verification` exists between unauthenticated and authenticated:
 * a Firebase user is signed in but `emailVerified` is still false. The user
 * lands on `EmailVerificationScreen` and can either verify (which flips us
 * to authenticated) or "Use a different account" → sign out (which flips us
 * back to unauthenticated). They never reach `MainNavigator` until verified.
 *
 * Note: rendering different navigators based on a flag is the React
 * Navigation idiom for auth-vs-app routing — it lets each navigator have
 * its own independent screen stack and state, and means there's no flash
 * of the auth UI for already-signed-in users.
 */
export function RootNavigator() {
  const status = useSessionStatus();

  if (status === 'initializing') {
    return <SplashScreen />;
  }
  if (status === 'authenticated') {
    return <MainNavigator />;
  }
  if (status === 'needs-verification') {
    return <VerifyEmailNavigator />;
  }
  return <AuthNavigator />;
}

function SplashScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-background">
      <Text className="text-3xl font-bold text-primary mb-4">YeRide Next</Text>
      <ActivityIndicator size="large" />
    </View>
  );
}
