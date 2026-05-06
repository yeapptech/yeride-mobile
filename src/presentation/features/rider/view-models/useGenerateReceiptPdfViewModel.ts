import { File } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useCallback, useRef, useState } from 'react';

import type { Money } from '@domain/entities/Money';
import type { CardBrand } from '@domain/entities/PaymentMethod';
import type { Ride } from '@domain/entities/Ride';
import type { TripPayment } from '@domain/entities/TripPayment';
import { LOG } from '@shared/logger';
import { buildReceiptHtml } from '@shared/pdf/buildReceiptHtml';

const logger = LOG.extend('ReceiptPdf');

/**
 * View-model for the rider's "Share receipt" flow on
 * `RideReceiptScreen` (Phase 9 Turn 16).
 *
 * Owns the generate-PDF + share orchestration on top of the data
 * the parent receipt VM already exposes:
 *   1. `Print.printToFileAsync({html})` — renders the receipt HTML
 *      into a PDF written to the OS cache directory; resolves with
 *      `{uri, numberOfPages}`. The HTML is built by the pure
 *      `buildReceiptHtml` helper from `@shared/pdf` so we can
 *      snapshot-test it independently.
 *   2. `Sharing.isAvailableAsync()` — Android emulators without a
 *      configured share-intent target return `false`; iOS
 *      simulators occasionally do too. We surface a distinct error
 *      arm so the rider sees an informative ("Sharing isn't
 *      available on this device — try emailing yourself the
 *      receipt") message rather than a silent no-op.
 *   3. `Sharing.shareAsync(uri)` — opens the system share sheet
 *      ("Save to Files / Mail / Messages / Print / etc."). Per
 *      kickoff Q3 we let the OS handle the share UX rather than
 *      building an in-app action sheet.
 *   4. `new File(uri).delete()` — best-effort cleanup of the
 *      temporary PDF in the cache directory. iOS auto-cleans cache
 *      eventually but Android won't; the explicit delete keeps
 *      cache footprint flat. Wrapped in try-catch and logged at
 *      `LOG.warn` (cleanup-best-effort, mirroring NavigationSdkClient
 *      teardown semantics — the user's flow has already succeeded by
 *      the time we get here, so a cleanup failure shouldn't surface
 *      as a user-facing error).
 *
 * Six-arm tagged union (per kickoff and matching `useTipFlowViewModel`'s
 * shape):
 *   - `idle`        — CTA visible, ready to fire.
 *   - `generating`  — `printToFileAsync` in flight; CTA disabled.
 *   - `ready`       — PDF generated, about to share. Transient state
 *                     held only across the `printToFileAsync` →
 *                     `Sharing.isAvailableAsync` boundary; no UI
 *                     surface beyond the spinner.
 *   - `sharing`     — `shareAsync` open; share sheet visible. CTA
 *                     stays disabled.
 *   - `shared`      — Brief success state. The screen flips back to
 *                     `'idle'` after the share completes (we don't
 *                     hold the success banner — the share sheet's
 *                     own confirmation is the user's signal).
 *   - `error`       — Three sub-kinds: `pdf_generation_failed` (Print
 *                     SDK threw or returned a malformed result),
 *                     `sharing_unavailable` (Sharing.isAvailableAsync
 *                     returned false), `unknown` (anything else,
 *                     including Sharing.shareAsync throwing). Form
 *                     stays interactive so the rider can retry; the
 *                     error band has a Dismiss affordance.
 *
 * Rules:
 *   - **Idempotent submit.** A second `onShare()` call while in
 *     any non-terminal arm (`generating` / `ready` / `sharing`) is
 *     a no-op. Defense in depth on top of the natural disabled
 *     state of the CTA in those arms.
 *   - **Status gate.** The screen gates the CTA on
 *     `ride.status === 'completed'` — a `'payment_failed'` ride
 *     doesn't have a finalizable receipt and the rider sees the
 *     PaymentFailed view's retry path instead. The VM doesn't
 *     re-check this internally; the caller's gate is the
 *     authoritative source.
 *   - **Cleanup on shared AND on error.** Both terminal arms
 *     attempt to delete the temp PDF. The `error` arm only deletes
 *     when the PDF was successfully generated before the failure
 *     fired (i.e. when the failure is in the `sharing_unavailable`
 *     or `unknown`-from-shareAsync branch); a
 *     `pdf_generation_failed` error has no temp file to clean up.
 *
 * **SDK seam status.** This VM imports `expo-print`, `expo-sharing`,
 * and `expo-file-system` directly rather than through a domain
 * interface. Qualifies for the single-call SDK escape hatch
 * (CLAUDE.md § "Single-call SDK escape hatch"): (a) the entire flow
 * is one-shot per tap with no listener stream, (b) no permission
 * state — `Print.printToFileAsync` needs none,
 * `Sharing.isAvailableAsync` is a one-shot capability probe rather
 * than a lifecycle, and `expo-file-system`'s `File.delete()` is
 * best-effort cleanup, (c) all three SDKs export module-level
 * functions that mock cleanly in Jest via `jest.mock('expo-print',
 * ...)` etc. If a future change introduces a continuous listener
 * (e.g. share-completion callbacks the rider sees on a banner) or
 * a mirrored permission state, promote to a `PdfGenerationService`
 * domain interface.
 */

export type ReceiptPdfErrorKind =
  | 'pdf_generation_failed'
  | 'sharing_unavailable'
  | 'unknown';

export interface ReceiptPdfError {
  readonly kind: ReceiptPdfErrorKind;
  readonly message: string;
}

export type ReceiptPdfState =
  | { readonly kind: 'idle'; readonly onShare: () => void }
  | { readonly kind: 'generating' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'sharing' }
  | { readonly kind: 'shared'; readonly onShare: () => void }
  | {
      readonly kind: 'error';
      readonly error: ReceiptPdfError;
      readonly onShare: () => void;
      readonly onDismissError: () => void;
    };

export interface UseGenerateReceiptPdfViewModel {
  readonly state: ReceiptPdfState;
}

export interface UseGenerateReceiptPdfViewModelArgs {
  readonly ride: Ride;
  readonly farePayment: TripPayment | null;
  readonly tipPayment: TripPayment | null;
  readonly refundPayment: TripPayment | null;
  readonly fareTotal: Money | null;
  readonly paymentBrand: CardBrand | null;
  readonly paymentLast4: string | null;
}

type Phase = 'idle' | 'generating' | 'ready' | 'sharing' | 'shared';

/**
 * Best-effort cleanup of the temp PDF. Wrapped in try-catch + LOG.warn
 * because the user-facing flow has already completed by the time we
 * call this (or the user-facing error has already surfaced). Mirrors
 * the cleanup-best-effort pattern from NavigationSdkClient teardown:
 * failures don't propagate, the next session's cache state isn't
 * affected by a leftover file (iOS clears cache; Android caps cache
 * directory size).
 */
function cleanupTempFile(uri: string): void {
  try {
    new File(uri).delete();
  } catch (e) {
    logger.warn('Failed to delete temp PDF', e);
  }
}

function classifyShareError(e: unknown): ReceiptPdfError {
  // No structural domain-error path here — the SDK throws plain
  // Errors. We surface the message verbatim for the `unknown` arm
  // (it's user-actionable: "Network unreachable", etc.).
  const message =
    e instanceof Error
      ? e.message
      : typeof e === 'object' && e !== null && 'message' in e
        ? String((e as { message: unknown }).message)
        : 'Something went wrong. Please try again.';
  return { kind: 'unknown', message };
}

export function useGenerateReceiptPdfViewModel(
  args: UseGenerateReceiptPdfViewModelArgs,
): UseGenerateReceiptPdfViewModel {
  const {
    ride,
    farePayment,
    tipPayment,
    refundPayment,
    fareTotal,
    paymentBrand,
    paymentLast4,
  } = args;

  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<ReceiptPdfError | null>(null);

  // Phase mirrored into a ref so the idempotent guard inside `onShare`
  // reads the latest value synchronously. `useCallback`-captured
  // `phase` would be stale on a fast double-tap that fires before the
  // next render commits — the CTA's disabled state is the screen-level
  // mechanism, but defence in depth at the VM seam keeps tests honest
  // about real-world race conditions (test renderer can fire two acts
  // before re-render commits).
  const phaseRef = useRef<Phase>('idle');
  const updatePhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const onDismissError = useCallback(() => {
    setError(null);
    updatePhase('idle');
  }, [updatePhase]);

  const onShare = useCallback(() => {
    // Idempotent guard: any non-terminal phase blocks re-entry. The
    // CTA is disabled in those arms anyway, but a fast double-tap
    // could otherwise slip through before the next render.
    if (
      phaseRef.current === 'generating' ||
      phaseRef.current === 'ready' ||
      phaseRef.current === 'sharing'
    ) {
      return;
    }

    setError(null);
    updatePhase('generating');

    void (async () => {
      let pdfUri: string | null = null;
      try {
        const html = buildReceiptHtml({
          ride,
          payments: {
            fare: farePayment,
            tip: tipPayment,
            refund: refundPayment,
          },
          fareTotal,
          paymentBrand,
          paymentLast4,
        });

        let printResult: Print.FilePrintResult;
        try {
          printResult = await Print.printToFileAsync({ html });
        } catch (e) {
          logger.warn('printToFileAsync failed', e);
          const message =
            e instanceof Error
              ? e.message
              : 'Could not generate the PDF. Please try again.';
          setError({ kind: 'pdf_generation_failed', message });
          updatePhase('idle');
          return;
        }

        if (!printResult.uri) {
          // Defensive: the Expo SDK guarantees a `uri` on success but
          // we cover the path because malformed results have surfaced
          // historically when running against a stale dev-client.
          logger.warn('printToFileAsync returned malformed result', {
            result: printResult,
          });
          setError({
            kind: 'pdf_generation_failed',
            message: 'Could not generate the PDF. Please try again.',
          });
          updatePhase('idle');
          return;
        }

        pdfUri = printResult.uri;
        updatePhase('ready');

        const sharingAvailable = await Sharing.isAvailableAsync();
        if (!sharingAvailable) {
          // The temp file was generated successfully but the device
          // can't share it. Cleanup happens here — we hold the temp
          // file only as long as we're going to use it.
          cleanupTempFile(pdfUri);
          pdfUri = null;
          setError({
            kind: 'sharing_unavailable',
            message:
              "Sharing isn't available on this device — try emailing yourself the receipt instead.",
          });
          updatePhase('idle');
          return;
        }

        updatePhase('sharing');
        try {
          await Sharing.shareAsync(pdfUri, {
            mimeType: 'application/pdf',
            dialogTitle: 'YeRide trip receipt',
            UTI: 'com.adobe.pdf',
          });
        } catch (e) {
          logger.warn('Sharing.shareAsync failed', e);
          cleanupTempFile(pdfUri);
          pdfUri = null;
          setError(classifyShareError(e));
          updatePhase('idle');
          return;
        }

        // Success path. Cleanup the temp file; the rider's chosen
        // share target (Files / Mail / etc.) has already taken its
        // own copy by this point.
        cleanupTempFile(pdfUri);
        pdfUri = null;
        updatePhase('shared');
      } catch (e) {
        // Catch-all for anything outside the inner try blocks —
        // mostly defensive against build-receipt-html throwing on a
        // malformed Ride entity (shouldn't happen given the
        // constructor guards, but the cost of the wrapper is tiny).
        logger.error('share receipt unexpected failure', e);
        if (pdfUri !== null) cleanupTempFile(pdfUri);
        setError(classifyShareError(e));
        updatePhase('idle');
      }
    })();
  }, [
    updatePhase,
    ride,
    farePayment,
    tipPayment,
    refundPayment,
    fareTotal,
    paymentBrand,
    paymentLast4,
  ]);

  let state: ReceiptPdfState;
  if (error !== null) {
    state = { kind: 'error', error, onShare, onDismissError };
  } else if (phase === 'generating') {
    state = { kind: 'generating' };
  } else if (phase === 'ready') {
    state = { kind: 'ready' };
  } else if (phase === 'sharing') {
    state = { kind: 'sharing' };
  } else if (phase === 'shared') {
    state = { kind: 'shared', onShare };
  } else {
    state = { kind: 'idle', onShare };
  }

  return { state };
}
