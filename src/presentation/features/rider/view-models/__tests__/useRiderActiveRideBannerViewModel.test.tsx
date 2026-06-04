import { act, renderHook, waitFor } from '@testing-library/react-native';
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
import type { UserId } from '@domain/entities/UserId';
import { useRiderActiveRideBannerViewModel } from '@presentation/features/rider/view-models/useRiderActiveRideBannerViewModel';
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

function makeAwaitingRiderRide(uid: UserId, id: string): Ride {
  const passenger = unwrap(
    PassengerSnapshot.create({
      id: uid,
      name: unwrap(PersonName.create({ first: 'Ada', last: 'Lovelace' })),
      email: unwrap(Email.create('rider@yeapp.tech')),
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
  const miami = unwrap(Coordinates.create(25.7617, -80.1918));
  const lauderdale = unwrap(Coordinates.create(26.1224, -80.1373));
  return unwrap(
    Ride.create({
      id: unwrap(RideId.create(id)),
      passenger,
      rideService: service,
      pickup: unwrap(
        Endpoint.create({
          location: miami,
          address: 'pickup',
          placeName: null,
          directions: null,
        }),
      ),
      dropoff: unwrap(
        Endpoint.create({
          location: lauderdale,
          address: 'dropoff',
          placeName: null,
          directions: null,
        }),
      ),
      createdAt: new Date(),
    }),
  );
}

async function seedRider(): Promise<{
  ridesRepo: InMemoryRideRepository;
  uid: UserId;
}> {
  const authRepo = new InMemoryAuthRepository();
  const uid = unwrap(
    await authRepo.signUp({
      email: unwrap(Email.create('rider@yeapp.tech')),
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

describe('useRiderActiveRideBannerViewModel', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    useSessionStore.getState().setSignedOut();
  });

  it('is hidden when there is no active ride', async () => {
    const { ridesRepo } = await seedRider();
    const { result } = renderHook(() => useRiderActiveRideBannerViewModel(), {
      wrapper: wrapper(ridesRepo),
    });
    await waitFor(() => {
      expect(result.current.visible).toBe(false);
    });
    expect(result.current.statusLabel).toBe('');
  });

  it('shows a status-aware label and navigates to RideMonitor on return', async () => {
    const { ridesRepo, uid } = await seedRider();
    ridesRepo.seed(makeAwaitingRiderRide(uid, 'rideBanner000000001ab'));

    const { result } = renderHook(() => useRiderActiveRideBannerViewModel(), {
      wrapper: wrapper(ridesRepo),
    });

    await waitFor(() => {
      expect(result.current.visible).toBe(true);
    });
    expect(result.current.statusLabel).toBe('Finding your driver');

    act(() => {
      result.current.onReturn();
    });
    expect(mockNavigate).toHaveBeenCalledWith('RideMonitor', {
      rideId: 'rideBanner000000001ab',
    });
  });
});
