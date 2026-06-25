import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { formatMoney } from '@presentation/utils/formatMoney';

import { BalanceTransactionRow } from '../components/BalanceTransactionRow';
import { PayoutRow } from '../components/PayoutRow';
import { useDriverEarningsViewModel } from '../view-models/useDriverEarningsViewModel';

/**
 * Driver Earnings tab. Replaces `DriverEarningsPlaceholderScreen` from
 * Phase 4.
 *
 * The screen is dumb — `useDriverEarningsViewModel` does all the
 * orchestration. Each tagged-union arm renders a different layout:
 *
 *   `unconfigured` — loud error block (rare; means an op set up the
 *                    build without `STRIPE_PUBLISHABLE_KEY`).
 *   `loading`      — centred spinner. Covers both "currentUser query
 *                    pending" and "Connect-data queries pending in the
 *                    enabled arm".
 *   `no_account`   — empty state with "Set up payouts" CTA.
 *   `pending`      — "We're verifying your account" + "Continue setup".
 *   `enabled`      — full earnings dashboard: balance card, payouts
 *                    list, balance-transaction list, "View Express
 *                    dashboard" affordance, pull-to-refresh.
 *   `error`        — error block with Retry CTA.
 */

export default function DriverEarningsScreen() {
  const { state } = useDriverEarningsViewModel();

  if (state.kind === 'unconfigured') {
    return (
      <SafeAreaView className="flex-1 bg-background px-6">
        <View className="flex-1 items-center justify-center">
          <Text className="mb-2 text-2xl font-bold text-error">
            Earnings unavailable
          </Text>
          <Text className="text-center text-sm text-muted-foreground">
            STRIPE_PUBLISHABLE_KEY is not configured for this build. Payouts
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
          <ActivityIndicator size="large" testID="earnings-loading-spinner" />
        </View>
      </SafeAreaView>
    );
  }

  if (state.kind === 'error') {
    return (
      <SafeAreaView className="flex-1 bg-background px-6">
        <View className="flex-1 items-center justify-center">
          <Text className="mb-2 text-xl font-bold text-foreground">
            Couldn&apos;t load your earnings
          </Text>
          <Text className="mb-6 text-center text-sm text-muted-foreground">
            {state.error.message ?? 'Network error'}
          </Text>
          <Pressable
            onPress={state.onRetry}
            accessibilityRole="button"
            testID="earnings-retry"
            className="rounded-2xl bg-primary px-6 py-3"
          >
            <Text className="text-base font-semibold text-primary-foreground">
              Retry
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (state.kind === 'no_account') {
    return (
      <SafeAreaView className="flex-1 bg-background px-6">
        <View className="py-4">
          <Text className="text-2xl font-bold text-foreground">Earnings</Text>
        </View>
        <View className="flex-1 items-center justify-center">
          <Text className="mb-2 text-lg font-semibold text-foreground">
            Set up payouts to start earning
          </Text>
          <Text className="mb-6 text-center text-sm text-muted-foreground">
            We&apos;ll send you to Stripe to verify your identity and connect a
            bank account. Takes a few minutes.
          </Text>
          <Pressable
            onPress={state.onSetupPayouts}
            disabled={state.isOnboarding}
            accessibilityRole="button"
            testID="earnings-setup-payouts"
            className="rounded-2xl bg-primary px-6 py-3"
          >
            {state.isOnboarding ? (
              <ActivityIndicator size="small" />
            ) : (
              <Text className="text-base font-semibold text-primary-foreground">
                Set up payouts
              </Text>
            )}
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (state.kind === 'pending') {
    return (
      <SafeAreaView className="flex-1 bg-background px-6">
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          refreshControl={
            <RefreshControl
              refreshing={state.isRefreshing}
              onRefresh={state.onRefresh}
            />
          }
        >
          <View className="py-4">
            <Text className="text-2xl font-bold text-foreground">Earnings</Text>
          </View>
          <View className="flex-1 items-center justify-center">
            <Text className="mb-2 text-lg font-semibold text-foreground">
              We&apos;re verifying your account
            </Text>
            <Text className="mb-6 text-center text-sm text-muted-foreground">
              Stripe is reviewing your information. If you backed out before
              finishing, tap below to continue.
            </Text>
            <Pressable
              onPress={state.onContinueSetup}
              disabled={state.isOnboarding}
              accessibilityRole="button"
              testID="earnings-continue-setup"
              className="rounded-2xl bg-primary px-6 py-3"
            >
              {state.isOnboarding ? (
                <ActivityIndicator size="small" />
              ) : (
                <Text className="text-base font-semibold text-primary-foreground">
                  Continue setup
                </Text>
              )}
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // enabled
  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 32 }}
        refreshControl={
          <RefreshControl
            refreshing={state.isRefreshing}
            onRefresh={state.onRefresh}
          />
        }
      >
        <View className="py-4">
          <Text className="text-2xl font-bold text-foreground">Earnings</Text>
        </View>

        {/* Balance card */}
        <View
          testID="earnings-balance-card"
          className="rounded-2xl border border-border bg-card px-5 py-4"
        >
          <Text className="text-xs uppercase text-muted-foreground">
            Available
          </Text>
          <Text className="mt-1 text-3xl font-bold text-foreground">
            {formatMoney(state.available)}
          </Text>
          <View className="mt-3 flex-row items-center justify-between">
            <Text className="text-xs uppercase text-muted-foreground">
              Pending
            </Text>
            <Text className="text-base font-medium text-foreground">
              {formatMoney(state.pending)}
            </Text>
          </View>
        </View>

        {/* Payouts list */}
        <View className="mt-6">
          <Text className="mb-2 text-base font-semibold text-foreground">
            Recent payouts
          </Text>
          {state.payouts.length === 0 ? (
            <Text
              testID="earnings-payouts-empty"
              className="text-sm text-muted-foreground"
            >
              No payouts yet
            </Text>
          ) : (
            state.payouts.map((p) => <PayoutRow key={p.id} payout={p} />)
          )}
        </View>

        {/* Balance transactions list */}
        <View className="mt-6">
          <Text className="mb-2 text-base font-semibold text-foreground">
            Recent activity
          </Text>
          {state.balanceTxns.length === 0 ? (
            <Text
              testID="earnings-balance-txns-empty"
              className="text-sm text-muted-foreground"
            >
              No transactions yet
            </Text>
          ) : (
            state.balanceTxns.map((t) => (
              <BalanceTransactionRow key={t.id} txn={t} />
            ))
          )}
        </View>

        {/* Express dashboard */}
        <Pressable
          onPress={state.onViewExpressDashboard}
          disabled={state.isOpeningDashboard}
          accessibilityRole="button"
          testID="earnings-express-dashboard"
          className="mt-6 flex-row items-center justify-center rounded-2xl border border-border bg-card px-4 py-4"
        >
          {state.isOpeningDashboard ? (
            <ActivityIndicator size="small" />
          ) : (
            <Text className="text-base font-medium text-foreground">
              View Express dashboard
            </Text>
          )}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
