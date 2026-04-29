import { Email } from '@domain/entities/Email';
import { PersonName } from '@domain/entities/PersonName';
import { PhoneNumber } from '@domain/entities/PhoneNumber';
import {
  isDriver,
  isRider,
  makeDriver,
  makeRider,
} from '@domain/entities/User';
import { UserId } from '@domain/entities/UserId';

import { parseUserDoc, toDoc, toDomain } from '../userMapper';

const FIXED_NOW = new Date('2026-04-27T00:00:00Z');

function uid() {
  const r = UserId.create('aaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  if (!r.ok) throw r.error;
  return r.value;
}

describe('parseUserDoc', () => {
  it('accepts a minimal valid rider doc', () => {
    const r = parseUserDoc({
      email: 'ada@yeapp.tech',
      firstName: 'Ada',
      lastName: 'Lovelace',
      role: 'rider',
      createdDateTime: FIXED_NOW.toISOString(),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.role).toBe('rider');
      expect(r.value.emailVerified).toBe(false); // default
      expect(r.value.savedPlaces).toEqual([]); // default
    }
  });

  it('accepts a fully-populated driver doc with legacy fields', () => {
    const r = parseUserDoc({
      email: 'driver@yeapp.tech',
      firstName: 'Grace',
      lastName: 'Hopper',
      phone: '+14155550123', // legacy alias
      role: 'driver',
      emailVerified: true,
      avatar: 'https://avatars/g.png',
      activeVehicleId: 'VIN12345',
      vehicleIds: ['VIN12345'],
      createdDateTime: FIXED_NOW.toISOString(),
      savedPlaces: [
        {
          place_id: 'home',
          label: 'Home',
          address: '1 Main St',
          latitude: 37.4275,
          longitude: -122.1697,
        },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.role).toBe('driver');
      if (r.value.role === 'driver') {
        expect(r.value.activeVehicleId).toBe('VIN12345');
        expect(r.value.vehicleIds).toEqual(['VIN12345']);
      }
    }
  });

  it('rejects a doc with unknown role', () => {
    const r = parseUserDoc({
      email: 'x@y.com',
      firstName: 'X',
      lastName: 'Y',
      role: 'admin',
      createdDateTime: FIXED_NOW.toISOString(),
    });
    expect(r.ok).toBe(false);
  });

  it('rejects malformed email', () => {
    const r = parseUserDoc({
      email: 'not-email',
      firstName: 'X',
      lastName: 'Y',
      role: 'rider',
      createdDateTime: FIXED_NOW.toISOString(),
    });
    expect(r.ok).toBe(false);
  });

  it('rejects out-of-range coordinates', () => {
    const r = parseUserDoc({
      email: 'x@y.com',
      firstName: 'X',
      lastName: 'Y',
      role: 'rider',
      createdDateTime: FIXED_NOW.toISOString(),
      savedPlaces: [
        {
          place_id: 'home',
          label: 'Home',
          address: '1 Main St',
          latitude: 91,
          longitude: 0,
        },
      ],
    });
    expect(r.ok).toBe(false);
  });
});

describe('toDomain', () => {
  it('builds a Rider with all fields populated', () => {
    const parsed = parseUserDoc({
      email: 'ada@yeapp.tech',
      firstName: 'Ada',
      lastName: 'Lovelace',
      phoneNumber: '+14155550123',
      role: 'rider',
      emailVerified: true,
      avatar: 'https://avatars/x.png',
      stripeCustomerId: 'cus_abc',
      createdDateTime: FIXED_NOW.toISOString(),
      updatedDateTime: FIXED_NOW.toISOString(),
      savedPlaces: [
        {
          place_id: 'home',
          label: 'Home',
          address: '1 Main St',
          latitude: 37.4275,
          longitude: -122.1697,
        },
      ],
    });
    if (!parsed.ok) throw parsed.error;
    const r = toDomain(uid(), parsed.value);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(isRider(r.value)).toBe(true);
      expect(r.value.email.value).toBe('ada@yeapp.tech');
      expect(r.value.name.full).toBe('Ada Lovelace');
      expect(r.value.phone?.value).toBe('+14155550123');
      expect(r.value.emailVerified).toBe(true);
      expect(r.value.avatarUrl).toBe('https://avatars/x.png');
      expect(r.value.savedPlaces).toHaveLength(1);
      if (isRider(r.value)) {
        expect(r.value.stripeCustomerId).toBe('cus_abc');
      }
    }
  });

  it('builds a Driver with default Stripe Connect state', () => {
    const parsed = parseUserDoc({
      email: 'driver@yeapp.tech',
      firstName: 'Grace',
      lastName: 'Hopper',
      role: 'driver',
      createdDateTime: FIXED_NOW.toISOString(),
    });
    if (!parsed.ok) throw parsed.error;
    const r = toDomain(uid(), parsed.value);
    expect(r.ok).toBe(true);
    if (r.ok && isDriver(r.value)) {
      expect(r.value.stripeAccountId).toBeNull();
      expect(r.value.stripeChargesEnabled).toBe(false);
      expect(r.value.stripePayoutsEnabled).toBe(false);
      expect(r.value.activeVehicleId).toBeNull();
      expect(r.value.vehicleIds).toEqual([]);
    }
  });

  it('falls back to legacy `phone` field when `phoneNumber` is absent', () => {
    const parsed = parseUserDoc({
      email: 'x@y.com',
      firstName: 'X',
      lastName: 'Y',
      role: 'rider',
      phone: '+14155550123',
      createdDateTime: FIXED_NOW.toISOString(),
    });
    if (!parsed.ok) throw parsed.error;
    const r = toDomain(uid(), parsed.value);
    if (r.ok) expect(r.value.phone?.value).toBe('+14155550123');
  });

  it('uses createdDateTime as updatedAt when updatedDateTime is missing', () => {
    const parsed = parseUserDoc({
      email: 'x@y.com',
      firstName: 'X',
      lastName: 'Y',
      role: 'rider',
      createdDateTime: FIXED_NOW.toISOString(),
    });
    if (!parsed.ok) throw parsed.error;
    const r = toDomain(uid(), parsed.value);
    if (r.ok)
      expect(r.value.updatedAt.toISOString()).toBe(FIXED_NOW.toISOString());
  });

  it('rejects malformed createdDateTime', () => {
    const parsed = parseUserDoc({
      email: 'x@y.com',
      firstName: 'X',
      lastName: 'Y',
      role: 'rider',
      createdDateTime: 'not-a-date',
    });
    if (!parsed.ok) throw parsed.error;
    const r = toDomain(uid(), parsed.value);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('user_doc_invalid_date');
  });
});

describe('toDoc', () => {
  function makeUser() {
    const emailR = Email.create('ada@yeapp.tech');
    if (!emailR.ok) throw emailR.error;
    const nameR = PersonName.create({ first: 'Ada', last: 'Lovelace' });
    if (!nameR.ok) throw nameR.error;
    const phoneR = PhoneNumber.create('+14155550123');
    if (!phoneR.ok) throw phoneR.error;
    return makeRider({
      id: uid(),
      email: emailR.value,
      name: nameR.value,
      phone: phoneR.value,
      avatarUrl: 'https://avatars/x.png',
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
      stripeCustomerId: 'cus_abc',
    });
  }

  it('serializes a Rider to the canonical wire shape', () => {
    const doc = toDoc(makeUser());
    expect(doc).toMatchObject({
      role: 'rider',
      email: 'ada@yeapp.tech',
      firstName: 'Ada',
      lastName: 'Lovelace',
      phoneNumber: '+14155550123',
      avatar: 'https://avatars/x.png',
      stripeCustomerId: 'cus_abc',
    });
    expect(doc.createdDateTime).toBe(FIXED_NOW.toISOString());
    expect(doc.updatedDateTime).toBe(FIXED_NOW.toISOString());
  });

  it('round-trips: domain → doc → domain', () => {
    const original = makeUser();
    const doc = toDoc(original);
    const parsed = parseUserDoc(doc);
    if (!parsed.ok) throw parsed.error;
    const r = toDomain(uid(), parsed.value);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.email.value).toBe(original.email.value);
      expect(r.value.name.full).toBe(original.name.full);
      expect(r.value.phone?.value).toBe(original.phone?.value);
      expect(r.value.avatarUrl).toBe(original.avatarUrl);
      expect(r.value.role).toBe(original.role);
    }
  });

  it('serializes null phone as null, not undefined', () => {
    const emailR = Email.create('ada@yeapp.tech');
    const nameR = PersonName.create({ first: 'A', last: 'B' });
    if (!emailR.ok || !nameR.ok) throw new Error('setup');
    const user = makeRider({
      id: uid(),
      email: emailR.value,
      name: nameR.value,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    });
    const doc = toDoc(user);
    expect(doc.phoneNumber).toBeNull();
  });
});

describe('legacy nested stripe shape on driver docs', () => {
  it('reads the legacy nested stripe object when flat fields are absent', () => {
    // This is what an existing legacy-yeride driver currently has on disk.
    const parsed = parseUserDoc({
      email: 'driver@yeapp.tech',
      firstName: 'Grace',
      lastName: 'Hopper',
      role: 'driver',
      createdDateTime: FIXED_NOW.toISOString(),
      stripe: {
        id: 'acct_legacyABC',
        charges_enabled: true,
        payouts_enabled: false,
        // Stripe response carries many other fields — they should
        // round-trip through passthrough without affecting the parse.
        country: 'US',
        default_currency: 'usd',
      },
    });
    if (!parsed.ok) throw parsed.error;

    const r = toDomain(uid(), parsed.value);
    expect(r.ok).toBe(true);
    if (r.ok && isDriver(r.value)) {
      expect(r.value.stripeAccountId).toBe('acct_legacyABC');
      expect(r.value.stripeChargesEnabled).toBe(true);
      expect(r.value.stripePayoutsEnabled).toBe(false);
    }
  });

  it('prefers flat fields when both flat and nested are present (rewrite has won the cleanup)', () => {
    const parsed = parseUserDoc({
      email: 'driver@yeapp.tech',
      firstName: 'Grace',
      lastName: 'Hopper',
      role: 'driver',
      createdDateTime: FIXED_NOW.toISOString(),
      stripeAccountId: 'acct_FLAT_NEW',
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
      stripe: {
        id: 'acct_NESTED_OLD',
        charges_enabled: false,
        payouts_enabled: false,
      },
    });
    if (!parsed.ok) throw parsed.error;

    const r = toDomain(uid(), parsed.value);
    expect(r.ok).toBe(true);
    if (r.ok && isDriver(r.value)) {
      expect(r.value.stripeAccountId).toBe('acct_FLAT_NEW');
      expect(r.value.stripeChargesEnabled).toBe(true);
      expect(r.value.stripePayoutsEnabled).toBe(true);
    }
  });

  it('writes both flat fields and the nested stripe shape on driver docs (legacy compatibility)', () => {
    const emailR = Email.create('driver@yeapp.tech');
    const nameR = PersonName.create({ first: 'Grace', last: 'Hopper' });
    if (!emailR.ok || !nameR.ok) throw new Error('setup');
    const driver = makeDriver({
      id: uid(),
      email: emailR.value,
      name: nameR.value,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
      stripeAccountId: 'acct_RIDER',
      stripeChargesEnabled: true,
      stripePayoutsEnabled: false,
    });
    const doc = toDoc(driver);

    if (doc.role !== 'driver') throw new Error('expected driver doc');
    expect(doc.stripeAccountId).toBe('acct_RIDER');
    expect(doc.stripeChargesEnabled).toBe(true);
    expect(doc.stripePayoutsEnabled).toBe(false);
    // Legacy nested shape also written, so legacy yeride keeps reading state.
    expect(doc.stripe).toEqual({
      id: 'acct_RIDER',
      charges_enabled: true,
      payouts_enabled: false,
    });
  });

  it('omits the nested stripe shape when the driver has no Stripe Connect account yet', () => {
    const emailR = Email.create('driver@yeapp.tech');
    const nameR = PersonName.create({ first: 'Grace', last: 'Hopper' });
    if (!emailR.ok || !nameR.ok) throw new Error('setup');
    const driver = makeDriver({
      id: uid(),
      email: emailR.value,
      name: nameR.value,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    });
    const doc = toDoc(driver);
    if (doc.role !== 'driver') throw new Error('expected driver doc');
    expect(doc.stripeAccountId).toBeNull();
    expect(doc.stripe).toBeNull();
  });
});
