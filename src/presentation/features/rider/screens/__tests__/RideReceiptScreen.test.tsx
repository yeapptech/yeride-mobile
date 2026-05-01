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
    }),
  );
}

const FARE: TripPayment = {
  id: 'pay-fare',
  type: 'fare',
  amount: usd(18),
  status: 'succeeded',
  createdAt: new Date('2026-04-28T10:30:30Z'),
};
const TIP: TripPayment = {
  id: 'pay-tip',
  type: 'tip',
  amount: usd(3),
  status: 'succeeded',
  createdAt: new Date('2026-04-28T10:32:00Z'),
};

const baseScreenProps = {
  route: {
    key: 'r1',
    name: 'RideReceipt' as const,
    params: { rideId: String(RIDE_ID) },
  },
  // Done now calls `reset` (not `popToTop`) so the rider always lands
  // back on RiderTabs regardless of how they reached the receipt.
  navigation: {
    reset: jest.fn(),
  } as unknown as Parameters<typeof RideReceiptScreen>[0]['navigation'],
};

describe('RideReceiptScreen — Phase 6 turn 5 wiring', () => {
  beforeEach(() => {
    mockUseRideReceiptViewModel.mockReset();
    mockUseTipFlowViewModel.mockReset();
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
      isLoading: false,
      error: null,
      emailReceipt: () => undefined,
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
      isLoading: false,
      error: null,
      emailReceipt: () => undefined,
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
      isLoading: false,
      error: null,
      emailReceipt: () => undefined,
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
