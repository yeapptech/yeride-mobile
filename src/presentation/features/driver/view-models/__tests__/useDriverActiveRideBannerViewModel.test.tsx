import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

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
import { Route } from '@domain/entities/Route';
import { UserId } from '@domain/entities/UserId';
import { useDriverActiveRideBannerViewModel } from '@presentation/features/driver/view-models/useDriverActiveRideBannerViewModel';
import { useSessionStore } from '@presentation/stores';
import {
  InMemoryAuthRepository,
  InMemoryRideRepository,
  TestContainerProvider,
} from '@shared/testing';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

const usd = (major: number) => unwrap(Money.fromMajor(major, 'USD'));
const MIAMI = unwrap(Coordinates.create(25.7617, -80.1918));
const FORT_LAUDERDALE = unwrap(Coordinates.create(26.1224, -80.1373));

function makeDispatchedDriverRide(driverId: UserId, id: string): Ride {
  const passenger = unwrap(
    PassengerSnapshot.create({
      id: unwrap(UserId.create('passengerxxxxxxxxxxxxxxxxxxx')),
      name: unwrap(PersonName.create({ first: 'Ada', last: 'Lovelace' })),
      email: unwrap(Email.create('ada@yeapp.tech')),
      phoneNumber: unwrap(PhoneNumber.create('+14155551111')),
      pushToken: null,
      avatarUrl: null,
      stripeCustomerId: null,
      defaultPaymentMethod: null,
    }),
  );
  const service = unwrap(
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
  const awaiting = unwrap(
    Ride.create({
      id: unwrap(RideId.create(id)),
      passenger,
      rideService: service,
      pickup: unwrap(
        Endpoint.create({
          location: MIAMI,
          address: 'pickup',
          placeName: null,
          directions: null,
        }),
      ),
      dropoff: unwrap(
        Endpoint.create({
          location: FORT_LAUDERDALE,
          address: 'dropoff',
          placeName: null,
          directions: null,
        }),
      ),
      createdAt: new Date(),
    }),
  );
  const driver = unwrap(
    DriverSnapshot.create({
      id: driverId,
      name: unwrap(PersonName.create({ first: 'Grace', last: 'Hopper' })),
      email: unwrap(Email.create('driver@yeapp.tech')),
      phoneNumber: unwrap(PhoneNumber.create('+14155552222')),
      stripeAccountId: 'acct_test',
      pushToken: null,
      avatarUrl: null,
      vehicle: unwrap(
        VehicleSnapshot.create({
          make: 'Toyota',
          model: 'Camry',
          year: 2024,
          color: 'White',
          licensePlate: 'ABC1234',
          stockPhoto: null,
          photos: [],
        }),
      ),
    }),
  );
  const route = unwrap(
    Route.create({
      distanceMeters: 5_000,
      durationSeconds: 600,
      distanceText: '3.1 mi',
      durationText: '10 mins',
      encodedPolyline: '_p~iF',
      startLocation: MIAMI,
      endLocation: FORT_LAUDERDALE,
      routeLabels: [],
      tollPrice: null,
      routeToken: 'tk',
      description: '',
    }),
  );
  return unwrap(
    awaiting.dispatch({ driver, pickupDirections: route, at: new Date() }),
  );
}

async function seedDriver(): Promise<{
  ridesRepo: InMemoryRideRepository;
  uid: UserId;
}> {
  const authRepo = new InMemoryAuthRepository();
  const uid = unwrap(
    await authRepo.signUp({
      email: unwrap(Email.create('driver@yeapp.tech')),
      password: 'pw1234',
    }),
  );
  useSessionStore.getState().setSignedIn(uid);
  return { ridesRepo: new InMemoryRideRepository(), uid };
}

function wrapper(ridesRepo: InMemoryRideRepository) {
  return ({ children }: { children: ReactNode }) => (
    <TestContainerProvider rides={ridesRepo}>{children}</TestContainerProvider>
  );
}

describe('useDriverActiveRideBannerViewModel', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    useSessionStore.getState().setSignedOut();
  });

  it('is hidden when there is no active ride', async () => {
    const { ridesRepo } = await seedDriver();
    const { result } = renderHook(() => useDriverActiveRideBannerViewModel(), {
      wrapper: wrapper(ridesRepo),
    });
    await waitFor(() => {
      expect(result.current.visible).toBe(false);
    });
  });

  it('shows a status-aware label and navigates to DriverMonitor on return', async () => {
    const { ridesRepo, uid } = await seedDriver();
    ridesRepo.seed(makeDispatchedDriverRide(uid, 'rideDrvBanner00001ab'));

    const { result } = renderHook(() => useDriverActiveRideBannerViewModel(), {
      wrapper: wrapper(ridesRepo),
    });

    await waitFor(() => {
      expect(result.current.visible).toBe(true);
    });
    expect(result.current.statusLabel).toBe('Heading to pickup');

    act(() => {
      result.current.onReturn();
    });
    expect(mockNavigate).toHaveBeenCalledWith('DriverMonitor', {
      rideId: 'rideDrvBanner00001ab',
    });
  });
});
