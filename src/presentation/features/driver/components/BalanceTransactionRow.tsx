import { Text, View } from 'react-native';

import type { BalanceTransaction } from '@domain/entities/BalanceTransaction';

import { formatMoney } from '../utils/formatMoney';

/**
 * One row in the driver Earnings tab's balance-transaction ledger list.
 *
 * Layout:
 *   [type label]                                         [amount, signed]
 *   [date · fee/net subline?]
 *
 * The fee/net subline only renders when `fee.minorUnits > 0` — the
 * majority of charge events have non-zero fees, but transfers and
 * payouts can have fee = 0 and the extra row would just be noise.
 *
 * Pure display component — no callbacks. Phase 9 adds drill-down via
 * `onPress` to the trip-receipt screen when `tripId !== null`; for now
 * the row is read-only.
 */

export interface BalanceTransactionRowProps {
  readonly txn: BalanceTransaction;
}

export function BalanceTransactionRow({ txn }: BalanceTransactionRowProps) {
  const isPositive = txn.amount.minorUnits >= 0;
  const showFeeRow = txn.fee.minorUnits > 0;
  return (
    <View
      testID={`balance-txn-row-${txn.id}`}
      className="mb-2 rounded-2xl border border-border bg-card px-4 py-3"
    >
      <View className="flex-row items-start justify-between">
        <View className="flex-1 pr-3">
          <Text className="text-sm font-medium text-foreground">
            {formatTransactionType(txn.type)}
          </Text>
          <Text className="mt-0.5 text-xs text-muted-foreground">
            {formatCreatedAt(txn.createdAt)}
            {showFeeRow
              ? ` · fee ${formatMoney(txn.fee)} · net ${formatMoney(txn.net)}`
              : ''}
          </Text>
        </View>
        <Text
          className={`text-base font-semibold ${
            isPositive ? 'text-success' : 'text-error'
          }`}
        >
          {formatMoney(txn.amount)}
        </Text>
      </View>
    </View>
  );
}

/**
 * Stripe `type` is free-form (charge, payment, transfer, payout,
 * application_fee, stripe_fee, refund, …). Map the common ones to a
 * friendly label; fall through with the raw value (with underscores
 * replaced) for unknowns so a new Stripe type still surfaces something
 * readable.
 */
function formatTransactionType(type: string): string {
  switch (type) {
    case 'charge':
    case 'payment':
      return 'Payment received';
    case 'payout':
      return 'Payout to bank';
    case 'transfer':
      return 'Transfer';
    case 'refund':
      return 'Refund';
    case 'stripe_fee':
      return 'Stripe fee';
    case 'application_fee':
      return 'YeRide fee';
    default:
      return type.replace(/_/g, ' ');
  }
}

function formatCreatedAt(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
