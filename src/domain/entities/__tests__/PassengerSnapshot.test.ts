import { Email } from '../Email';
import { PassengerSnapshot } from '../PassengerSnapshot';
import { PaymentMethodId } from '../PaymentMethodId';
import { PersonName } from '../PersonName';
import { PhoneNumber } from '../PhoneNumber';
import { StripeCustomerId } from '../StripeCustomerId';
import { UserId } from '../UserId';

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

const PM_ID = unwrap(PaymentMethodId.create('pm_123abc'));
const CUS_ID = unwrap(StripeCustomerId.create('cus_xyz789'));

const VALID = {
  id: unwrap(UserId.create('aaaaaaaaaaaaaaaaaaaaaaaaaaaa')),
  name: unwrap(PersonName.create({ first: 'Ada', last: 'Lovelace' })),
  email: unwrap(Email.create('ada@yeapp.tech')),
  phoneNumber: unwrap(PhoneNumber.create('+14155551111')),
  pushToken: 'ExponentPushToken[abc123]',
  avatarUrl: 'https://example.com/a.png',
  stripeCustomerId: CUS_ID,
  defaultPaymentMethod: { id: PM_ID, type: 'card' as const },
};

describe('PassengerSnapshot', () => {
  it('constructs from valid props', () => {
    const r = PassengerSnapshot.create(VALID);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.email.value).toBe('ada@yeapp.tech');
      expect(r.value.pushToken).toBe('ExponentPushToken[abc123]');
      expect(String(r.value.stripeCustomerId)).toBe('cus_xyz789');
      expect(r.value.defaultPaymentMethod?.type).toBe('card');
      expect(String(r.value.defaultPaymentMethod?.id)).toBe('pm_123abc');
    }
  });

  it('accepts a snapshot with no avatar / pushToken / payment method', () => {
    const r = PassengerSnapshot.create({
      ...VALID,
      pushToken: null,
      avatarUrl: null,
      stripeCustomerId: null,
      defaultPaymentMethod: null,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.pushToken).toBeNull();
      expect(r.value.avatarUrl).toBeNull();
      expect(r.value.stripeCustomerId).toBeNull();
      expect(r.value.defaultPaymentMethod).toBeNull();
    }
  });

  it('accepts a cash-typed default payment method', () => {
    const r = PassengerSnapshot.create({
      ...VALID,
      defaultPaymentMethod: { id: PM_ID, type: 'cash' as const },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.defaultPaymentMethod?.type).toBe('cash');
    }
  });
});
