import type { StripeAccountId } from './StripeAccountId';

/**
 * The four states a driver's Stripe Connect onboarding can be in, as far as
 * the rewrite needs to surface in the Earnings tab.
 *
 *   - `no_account`:  no `stripeAccountId` on the user doc yet. The driver
 *                    has never started Connect onboarding. Earnings tab
 *                    shows the "Set up payouts" CTA.
 *   - `pending`:     account exists but at least one of charges_enabled /
 *                    payouts_enabled is false. Stripe is still verifying
 *                    paperwork. Earnings tab shows "We're verifying your
 *                    account" with a "Continue setup" button that re-opens
 *                    the account-link URL.
 *   - `enabled`:     both flags true. The driver can take rides and receive
 *                    payouts. Earnings tab shows the dashboard.
 *   - `disabled`:    explicitly NOT modeled today. Stripe's `accounts/<id>`
 *                    payload exposes `requirements.disabled_reason` when
 *                    Stripe has paused the account (KYC failure, fraud
 *                    review, etc.). We fold that into `pending` for now and
 *                    surface "Continue setup" — same recovery path as a
 *                    fresh account that hasn't completed onboarding. Add a
 *                    dedicated `disabled` arm here if/when the UI grows a
 *                    distinct copy block.
 */
export type StripeAccountStatus =
  | { readonly kind: 'no_account' }
  | { readonly kind: 'pending'; readonly accountId: StripeAccountId }
  | { readonly kind: 'enabled'; readonly accountId: StripeAccountId };

/**
 * Pure derivation from the three flat fields on the driver's user doc. Total
 * function — no Result, no factory ceremony — because every input
 * combination has a defined output.
 *
 *   { accountId: null, ... }                          → { kind: 'no_account' }
 *   { accountId: 'acct_X', charges: F | payouts: F }  → { kind: 'pending', ... }
 *   { accountId: 'acct_X', charges: T, payouts: T }   → { kind: 'enabled', ... }
 */
export function deriveStripeAccountStatus(args: {
  accountId: StripeAccountId | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
}): StripeAccountStatus {
  if (args.accountId === null) return { kind: 'no_account' };
  if (args.chargesEnabled && args.payoutsEnabled) {
    return { kind: 'enabled', accountId: args.accountId };
  }
  return { kind: 'pending', accountId: args.accountId };
}
