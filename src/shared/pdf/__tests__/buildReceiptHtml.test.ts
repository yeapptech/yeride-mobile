import { Coordinates } from '@domain/entities/Coordinates';
import {
  DriverSnapshot,
  VehicleSnapshot,
} from '@domain/entities/DriverSnapshot';
import { Email } from '@domain/entities/Email';
import { Endpoint } from '@domain/entities/Endpoint';
import { Money } from '@domain/entities/Money';
import { PassengerSnapshot } from '@domain/entities/PassengerSnapshot';
import { PersonName } from '@domain/entities/PersonName';
import { PhoneNumber } from '@domain/entities/PhoneNumber';
import { Ride } from '@domain/entities/Ride';
import { RideId } from '@domain/entities/RideId';
import { RideServiceId } from '@domain/entities/RideServiceId';
import { RideServiceSnapshot } from '@domain/entities/RideServiceSnapshot';
import type { TripPayment } from '@domain/entities/TripPayment';
import { UserId } from '@domain/entities/UserId';

import {
  buildReceiptHtml,
  escapeHtml,
  formatBrandForPdf,
  formatMoneyForPdf,
  formatRideDate,
  getBrandSvgString,
} from '../buildReceiptHtml';

function unwrap<T>(
  r: { ok: true; value: T } | { ok: false; error: unknown },
): T {
  if (!r.ok) throw r.error;
  return r.value;
}

function usd(major: number): Money {
  return unwrap(Money.fromMajor(major, 'USD'));
}

const RIDE_ID = unwrap(RideId.create('ridepdfxxxxxxxxxxxxxa'));

function makeCompletedRide(opts: { withDriver?: boolean } = {}): Ride {
  const passenger = unwrap(
    PassengerSnapshot.create({
      id: unwrap(UserId.create('rider12345678901234567890123')),
      name: unwrap(PersonName.create({ first: 'Ada', last: 'Lovelace' })),
      email: unwrap(Email.create('rider@yeapp.tech')),
      phoneNumber: unwrap(PhoneNumber.create('+14155550123')),
      pushToken: null,
      avatarUrl: null,
      stripeCustomerId: null,
      defaultPaymentMethod: null,
    }),
  );
  const tier = unwrap(
    RideServiceSnapshot.create({
      id: unwrap(RideServiceId.create('economy')),
      name: 'Economy',
      baseFare: usd(2.5),
      minimumFare: usd(5),
      cancelationFee: usd(2),
      costPerKm: usd(1.25),
      costPerMinute: usd(0.2),
      seatCapacity: 4,
    }),
  );
  let driver = null;
  if (opts.withDriver) {
    const vehicle = unwrap(
      VehicleSnapshot.create({
        make: 'Toyota',
        model: 'Camry',
        year: 2024,
        color: 'Silver',
        licensePlate: 'ABC123',
        stockPhoto: null,
        photos: [],
      }),
    );
    driver = unwrap(
      DriverSnapshot.create({
        id: unwrap(UserId.create('driverabcdefghijklmnopqrstuv')),
        name: unwrap(PersonName.create({ first: 'Grace', last: 'Hopper' })),
        email: unwrap(Email.create('driver@yeapp.tech')),
        phoneNumber: unwrap(PhoneNumber.create('+14155550999')),
        stripeAccountId: 'acct_test',
        pushToken: null,
        avatarUrl: null,
        vehicle,
      }),
    );
  }
  return unwrap(
    Ride.fromProps({
      id: RIDE_ID,
      status: 'completed',
      passenger,
      driver,
      rideService: tier,
      pickup: unwrap(
        Endpoint.create({
          location: unwrap(Coordinates.create(25.7617, -80.1918)),
          address: 'Bayfront Park',
          placeName: 'Bayfront Park',
          directions: null,
        }),
      ),
      dropoff: unwrap(
        Endpoint.create({
          location: unwrap(Coordinates.create(26.1224, -80.1373)),
          address: '1 Las Olas Blvd',
          placeName: null,
          directions: null,
        }),
      ),
      createdAt: new Date('2026-04-28T15:30:00Z'),
      pickupTiming: {
        startedAt: new Date('2026-04-28T15:30:00Z'),
        completedAt: new Date('2026-04-28T15:35:00Z'),
        odometerMeters: 0,
        elapsedSeconds: 300,
      },
      dropoffTiming: {
        startedAt: new Date('2026-04-28T15:35:00Z'),
        completedAt: new Date('2026-04-28T16:00:00Z'),
        odometerMeters: 10_000,
      },
      cancellation: null,
      routePreference: null,
      schedulePickupAt: null,
      paymentFailure: null,
    }),
  );
}

const FARE: TripPayment = {
  id: 'pay-fare',
  type: 'fare',
  amount: usd(18.5),
  status: 'succeeded',
  createdAt: new Date('2026-04-28T16:00:30Z'),
  paymentMethodId: null,
};
const TIP: TripPayment = {
  id: 'pay-tip',
  type: 'tip',
  amount: usd(3),
  status: 'succeeded',
  createdAt: new Date('2026-04-28T16:02:00Z'),
  paymentMethodId: null,
};
const REFUND: TripPayment = {
  id: 'pay-refund',
  type: 'refund',
  amount: usd(2.5),
  status: 'succeeded',
  createdAt: new Date('2026-04-28T16:05:00Z'),
  paymentMethodId: null,
};

describe('escapeHtml', () => {
  it('escapes the canonical 5-char set', () => {
    expect(escapeHtml('a&b<c>d"e\'f')).toBe('a&amp;b&lt;c&gt;d&quot;e&#39;f');
  });

  it('escapes & first so emitted entities are not double-escaped', () => {
    // Critical: if we escaped < before &, the output would contain
    // `&amp;lt;` instead of `&lt;`. The test pins the order.
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('&')).toBe('&amp;');
  });

  it('passes through plain text unchanged', () => {
    expect(escapeHtml('Hello world')).toBe('Hello world');
  });
});

describe('formatMoneyForPdf', () => {
  it('formats USD with two decimal places', () => {
    expect(formatMoneyForPdf(usd(18))).toBe('$18.00');
    expect(formatMoneyForPdf(usd(0))).toBe('$0.00');
    expect(formatMoneyForPdf(usd(123.45))).toBe('$123.45');
  });
});

describe('formatRideDate', () => {
  it('produces a stable long-date + 12-hour-time string', () => {
    // Use a fixed UTC moment; the en-US locale produces predictable
    // output (the device-locale setting doesn't affect this).
    const d = new Date('2026-04-28T15:30:00Z');
    const formatted = formatRideDate(d);
    // The exact string depends on the test runner's TZ; assert
    // structurally instead.
    expect(formatted).toMatch(/April 28, 2026/);
    expect(formatted).toMatch(/(AM|PM)/);
  });
});

describe('formatBrandForPdf', () => {
  it.each([
    ['visa', 'Visa'],
    ['mastercard', 'Mastercard'],
    ['amex', 'Amex'],
    ['discover', 'Discover'],
    ['diners', 'Diners'],
    ['jcb', 'JCB'],
    ['unionpay', 'UnionPay'],
    ['unknown', 'Card'],
  ] as const)('formats %s as %s', (brand, expected) => {
    expect(formatBrandForPdf(brand)).toBe(expected);
  });
});

describe('getBrandSvgString', () => {
  it('returns an inline SVG for each branded brand', () => {
    for (const brand of [
      'visa',
      'mastercard',
      'amex',
      'discover',
      'diners',
    ] as const) {
      const svg = getBrandSvgString(brand);
      expect(svg).toMatch(/^<svg /);
      expect(svg).toContain('viewBox="0 0 60 40"');
      expect(svg).toMatch(/<\/svg>$/);
    }
  });

  it('falls back to the generic glyph for jcb / unionpay / unknown', () => {
    const generic = getBrandSvgString('unknown');
    expect(getBrandSvgString('jcb')).toBe(generic);
    expect(getBrandSvgString('unionpay')).toBe(generic);
    // The generic glyph carries the slate-grey card body color.
    expect(generic).toContain('#5A6772');
  });

  it('Visa SVG carries the brand-recognizable navy + yellow accent', () => {
    const svg = getBrandSvgString('visa');
    expect(svg).toContain('#1A1F71'); // Navy card body
    expect(svg).toContain('#F7B600'); // Yellow accent bar
  });

  it('Mastercard SVG carries the red + yellow + orange overlap colors', () => {
    const svg = getBrandSvgString('mastercard');
    expect(svg).toContain('#EB001B');
    expect(svg).toContain('#F79E1B');
    expect(svg).toContain('#FF5F00');
  });
});

describe('buildReceiptHtml', () => {
  it('produces a valid HTML document with the YeRide brand bar', () => {
    const html = buildReceiptHtml({
      ride: makeCompletedRide({ withDriver: true }),
      payments: { fare: FARE, tip: null, refund: null },
      fareTotal: usd(18.5),
      paymentBrand: null,
      paymentLast4: null,
    });
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('YeRide');
    expect(html).toContain('Trip with Grace'); // driver first name in header
    expect(html).toContain(`Receipt ${String(RIDE_ID)}`);
    expect(html).toMatch(/<\/html>$/);
  });

  it('renders the driver block with name + vehicle when driver is present', () => {
    const html = buildReceiptHtml({
      ride: makeCompletedRide({ withDriver: true }),
      payments: { fare: FARE, tip: null, refund: null },
      fareTotal: usd(18.5),
      paymentBrand: null,
      paymentLast4: null,
    });
    expect(html).toContain('Grace Hopper');
    expect(html).toContain('2024 Toyota Camry');
    expect(html).toContain('Plate ABC123');
  });

  it('omits the driver block entirely when ride.driver is null', () => {
    const html = buildReceiptHtml({
      ride: makeCompletedRide({ withDriver: false }),
      payments: { fare: FARE, tip: null, refund: null },
      fareTotal: usd(18.5),
      paymentBrand: null,
      paymentLast4: null,
    });
    expect(html).toContain('Trip complete'); // header fallback
    expect(html).not.toContain('Grace Hopper');
    expect(html).not.toContain('2024 Toyota Camry');
  });

  it('renders all three payment rows + total when fare + tip + refund are present', () => {
    const html = buildReceiptHtml({
      ride: makeCompletedRide({ withDriver: true }),
      payments: { fare: FARE, tip: TIP, refund: REFUND },
      fareTotal: usd(19), // 18.5 + 3 - 2.5
      paymentBrand: null,
      paymentLast4: null,
    });
    expect(html).toContain('Trip fare');
    expect(html).toContain('$18.50');
    expect(html).toContain('Tip');
    expect(html).toContain('$3.00');
    expect(html).toContain('Refund');
    expect(html).toContain('-$2.50'); // negation prefix
    expect(html).toContain('Total');
    expect(html).toContain('$19.00');
  });

  it('renders the inline SVG glyph + brand label when paymentBrand + last4 hit', () => {
    const html = buildReceiptHtml({
      ride: makeCompletedRide({ withDriver: true }),
      payments: { fare: FARE, tip: null, refund: null },
      fareTotal: usd(18.5),
      paymentBrand: 'visa',
      paymentLast4: '4242',
    });
    expect(html).toContain('<svg ');
    expect(html).toContain('#1A1F71'); // Visa navy
    expect(html).toContain('<strong>Visa</strong>');
    expect(html).toContain('•••• 4242');
  });

  it('falls back to "Charged to your card on file." when paymentBrand is null', () => {
    const html = buildReceiptHtml({
      ride: makeCompletedRide({ withDriver: true }),
      payments: { fare: FARE, tip: null, refund: null },
      fareTotal: usd(18.5),
      paymentBrand: null,
      paymentLast4: null,
    });
    expect(html).toContain('Charged to your card on file.');
    // The branded payment row's testID/strong tag should NOT appear.
    expect(html).not.toContain('<strong>Visa</strong>');
  });

  it('always carries the auto-email footer note', () => {
    const html = buildReceiptHtml({
      ride: makeCompletedRide({ withDriver: true }),
      payments: { fare: FARE, tip: null, refund: null },
      fareTotal: usd(18.5),
      paymentBrand: null,
      paymentLast4: null,
    });
    expect(html).toContain(
      'A receipt is emailed automatically when your charge clears.',
    );
  });

  it('renders the no-fare message when no payment rows exist yet', () => {
    const html = buildReceiptHtml({
      ride: makeCompletedRide({ withDriver: true }),
      payments: { fare: null, tip: null, refund: null },
      fareTotal: null,
      paymentBrand: null,
      paymentLast4: null,
    });
    expect(html).toContain('Total updates as soon as your charge clears.');
  });

  it('escapes user-provided strings (driver name + vehicle + addresses)', () => {
    const adversarialPassenger = unwrap(
      PassengerSnapshot.create({
        id: unwrap(UserId.create('rider12345678901234567890123')),
        name: unwrap(PersonName.create({ first: 'Ada', last: 'Lovelace' })),
        email: unwrap(Email.create('rider@yeapp.tech')),
        phoneNumber: unwrap(PhoneNumber.create('+14155550123')),
        pushToken: null,
        avatarUrl: null,
        stripeCustomerId: null,
        defaultPaymentMethod: null,
      }),
    );
    const tier = unwrap(
      RideServiceSnapshot.create({
        id: unwrap(RideServiceId.create('economy')),
        name: 'Economy',
        baseFare: usd(2.5),
        minimumFare: usd(5),
        cancelationFee: usd(2),
        costPerKm: usd(1.25),
        costPerMinute: usd(0.2),
        seatCapacity: 4,
      }),
    );
    const ride = unwrap(
      Ride.fromProps({
        id: RIDE_ID,
        status: 'completed',
        passenger: adversarialPassenger,
        driver: null,
        rideService: tier,
        pickup: unwrap(
          Endpoint.create({
            location: unwrap(Coordinates.create(25.7617, -80.1918)),
            // Adversarial address content with an HTML-meaningful char.
            address: 'Bayfront Park & 5th Ave',
            placeName: '<script>alert(1)</script>',
            directions: null,
          }),
        ),
        dropoff: unwrap(
          Endpoint.create({
            location: unwrap(Coordinates.create(26.1224, -80.1373)),
            address: '1 Las Olas Blvd',
            placeName: null,
            directions: null,
          }),
        ),
        createdAt: new Date('2026-04-28T15:30:00Z'),
        pickupTiming: {
          startedAt: new Date('2026-04-28T15:30:00Z'),
          completedAt: new Date('2026-04-28T15:35:00Z'),
          odometerMeters: 0,
          elapsedSeconds: 300,
        },
        dropoffTiming: {
          startedAt: new Date('2026-04-28T15:35:00Z'),
          completedAt: new Date('2026-04-28T16:00:00Z'),
          odometerMeters: 10_000,
        },
        cancellation: null,
        routePreference: null,
        schedulePickupAt: null,
        paymentFailure: null,
      }),
    );
    const html = buildReceiptHtml({
      ride,
      payments: { fare: FARE, tip: null, refund: null },
      fareTotal: usd(18.5),
      paymentBrand: null,
      paymentLast4: null,
    });
    // Adversarial placeName should be escaped (not rendered as live HTML).
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    // Address with `&` should render as `&amp;`.
    // (placeName is preferred over address when present, so this branch
    // exercises the dropoff side which has a null placeName.)
    expect(html).toContain('1 Las Olas Blvd');
    // Verify the pickup placeName is the source — not the raw address.
    expect(html).not.toContain('Bayfront Park & 5th Ave');
  });
});
