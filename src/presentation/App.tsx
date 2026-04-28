import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

import { AppContent } from './AppContent';
import { ContainerProvider } from './di';
import { RootNavigator } from './navigation/RootNavigator';

/**
 * Application root.
 *
 *   GestureHandlerRootView         ← required for react-native-gesture-handler
 *     SafeAreaProvider             ← provides safe-area insets
 *       QueryClientProvider        ← TanStack Query for server cache (Phase 2+)
 *         ContainerProvider        ← DI container (use cases)
 *           AppContent             ← auth listener + session bootstrapping
 *             NavigationContainer  ← React Navigation
 *               RootNavigator      ← conditional auth/main routing
 *
 * NativeWind's metro plugin wires `global.css` automatically — no
 * side-effect import needed here.
 *
 * Stripe + ErrorBoundary + Theme providers slot in here in later phases.
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

export function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
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
      </SafeAreaProvider>
      {/* Toast lives at the root so it floats over every screen +
          navigator. Phase 3 turn 4b uses it for the chat stub; Phase 4+
          will use it for GPS-permission nudges and similar transient
          banners. */}
      <Toast />
    </GestureHandlerRootView>
  );
}
