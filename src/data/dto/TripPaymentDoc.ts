import { z } from 'zod';

/**
 * Shape of a Firestore `trips/{tripId}/payments/{paymentId}` document.
 * Written exclusively by the Stripe webhook → Cloud Function pipeline; the
 * client cannot write here (Firestore rules deny). Read-only on the client.
 *
 * Field semantics:
 *   - `type`: 'fare' (the ride fare), 'tip' (rider's optional gratuity),
 *     'refund' (cancellation refund or post-trip dispute resolution).
 *   - `amount`: PLAIN NUMBER IN DOLLARS. Mapped to `Money` USD minor units.
 *   - `status`: Stripe-derived terminal state for the payment row —
 *     'succeeded', 'failed', or 'refunded'.
 *   - `createdAt`: ISO string. Used for ordering on the receipt screen
 *     (descending).
 */

export const TripPaymentDocSchema = z.object({
  type: z.enum(['fare', 'tip', 'refund']),
  amount: z.number().finite().gte(0),
  status: z.enum(['succeeded', 'failed', 'refunded']),
  createdAt: z.string().min(1),
});

export type TripPaymentDoc = z.infer<typeof TripPaymentDocSchema>;
