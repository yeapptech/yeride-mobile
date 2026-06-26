import { act, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { Coordinates } from '@domain/entities/Coordinates';
import {
  DriverSnapshot,
  VehicleSnapshot,
} from '@domain/entities/DriverSnapshot';
import { Email } from '@domain/entities/Email';
import { Endpoint } from '@domain/entities/Endpoint';
import { Money } from '@domain/entities/Money';
import { PassengerSnapshot } from '@domain/entities/PassengerSnapshot';
import { PaymentMethodId } from '@domain/entities/PaymentMethodId';
import { PersonName } from '@domain/entities/PersonName';
import { PhoneNumber } from '@domain/entities/PhoneNumber';
import { Ride } from '@domain/entities/Ride';
import { RideId } from '@domain/entities/RideId';
import { RideServiceId } from '@domain/entities/RideServiceId';
import { RideServiceSnapshot } from '@domain/entities/RideServiceSnapshot';
import { Route } from '@domain/entities/Route';
import { StripeAccountId } from '@domain/entities/StripeAccountId';
import { StripeCustomerId } from '@domain/entities/StripeCustomerId';
import { makeDriver, makeRider } from '@domain/entities/User';
import { UserId } from '@domain/entities/UserId';
import { useGpsStore, useSessionStore } from '@presentation/stores';
import {
  FakeBackgroundGeolocationClient,
  InMemoryAuthRepository,
  InMemoryRideRepository,
  InMemoryUserRepository,
  TestContainerProvider,
} from '@shared/testing';

import { AppContent } from '../AppContent';

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

const RIDER_EMAIL = 'rider@yeapp.tech';
const DRIVER_EMAIL = 'driver@yeapp.tech';

interface SeededFixture {
  authRepo: InMemoryAuthRepository;
  usersRepo: InMemoryUserRepository;
  ridesRepo?: InMemoryRideRepository;
  bg: FakeBackgroundGeolocationClient;
  uid: UserId;
}

const MIAMI = unwrap(Coordinates.create(25.7617, -80.1918));
const FORT_LAUDERDALE = unwrap(Coordinates.create(26.1224, -80.1373));
const RIDE_ID = unwrap(RideId.create('rideAppContent12345aa'));

function usd(m: number) {
  return unwrap(Money.fromMajor(m, 'USD'));
}

function makeDispatchedRide(passengerUid: UserId, driverUid: UserId): Ride {
  const passenger = unwrap(
    PassengerSnapshot.create({
      id: passengerUid,
      name: unwrap(PersonName.create({ first: 'Ada', last: 'Lovelace' })),
      email: unwrap(Email.create('ada@yeapp.tech')),
      phoneNumber: unwrap(PhoneNumber.create('+14155551111')),
      pushToken: null,
      avatarUrl: null,
      stripeCustomerId: null,
      defaultPaymentMethod: null,
    }),
  );
  const driverSnap = unwrap(
    DriverSnapshot.create({
      id: driverUid,
      name: unwrap(PersonName.create({ first: 'Grace', last: 'Hopper' })),
      email: unwrap(Email.create('grace@yeapp.tech')),
      phoneNumber: unwrap(PhoneNumber.create('+14155552222')),
      stripeAccountId: 'acct_d',
      pushToken: null,
      avatarUrl: null,
      vehicle: unwrap(
        VehicleSnapshot.create({
          make: 'Honda',
          model: 'Civic',
          year: 2025,
          color: 'Blue',
          licensePlate: 'XYZ',
          stockPhoto: null,
          photos: [],
        }),
      ),
    }),
  );
  const economy = unwrap(
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
      id: RIDE_ID,
      passenger,
      rideService: economy,
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
    unwrap(
      awaiting.claimForDispatch({ driver: driverSnap, at: new Date() }),
    ).attachPickupDirections(route),
  );
}

async function seedRiderFixture(opts?: {
  withDefaultPaymentMethod?: boolean;
  emailVerified?: boolean;
}): Promise<SeededFixture> {
  const authRepo = new InMemoryAuthRepository();
  const usersRepo = new InMemoryUserRepository();
  const bg = new FakeBackgroundGeolocationClient();
  bg.seedAuthorization('always');

  const signUpR = await authRepo.signUp({
    email: unwrap(Email.create(RIDER_EMAIL)),
    password: 'pw1234',
  });
  const uid = unwrap(signUpR);
  if (opts?.emailVerified ?? true) {
    authRepo.markCurrentVerified();
  }

  const rider = makeRider({
    id: uid,
    email: unwrap(Email.create(RIDER_EMAIL)),
    emailVerified: opts?.emailVerified ?? true,
    name: unwrap(PersonName.create({ first: 'Ada', last: 'Lovelace' })),
    phone: unwrap(PhoneNumber.create('+14155551111')),
    createdAt: new Date(),
    updatedAt: new Date(),
    stripeCustomerId: unwrap(StripeCustomerId.create('cus_rider1')),
    defaultPaymentMethodId: opts?.withDefaultPaymentMethod
      ? unwrap(PaymentMethodId.create('pm_card1'))
      : null,
  });
  await usersRepo.create(rider);

  return { authRepo, usersRepo, bg, uid };
}

async function seedDriverFixture(opts?: {
  stripeChargesEnabled?: boolean;
  stripePayoutsEnabled?: boolean;
}): Promise<SeededFixture> {
  const authRepo = new InMemoryAuthRepository();
  const usersRepo = new InMemoryUserRepository();
  const bg = new FakeBackgroundGeolocationClient();
  bg.seedAuthorization('always');

  const signUpR = await authRepo.signUp({
    email: unwrap(Email.create(DRIVER_EMAIL)),
    password: 'pw1234',
  });
  const uid = unwrap(signUpR);
  authRepo.markCurrentVerified();

  const driver = makeDriver({
    id: uid,
    email: unwrap(Email.create(DRIVER_EMAIL)),
    emailVerified: true,
    name: unwrap(PersonName.create({ first: 'Grace', last: 'Hopper' })),
    phone: unwrap(PhoneNumber.create('+14155552222')),
    createdAt: new Date(),
    updatedAt: new Date(),
    stripeAccountId: unwrap(StripeAccountId.create('acct_driver')),
    stripeChargesEnabled: opts?.stripeChargesEnabled ?? true,
    stripePayoutsEnabled: opts?.stripePayoutsEnabled ?? true,
  });
  await usersRepo.create(driver);

  return { authRepo, usersRepo, bg, uid };
}

function renderApp(fixture: SeededFixture) {
  return render(
    <TestContainerProvider
      auth={fixture.authRepo}
      users={fixture.usersRepo}
      bgGeolocation={fixture.bg}
      {...(fixture.ridesRepo ? { rides: fixture.ridesRepo } : {})}
    >
      <AppContent>
        <Text testID="sentinel">tree</Text>
      </AppContent>
    </TestContainerProvider>,
  );
}

describe('AppContent — Phase 7 turn 2 GPS lifecycle', () => {
  beforeEach(() => {
    useSessionStore.setState({ status: 'initializing', userId: null });
    useGpsStore.getState().reset();
  });

  it('starts the SDK once the rider has cleared registration (default payment method present)', async () => {
    const fixture = await seedRiderFixture({ withDefaultPaymentMethod: true });
    renderApp(fixture);

    await waitFor(() => {
      expect(fixture.bg.spies.startCalls).toBeGreaterThanOrEqual(1);
    });
    expect(fixture.bg.isInitialized()).toBe(true);
    expect(fixture.bg.isEnabled()).toBe(true);
  });

  it('does NOT start the SDK for a rider mid-onboarding (no default payment method)', async () => {
    const fixture = await seedRiderFixture({ withDefaultPaymentMethod: false });
    renderApp(fixture);

    // Wait for the auth listener to fire so the session store reflects
    // 'authenticated', then assert that GPS still hasn't started.
    await waitFor(() => {
      expect(useSessionStore.getState().status).toBe('authenticated');
    });
    // Give async effects a tick to confirm.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(fixture.bg.spies.initCalls).toEqual([]);
    expect(fixture.bg.spies.startCalls).toBe(0);
    expect(fixture.bg.isEnabled()).toBe(false);
  });

  it('starts the SDK for a driver with Stripe Connect enabled', async () => {
    const fixture = await seedDriverFixture();
    renderApp(fixture);

    await waitFor(() => {
      expect(fixture.bg.spies.startCalls).toBeGreaterThanOrEqual(1);
    });
    expect(fixture.bg.isEnabled()).toBe(true);
  });

  it('does NOT start the SDK for a driver mid-Connect-onboarding', async () => {
    const fixture = await seedDriverFixture({
      stripeChargesEnabled: true,
      stripePayoutsEnabled: false,
    });
    renderApp(fixture);

    await waitFor(() => {
      expect(useSessionStore.getState().status).toBe('authenticated');
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(fixture.bg.spies.startCalls).toBe(0);
    expect(fixture.bg.isEnabled()).toBe(false);
  });

  it("registers a pickup geofence when the rider has a 'dispatched' ride", async () => {
    const fixture = await seedRiderFixture({ withDefaultPaymentMethod: true });
    fixture.ridesRepo = new InMemoryRideRepository();
    // Re-make the dispatched ride with the rider fixture's UID as the
    // passenger so `useInProgressRideQuery` finds it.
    const otherDriverUid = unwrap(
      UserId.create('otherdriverxxxxxxxxxxxxxxxxx'),
    );
    fixture.ridesRepo.seed(makeDispatchedRide(fixture.uid, otherDriverUid));

    renderApp(fixture);

    await waitFor(() => {
      expect(
        fixture.bg.spies.addPickupGeofenceCalls.length,
      ).toBeGreaterThanOrEqual(1);
    });
    const geofence = fixture.bg.getActiveGeofence();
    expect(geofence?.rideId).toEqual(RIDE_ID);
    expect(geofence?.location).toBe(MIAMI);
    expect(geofence?.radiusMeters).toBe(200);
  });

  it('stops the SDK and resets the GPS store on sign-out', async () => {
    const fixture = await seedRiderFixture({ withDefaultPaymentMethod: true });
    renderApp(fixture);

    await waitFor(() => {
      expect(fixture.bg.isEnabled()).toBe(true);
    });
    // Seed some store state so we can verify reset wipes it.
    act(() => {
      useGpsStore.getState().setLocation({
        coords: unwrap(Coordinates.create(25.7617, -80.1918)),
        speed: 5,
        heading: null,
        odometerMeters: 2000,
        timestampMs: Date.now(),
        isMoving: true,
      });
    });
    expect(useGpsStore.getState().currentLocation).not.toBeNull();

    await act(async () => {
      await fixture.authRepo.signOut();
    });

    await waitFor(() => {
      expect(useSessionStore.getState().status).toBe('unauthenticated');
    });
    await waitFor(() => {
      expect(fixture.bg.spies.stopCalls).toBeGreaterThanOrEqual(1);
    });
    expect(fixture.bg.isEnabled()).toBe(false);
    expect(useGpsStore.getState().currentLocation).toBeNull();
    expect(useGpsStore.getState().currentOdometerMeters).toBe(0);
  });
});
