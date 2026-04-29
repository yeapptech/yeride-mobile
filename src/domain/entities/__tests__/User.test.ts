import { Address } from '../Address';
import { Coordinates } from '../Coordinates';
import { Email } from '../Email';
import { PaymentMethodId } from '../PaymentMethodId';
import { PersonName } from '../PersonName';
import { PhoneNumber } from '../PhoneNumber';
import { SavedPlace, SavedPlaceId } from '../SavedPlace';
import { StripeAccountId } from '../StripeAccountId';
import { StripeCustomerId } from '../StripeCustomerId';
import {
  isDriver,
  isRider,
  makeDriver,
  makeRider,
  makeUser,
  removeSavedPlace,
  setAvatarUrl,
  setDefaultPaymentMethodId,
  setEmail,
  setEmailVerified,
  setStripeAccountFlags,
  setStripeAccountId,
  setStripeCustomerId,
  updateProfile,
  upsertSavedPlace,
  type Rider,
  type Driver,
  type User,
} from '../User';
import { UserId } from '../UserId';

const FIXED_NOW = new Date('2026-04-27T00:00:00Z');
const LATER = new Date('2026-04-28T00:00:00Z');

function uid(): ReturnType<typeof UserId.create> extends infer R
  ? R extends { ok: true; value: infer V }
    ? V
    : never
  : never {
  const r = UserId.create('aaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  if (!r.ok) throw r.error;
  return r.value;
}

function email(value = 'user@yeapp.tech'): Email {
  const r = Email.create(value);
  if (!r.ok) throw r.error;
  return r.value;
}

function name(): PersonName {
  const r = PersonName.create({ first: 'Ada', last: 'Lovelace' });
  if (!r.ok) throw r.error;
  return r.value;
}

function phone(): PhoneNumber {
  const r = PhoneNumber.create('+14155550123');
  if (!r.ok) throw r.error;
  return r.value;
}

function makePlace(idValue = 'home'): SavedPlace {
  const idR = SavedPlaceId.create(idValue);
  if (!idR.ok) throw idR.error;
  const coords = Coordinates.create(37.4275, -122.1697);
  if (!coords.ok) throw coords.error;
  const addr = Address.create({
    label: '1 Main St',
    coordinates: coords.value,
  });
  if (!addr.ok) throw addr.error;
  const p = SavedPlace.create({
    id: idR.value,
    label: 'Home',
    address: addr.value,
  });
  if (!p.ok) throw p.error;
  return p.value;
}

const baseArgs = (): Parameters<typeof makeRider>[0] => ({
  id: uid(),
  email: email(),
  name: name(),
  phone: phone(),
  createdAt: FIXED_NOW,
  updatedAt: FIXED_NOW,
});

describe('User factories', () => {
  describe('makeRider', () => {
    it('produces a Rider with default null Stripe customer id', () => {
      const r = makeRider(baseArgs());
      expect(r.role).toBe('rider');
      expect(r.stripeCustomerId).toBeNull();
      expect(r.emailVerified).toBe(false);
      expect(r.savedPlaces).toEqual([]);
      expect(r.avatarUrl).toBeNull();
    });

    it('preserves provided Stripe customer id', () => {
      const cusR = StripeCustomerId.create('cus_abc');
      if (!cusR.ok) throw cusR.error;
      const r = makeRider({ ...baseArgs(), stripeCustomerId: cusR.value });
      expect(String(r.stripeCustomerId)).toBe('cus_abc');
    });

    it('produces a Rider with default null defaultPaymentMethodId', () => {
      const r = makeRider(baseArgs());
      expect(r.defaultPaymentMethodId).toBeNull();
    });
  });

  describe('makeDriver', () => {
    it('produces a Driver with empty Stripe Connect + vehicle state', () => {
      const d = makeDriver(baseArgs());
      expect(d.role).toBe('driver');
      expect(d.stripeAccountId).toBeNull();
      expect(d.stripeChargesEnabled).toBe(false);
      expect(d.stripePayoutsEnabled).toBe(false);
      expect(d.activeVehicleId).toBeNull();
      expect(d.vehicleIds).toEqual([]);
    });
  });

  describe('makeUser', () => {
    it('branches on role', () => {
      const r = makeUser('rider', baseArgs());
      const d = makeUser('driver', baseArgs());
      expect(r.role).toBe('rider');
      expect(d.role).toBe('driver');
    });
  });
});

describe('User update helpers', () => {
  it('setEmailVerified marks user verified and bumps updatedAt', () => {
    const u = makeRider(baseArgs());
    const v = setEmailVerified(u, true, LATER);
    expect(v.emailVerified).toBe(true);
    expect(v.updatedAt).toBe(LATER);
    expect(u.emailVerified).toBe(false); // original unchanged
  });

  it('setEmailVerified is a no-op when already at the target value', () => {
    const u = makeRider(baseArgs());
    expect(setEmailVerified(u, false, LATER)).toBe(u);
  });

  it('setEmail clears the verification flag', () => {
    const verified: Rider = setEmailVerified(
      makeRider(baseArgs()),
      true,
      FIXED_NOW,
    ) as Rider;
    expect(verified.emailVerified).toBe(true);
    const updated = setEmail(verified, email('new@yeapp.tech'), LATER);
    expect(updated.email.value).toBe('new@yeapp.tech');
    expect(updated.emailVerified).toBe(false);
    expect(updated.updatedAt).toBe(LATER);
  });

  it('updateProfile patches name and phone independently', () => {
    const u = makeRider(baseArgs());
    const newName = PersonName.create({ first: 'Grace', last: 'Hopper' });
    if (!newName.ok) throw newName.error;
    const u2 = updateProfile(u, { name: newName.value }, LATER);
    expect(u2.name.full).toBe('Grace Hopper');
    expect(u2.phone).toBe(u.phone);
    expect(u2.updatedAt).toBe(LATER);
  });

  it('updateProfile can clear phone with explicit null', () => {
    const u = makeRider(baseArgs());
    const u2 = updateProfile(u, { phone: null }, LATER);
    expect(u2.phone).toBeNull();
  });

  it('updateProfile leaves phone untouched when undefined', () => {
    const u = makeRider(baseArgs());
    const u2 = updateProfile(u, { name: u.name }, LATER);
    expect(u2.phone).toBe(u.phone);
  });

  it('setAvatarUrl can set and clear', () => {
    const u = makeRider(baseArgs());
    const u2 = setAvatarUrl(u, 'https://avatars/x.png', LATER);
    expect(u2.avatarUrl).toBe('https://avatars/x.png');
    const u3 = setAvatarUrl(u2, null, LATER);
    expect(u3.avatarUrl).toBeNull();
  });
});

describe('Saved-places helpers', () => {
  it('upsertSavedPlace adds a new place', () => {
    const u = makeRider(baseArgs());
    const u2 = upsertSavedPlace(u, makePlace('home'), LATER);
    expect(u2.savedPlaces).toHaveLength(1);
    expect(u2.savedPlaces[0]?.id).toBe('home');
  });

  it('upsertSavedPlace replaces an existing place by id', () => {
    let u: User = makeRider(baseArgs());
    u = upsertSavedPlace(u, makePlace('home'), FIXED_NOW);
    const updated = makePlace('home');
    u = upsertSavedPlace(u, updated, LATER);
    expect(u.savedPlaces).toHaveLength(1);
  });

  it('removeSavedPlace strips a saved place', () => {
    let u: User = makeRider(baseArgs());
    const placeR = SavedPlaceId.create('home');
    if (!placeR.ok) throw placeR.error;
    u = upsertSavedPlace(u, makePlace('home'), FIXED_NOW);
    u = removeSavedPlace(u, placeR.value, LATER);
    expect(u.savedPlaces).toHaveLength(0);
  });

  it('removeSavedPlace is a no-op when id not found', () => {
    const u = makeRider(baseArgs());
    const missingR = SavedPlaceId.create('nonexistent');
    if (!missingR.ok) throw missingR.error;
    expect(removeSavedPlace(u, missingR.value, LATER)).toBe(u);
  });
});

describe('Stripe state helpers', () => {
  function rider(): Rider {
    return makeRider(baseArgs());
  }
  function driver(): Driver {
    return makeDriver(baseArgs());
  }
  function cusId(value = 'cus_abc'): StripeCustomerId {
    const r = StripeCustomerId.create(value);
    if (!r.ok) throw r.error;
    return r.value;
  }
  function acctId(value = 'acct_xyz'): StripeAccountId {
    const r = StripeAccountId.create(value);
    if (!r.ok) throw r.error;
    return r.value;
  }
  function pmId(value = 'pm_card1'): PaymentMethodId {
    const r = PaymentMethodId.create(value);
    if (!r.ok) throw r.error;
    return r.value;
  }

  it('setStripeCustomerId sets the id and bumps updatedAt', () => {
    const r = rider();
    const next = setStripeCustomerId(r, cusId(), LATER);
    expect(String(next.stripeCustomerId)).toBe('cus_abc');
    expect(next.updatedAt).toBe(LATER);
  });

  it('setStripeCustomerId is a no-op when the id is already the same', () => {
    const r0 = rider();
    const r1 = setStripeCustomerId(r0, cusId(), LATER);
    const r2 = setStripeCustomerId(r1, cusId(), new Date('2030-01-01Z'));
    expect(r2).toBe(r1);
  });

  it('setDefaultPaymentMethodId sets and clears with explicit null', () => {
    const r0 = rider();
    const set = setDefaultPaymentMethodId(r0, pmId(), LATER);
    expect(String(set.defaultPaymentMethodId)).toBe('pm_card1');
    const cleared = setDefaultPaymentMethodId(set, null, LATER);
    expect(cleared.defaultPaymentMethodId).toBeNull();
  });

  it('setStripeAccountId sets the id on a driver', () => {
    const d = driver();
    const next = setStripeAccountId(d, acctId(), LATER);
    expect(String(next.stripeAccountId)).toBe('acct_xyz');
    expect(next.updatedAt).toBe(LATER);
  });

  it('setStripeAccountFlags updates only when changed', () => {
    const d0 = driver();
    const enabled = setStripeAccountFlags(
      d0,
      { chargesEnabled: true, payoutsEnabled: true },
      LATER,
    );
    expect(enabled.stripeChargesEnabled).toBe(true);
    expect(enabled.stripePayoutsEnabled).toBe(true);
    expect(enabled.updatedAt).toBe(LATER);
    // Same flags → no-op (returns the same instance).
    const same = setStripeAccountFlags(
      enabled,
      { chargesEnabled: true, payoutsEnabled: true },
      new Date('2099-01-01Z'),
    );
    expect(same).toBe(enabled);
  });
});

describe('Type guards', () => {
  it('isRider narrows', () => {
    const u: User = makeRider(baseArgs());
    expect(isRider(u)).toBe(true);
    if (isRider(u)) {
      // TS narrows; this assignment proves it
      const _r: Rider = u;
      expect(_r.role).toBe('rider');
    }
  });

  it('isDriver narrows', () => {
    const u: User = makeDriver(baseArgs());
    expect(isDriver(u)).toBe(true);
    if (isDriver(u)) {
      const _d: Driver = u;
      expect(_d.role).toBe('driver');
    }
  });
});
