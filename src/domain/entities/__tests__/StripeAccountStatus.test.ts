import { StripeAccountId } from '../StripeAccountId';
import { deriveStripeAccountStatus } from '../StripeAccountStatus';

function acct(): StripeAccountId {
  const r = StripeAccountId.create('acct_1ABC234DEFghij5K');
  if (!r.ok) throw new Error('test setup: acct failed');
  return r.value;
}

describe('deriveStripeAccountStatus', () => {
  it('returns no_account when accountId is null (regardless of flags)', () => {
    expect(
      deriveStripeAccountStatus({
        accountId: null,
        chargesEnabled: false,
        payoutsEnabled: false,
      }),
    ).toEqual({ kind: 'no_account' });

    // Even if flags are true, no accountId still means no account.
    expect(
      deriveStripeAccountStatus({
        accountId: null,
        chargesEnabled: true,
        payoutsEnabled: true,
      }),
    ).toEqual({ kind: 'no_account' });
  });

  it('returns pending when account exists but neither flag is true', () => {
    const id = acct();
    expect(
      deriveStripeAccountStatus({
        accountId: id,
        chargesEnabled: false,
        payoutsEnabled: false,
      }),
    ).toEqual({ kind: 'pending', accountId: id });
  });

  it('returns pending when only charges is true', () => {
    const id = acct();
    expect(
      deriveStripeAccountStatus({
        accountId: id,
        chargesEnabled: true,
        payoutsEnabled: false,
      }),
    ).toEqual({ kind: 'pending', accountId: id });
  });

  it('returns pending when only payouts is true', () => {
    const id = acct();
    expect(
      deriveStripeAccountStatus({
        accountId: id,
        chargesEnabled: false,
        payoutsEnabled: true,
      }),
    ).toEqual({ kind: 'pending', accountId: id });
  });

  it('returns enabled when both flags are true', () => {
    const id = acct();
    expect(
      deriveStripeAccountStatus({
        accountId: id,
        chargesEnabled: true,
        payoutsEnabled: true,
      }),
    ).toEqual({ kind: 'enabled', accountId: id });
  });
});
