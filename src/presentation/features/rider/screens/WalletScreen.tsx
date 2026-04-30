import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { WalletCardRow } from '../components/WalletCardRow';
import { useWalletViewModel } from '../view-models/useWalletViewModel';

/**
 * Rider Wallet tab. Replaces `WalletPlaceholderScreen` from Phase 3.
 *
 * The screen is dumb — `useWalletViewModel` does all the orchestration.
 * Each tagged-union arm renders a different layout:
 *   `unconfigured` — loud error block (rare; means an op set up the
 *                    build without `STRIPE_PUBLISHABLE_KEY`).
 *   `loading`      — centred spinner.
 *   `no_customer`  — empty state + Add card CTA.
 *   `empty`        — same empty state but with pull-to-refresh.
 *   `ready`        — FlatList of `WalletCardRow` rows, header with "Add
 *                    card" affordance, pull-to-refresh.
 *   `error`        — error block with Retry CTA.
 */

export default function WalletScreen() {
  const { state } = useWalletViewModel();

  if (state.kind === 'unconfigured') {
    return (
      <SafeAreaView className="flex-1 bg-background px-6">
        <View className="flex-1 items-center justify-center">
          <Text className="mb-2 text-2xl font-bold text-destructive">
            Wallet unavailable
          </Text>
          <Text className="text-center text-sm text-muted-foreground">
            STRIPE_PUBLISHABLE_KEY is not configured for this build. Payments
            will not work until it is set.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (state.kind === 'loading') {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" testID="wallet-loading-spinner" />
        </View>
      </SafeAreaView>
    );
  }

  if (state.kind === 'error') {
    return (
      <SafeAreaView className="flex-1 bg-background px-6">
        <View className="flex-1 items-center justify-center">
          <Text className="mb-2 text-xl font-bold text-foreground">
            Couldn&apos;t load your wallet
          </Text>
          <Text className="mb-6 text-center text-sm text-muted-foreground">
            {state.error.message ?? 'Network error'}
          </Text>
          <Pressable
            onPress={state.onRetry}
            accessibilityRole="button"
            testID="wallet-retry"
            className="rounded-full bg-primary px-6 py-3"
          >
            <Text className="text-base font-semibold text-primary-foreground">
              Retry
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (state.kind === 'no_customer' || state.kind === 'empty') {
    return (
      <SafeAreaView className="flex-1 bg-background px-6">
        <View className="flex-row items-center justify-between py-4">
          <Text className="text-2xl font-bold text-foreground">Wallet</Text>
        </View>
        <View className="flex-1 items-center justify-center">
          <Text className="mb-2 text-lg font-semibold text-foreground">
            No payment methods
          </Text>
          <Text className="mb-6 text-center text-sm text-muted-foreground">
            Add a card to start riding. We&apos;ll charge it automatically when
            each trip ends.
          </Text>
          <Pressable
            onPress={state.onAdd}
            accessibilityRole="button"
            testID="wallet-empty-add"
            className="rounded-full bg-primary px-6 py-3"
          >
            <Text className="text-base font-semibold text-primary-foreground">
              Add card
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ready
  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-row items-center justify-between px-6 py-4">
        <Text className="text-2xl font-bold text-foreground">Wallet</Text>
        <Pressable
          onPress={state.onAdd}
          accessibilityRole="button"
          testID="wallet-header-add"
          className="rounded-full bg-primary px-4 py-2"
        >
          <Text className="text-sm font-semibold text-primary-foreground">
            Add card
          </Text>
        </Pressable>
      </View>
      <FlatList
        data={state.methods}
        keyExtractor={(m) => String(m.id)}
        contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 24 }}
        ItemSeparatorComponent={() => <View className="h-3" />}
        refreshControl={
          <RefreshControl
            refreshing={state.isRefreshing}
            onRefresh={state.onRefresh}
          />
        }
        renderItem={({ item }) => (
          <WalletCardRow
            method={item}
            isDefault={
              state.defaultMethodId !== null &&
              String(state.defaultMethodId) === String(item.id)
            }
            isSetDefaultInFlight={state.inFlight.setDefault.has(
              String(item.id),
            )}
            isDetachInFlight={state.inFlight.detach.has(String(item.id))}
            onSetDefault={state.onSetDefault}
            onDelete={state.onDelete}
          />
        )}
      />
    </SafeAreaView>
  );
}
