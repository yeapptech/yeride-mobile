import { useCallback, useMemo, useState } from 'react';

import { Money } from '@domain/entities/Money';
import type { Ride } from '@domain/entities/Ride';
import type { RideId } from '@domain/entities/RideId';
import type { TripPayment } from '@domain/entities/TripPayment';
import {
  AuthorizationError,
  NetworkError,
  ValidationError,
} from '@domain/errors';
import { useProcessTipMutation } from '@presentation/queries';
import { LOG } from '@shared/logger';

const logger = LOG.extend('TIP');

/**
 * View-model for the tip flow on `RideReceiptScreen`.
 *
 * Owns the state machine driving `<TipSelector/>`. Composes:
 *   - the parent receipt VM's `ride` (live via `ObserveRide` after the
 *     turn-5 swap) so we hide the selector once the trip leaves
 *     `'completed'` — defensive against status flips while the rider
 *     lingers on the receipt;
 *   - the parent receipt VM's `tipPayment` (live via
 *     `useFirestoreSubscription(observeTripPayments)`) so we hide the
 *     selector once the new `'tip'` `TripPayment` row materializes;
 *   - `useProcessTipMutation` over the Turn-2 `tipDriver` Cloud Function
 *     callable.
 *
 * Six-arm tagged union (per Phase 6 turn 5 kickoff decision 3):
 *   - `hidden`     — trip not completed OR a tip row already exists.
 *                    Component renders nothing.
 *   - `idle`       — chips visible, no amount picked yet, CTA disabled.
 *   - `selected`   — preset OR a valid custom amount picked; CTA enabled.
 *   - `submitting` — `mutateAsync` in flight; chips + CTA disabled.
 *   - `submitted`  — local optimistic flag. We hold the "Tip $X added —
 *                    thank you!" banner until `tipPayment !== null`
 *                    flips and `'hidden'` takes over. No fixed-duration
 *                    auto-hide — the live subscription is the source of
 *                    truth (per kickoff decision 2).
 *   - `error`      — distinct UX for `validation` (server-side race —
 *                    e.g. `tip_trip_not_completed`), `network`,
 *                    `unauthorized` (rider's auth flickered mid-flight),
 *                    or `unknown`. Form stays interactive so the rider
 *                    can pick a different amount and retry; the band
 *                    has a Dismiss affordance that returns to `idle`.
 *
 * Rules:
 *   - Preset chips: $1 / $3 / $5.
 *   - Custom amount: whole dollars only, 1 ≤ x ≤ 99. The component
 *     constrains the TextInput to digits + `maxLength={2}`; this
 *     view-model parses defensively in case anything bypasses that.
 *   - $1 floor mirrors `ProcessTip`. $99 ceiling is a defensive upper
 *     bound that the kickoff locked in (legacy has no max; tipping
 *     more than $99 is an admin action, not an app flow).
 *   - Idempotent submit: an `onSubmit()` call while `'submitting'` is a
 *     no-op. Defense-in-depth on top of the Cloud Function's
 *     `(tripId, customerId)` server-idempotency.
 */

const TIP_PRESET_MINOR_UNITS = [100, 300, 500] as const;
const TIP_MIN_DOLLARS = 1;
const TIP_MAX_DOLLARS = 99;

export type TipPresetMinorUnits = (typeof TIP_PRESET_MINOR_UNITS)[number];

export const TIP_PRESETS: ReadonlyArray<TipPresetMinorUnits> =
  TIP_PRESET_MINOR_UNITS;

export type TipFlowErrorKind =
  | 'validation'
  | 'network'
  | 'unauthorized'
  | 'unknown';

export interface TipFlowError {
  readonly kind: TipFlowErrorKind;
  readonly message: string;
}

interface FormCallbacks {
  readonly isCustom: boolean;
  readonly customText: string;
  readonly selectedPresetMinor: TipPresetMinorUnits | null;
  readonly onSelectPreset: (minorUnits: TipPresetMinorUnits) => void;
  readonly onSelectCustom: () => void;
  readonly onCustomAmountChange: (text: string) => void;
}

export type TipFlowState =
  | { readonly kind: 'hidden' }
  | ({ readonly kind: 'idle' } & FormCallbacks)
  | ({
      readonly kind: 'selected';
      readonly tipAmount: Money;
      readonly onSubmit: () => void;
    } & FormCallbacks)
  | { readonly kind: 'submitting'; readonly tipAmount: Money }
  | { readonly kind: 'submitted'; readonly tipAmount: Money }
  | ({
      readonly kind: 'error';
      readonly error: TipFlowError;
      readonly tipAmount: Money | null;
      readonly onSubmit: () => void;
      readonly onDismissError: () => void;
    } & FormCallbacks);

export interface UseTipFlowViewModel {
  readonly state: TipFlowState;
}

export interface UseTipFlowViewModelArgs {
  readonly rideId: RideId;
  readonly ride: Ride | null | undefined;
  readonly tipPayment: TripPayment | null;
}

/**
 * Parse a custom-amount text input as whole dollars in `[1, 99]`. Returns
 * `null` for empty, NaN, fractional, or out-of-range values. The
 * component-level `keyboardType="numeric"` + `maxLength={2}` prevents
 * most invalid input at the surface; this is defense in depth.
 */
function parseCustomDollars(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n)) return null;
  if (n < TIP_MIN_DOLLARS || n > TIP_MAX_DOLLARS) return null;
  return n;
}

function deriveTipAmount(args: {
  readonly isCustom: boolean;
  readonly customText: string;
  readonly selectedPresetMinor: TipPresetMinorUnits | null;
}): Money | null {
  if (args.isCustom) {
    const dollars = parseCustomDollars(args.customText);
    if (dollars === null) return null;
    const r = Money.fromMajor(dollars, 'USD');
    return r.ok ? r.value : null;
  }
  if (args.selectedPresetMinor !== null) {
    const r = Money.create(args.selectedPresetMinor, 'USD');
    return r.ok ? r.value : null;
  }
  return null;
}

function classifyError(e: unknown): TipFlowError {
  if (e instanceof ValidationError) {
    return { kind: 'validation', message: e.message };
  }
  if (e instanceof AuthorizationError) {
    return { kind: 'unauthorized', message: e.message };
  }
  if (e instanceof NetworkError) {
    return { kind: 'network', message: e.message };
  }
  // Defensive: domain errors carry a `kind` discriminator on the base
  // class, so a structural check picks up subclasses we forgot to
  // import (or that arrive through a TanStack throw boundary).
  if (typeof e === 'object' && e !== null && 'kind' in e) {
    const kind = (e as { kind: unknown }).kind;
    if (kind === 'validation') {
      return { kind: 'validation', message: messageOf(e) };
    }
    if (kind === 'authorization') {
      return { kind: 'unauthorized', message: messageOf(e) };
    }
    if (kind === 'network') {
      return { kind: 'network', message: messageOf(e) };
    }
  }
  return { kind: 'unknown', message: messageOf(e) };
}

function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'object' && e !== null && 'message' in e) {
    const m = (e as { message: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return 'Something went wrong. Please try again.';
}

export function useTipFlowViewModel(
  args: UseTipFlowViewModelArgs,
): UseTipFlowViewModel {
  const { rideId, ride, tipPayment } = args;

  const processTipMutation = useProcessTipMutation();

  const [isCustom, setIsCustom] = useState(false);
  const [customText, setCustomText] = useState('');
  const [selectedPresetMinor, setSelectedPresetMinor] =
    useState<TipPresetMinorUnits | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedAmount, setSubmittedAmount] = useState<Money | null>(null);
  const [error, setError] = useState<TipFlowError | null>(null);

  // Visibility gate: hide the selector when the trip is not completed
  // (the rider is on a different surface, or the trip flipped back to
  // `'payment_failed'` server-side) OR when a `'tip'` payment row already
  // exists. The live subscriptions in the parent receipt VM keep these
  // current.
  const hidden = ride?.status !== 'completed' || tipPayment !== null;

  const tipAmount = useMemo(
    () => deriveTipAmount({ isCustom, customText, selectedPresetMinor }),
    [isCustom, customText, selectedPresetMinor],
  );

  const onSelectPreset = useCallback((minorUnits: TipPresetMinorUnits) => {
    setIsCustom(false);
    setCustomText('');
    setSelectedPresetMinor(minorUnits);
    setError(null);
  }, []);

  const onSelectCustom = useCallback(() => {
    setIsCustom(true);
    setSelectedPresetMinor(null);
    setError(null);
  }, []);

  const onCustomAmountChange = useCallback((text: string) => {
    // Defensive sanitization: strip anything that isn't a digit. The
    // component restricts the TextInput to numeric keyboard +
    // maxLength={2}, but a paste action or external automation could
    // bypass that.
    const digitsOnly = text.replace(/[^0-9]/g, '').slice(0, 2);
    setCustomText(digitsOnly);
    setError(null);
  }, []);

  const onDismissError = useCallback(() => {
    setError(null);
  }, []);

  const onSubmit = useCallback(() => {
    if (isSubmitting) return; // Idempotent guard: no double-submit.
    if (!tipAmount) {
      // Local validation surfaces an error band rather than silently
      // doing nothing — matches the kickoff's acceptance ("see the
      // validation error inline").
      setError({
        kind: 'validation',
        message: 'Please pick a tip amount between $1 and $99 (whole dollars).',
      });
      return;
    }
    setError(null);
    setIsSubmitting(true);
    void (async () => {
      try {
        await processTipMutation.mutateAsync({ rideId, tipAmount });
        logger.info('tip submitted', {
          rideId: String(rideId),
          minorUnits: tipAmount.minorUnits,
        });
        setSubmittedAmount(tipAmount);
      } catch (e) {
        logger.warn('tipDriver mutation failed', e);
        setError(classifyError(e));
      } finally {
        setIsSubmitting(false);
      }
    })();
  }, [isSubmitting, tipAmount, processTipMutation, rideId]);

  const formCallbacks: FormCallbacks = {
    isCustom,
    customText,
    selectedPresetMinor,
    onSelectPreset,
    onSelectCustom,
    onCustomAmountChange,
  };

  let state: TipFlowState;
  if (hidden) {
    state = { kind: 'hidden' };
  } else if (submittedAmount !== null) {
    // Local-optimistic banner held until the live `tipPayment` row
    // lands and the next render flips to `'hidden'`.
    state = { kind: 'submitted', tipAmount: submittedAmount };
  } else if (isSubmitting && tipAmount !== null) {
    state = { kind: 'submitting', tipAmount };
  } else if (error !== null) {
    state = {
      kind: 'error',
      error,
      tipAmount,
      onSubmit,
      onDismissError,
      ...formCallbacks,
    };
  } else if (tipAmount !== null) {
    state = {
      kind: 'selected',
      tipAmount,
      onSubmit,
      ...formCallbacks,
    };
  } else {
    state = { kind: 'idle', ...formCallbacks };
  }

  return { state };
}
