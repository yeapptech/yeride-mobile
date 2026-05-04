import { useCallback, useEffect, useMemo, useState } from 'react';

import type { Money } from '@domain/entities/Money';
import { Money as MoneyClass } from '@domain/entities/Money';
import type { CardBrand } from '@domain/entities/PaymentMethod';
import type { Ride } from '@domain/entities/Ride';
import type { RideId } from '@domain/entities/RideId';
import type { TripPayment } from '@domain/entities/TripPayment';
import { useUseCases } from '@presentation/di';
import { useFirestoreSubscription } from '@presentation/hooks';
import {
  useCurrentUserQuery,
  useListPaymentMethodsQuery,
} from '@presentation/queries';

/**
 * View-model for `RideReceiptScreen`.
 *
 * Composition:
 *   - `useFirestoreSubscription(observeRide)` — live ride doc. Phase 6
 *     turn 5 swapped the one-shot `useRideQuery` for the live source so
 *     a `'payment_failed' → 'completed'` flip server-side (rider re-tries
 *     the charge from a different surface) lights up the tip selector
 *     without a navigation round-trip. The receipt VM stays read-only;
 *     the tip flow lives in `useTipFlowViewModel` consuming
 *     `{ride, tipPayment}` from this VM.
 *   - `useFirestoreSubscription(observeTripPayments)` — live: the
 *     Stripe webhook may write a tip / refund row after the rider
 *     opened the receipt. Wiring as a live source means the receipt
 *     auto-updates without a manual refresh, and the tip flow's
 *     `'submitted' → 'hidden'` transition is driven by the new `'tip'`
 *     row landing here.
 *
 * Computed surface:
 *   - `fareTotal` — sum of `succeeded` `fare` + `tip` − `refund`. The
 *     authoritative server-side total. Falls back to a `null` so the UI
 *     shows "—" rather than $0 when no payment row has landed yet.
 *   - `farePayment` / `tipPayment` / `refundPayment` — single-instance
 *     access for the receipt's labelled rows.
 *
 * Loading semantics: `useFirestoreSubscription` initializes to the
 * `initialValue` we pass (`null` for the ride). `InMemoryRideRepository`
 * + `FirestoreRideRepository` both emit synchronously on first
 * subscribe, so `hasRideEmitted` flips to true within a tick. We
 * surface `isLoading: true` only until that first emission lands; from
 * then on `ride === null` means the doc was actually deleted (rare —
 * admin tooling only) and the screen renders a not-found message.
 *
 * Card-brand + last-4 join (Phase 9 Turn 7):
 *   The `farePayment.paymentMethodId` (Stripe `pm_…` id, written by the
 *   webhook server on every fare/tip charge — see
 *   yeride-stripe-server/stripe/routes.js:138) is matched against the
 *   rider's `useListPaymentMethodsQuery` cache. When the join hits, the
 *   VM surfaces `paymentBrand` + `paymentLast4` and the screen renders
 *   the per-brand glyph. When the join misses (refund-only rows;
 *   pre-Phase-9-Turn-7 legacy fare rows that lacked `paymentMethodId`;
 *   the rider detached the card after the trip; the wallet cache is
 *   still loading), both fields are `null` and the screen falls back
 *   to a brand-agnostic "Charged to your card on file" line.
 *
 * Email-receipt button removed in Phase 9 Turn 7. Stripe sends emailed
 * receipts automatically via the `receiptEmail` parameter on
 * `/direct-charge` (yeride-functions/lib/payments.js:454). The legacy
 * yeride app never had an in-app email-receipt trigger — the disabled
 * button on the rewrite was a stub for a hypothetical resend feature
 * that wasn't actually wired anywhere. Replaced with a small
 * informational note on the screen.
 */

export interface UseRideReceiptViewModel {
  readonly ride: Ride | null;
  readonly payments: readonly TripPayment[];
  readonly fareTotal: Money | null;
  readonly farePayment: TripPayment | null;
  readonly tipPayment: TripPayment | null;
  readonly refundPayment: TripPayment | null;
  /**
   * Card brand resolved from the wallet cache by joining
   * `farePayment.paymentMethodId` against `useListPaymentMethodsQuery`.
   * `null` when the join misses (no fare row yet / no
   * `paymentMethodId` on the wire / card detached / wallet cache
   * loading / no Stripe customer record). The screen surfaces a
   * brand-agnostic fallback in that branch.
   */
  readonly paymentBrand: CardBrand | null;
  /**
   * Last-4 digits of the card the fare was charged to. Same null
   * semantics as `paymentBrand` — both fields fall together (the
   * wallet cache always carries last4 alongside brand).
   */
  readonly paymentLast4: string | null;
  readonly isLoading: boolean;
  readonly error: string | null;
}

export function useRideReceiptViewModel(args: {
  rideId: RideId;
}): UseRideReceiptViewModel {
  const { rideId } = args;
  const useCases = useUseCases();

  // ── Live ride subscription ────────────────────────────────────────
  const [hasRideEmitted, setHasRideEmitted] = useState(false);
  const subscribeRide = useCallback(
    (cb: (ride: Ride | null) => void) =>
      useCases.observeRide.execute({
        rideId,
        callback: (next) => {
          setHasRideEmitted(true);
          cb(next);
        },
      }),
    [useCases, rideId],
  );
  const ride = useFirestoreSubscription<Ride | null>(subscribeRide, null);

  // Reset the emitted flag when the rideId changes — switching the
  // observed trip should re-show the loading state.
  useEffect(() => {
    setHasRideEmitted(false);
  }, [rideId]);

  // ── Live trip-payments subscription ───────────────────────────────
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

  // ── Card brand + last-4 join (Phase 9 Turn 7) ────────────────────
  // Pull the rider's stripeCustomerId off the user query, then fire
  // useListPaymentMethodsQuery (gated on customerId). Match the fare
  // row's paymentMethodId against the cached methods array. Cache miss
  // → null both. The user query and the methods query share TanStack's
  // global cache; the Wallet tab's render warms this cache, but the
  // receipt screen also works on a cold cache (just with a brief
  // brand-agnostic fallback while the methods load).
  const userQuery = useCurrentUserQuery();
  const customerId =
    userQuery.data?.role === 'rider' ? userQuery.data.stripeCustomerId : null;
  const methodsQuery = useListPaymentMethodsQuery({ customerId });
  const matchedMethod = useMemo(() => {
    if (farePayment === null) return null;
    if (farePayment.paymentMethodId === null) return null;
    const methods = methodsQuery.data ?? [];
    if (methods.length === 0) return null;
    const target = String(farePayment.paymentMethodId);
    return methods.find((m) => String(m.id) === target) ?? null;
  }, [farePayment, methodsQuery.data]);
  const paymentBrand: CardBrand | null = matchedMethod?.brand ?? null;
  const paymentLast4: string | null = matchedMethod?.last4 ?? null;

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

  return {
    ride,
    payments,
    fareTotal,
    farePayment,
    tipPayment,
    refundPayment,
    paymentBrand,
    paymentLast4,
    // Loading until the first ride-doc emission lands. Subsequent
    // `ride === null` means the doc was deleted; the screen renders
    // "couldn't find that receipt" in that branch.
    isLoading: !hasRideEmitted,
    error: null,
  };
}
