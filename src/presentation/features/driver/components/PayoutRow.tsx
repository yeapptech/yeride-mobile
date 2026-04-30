import { Text, View } from 'react-native';

import type { Payout, PayoutStatus } from '@domain/entities/Payout';
import { formatMoney } from '@presentation/utils/formatMoney';

/**
 * One row in the driver Earnings tab's payouts list.
 *
 * Layout (left to right):
 *   [arrival date]   [status pill]                              [amount]
 *
 * Status pills mirror legacy yeride's color palette. Phase 9 polish
 * brings tokenized colors; until then we use Tailwind utility classes
 * keyed on the status literal.
 *
 * Pure display component — no callbacks. Phase 9 adds drill-down via
 * `onPress`; for now the row is read-only.
 */

export interface PayoutRowProps {
  readonly payout: Payout;
}

export function PayoutRow({ payout }: PayoutRowProps) {
  return (
    <View
      testID={`payout-row-${payout.id}`}
      className="mb-2 flex-row items-center justify-between rounded-2xl border border-border bg-card px-4 py-3"
    >
      <View className="flex-1 flex-row items-center">
        <Text className="text-sm text-muted-foreground">
          {formatArrivalDate(payout.arrivalDate)}
        </Text>
        <View className="ml-3">
          <StatusPill status={payout.status} />
        </View>
      </View>
      <Text className="text-base font-semibold text-foreground">
        {formatMoney(payout.amount)}
      </Text>
    </View>
  );
}

function StatusPill({ status }: { readonly status: PayoutStatus }) {
  const { label, className } = pillStyle(status);
  return (
    <View
      className={`rounded-full px-2 py-0.5 ${className}`}
      testID={`payout-status-${status}`}
    >
      <Text className="text-xs font-medium text-white">{label}</Text>
    </View>
  );
}

function pillStyle(status: PayoutStatus): {
  readonly label: string;
  readonly className: string;
} {
  switch (status) {
    case 'paid':
      return { label: 'Paid', className: 'bg-success' };
    case 'pending':
      return { label: 'Pending', className: 'bg-warning' };
    case 'in_transit':
      return { label: 'In transit', className: 'bg-primary' };
    case 'failed':
      return { label: 'Failed', className: 'bg-error' };
    case 'canceled':
      return { label: 'Canceled', className: 'bg-muted-foreground' };
  }
}

function formatArrivalDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
