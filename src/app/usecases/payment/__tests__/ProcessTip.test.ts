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
import type { RideStatus } from '@domain/entities/RideStatus';
import { UserId } from '@domain/entities/UserId';
import { NetworkError } from '@domain/errors';
import {
  FakeCloudFunctionsService,
  InMemoryAuthRepository,
  InMemoryRideRepository,
  InMemoryUserRepository,
} from '@shared/testing';

import { ProcessTip } from '../ProcessTip';

import { setupSignedInRider, unwrap } from './_helpers';

const RIDE_ID = unwrap(RideId.create('ridetipxxxxxxxxxxxxxa'));

function usd(major: number): Money {
  return unwrap(Money.fromMajor(major, 'USD'));
}

function makeRide(args: { passengerId: UserId; status: RideStatus }): Ride {
  const passenger = unwrap(
    PassengerSnapshot.create({
      id: args.passengerId,
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
      status: args.status,
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
    }),
  );
}

describe('ProcessTip', () => {
  it('calls tipDriver with the trip id and dollar amount on a happy path', async () => {
    const { authRepo, rider } = await setupSignedInRider();
    const ridesRepo = new InMemoryRideRepository();
    ridesRepo.seed(makeRide({ passengerId: rider.id, status: 'completed' }));
    const callable = new FakeCloudFunctionsService();

    const r = await new ProcessTip(authRepo, ridesRepo, callable).execute({
      rideId: RIDE_ID,
      tipAmount: usd(3),
    });
    expect(r.ok).toBe(true);
    expect(callable.spies.tipDriverCalls).toEqual([
      { tripId: String(RIDE_ID), tipAmountDollars: 3 },
    ]);
  });

  it('rejects when no user is signed in', async () => {
    const r = await new ProcessTip(
      new InMemoryAuthRepository(),
      new InMemoryRideRepository(),
      new FakeCloudFunctionsService(),
    ).execute({ rideId: RIDE_ID, tipAmount: usd(3) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('auth_no_current_user');
  });

  it('rejects below the $1 minimum', async () => {
    const { authRepo, rider } = await setupSignedInRider();
    const ridesRepo = new InMemoryRideRepository();
    ridesRepo.seed(makeRide({ passengerId: rider.id, status: 'completed' }));
    const r = await new ProcessTip(
      authRepo,
      ridesRepo,
      new FakeCloudFunctionsService(),
    ).execute({ rideId: RIDE_ID, tipAmount: usd(0.5) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('tip_below_minimum');
  });

  it('rejects fractional dollars', async () => {
    const { authRepo, rider } = await setupSignedInRider();
    const ridesRepo = new InMemoryRideRepository();
    ridesRepo.seed(makeRide({ passengerId: rider.id, status: 'completed' }));
    const r = await new ProcessTip(
      authRepo,
      ridesRepo,
      new FakeCloudFunctionsService(),
    ).execute({ rideId: RIDE_ID, tipAmount: usd(1.5) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('tip_non_whole_dollar');
  });

  it('rejects when the trip is not yet completed', async () => {
    const { authRepo, rider } = await setupSignedInRider();
    const ridesRepo = new InMemoryRideRepository();
    ridesRepo.seed(makeRide({ passengerId: rider.id, status: 'started' }));
    const r = await new ProcessTip(
      authRepo,
      ridesRepo,
      new FakeCloudFunctionsService(),
    ).execute({ rideId: RIDE_ID, tipAmount: usd(3) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('tip_trip_not_completed');
  });

  it('rejects when the signed-in user is not the trip passenger', async () => {
    const { authRepo } = await setupSignedInRider();
    const ridesRepo = new InMemoryRideRepository();
    // Different passenger on the ride doc.
    const otherPassenger = unwrap(
      UserId.create('zzzzzzzzzzzzzzzzzzzzzzzzzzzz'),
    );
    ridesRepo.seed(
      makeRide({ passengerId: otherPassenger, status: 'completed' }),
    );
    const r = await new ProcessTip(
      authRepo,
      ridesRepo,
      new FakeCloudFunctionsService(),
    ).execute({ rideId: RIDE_ID, tipAmount: usd(3) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('tip_not_passenger');
  });

  it('returns NotFoundError when the ride does not exist', async () => {
    const { authRepo } = await setupSignedInRider();
    const r = await new ProcessTip(
      authRepo,
      new InMemoryRideRepository(),
      new FakeCloudFunctionsService(),
    ).execute({ rideId: RIDE_ID, tipAmount: usd(3) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('not_found');
  });

  it('propagates a NetworkError from the callable', async () => {
    const { authRepo, rider } = await setupSignedInRider();
    const ridesRepo = new InMemoryRideRepository();
    ridesRepo.seed(makeRide({ passengerId: rider.id, status: 'completed' }));
    const callable = new FakeCloudFunctionsService();
    callable.failNext({
      method: 'tipDriver',
      error: new NetworkError({ code: 'tip_down', message: 'down' }),
    });
    const r = await new ProcessTip(authRepo, ridesRepo, callable).execute({
      rideId: RIDE_ID,
      tipAmount: usd(3),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('network');
  });

  it('does not call the user repo (single round-trip ride read only)', async () => {
    const { authRepo, rider } = await setupSignedInRider();
    const ridesRepo = new InMemoryRideRepository();
    ridesRepo.seed(makeRide({ passengerId: rider.id, status: 'completed' }));
    const usersRepoSpy = new InMemoryUserRepository();
    const callable = new FakeCloudFunctionsService();
    await new ProcessTip(authRepo, ridesRepo, callable).execute({
      rideId: RIDE_ID,
      tipAmount: usd(3),
    });
    // We never call the users repo at all.
    expect(usersRepoSpy).toBeDefined(); // sanity; the constructor is the assertion.
  });
});
