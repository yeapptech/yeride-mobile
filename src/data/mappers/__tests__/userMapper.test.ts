import { Email } from '@domain/entities/Email';
import { PaymentMethodId } from '@domain/entities/PaymentMethodId';
import { PersonName } from '@domain/entities/PersonName';
import { PhoneNumber } from '@domain/entities/PhoneNumber';
import { PushToken } from '@domain/entities/PushToken';
import { StripeAccountId } from '@domain/entities/StripeAccountId';
import { StripeCustomerId } from '@domain/entities/StripeCustomerId';
import {
  isDriver,
  isRider,
  makeDriver,
  makeRider,
} from '@domain/entities/User';
import { UserId } from '@domain/entities/UserId';
import { CrashlyticsLogTransport, LOG } from '@shared/logger';
import { FakeCrashReportingService } from '@shared/testing';

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
        expect(String(r.value.stripeCustomerId)).toBe('cus_abc');
        expect(r.value.defaultPaymentMethodId).toBeNull();
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
    const cusR = StripeCustomerId.create('cus_abc');
    if (!cusR.ok) throw cusR.error;
    return makeRider({
      id: uid(),
      email: emailR.value,
      name: nameR.value,
      phone: phoneR.value,
      avatarUrl: 'https://avatars/x.png',
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
      stripeCustomerId: cusR.value,
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
      expect(String(r.value.stripeAccountId)).toBe('acct_legacyABC');
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
      stripeAccountId: 'acct_flatNew',
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
      stripe: {
        id: 'acct_nestedOld',
        charges_enabled: false,
        payouts_enabled: false,
      },
    });
    if (!parsed.ok) throw parsed.error;

    const r = toDomain(uid(), parsed.value);
    expect(r.ok).toBe(true);
    if (r.ok && isDriver(r.value)) {
      expect(String(r.value.stripeAccountId)).toBe('acct_flatNew');
      expect(r.value.stripeChargesEnabled).toBe(true);
      expect(r.value.stripePayoutsEnabled).toBe(true);
    }
  });

  it('writes both flat fields and the nested stripe shape on driver docs (legacy compatibility)', () => {
    const emailR = Email.create('driver@yeapp.tech');
    const nameR = PersonName.create({ first: 'Grace', last: 'Hopper' });
    const acctR = StripeAccountId.create('acct_RIDER');
    if (!emailR.ok || !nameR.ok || !acctR.ok) throw new Error('setup');
    const driver = makeDriver({
      id: uid(),
      email: emailR.value,
      name: nameR.value,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
      stripeAccountId: acctR.value,
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

describe('rider defaultPaymentMethodId round-trip (Phase 6 turn 2)', () => {
  it('reads a populated defaultPaymentMethodId into a branded id', () => {
    const parsed = parseUserDoc({
      email: 'ada@yeapp.tech',
      firstName: 'Ada',
      lastName: 'Lovelace',
      role: 'rider',
      createdDateTime: FIXED_NOW.toISOString(),
      stripeCustomerId: 'cus_ada',
      defaultPaymentMethodId: 'pm_carddefault',
    });
    if (!parsed.ok) throw parsed.error;
    const r = toDomain(uid(), parsed.value);
    expect(r.ok).toBe(true);
    if (r.ok && isRider(r.value)) {
      expect(String(r.value.defaultPaymentMethodId)).toBe('pm_carddefault');
    }
  });

  it('hydrates with null defaultPaymentMethodId when the field is missing', () => {
    const parsed = parseUserDoc({
      email: 'ada@yeapp.tech',
      firstName: 'Ada',
      lastName: 'Lovelace',
      role: 'rider',
      createdDateTime: FIXED_NOW.toISOString(),
    });
    if (!parsed.ok) throw parsed.error;
    const r = toDomain(uid(), parsed.value);
    if (r.ok && isRider(r.value)) {
      expect(r.value.defaultPaymentMethodId).toBeNull();
    }
  });

  it('falls back to null on a malformed defaultPaymentMethodId rather than failing the whole hydration', () => {
    const parsed = parseUserDoc({
      email: 'ada@yeapp.tech',
      firstName: 'Ada',
      lastName: 'Lovelace',
      role: 'rider',
      createdDateTime: FIXED_NOW.toISOString(),
      // Not a `pm_*` prefixed id — branded factory rejects, mapper logs + defaults.
      defaultPaymentMethodId: 'garbage',
    });
    if (!parsed.ok) throw parsed.error;
    const r = toDomain(uid(), parsed.value);
    expect(r.ok).toBe(true);
    if (r.ok && isRider(r.value)) {
      expect(r.value.defaultPaymentMethodId).toBeNull();
    }
  });

  it('writes the rider doc with a populated defaultPaymentMethodId field', () => {
    const emailR = Email.create('ada@yeapp.tech');
    const nameR = PersonName.create({ first: 'Ada', last: 'Lovelace' });
    const cusR = StripeCustomerId.create('cus_ada');
    const pmR = PaymentMethodId.create('pm_carddefault');
    if (!emailR.ok || !nameR.ok || !cusR.ok || !pmR.ok)
      throw new Error('setup');
    const rider = makeRider({
      id: uid(),
      email: emailR.value,
      name: nameR.value,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
      stripeCustomerId: cusR.value,
      defaultPaymentMethodId: pmR.value,
    });
    const doc = toDoc(rider);
    if (doc.role !== 'rider') throw new Error('expected rider doc');
    expect(doc.stripeCustomerId).toBe('cus_ada');
    expect(doc.defaultPaymentMethodId).toBe('pm_carddefault');
  });

  it('writes null when the rider has no default payment method (drops field on merge)', () => {
    const emailR = Email.create('ada@yeapp.tech');
    const nameR = PersonName.create({ first: 'Ada', last: 'Lovelace' });
    if (!emailR.ok || !nameR.ok) throw new Error('setup');
    const rider = makeRider({
      id: uid(),
      email: emailR.value,
      name: nameR.value,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    });
    const doc = toDoc(rider);
    if (doc.role !== 'rider') throw new Error('expected rider doc');
    expect(doc.defaultPaymentMethodId).toBeNull();
  });
});

describe('pushToken round-trip (Phase 9 turn 2)', () => {
  it('reads a populated Expo wrapped pushToken into a branded PushToken', () => {
    const parsed = parseUserDoc({
      email: 'ada@yeapp.tech',
      firstName: 'Ada',
      lastName: 'Lovelace',
      role: 'rider',
      createdDateTime: FIXED_NOW.toISOString(),
      pushToken: 'ExponentPushToken[abc123XYZ]',
    });
    if (!parsed.ok) throw parsed.error;
    const r = toDomain(uid(), parsed.value);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(String(r.value.pushToken)).toBe('ExponentPushToken[abc123XYZ]');
    }
  });

  it('reads a populated raw FCM pushToken into a branded PushToken', () => {
    const parsed = parseUserDoc({
      email: 'driver@yeapp.tech',
      firstName: 'Grace',
      lastName: 'Hopper',
      role: 'driver',
      createdDateTime: FIXED_NOW.toISOString(),
      pushToken: 'fGz7yK_x6kE:APA91bH-_/+',
    });
    if (!parsed.ok) throw parsed.error;
    const r = toDomain(uid(), parsed.value);
    if (r.ok) expect(String(r.value.pushToken)).toBe('fGz7yK_x6kE:APA91bH-_/+');
  });

  it('hydrates with null pushToken when the field is missing', () => {
    const parsed = parseUserDoc({
      email: 'ada@yeapp.tech',
      firstName: 'Ada',
      lastName: 'Lovelace',
      role: 'rider',
      createdDateTime: FIXED_NOW.toISOString(),
    });
    if (!parsed.ok) throw parsed.error;
    const r = toDomain(uid(), parsed.value);
    if (r.ok) expect(r.value.pushToken).toBeNull();
  });

  it('falls back to null on a malformed pushToken rather than failing the whole hydration', () => {
    const parsed = parseUserDoc({
      email: 'ada@yeapp.tech',
      firstName: 'Ada',
      lastName: 'Lovelace',
      role: 'rider',
      createdDateTime: FIXED_NOW.toISOString(),
      // Contains a space — fails both Expo regex AND raw-token regex.
      pushToken: 'broken token with spaces',
    });
    if (!parsed.ok) throw parsed.error;
    const r = toDomain(uid(), parsed.value);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.pushToken).toBeNull();
  });

  it('writes a populated pushToken to the doc as a top-level string', () => {
    const emailR = Email.create('ada@yeapp.tech');
    const nameR = PersonName.create({ first: 'Ada', last: 'Lovelace' });
    const tokenR = PushToken.create('ExponentPushToken[abc]');
    if (!emailR.ok || !nameR.ok || !tokenR.ok) throw new Error('setup');
    const rider = makeRider({
      id: uid(),
      email: emailR.value,
      name: nameR.value,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
      pushToken: tokenR.value,
    });
    const doc = toDoc(rider);
    expect(doc.pushToken).toBe('ExponentPushToken[abc]');
  });

  it('writes null when the user has no pushToken', () => {
    const emailR = Email.create('ada@yeapp.tech');
    const nameR = PersonName.create({ first: 'Ada', last: 'Lovelace' });
    if (!emailR.ok || !nameR.ok) throw new Error('setup');
    const rider = makeRider({
      id: uid(),
      email: emailR.value,
      name: nameR.value,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    });
    const doc = toDoc(rider);
    expect(doc.pushToken).toBeNull();
  });

  it('round-trips: domain → doc → domain preserves the pushToken value', () => {
    const emailR = Email.create('ada@yeapp.tech');
    const nameR = PersonName.create({ first: 'Ada', last: 'Lovelace' });
    const tokenR = PushToken.create('ExponentPushToken[xyz]');
    if (!emailR.ok || !nameR.ok || !tokenR.ok) throw new Error('setup');
    const original = makeRider({
      id: uid(),
      email: emailR.value,
      name: nameR.value,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
      pushToken: tokenR.value,
    });
    const doc = toDoc(original);
    const parsed = parseUserDoc(doc);
    if (!parsed.ok) throw parsed.error;
    const r = toDomain(uid(), parsed.value);
    if (!r.ok) throw r.error;
    expect(String(r.value.pushToken)).toBe('ExponentPushToken[xyz]');
  });
});

/**
 * Phase 9 turn 11 — telemetry: 4 LOG.warn → LOG.error flips on the
 * malformed-id fallback paths in `userMapper.toDomain`. Each must
 * reach `CrashlyticsLogTransport.recordError` via the rawMeta channel
 * (Phase 9 turn 6 contract). Pattern mirrors `Logger.test.ts:244-267`
 * and the Turn 4 / Turn 8 / Turn 9 telemetry test precedent:
 *   - attach a `CrashlyticsLogTransport` to the singleton `LOG`
 *   - drive the failure path
 *   - assert on `fakeCrash.getRecordedErrors()` (constructed-Error
 *     message-substring assertion — the prefix is the Crashlytics
 *     grouping key)
 *   - detach in `try/finally` so subsequent tests in the same Jest
 *     worker don't see leaked transports.
 *
 * Each test asserts the recorded `name === 'YeRide:userMapper'` so
 * Firebase Console groups non-fatals correctly under the mapper's
 * scope.
 */
describe('telemetry — recordError fan-out via rawMeta channel (Phase 9 turn 11)', () => {
  const SCOPE = 'YeRide:userMapper';

  it('malformed stripeCustomerId → recordError fires with constructed Error carrying the stable prefix', () => {
    const fakeCrash = new FakeCrashReportingService();
    const transport = new CrashlyticsLogTransport(fakeCrash);
    LOG.addTransport(transport);
    try {
      const parsed = parseUserDoc({
        email: 'ada@yeapp.tech',
        firstName: 'Ada',
        lastName: 'Lovelace',
        role: 'rider',
        createdDateTime: FIXED_NOW.toISOString(),
        // Wrong prefix — branded factory rejects.
        stripeCustomerId: 'garbage',
      });
      if (!parsed.ok) throw parsed.error;
      const r = toDomain(uid(), parsed.value);
      expect(r.ok).toBe(true);

      const recorded = fakeCrash.getRecordedErrors();
      const found = recorded.find((rec) =>
        rec.error.message.startsWith('user_doc_malformed_stripe_customer_id'),
      );
      expect(found).toBeDefined();
      expect(found?.name).toBe(SCOPE);
    } finally {
      LOG.removeTransport(transport);
    }
  });

  it('malformed stripeAccountId → recordError fires with constructed Error carrying the stable prefix', () => {
    const fakeCrash = new FakeCrashReportingService();
    const transport = new CrashlyticsLogTransport(fakeCrash);
    LOG.addTransport(transport);
    try {
      const parsed = parseUserDoc({
        email: 'driver@yeapp.tech',
        firstName: 'Grace',
        lastName: 'Hopper',
        role: 'driver',
        createdDateTime: FIXED_NOW.toISOString(),
        // Wrong prefix on the flat field.
        stripeAccountId: 'not-an-acct-id',
      });
      if (!parsed.ok) throw parsed.error;
      const r = toDomain(uid(), parsed.value);
      expect(r.ok).toBe(true);

      const recorded = fakeCrash.getRecordedErrors();
      const found = recorded.find((rec) =>
        rec.error.message.startsWith('user_doc_malformed_stripe_account_id'),
      );
      expect(found).toBeDefined();
      expect(found?.name).toBe(SCOPE);
    } finally {
      LOG.removeTransport(transport);
    }
  });

  it('malformed defaultPaymentMethodId → recordError fires with constructed Error carrying the stable prefix', () => {
    const fakeCrash = new FakeCrashReportingService();
    const transport = new CrashlyticsLogTransport(fakeCrash);
    LOG.addTransport(transport);
    try {
      const parsed = parseUserDoc({
        email: 'ada@yeapp.tech',
        firstName: 'Ada',
        lastName: 'Lovelace',
        role: 'rider',
        createdDateTime: FIXED_NOW.toISOString(),
        defaultPaymentMethodId: 'garbage', // wrong prefix
      });
      if (!parsed.ok) throw parsed.error;
      const r = toDomain(uid(), parsed.value);
      expect(r.ok).toBe(true);

      const recorded = fakeCrash.getRecordedErrors();
      const found = recorded.find((rec) =>
        rec.error.message.startsWith('user_doc_malformed_payment_method_id'),
      );
      expect(found).toBeDefined();
      expect(found?.name).toBe(SCOPE);
    } finally {
      LOG.removeTransport(transport);
    }
  });

  it('malformed pushToken → recordError fires with constructed Error carrying the stable prefix', () => {
    const fakeCrash = new FakeCrashReportingService();
    const transport = new CrashlyticsLogTransport(fakeCrash);
    LOG.addTransport(transport);
    try {
      const parsed = parseUserDoc({
        email: 'ada@yeapp.tech',
        firstName: 'Ada',
        lastName: 'Lovelace',
        role: 'rider',
        createdDateTime: FIXED_NOW.toISOString(),
        // Spaces fail both Expo and raw FCM regexes.
        pushToken: 'broken token with spaces',
      });
      if (!parsed.ok) throw parsed.error;
      const r = toDomain(uid(), parsed.value);
      expect(r.ok).toBe(true);

      const recorded = fakeCrash.getRecordedErrors();
      const found = recorded.find((rec) =>
        rec.error.message.startsWith('user_doc_malformed_push_token'),
      );
      expect(found).toBeDefined();
      expect(found?.name).toBe(SCOPE);
    } finally {
      LOG.removeTransport(transport);
    }
  });
});
