import { z } from 'zod';

/**
 * Shape of a Firestore `trips/{tripId}/payments/{paymentId}` document.
 * Written exclusively by the Stripe webhook → Cloud Function pipeline; the
 * client cannot write here (Firestore rules deny). Read-only on the client.
 *
 * Field semantics:
 *   - `type`: 'fare' (the ride fare), 'tip' (rider's optional gratuity),
 *     'refund' (cancellation refund or post-trip dispute resolution).
 *   - `amount`: INTEGER CENTS — Stripe-native unit. The webhook server
 *     (yeride-stripe-server/stripe/routes.js:132) writes the raw
 *     `pi.amount` from the Stripe Charge/PaymentIntent, which is always
 *     an integer in the smallest currency unit. Maps to `Money` via
 *     `Money.create(amount, 'USD')` (NOT `fromMajor` — that's a 100x
 *     bug we hit during the Phase 9 turn 4 smoke). The webhook also
 *     writes a sibling `amountInDollars` field which the rewrite
 *     ignores (cents-as-integer is the source of truth).
 *   - `status`: Stripe-derived terminal state for the payment row —
 *     'succeeded', 'failed', or 'refunded'.
 *   - `createdAt`: ISO string. Used for ordering on the receipt screen
 *     (descending).
 */

export const TripPaymentDocSchema = z.object({
  type: z.enum(['fare', 'tip', 'refund']),
  // Integer cents (Stripe-native). `.int()` enforces the contract — Stripe
  // amounts are ALWAYS integers in the smallest currency unit; a non-
  // integer here would be a wire-format break worth surfacing as a parse
  // failure rather than silently truncating.
  amount: z.number().int().finite().gte(0),
  status: z.enum(['succeeded', 'failed', 'refunded']),
  createdAt: z.string().min(1),
});

export type TripPaymentDoc = z.infer<typeof TripPaymentDocSchema>;
