import { renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

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
import { InMemoryRideRepository, TestContainerProvider } from '@shared/testing';

import { useRideReceiptViewModel } from '../useRideReceiptViewModel';

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

function usd(m: number) {
  return unwrap(Money.fromMajor(m, 'USD'));
}

const RIDE_ID = unwrap(RideId.create('rideAbcDef1234567890ab'));

function makeCompletedRide(): Ride {
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
  amount: usd(2),
  status: 'succeeded',
  createdAt: new Date('2026-04-28T10:32:00Z'),
};
const REFUND: TripPayment = {
  id: 'pay-refund',
  type: 'refund',
  amount: usd(5),
  status: 'succeeded',
  createdAt: new Date('2026-04-28T10:35:00Z'),
};

function withTestContainer(opts: { ridesRepo: InMemoryRideRepository }) {
  return ({ children }: { children: ReactNode }) => (
    <TestContainerProvider rides={opts.ridesRepo}>
      {children}
    </TestContainerProvider>
  );
}

describe('useRideReceiptViewModel', () => {
  it('emits the ride after the query resolves', async () => {
    const ridesRepo = new InMemoryRideRepository();
    ridesRepo.seed(makeCompletedRide());

    const { result } = renderHook(
      () => useRideReceiptViewModel({ rideId: RIDE_ID }),
      { wrapper: withTestContainer({ ridesRepo }) },
    );

    await waitFor(() => {
      expect(result.current.ride?.id).toBe(RIDE_ID);
    });
    expect(result.current.ride?.status).toBe('completed');
  });

  it('emits empty payments when the subcollection is empty', async () => {
    const ridesRepo = new InMemoryRideRepository();
    ridesRepo.seed(makeCompletedRide());

    const { result } = renderHook(
      () => useRideReceiptViewModel({ rideId: RIDE_ID }),
      { wrapper: withTestContainer({ ridesRepo }) },
    );
    await waitFor(() => {
      expect(result.current.ride).not.toBeUndefined();
    });
    expect(result.current.payments).toEqual([]);
    expect(result.current.fareTotal).toBeNull();
  });

  it('derives fareTotal from the seeded fare row', async () => {
    const ridesRepo = new InMemoryRideRepository();
    ridesRepo.seed(makeCompletedRide());
    ridesRepo.seedPayments(RIDE_ID, [FARE]);

    const { result } = renderHook(
      () => useRideReceiptViewModel({ rideId: RIDE_ID }),
      { wrapper: withTestContainer({ ridesRepo }) },
    );
    await waitFor(() => {
      expect(result.current.farePayment).not.toBeNull();
    });
    expect(result.current.fareTotal?.majorUnits).toBe(18);
  });

  it('adds a tip into the fareTotal when present', async () => {
    const ridesRepo = new InMemoryRideRepository();
    ridesRepo.seed(makeCompletedRide());
    ridesRepo.seedPayments(RIDE_ID, [FARE, TIP]);

    const { result } = renderHook(
      () => useRideReceiptViewModel({ rideId: RIDE_ID }),
      { wrapper: withTestContainer({ ridesRepo }) },
    );
    await waitFor(() => {
      expect(result.current.tipPayment).not.toBeNull();
    });
    expect(result.current.fareTotal?.majorUnits).toBe(20); // 18 + 2
  });

  it('subtracts a refund from the fareTotal when present', async () => {
    const ridesRepo = new InMemoryRideRepository();
    ridesRepo.seed(makeCompletedRide());
    ridesRepo.seedPayments(RIDE_ID, [FARE, TIP, REFUND]);

    const { result } = renderHook(
      () => useRideReceiptViewModel({ rideId: RIDE_ID }),
      { wrapper: withTestContainer({ ridesRepo }) },
    );
    await waitFor(() => {
      expect(result.current.refundPayment).not.toBeNull();
    });
    expect(result.current.fareTotal?.majorUnits).toBe(15); // 18 + 2 − 5
  });

  it('clamps fareTotal to zero if the refund exceeds the charge', async () => {
    const ridesRepo = new InMemoryRideRepository();
    ridesRepo.seed(makeCompletedRide());
    const oversizedRefund: TripPayment = {
      ...REFUND,
      amount: usd(100),
    };
    ridesRepo.seedPayments(RIDE_ID, [FARE, oversizedRefund]);

    const { result } = renderHook(
      () => useRideReceiptViewModel({ rideId: RIDE_ID }),
      { wrapper: withTestContainer({ ridesRepo }) },
    );
    await waitFor(() => {
      expect(result.current.refundPayment).not.toBeNull();
    });
    expect(result.current.fareTotal?.minorUnits).toBe(0);
  });
});
