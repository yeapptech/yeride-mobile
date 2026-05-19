import { useMemo } from 'react';
import { Text, View } from 'react-native';

import { Money } from '@domain/entities/Money';
import type {
  TripPayment,
  TripPaymentStatus,
  TripPaymentType,
} from '@domain/entities/TripPayment';

/**
 * Per-trip payments table for the trip-detail surface (TripDetailScreen).
 * Mirrors legacy `TransactionHistory.js` — renders one row per payment
 * with type chip, status badge, amount, timestamp, and a "Total" footer
 * summing `succeeded` fare/tip rows minus `succeeded` refund rows.
 *
 * The component is purely presentational — it does NOT subscribe to
 * `ObserveTripPayments`. The parent VM (`useTripDetailViewModel`) drives
 * the subscription and passes the rows in. Keeps the component testable
 * without a DI container.
 *
 * Total math runs in minor units via the `Money` value object — no
 * floats, no accidental currency mixing. Refund rows subtract; failed
 * rows are listed but excluded from the total (legacy parity:
 * `TransactionHistory` only summed `succeeded`).
 */
export interface TripPaymentsListProps {
  readonly payments: readonly TripPayment[];
  readonly testID?: string;
}

function typeLabel(t: TripPaymentType): string {
  switch (t) {
    case 'fare':
      return 'Fare';
    case 'tip':
      return 'Tip';
    case 'refund':
      return 'Refund';
  }
}

function statusLabel(s: TripPaymentStatus): string {
  switch (s) {
    case 'succeeded':
      return 'Succeeded';
    case 'failed':
      return 'Failed';
    case 'refunded':
      return 'Refunded';
  }
}

function statusPillClass(s: TripPaymentStatus): string {
  switch (s) {
    case 'succeeded':
      return 'bg-success/10 text-success';
    case 'failed':
      return 'bg-destructive/10 text-destructive';
    case 'refunded':
      return 'bg-muted text-muted-foreground';
  }
}

function formatTimestamp(d: Date): string {
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Sum the "Total" row: `succeeded` fare + `succeeded` tip - `succeeded`
 * refund. All arithmetic in `Money` minor units; returns `null` if the
 * list is empty OR if any cross-currency mismatch is encountered
 * (defensive — production data is USD-only).
 */
function computeTotal(payments: readonly TripPayment[]): Money | null {
  const succeeded = payments.filter((p) => p.status === 'succeeded');
  if (succeeded.length === 0) return null;
  const first = succeeded[0];
  if (!first) return null;
  const zero = Money.create(0, first.amount.currency);
  if (!zero.ok) return null;
  let running: Money = zero.value;
  for (const p of succeeded) {
    const sum =
      p.type === 'refund' ? running.subtract(p.amount) : running.add(p.amount);
    if (!sum.ok) return null;
    running = sum.value;
  }
  return running;
}

export function TripPaymentsList({ payments, testID }: TripPaymentsListProps) {
  // Stable order: newest first (subscription already emits desc, but be
  // defensive in case a caller passes raw input).
  const ordered = useMemo(
    () =>
      [...payments].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
      ),
    [payments],
  );
  const total = useMemo(() => computeTotal(payments), [payments]);

  if (ordered.length === 0) {
    return (
      <View
        testID={testID ?? 'trip-payments-list'}
        className="rounded-lg border border-border bg-card p-3"
      >
        <Text className="text-sm text-muted-foreground">
          No payments recorded for this trip yet.
        </Text>
      </View>
    );
  }

  return (
    <View
      testID={testID ?? 'trip-payments-list'}
      className="rounded-lg border border-border bg-card"
    >
      {ordered.map((p, i) => (
        <View
          key={p.id}
          testID={`trip-payment-${p.id}`}
          className={`flex-row items-start justify-between px-3 py-2 ${i === ordered.length - 1 ? '' : 'border-b border-border'}`}
        >
          <View className="flex-1 pr-3">
            <View className="flex-row items-center gap-2">
              <Text className="text-sm font-medium text-foreground">
                {typeLabel(p.type)}
              </Text>
              <View
                className={`rounded-full px-2 py-0.5 ${statusPillClass(p.status)}`}
              >
                <Text
                  className={`text-xs font-medium ${statusPillClass(p.status)}`}
                >
                  {statusLabel(p.status)}
                </Text>
              </View>
            </View>
            <Text className="mt-0.5 text-xs text-muted-foreground">
              {formatTimestamp(p.createdAt)}
            </Text>
          </View>
          <Text
            className={`text-sm font-semibold ${p.type === 'refund' ? 'text-destructive' : 'text-foreground'}`}
          >
            {p.type === 'refund' ? `−${p.amount.format()}` : p.amount.format()}
          </Text>
        </View>
      ))}
      {total !== null && (
        <View
          testID="trip-payments-total"
          className="flex-row items-center justify-between border-t border-border bg-muted/30 px-3 py-2"
        >
          <Text className="text-sm font-semibold text-foreground">Total</Text>
          <Text className="text-sm font-semibold text-foreground">
            {total.format()}
          </Text>
        </View>
      )}
    </View>
  );
}
