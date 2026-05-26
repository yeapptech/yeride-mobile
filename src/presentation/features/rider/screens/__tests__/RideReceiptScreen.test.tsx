import { render } from '@testing-library/react-native';

import { Coordinates } from '@domain/entities/Coordinates';
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

/**
 * Smoke for the screen-level wiring of the tip flow. Both view-models
 * are mocked at the hook seam — the receipt VM's behavior is covered by
 * `useRideReceiptViewModel.test.tsx`, and the tip flow VM is covered by
 * `useTipFlowViewModel.test.tsx`. This file only verifies that the
 * screen mounts the TipSelector with the right state.
 *
 * `react-native-maps` is mocked because the screen renders a small map
 * preview and the native module isn't available under jest.
 */

const mockUseRideReceiptViewModel = jest.fn();
const mockUseTipFlowViewModel = jest.fn();
const mockUseGenerateReceiptPdfViewModel = jest.fn();

jest.mock('@presentation/components/map', () => {
  const { View } = jest.requireActual('react-native');
  return {
    Map: () => <View testID="receipt-map-mock" />,
  };
});

jest.mock('../../view-models/useRideReceiptViewModel', () => ({
  useRideReceiptViewModel: (...args: unknown[]) =>
    mockUseRideReceiptViewModel(...args),
}));
jest.mock('../../view-models/useTipFlowViewModel', () => {
  const actual = jest.requireActual('../../view-models/useTipFlowViewModel');
  return {
    ...actual,
    useTipFlowViewModel: (...args: unknown[]) =>
      mockUseTipFlowViewModel(...args),
  };
});
jest.mock('../../view-models/useGenerateReceiptPdfViewModel', () => {
  const actual = jest.requireActual(
    '../../view-models/useGenerateReceiptPdfViewModel',
  );
  return {
    ...actual,
    useGenerateReceiptPdfViewModel: (...args: unknown[]) =>
      mockUseGenerateReceiptPdfViewModel(...args),
  };
});

import RideReceiptScreen from '../RideReceiptScreen';

function unwrap<T>(
  r: { ok: true; value: T } | { ok: false; error: unknown },
): T {
  if (!r.ok) throw r.error;
  return r.value;
}

function usd(major: number): Money {
  return unwrap(Money.fromMajor(major, 'USD'));
}

const RIDE_ID = unwrap(RideId.create('rideReceiptScreen0123'));

function makeCompletedRide(): Ride {
  const passenger = unwrap(
    PassengerSnapshot.create({
      id: unwrap(UserId.create('aaaaaaaaaaaaaaaaaaaaaaaaaaaa')),
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
  return unwrap(
    Ride.fromProps({
      id: RIDE_ID,
      status: 'completed',
      passenger,
      driver: null,
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
      createdAt: new Date('2026-04-28T10:00:00Z'),
      pickupTiming: {
        startedAt: new Date('2026-04-28T10:00:00Z'),
        completedAt: new Date('2026-04-28T10:05:00Z'),
        odometerMeters: 0,
        elapsedSeconds: 300,
      },
      dropoffTiming: {
        startedAt: new Date('2026-04-28T10:05:00Z'),
        completedAt: new Date('2026-04-28T10:30:00Z'),
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
  amount: usd(18),
  status: 'succeeded',
  createdAt: new Date('2026-04-28T10:30:30Z'),
  paymentMethodId: null,
};
const TIP: TripPayment = {
  id: 'pay-tip',
  type: 'tip',
  amount: usd(3),
  status: 'succeeded',
  createdAt: new Date('2026-04-28T10:32:00Z'),
  paymentMethodId: null,
};

const baseScreenProps = {
  route: {
    key: 'r1',
    name: 'RideReceipt' as const,
    params: { rideId: String(RIDE_ID) },
  },
  // Done now calls `reset` (not `popToTop`) so the rider always lands
  // back on RiderTabs regardless of how they reached the receipt.
  // `replace` is wired for Phase 10 Turn 10.5's payment_failed
  // redirect to `RideMonitor`.
  navigation: {
    reset: jest.fn(),
    replace: jest.fn(),
  } as unknown as Parameters<typeof RideReceiptScreen>[0]['navigation'],
};

describe('RideReceiptScreen — Phase 6 turn 5 wiring', () => {
  beforeEach(() => {
    mockUseRideReceiptViewModel.mockReset();
    mockUseTipFlowViewModel.mockReset();
    mockUseGenerateReceiptPdfViewModel.mockReset();
    mockUseGenerateReceiptPdfViewModel.mockReturnValue({
      state: { kind: 'idle', onShare: () => undefined },
    });
  });

  it('mounts the TipSelector when the tip flow is in idle on a completed ride', () => {
    const ride = makeCompletedRide();
    mockUseRideReceiptViewModel.mockReturnValue({
      ride,
      payments: [FARE],
      fareTotal: usd(18),
      farePayment: FARE,
      tipPayment: null,
      refundPayment: null,
      paymentBrand: null,
      paymentLast4: null,
      isLoading: false,
      error: null,
    });
    mockUseTipFlowViewModel.mockReturnValue({
      state: {
        kind: 'idle',
        isCustom: false,
        customText: '',
        selectedPresetMinor: null,
        onSelectPreset: () => undefined,
        onSelectCustom: () => undefined,
        onCustomAmountChange: () => undefined,
      },
    });

    const { getByTestId, queryByTestId } = render(
      <RideReceiptScreen {...baseScreenProps} />,
    );
    expect(getByTestId('tip-selector')).toBeTruthy();
    expect(queryByTestId('tip-selector-submitted')).toBeNull();
    expect(getByTestId('tip-selector-preset-300')).toBeTruthy();
  });

  it('hides the TipSelector once a tip payment row has landed (state: hidden)', () => {
    const ride = makeCompletedRide();
    mockUseRideReceiptViewModel.mockReturnValue({
      ride,
      payments: [FARE, TIP],
      fareTotal: usd(21),
      farePayment: FARE,
      tipPayment: TIP,
      refundPayment: null,
      paymentBrand: null,
      paymentLast4: null,
      isLoading: false,
      error: null,
    });
    mockUseTipFlowViewModel.mockReturnValue({
      state: { kind: 'hidden' },
    });

    const { queryByTestId } = render(
      <RideReceiptScreen {...baseScreenProps} />,
    );
    expect(queryByTestId('tip-selector')).toBeNull();
    expect(queryByTestId('tip-selector-submitted')).toBeNull();
  });

  it('passes the live ride + tipPayment from the receipt VM into the tip flow VM', () => {
    const ride = makeCompletedRide();
    mockUseRideReceiptViewModel.mockReturnValue({
      ride,
      payments: [FARE],
      fareTotal: usd(18),
      farePayment: FARE,
      tipPayment: null,
      refundPayment: null,
      paymentBrand: null,
      paymentLast4: null,
      isLoading: false,
      error: null,
    });
    mockUseTipFlowViewModel.mockReturnValue({ state: { kind: 'hidden' } });

    render(<RideReceiptScreen {...baseScreenProps} />);

    expect(mockUseTipFlowViewModel).toHaveBeenCalledWith(
      expect.objectContaining({
        rideId: RIDE_ID,
        ride,
        tipPayment: null,
      }),
    );
  });
});

/* ─── Phase 9 Turn 7 — payment row + email-button removal ──────── */

describe('RideReceiptScreen — Phase 9 Turn 7 payment row', () => {
  beforeEach(() => {
    mockUseRideReceiptViewModel.mockReset();
    mockUseTipFlowViewModel.mockReset();
    mockUseGenerateReceiptPdfViewModel.mockReset();
    mockUseTipFlowViewModel.mockReturnValue({ state: { kind: 'hidden' } });
    mockUseGenerateReceiptPdfViewModel.mockReturnValue({
      state: { kind: 'idle', onShare: () => undefined },
    });
  });

  it('renders the brand badge + "Brand •••• last4" line when the join hits', () => {
    mockUseRideReceiptViewModel.mockReturnValue({
      ride: makeCompletedRide(),
      payments: [FARE],
      fareTotal: usd(18),
      farePayment: FARE,
      tipPayment: null,
      refundPayment: null,
      paymentBrand: 'visa',
      paymentLast4: '4242',
      isLoading: false,
      error: null,
    });

    const { getByTestId, getByText, queryByTestId } = render(
      <RideReceiptScreen {...baseScreenProps} />,
    );
    expect(getByTestId('receipt-payment-method')).toBeTruthy();
    expect(getByTestId('card-brand-badge-visa')).toBeTruthy();
    expect(getByText(/Visa •••• 4242/)).toBeTruthy();
    expect(queryByTestId('receipt-payment-fallback')).toBeNull();
  });

  it('renders the fallback line when brand is null (cache miss)', () => {
    mockUseRideReceiptViewModel.mockReturnValue({
      ride: makeCompletedRide(),
      payments: [FARE],
      fareTotal: usd(18),
      farePayment: FARE,
      tipPayment: null,
      refundPayment: null,
      paymentBrand: null,
      paymentLast4: null,
      isLoading: false,
      error: null,
    });

    const { getByTestId, queryByTestId, getByText } = render(
      <RideReceiptScreen {...baseScreenProps} />,
    );
    expect(getByTestId('receipt-payment-fallback')).toBeTruthy();
    expect(queryByTestId('receipt-payment-method')).toBeNull();
    expect(getByText('Charged to your card on file.')).toBeTruthy();
  });

  it('always shows the auto-email note (Stripe sends receipts via receiptEmail)', () => {
    mockUseRideReceiptViewModel.mockReturnValue({
      ride: makeCompletedRide(),
      payments: [FARE],
      fareTotal: usd(18),
      farePayment: FARE,
      tipPayment: null,
      refundPayment: null,
      paymentBrand: 'visa',
      paymentLast4: '4242',
      isLoading: false,
      error: null,
    });

    const { getByText } = render(<RideReceiptScreen {...baseScreenProps} />);
    expect(
      getByText('A receipt is emailed automatically when your charge clears.'),
    ).toBeTruthy();
  });

  it('does not render the disabled "Email receipt" button (removed)', () => {
    mockUseRideReceiptViewModel.mockReturnValue({
      ride: makeCompletedRide(),
      payments: [FARE],
      fareTotal: usd(18),
      farePayment: FARE,
      tipPayment: null,
      refundPayment: null,
      paymentBrand: null,
      paymentLast4: null,
      isLoading: false,
      error: null,
    });

    const { queryByTestId, queryByText } = render(
      <RideReceiptScreen {...baseScreenProps} />,
    );
    expect(queryByTestId('receipt-email')).toBeNull();
    expect(queryByText('Email receipt')).toBeNull();
    expect(queryByText('Emailed receipts land in Phase 9 polish.')).toBeNull();
  });
});

/* ─── Phase 9 Turn 16 — Share-receipt CTA ──────────────────────── */

describe('RideReceiptScreen — Phase 9 Turn 16 share-receipt CTA', () => {
  beforeEach(() => {
    mockUseRideReceiptViewModel.mockReset();
    mockUseTipFlowViewModel.mockReset();
    mockUseGenerateReceiptPdfViewModel.mockReset();
    mockUseTipFlowViewModel.mockReturnValue({ state: { kind: 'hidden' } });
  });

  function withCompletedRide() {
    mockUseRideReceiptViewModel.mockReturnValue({
      ride: makeCompletedRide(),
      payments: [FARE],
      fareTotal: usd(18),
      farePayment: FARE,
      tipPayment: null,
      refundPayment: null,
      paymentBrand: null,
      paymentLast4: null,
      isLoading: false,
      error: null,
    });
  }

  it('mounts the Share-receipt CTA when the PDF VM is in idle', () => {
    withCompletedRide();
    const onShare = jest.fn();
    mockUseGenerateReceiptPdfViewModel.mockReturnValue({
      state: { kind: 'idle', onShare },
    });

    const { getByTestId, getByText } = render(
      <RideReceiptScreen {...baseScreenProps} />,
    );
    expect(getByTestId('receipt-share-cta')).toBeTruthy();
    expect(getByText('Share receipt')).toBeTruthy();
  });

  it('calls onShare when the CTA is pressed', () => {
    withCompletedRide();
    const onShare = jest.fn();
    mockUseGenerateReceiptPdfViewModel.mockReturnValue({
      state: { kind: 'idle', onShare },
    });

    const { getByTestId } = render(<RideReceiptScreen {...baseScreenProps} />);
    const { fireEvent } = require('@testing-library/react-native');
    fireEvent.press(getByTestId('receipt-share-cta'));
    expect(onShare).toHaveBeenCalledTimes(1);
  });

  it('renders the spinner + "Generating PDF…" label during generating', () => {
    withCompletedRide();
    mockUseGenerateReceiptPdfViewModel.mockReturnValue({
      state: { kind: 'generating' },
    });

    const { getByTestId, getByText } = render(
      <RideReceiptScreen {...baseScreenProps} />,
    );
    expect(getByTestId('receipt-share-cta-spinner')).toBeTruthy();
    expect(getByText('Generating PDF…')).toBeTruthy();
  });

  it('renders the inline error band with "Try again" CTA when in error arm', () => {
    withCompletedRide();
    const onShare = jest.fn();
    const onDismissError = jest.fn();
    mockUseGenerateReceiptPdfViewModel.mockReturnValue({
      state: {
        kind: 'error',
        error: {
          kind: 'pdf_generation_failed',
          message: 'Print SDK exploded',
        },
        onShare,
        onDismissError,
      },
    });

    const { getByTestId, getByText } = render(
      <RideReceiptScreen {...baseScreenProps} />,
    );
    expect(getByTestId('receipt-share-cta-error')).toBeTruthy();
    expect(getByText("Couldn't build the PDF. Please try again.")).toBeTruthy();
    expect(getByText('Try again')).toBeTruthy();
    expect(getByText('Dismiss')).toBeTruthy();
  });

  it('Dismiss button calls onDismissError', () => {
    withCompletedRide();
    const onDismissError = jest.fn();
    mockUseGenerateReceiptPdfViewModel.mockReturnValue({
      state: {
        kind: 'error',
        error: { kind: 'unknown', message: 'something went wrong' },
        onShare: () => undefined,
        onDismissError,
      },
    });

    const { getByTestId } = render(<RideReceiptScreen {...baseScreenProps} />);
    const { fireEvent } = require('@testing-library/react-native');
    fireEvent.press(getByTestId('receipt-share-cta-error-dismiss'));
    expect(onDismissError).toHaveBeenCalledTimes(1);
  });

  it('renders the sharing_unavailable message verbatim from the VM', () => {
    withCompletedRide();
    mockUseGenerateReceiptPdfViewModel.mockReturnValue({
      state: {
        kind: 'error',
        error: {
          kind: 'sharing_unavailable',
          message:
            "Sharing isn't available on this device — try emailing yourself the receipt instead.",
        },
        onShare: () => undefined,
        onDismissError: () => undefined,
      },
    });

    const { getByText } = render(<RideReceiptScreen {...baseScreenProps} />);
    expect(
      getByText(
        "Sharing isn't available on this device — try emailing yourself the receipt instead.",
      ),
    ).toBeTruthy();
  });

  it('renders "Share again" label in the shared arm so the rider can re-share', () => {
    withCompletedRide();
    mockUseGenerateReceiptPdfViewModel.mockReturnValue({
      state: { kind: 'shared', onShare: () => undefined },
    });

    const { getByText } = render(<RideReceiptScreen {...baseScreenProps} />);
    expect(getByText('Share again')).toBeTruthy();
  });

  it('hides the Share-receipt CTA when ride.status is not completed', () => {
    // payment_failed ride — receipt is not finalized; the share CTA
    // should be hidden, but the screen otherwise still renders so
    // the rider sees the in-progress charge state.
    const passenger = unwrap(
      PassengerSnapshot.create({
        id: unwrap(UserId.create('aaaaaaaaaaaaaaaaaaaaaaaaaaaa')),
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
    const failedRide = unwrap(
      Ride.fromProps({
        id: RIDE_ID,
        status: 'payment_failed',
        passenger,
        driver: null,
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
        createdAt: new Date('2026-04-28T10:00:00Z'),
        pickupTiming: {
          startedAt: new Date('2026-04-28T10:00:00Z'),
          completedAt: new Date('2026-04-28T10:05:00Z'),
          odometerMeters: 0,
          elapsedSeconds: 300,
        },
        dropoffTiming: {
          startedAt: new Date('2026-04-28T10:05:00Z'),
          completedAt: new Date('2026-04-28T10:30:00Z'),
          odometerMeters: 10_000,
        },
        cancellation: null,
        routePreference: null,
        schedulePickupAt: null,
        paymentFailure: null,
      }),
    );
    mockUseRideReceiptViewModel.mockReturnValue({
      ride: failedRide,
      payments: [],
      fareTotal: null,
      farePayment: null,
      tipPayment: null,
      refundPayment: null,
      paymentBrand: null,
      paymentLast4: null,
      isLoading: false,
      error: null,
    });
    mockUseGenerateReceiptPdfViewModel.mockReturnValue({
      state: { kind: 'idle', onShare: () => undefined },
    });

    const { queryByTestId } = render(
      <RideReceiptScreen {...baseScreenProps} />,
    );
    expect(queryByTestId('receipt-share-cta')).toBeNull();
  });
});

/* ─── Phase 10 Turn 10.5 — payment_failed redirect ───────────── */

describe('RideReceiptScreen — Phase 10 Turn 10.5 payment_failed redirect', () => {
  beforeEach(() => {
    mockUseRideReceiptViewModel.mockReset();
    mockUseTipFlowViewModel.mockReset();
    mockUseGenerateReceiptPdfViewModel.mockReset();
    mockUseTipFlowViewModel.mockReturnValue({ state: { kind: 'hidden' } });
    mockUseGenerateReceiptPdfViewModel.mockReturnValue({
      state: { kind: 'idle', onShare: () => undefined },
    });
  });

  function makePaymentFailedRide(): Ride {
    const passenger = unwrap(
      PassengerSnapshot.create({
        id: unwrap(UserId.create('aaaaaaaaaaaaaaaaaaaaaaaaaaaa')),
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
    return unwrap(
      Ride.fromProps({
        id: RIDE_ID,
        status: 'payment_failed',
        passenger,
        driver: null,
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
        createdAt: new Date('2026-04-28T10:00:00Z'),
        pickupTiming: {
          startedAt: new Date('2026-04-28T10:00:00Z'),
          completedAt: new Date('2026-04-28T10:05:00Z'),
          odometerMeters: 0,
          elapsedSeconds: 300,
        },
        dropoffTiming: {
          startedAt: new Date('2026-04-28T10:05:00Z'),
          completedAt: new Date('2026-04-28T10:30:00Z'),
          odometerMeters: 10_000,
        },
        cancellation: null,
        routePreference: null,
        schedulePickupAt: null,
        paymentFailure: null,
      }),
    );
  }

  it('replaces with RideMonitor when the live ride flips to payment_failed', () => {
    const failed = makePaymentFailedRide();
    mockUseRideReceiptViewModel.mockReturnValue({
      ride: failed,
      payments: [],
      fareTotal: null,
      farePayment: null,
      tipPayment: null,
      refundPayment: null,
      paymentBrand: null,
      paymentLast4: null,
      isLoading: false,
      error: null,
    });

    const replace = jest.fn();
    const props = {
      ...baseScreenProps,
      navigation: {
        reset: jest.fn(),
        replace,
      } as unknown as Parameters<typeof RideReceiptScreen>[0]['navigation'],
    };
    render(<RideReceiptScreen {...props} />);

    expect(replace).toHaveBeenCalledWith('RideMonitor', {
      rideId: String(RIDE_ID),
    });
  });

  it('does NOT redirect on a completed ride (the normal happy path)', () => {
    const completed = makeCompletedRide();
    mockUseRideReceiptViewModel.mockReturnValue({
      ride: completed,
      payments: [],
      fareTotal: null,
      farePayment: null,
      tipPayment: null,
      refundPayment: null,
      paymentBrand: null,
      paymentLast4: null,
      isLoading: false,
      error: null,
    });

    const replace = jest.fn();
    const props = {
      ...baseScreenProps,
      navigation: {
        reset: jest.fn(),
        replace,
      } as unknown as Parameters<typeof RideReceiptScreen>[0]['navigation'],
    };
    render(<RideReceiptScreen {...props} />);

    expect(replace).not.toHaveBeenCalled();
  });
});
