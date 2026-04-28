import { Email } from '../Email';
import { PassengerSnapshot } from '../PassengerSnapshot';
import { PersonName } from '../PersonName';
import { PhoneNumber } from '../PhoneNumber';
import { UserId } from '../UserId';

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

const VALID = {
  id: unwrap(UserId.create('aaaaaaaaaaaaaaaaaaaaaaaaaaaa')),
  name: unwrap(PersonName.create({ first: 'Ada', last: 'Lovelace' })),
  email: unwrap(Email.create('ada@yeapp.tech')),
  phoneNumber: unwrap(PhoneNumber.create('+14155551111')),
  pushToken: 'ExponentPushToken[abc123]',
  avatarUrl: 'https://example.com/a.png',
  defaultPaymentMethod: 'pm_123abc',
};

describe('PassengerSnapshot', () => {
  it('constructs from valid props', () => {
    const r = PassengerSnapshot.create(VALID);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.email.value).toBe('ada@yeapp.tech');
      expect(r.value.pushToken).toBe('ExponentPushToken[abc123]');
      expect(r.value.defaultPaymentMethod).toBe('pm_123abc');
    }
  });

  it('accepts a snapshot with no avatar / pushToken / payment method', () => {
    const r = PassengerSnapshot.create({
      ...VALID,
      pushToken: null,
      avatarUrl: null,
      defaultPaymentMethod: null,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.pushToken).toBeNull();
      expect(r.value.avatarUrl).toBeNull();
      expect(r.value.defaultPaymentMethod).toBeNull();
    }
  });
});
