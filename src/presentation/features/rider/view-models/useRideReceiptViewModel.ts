import { useCallback, useMemo } from 'react';

import type { Money } from '@domain/entities/Money';
import { Money as MoneyClass } from '@domain/entities/Money';
import type { Ride } from '@domain/entities/Ride';
import type { RideId } from '@domain/entities/RideId';
import type { TripPayment } from '@domain/entities/TripPayment';
import { useUseCases } from '@presentation/di';
import { useFirestoreSubscription } from '@presentation/hooks';
import { useRideQuery } from '@presentation/queries';

/**
 * View-model for `RideReceiptScreen`.
 *
 * Composition:
 *   - `useRideQuery(rideId)` — one-shot read of the trip doc. Receipt
 *     is a terminal-state read; no need for a live subscription. Cache
 *     warmed by `useCancelRideAsRiderMutation` / `useCreateRideMutation`
 *     in earlier flows.
 *   - `useFirestoreSubscription(observeTripPayments)` — live: the
 *     Stripe webhook may write a tip / refund row after the rider
 *     opened the receipt. Wiring as a live source means the receipt
 *     auto-updates without a manual refresh.
 *
 * Computed surface:
 *   - `fareTotal` — sum of `succeeded` `fare` + `tip` − `refund`. The
 *     authoritative server-side total. Falls back to a `null` so the UI
 *     shows "—" rather than $0 when no payment row has landed yet.
 *   - `farePayment` / `tipPayment` / `refundPayment` — single-instance
 *     access for the receipt's labelled rows.
 *
 * Phase 6 will add `cardLast4`, `cardBrand`, and `processingFee` to
 * `TripPayment`. For now the screen renders a "Charged to your default
 * card" placeholder.
 */

export interface UseRideReceiptViewModel {
  readonly ride: Ride | null | undefined;
  readonly payments: readonly TripPayment[];
  readonly fareTotal: Money | null;
  readonly farePayment: TripPayment | null;
  readonly tipPayment: TripPayment | null;
  readonly refundPayment: TripPayment | null;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly emailReceipt: () => void;
}

export function useRideReceiptViewModel(args: {
  rideId: RideId;
}): UseRideReceiptViewModel {
  const { rideId } = args;
  const useCases = useUseCases();

  const rideQuery = useRideQuery(rideId);

  const subscribePayments = useCallback(
    (cb: (payments: readonly TripPayment[]) => void) =>
      useCases.observeTripPayments.execute({ rideId, callback: cb }),
    [useCases, rideId],
  );
  const payments = useFirestoreSubscription<readonly TripPayment[]>(
    subscribePayments,
    [],
  );

  const farePayment = useMemo(
    () =>
      payments.find((p) => p.type === 'fare' && p.status === 'succeeded') ??
      null,
    [payments],
  );
  const tipPayment = useMemo(
    () =>
      payments.find((p) => p.type === 'tip' && p.status === 'succeeded') ??
      null,
    [payments],
  );
  const refundPayment = useMemo(
    () =>
      payments.find((p) => p.type === 'refund' && p.status === 'succeeded') ??
      null,
    [payments],
  );

  // Authoritative total: fare + tip − refund. We only sum same-currency
  // amounts; if someone ever introduces multi-currency tipping, the
  // Money.add() inside the use case will refuse to mix and surface a
  // ValidationError, which we collapse to `null` here.
  const fareTotal = useMemo<Money | null>(() => {
    if (!farePayment) return null;
    let total: Money = farePayment.amount;
    if (tipPayment) {
      const r = total.add(tipPayment.amount);
      if (!r.ok) return null;
      total = r.value;
    }
    if (refundPayment) {
      // Refund = subtract; if the refund is larger than the charge,
      // clamp to zero rather than going negative.
      const r = total.subtract(refundPayment.amount);
      if (!r.ok) {
        const zeroR = MoneyClass.create(0, total.currency);
        return zeroR.ok ? zeroR.value : total;
      }
      total = r.value;
    }
    return total;
  }, [farePayment, tipPayment, refundPayment]);

  const emailReceipt = useCallback(() => {
    // Phase 9 polish — the legacy app sends an emailed receipt via a
    // Cloud Function trigger on the trip's `events` doc. For Phase 3
    // turn 3.5 the button is visible-but-disabled stub; the screen
    // wires this no-op so the type signature stays stable.
  }, []);

  return {
    ride: rideQuery.data,
    payments,
    fareTotal,
    farePayment,
    tipPayment,
    refundPayment,
    isLoading: rideQuery.isLoading,
    error:
      rideQuery.isError && rideQuery.error ? rideQuery.error.message : null,
    emailReceipt,
  };
}
