import { renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { Money } from '@domain/entities/Money';
import { RideId } from '@domain/entities/RideId';
import type { TripEvent } from '@domain/entities/TripEvent';
import type { TripPayment } from '@domain/entities/TripPayment';
import {
  makeRideAt,
  unwrap,
} from '@presentation/components/trip/__tests__/_rideFixture';
import { InMemoryRideRepository, TestContainerProvider } from '@shared/testing';

import { useTripDetailViewModel } from '../useTripDetailViewModel';

const RIDE_ID = unwrap(RideId.create('rideTripDetail123abcd'));

function makePayment(args: {
  id: string;
  type: TripPayment['type'];
  status: TripPayment['status'];
  usd: number;
  createdAt: Date;
}): TripPayment {
  return {
    id: args.id,
    type: args.type,
    status: args.status,
    amount: unwrap(Money.fromMajor(args.usd, 'USD')),
    createdAt: args.createdAt,
    paymentMethodId: null,
  };
}

function makeEvent(args: { id: string; createdAt: Date }): TripEvent {
  return {
    id: args.id,
    type: 'dispatch',
    event: 'Driver accepted',
    extras: {},
    createdAt: args.createdAt,
  };
}

function wrapperWithRides(rides: InMemoryRideRepository) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <TestContainerProvider rides={rides}>{children}</TestContainerProvider>
    );
  };
}

describe('useTripDetailViewModel', () => {
  it('loads the ride one-shot, surfaces ready status, and reads events + payments', async () => {
    const rides = new InMemoryRideRepository();
    const ride = makeRideAt('completed', String(RIDE_ID));
    rides.seed(ride);
    rides.seedEvents(ride.id, [
      makeEvent({ id: 'e1', createdAt: new Date('2026-05-19T10:00:00Z') }),
    ]);
    rides.seedPayments(ride.id, [
      makePayment({
        id: 'pay1',
        type: 'fare',
        status: 'succeeded',
        usd: 12.5,
        createdAt: new Date('2026-05-19T10:30:00Z'),
      }),
    ]);

    const { result } = renderHook(
      () => useTripDetailViewModel({ rideId: ride.id }),
      { wrapper: wrapperWithRides(rides) },
    );

    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });

    expect(result.current.ride?.id).toBe(ride.id);
    expect(result.current.payments).toHaveLength(1);
    expect(result.current.events).toHaveLength(1);
    expect(result.current.errorMessage).toBeNull();
  });

  it('surfaces not-found when the ride does not exist', async () => {
    const rides = new InMemoryRideRepository();
    const { result } = renderHook(
      () => useTripDetailViewModel({ rideId: RIDE_ID }),
      { wrapper: wrapperWithRides(rides) },
    );
    await waitFor(() => {
      expect(result.current.status).toBe('not-found');
    });
    expect(result.current.ride).toBeNull();
  });
});
