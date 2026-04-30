import { NavigationContainer } from '@react-navigation/native';
import { StripeProvider } from '@stripe/stripe-react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import type { ReactElement } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

import { getStripePublishableKey } from '@shared/env';
import { LOG } from '@shared/logger';

import { AppContent } from './AppContent';
import { ContainerProvider } from './di';
import { RootNavigator } from './navigation/RootNavigator';

/**
 * Application root.
 *
 *   GestureHandlerRootView         ← required for react-native-gesture-handler
 *     SafeAreaProvider             ← provides safe-area insets
 *       MaybeStripeProvider        ← Stripe context (Phase 6 turn 3); only when
 *                                    a publishable key is configured. The Wallet
 *                                    view-model handles the unconfigured state.
 *         QueryClientProvider      ← TanStack Query for server cache
 *           ContainerProvider      ← DI container (use cases)
 *             AppContent           ← auth listener + session bootstrapping
 *               NavigationContainer ← React Navigation
 *                 RootNavigator    ← conditional auth/main routing
 *
 * `<StripeProvider/>` is mounted ABOVE `<ContainerProvider/>` so
 * `useStripe()` is callable from any screen — the Phase 6 turn 4 Connect
 * onboarding may need it from outside the Wallet flow. When no
 * publishable key is configured we skip the provider entirely and log a
 * loud warn at boot.
 *
 * NativeWind's metro plugin wires `global.css` automatically — no
 * side-effect import needed here.
 */

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Phase 3 will revisit persistence per REFACTOR_PLAN.md §7 Decision 3.
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const logger = LOG.extend('APP');

/**
 * Conditional `<StripeProvider/>` wrapper. Mounts the provider when a
 * publishable key is configured; renders children naked otherwise (the
 * Wallet VM degrades to `'unconfigured'` and the rest of the app is
 * unaffected).
 *
 * Reading the key at module scope rather than inside the component keeps
 * the provider stable across renders. The key is bake-time-resolved; it
 * doesn't change at runtime.
 */
const stripePublishableKey = getStripePublishableKey();
if (stripePublishableKey === null) {
  logger.warn(
    'STRIPE_PUBLISHABLE_KEY not configured — <StripeProvider/> not mounted. ' +
      'Wallet / payment flows will surface an unconfigured state.',
  );
}

function MaybeStripeProvider({
  children,
}: {
  children: ReactElement;
}): ReactElement {
  if (stripePublishableKey === null) return children;
  return (
    <StripeProvider publishableKey={stripePublishableKey}>
      {children}
    </StripeProvider>
  );
}

export function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <MaybeStripeProvider>
          <QueryClientProvider client={queryClient}>
            <ContainerProvider>
              <AppContent>
                <NavigationContainer>
                  <StatusBar style="auto" />
                  <RootNavigator />
                </NavigationContainer>
              </AppContent>
            </ContainerProvider>
          </QueryClientProvider>
        </MaybeStripeProvider>
      </SafeAreaProvider>
      {/* Toast lives at the root so it floats over every screen +
          navigator. Phase 3 turn 4b uses it for the chat stub; Phase 4+
          will use it for GPS-permission nudges and similar transient
          banners. */}
      <Toast />
    </GestureHandlerRootView>
  );
}
