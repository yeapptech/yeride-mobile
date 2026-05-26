import { fireEvent, render } from '@testing-library/react-native';

import { Coordinates } from '@domain/entities/Coordinates';
import { Email } from '@domain/entities/Email';
import { Endpoint } from '@domain/entities/Endpoint';
import { Money } from '@domain/entities/Money';
import { PassengerSnapshot } from '@domain/entities/PassengerSnapshot';
import {
  PaymentFailure,
  type KnownPaymentFailureCode,
} from '@domain/entities/PaymentFailure';
import { PersonName } from '@domain/entities/PersonName';
import { PhoneNumber } from '@domain/entities/PhoneNumber';
import { Ride } from '@domain/entities/Ride';
import { RideId } from '@domain/entities/RideId';
import { RideServiceId } from '@domain/entities/RideServiceId';
import { RideServiceSnapshot } from '@domain/entities/RideServiceSnapshot';
import { UserId } from '@domain/entities/UserId';

import { PaymentFailedView } from '../PaymentFailedView';

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

function usd(m: number) {
  return unwrap(Money.fromMajor(m, 'USD'));
}

function makeRide(args: { paymentFailure: PaymentFailure | null }): Ride {
  const passenger = unwrap(
    PassengerSnapshot.create({
      id: unwrap(UserId.create('aaaaaaaaaaaaaaaaaaaaaaaaaaaa')),
      name: unwrap(PersonName.create({ first: 'Ada', last: 'Lovelace' })),
      email: unwrap(Email.create('ada@yeapp.tech')),
      phoneNumber: unwrap(PhoneNumber.create('+14155551111')),
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
  return unwrap(
    Ride.fromProps({
      id: unwrap(RideId.create('rideAbcDef1234567890ab')),
      status: 'payment_failed',
      passenger,
      driver: null,
      rideService: tier,
      pickup: unwrap(
        Endpoint.create({
          location: unwrap(Coordinates.create(25.7617, -80.1918)),
          address: 'Bayfront Park',
          placeName: null,
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
      createdAt: new Date('2026-05-26T12:00:00Z'),
      pickupTiming: {
        startedAt: null,
        completedAt: null,
        odometerMeters: null,
        elapsedSeconds: null,
      },
      dropoffTiming: {
        startedAt: null,
        completedAt: null,
        odometerMeters: null,
      },
      cancellation: null,
      routePreference: null,
      schedulePickupAt: null,
      paymentFailure: args.paymentFailure,
    }),
  );
}

function failure(code: KnownPaymentFailureCode, message = 'x'): PaymentFailure {
  return unwrap(
    PaymentFailure.create({
      code,
      message,
      occurredAt: new Date('2026-05-26T12:00:00Z'),
    }),
  );
}

describe('PaymentFailedView — synchronous-error branches (Phase 10 Turn 10.5)', () => {
  it('renders the missing-payment-method branch with Wallet CTA', () => {
    const ride = makeRide({
      paymentFailure: failure('trip_missing_payment_method'),
    });
    const onPressOpenWallet = jest.fn();
    const { queryByText, getByTestId } = render(
      <PaymentFailedView ride={ride} onPressOpenWallet={onPressOpenWallet} />,
    );
    expect(queryByText('Add a payment method')).not.toBeNull();
    expect(getByTestId('payment-failed-open-wallet')).toBeDefined();
    fireEvent.press(getByTestId('payment-failed-open-wallet'));
    expect(onPressOpenWallet).toHaveBeenCalledTimes(1);
  });

  it('renders the missing-stripe-customer branch with Contact-support primary CTA', () => {
    const ride = makeRide({
      paymentFailure: failure('trip_missing_stripe_customer'),
    });
    const onPressContactSupport = jest.fn();
    const { queryByText, getByTestId, queryByTestId } = render(
      <PaymentFailedView
        ride={ride}
        onPressContactSupport={onPressContactSupport}
      />,
    );
    expect(queryByText('Your account needs attention')).not.toBeNull();
    fireEvent.press(getByTestId('payment-failed-contact-support-primary'));
    expect(onPressContactSupport).toHaveBeenCalledTimes(1);
    // Secondary support link hidden because primary already IS support.
    expect(queryByTestId('payment-failed-contact-support')).toBeNull();
  });

  it('renders the missing-driver-account branch with Contact-support primary CTA', () => {
    const ride = makeRide({
      paymentFailure: failure('trip_missing_driver_account'),
    });
    const onPressContactSupport = jest.fn();
    const { queryByText, getByTestId } = render(
      <PaymentFailedView
        ride={ride}
        onPressContactSupport={onPressContactSupport}
      />,
    );
    expect(queryByText("Your driver's payouts aren't set up")).not.toBeNull();
    expect(getByTestId('payment-failed-contact-support-primary')).toBeDefined();
  });

  it('renders the card-declined branch with Wallet CTA', () => {
    const ride = makeRide({
      paymentFailure: failure('card_declined', 'Your card was declined.'),
    });
    const { queryByText, getByTestId } = render(
      <PaymentFailedView ride={ride} onPressOpenWallet={() => undefined} />,
    );
    expect(queryByText('Your card was declined')).not.toBeNull();
    expect(getByTestId('payment-failed-open-wallet')).toBeDefined();
  });

  it('renders the expired-card branch with Wallet CTA', () => {
    const ride = makeRide({
      paymentFailure: failure('expired_card', 'Your card expired.'),
    });
    const { queryByText, getByTestId } = render(
      <PaymentFailedView ride={ride} onPressOpenWallet={() => undefined} />,
    );
    expect(queryByText('Your card expired')).not.toBeNull();
    expect(getByTestId('payment-failed-open-wallet')).toBeDefined();
  });

  it('renders the insufficient-funds branch with Wallet CTA', () => {
    const ride = makeRide({
      paymentFailure: failure('insufficient_funds'),
    });
    const { queryByText, getByTestId } = render(
      <PaymentFailedView ride={ride} onPressOpenWallet={() => undefined} />,
    );
    expect(queryByText('Insufficient funds')).not.toBeNull();
    expect(getByTestId('payment-failed-open-wallet')).toBeDefined();
  });

  it('renders the generic-validation-failed branch with Wallet CTA', () => {
    const ride = makeRide({
      paymentFailure: failure('trip_payment_validation_failed'),
    });
    const { queryByText, getByTestId } = render(
      <PaymentFailedView ride={ride} onPressOpenWallet={() => undefined} />,
    );
    expect(queryByText('Payment validation failed')).not.toBeNull();
    expect(getByTestId('payment-failed-open-wallet')).toBeDefined();
  });

  it('renders the unknown-processing branch with Wallet CTA', () => {
    const ride = makeRide({
      paymentFailure: failure('payment_processing_unknown'),
    });
    const { queryByText, getByTestId } = render(
      <PaymentFailedView ride={ride} onPressOpenWallet={() => undefined} />,
    );
    expect(queryByText("We couldn't process your payment")).not.toBeNull();
    expect(getByTestId('payment-failed-open-wallet')).toBeDefined();
  });
});

describe('PaymentFailedView — fallback branches', () => {
  it('renders generic Stripe-async copy when paymentFailure is null', () => {
    const ride = makeRide({ paymentFailure: null });
    const { queryByText } = render(
      <PaymentFailedView ride={ride} onPressOpenWallet={() => undefined} />,
    );
    expect(queryByText("Charge couldn't go through")).not.toBeNull();
  });

  it('falls back to generic copy for an unknown future code, surfacing server message', () => {
    const r = PaymentFailure.create({
      code: 'future_server_code_not_in_catalog',
      message: 'something specific the server said',
      occurredAt: new Date('2026-05-26T12:00:00Z'),
    });
    if (!r.ok) throw new Error('test setup: PaymentFailure.create failed');
    const ride = makeRide({ paymentFailure: r.value });
    const { queryByText } = render(
      <PaymentFailedView ride={ride} onPressOpenWallet={() => undefined} />,
    );
    expect(queryByText("Charge couldn't go through")).not.toBeNull();
    expect(
      queryByText(/Server details: something specific the server said/),
    ).not.toBeNull();
  });
});

describe('PaymentFailedView — secondary support link', () => {
  it('shows secondary support link on the Wallet branch when handler supplied', () => {
    const ride = makeRide({
      paymentFailure: failure('card_declined'),
    });
    const onPressContactSupport = jest.fn();
    const { getByTestId } = render(
      <PaymentFailedView
        ride={ride}
        onPressOpenWallet={() => undefined}
        onPressContactSupport={onPressContactSupport}
      />,
    );
    fireEvent.press(getByTestId('payment-failed-contact-support'));
    expect(onPressContactSupport).toHaveBeenCalledTimes(1);
  });

  it('hides primary CTA when its handler is not supplied (read-only view)', () => {
    const ride = makeRide({
      paymentFailure: failure('card_declined'),
    });
    // No `onPressOpenWallet`, no `onPressContactSupport` — the view
    // should still render a body but no actionable buttons.
    const { queryByTestId, queryByText } = render(
      <PaymentFailedView ride={ride} />,
    );
    expect(queryByText('Your card was declined')).not.toBeNull();
    expect(queryByTestId('payment-failed-open-wallet')).toBeNull();
    expect(queryByTestId('payment-failed-contact-support')).toBeNull();
  });
});
