import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { useUseCases } from '@presentation/di';
import { useCurrentUserQuery } from '@presentation/queries';
import { useSessionStatus } from '@presentation/stores';

import { AuthNavigator } from './AuthNavigator';
import { DriverNavigator } from './DriverNavigator';
import { RiderNavigator } from './RiderNavigator';
import { VerifyEmailNavigator } from './VerifyEmailNavigator';

/**
 * Conditional routing based on session + user-role:
 *
 *   initializing         → splash
 *   unauthenticated      → AuthNavigator
 *   needs-verification   → VerifyEmailNavigator
 *   authenticated +      → RiderNavigator | DriverNavigator
 *     user.role
 *
 * The `useCurrentUserQuery` is enabled only after sign-in (gated on the
 * userId in the session store). While the user doc is loading we render
 * the splash; if the query errors we show a friendly retry plus a sign-out
 * escape hatch so the user is never stuck.
 *
 * Why role-routing lives in RootNavigator and not in MainNavigator: the
 * decision is global and the rider/driver navigators have completely
 * different mount sets. Splitting at the root means each navigator's
 * internal state stays clean across role swaps (rare in practice — the
 * only natural path is sign-out + re-register — but the architecture
 * stays correct).
 */
export function RootNavigator() {
  const status = useSessionStatus();

  if (status === 'initializing') {
    return <SplashScreen />;
  }
  if (status === 'needs-verification') {
    return <VerifyEmailNavigator />;
  }
  if (status === 'unauthenticated') {
    return <AuthNavigator />;
  }
  // status === 'authenticated' — branch on the user doc's role.
  return <AuthenticatedNavigator />;
}

/**
 * Pulls the user's role from `useCurrentUserQuery` and routes to the
 * right navigator. Loading and error states are friendly — the user
 * already authenticated, so we don't bounce them back to AuthNavigator
 * on a transient Firestore hiccup.
 */
function AuthenticatedNavigator() {
  const userQuery = useCurrentUserQuery();

  if (userQuery.isLoading || userQuery.isPending) {
    return <SplashScreen />;
  }

  if (userQuery.isError || !userQuery.data) {
    return <UserLoadErrorScreen onRetry={() => void userQuery.refetch()} />;
  }

  if (userQuery.data.role === 'driver') {
    return <DriverNavigator />;
  }
  return <RiderNavigator />;
}

function SplashScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-background">
      <Text className="text-3xl font-bold text-brand-deep mb-4">
        YeRide Next
      </Text>
      <ActivityIndicator size="large" />
    </View>
  );
}

interface UserLoadErrorScreenProps {
  onRetry: () => void;
}

function UserLoadErrorScreen({ onRetry }: UserLoadErrorScreenProps) {
  const { logOutUser } = useUseCases();
  return (
    <View className="flex-1 items-center justify-center bg-background px-6">
      <Text className="mb-2 text-2xl font-bold text-foreground">
        Couldn't load your profile
      </Text>
      <Text className="mb-6 text-center text-sm text-muted-foreground">
        Check your connection and try again. If this keeps happening, sign out
        and back in.
      </Text>
      <Pressable
        onPress={onRetry}
        className="mb-3 rounded-2xl bg-primary px-6 py-3"
        accessibilityRole="button"
      >
        <Text className="font-semibold text-primary-foreground">Retry</Text>
      </Pressable>
      <Pressable
        onPress={() => {
          void logOutUser.execute();
        }}
        accessibilityRole="button"
      >
        <Text className="text-info">Sign out</Text>
      </Pressable>
    </View>
  );
}
