import { fireEvent, render } from '@testing-library/react-native';

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

import { StartedView } from '../StartedView';

/**
 * Phase 8 turn 2 — smoke render verifying the new "Open Navigation"
 * CTA on the StartedView fires `onLaunchNavigation`.
 */

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

function makeStartedRide(): Ride {
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
  const economy = unwrap(
    RideServiceSnapshot.create({
      id: unwrap(RideServiceId.create('economy')),
      name: 'Economy',
      baseFare: unwrap(Money.fromMajor(2.5, 'USD')),
      minimumFare: unwrap(Money.fromMajor(5, 'USD')),
      cancelationFee: unwrap(Money.fromMajor(2, 'USD')),
      costPerKm: unwrap(Money.fromMajor(1.25, 'USD')),
      costPerMinute: unwrap(Money.fromMajor(0.2, 'USD')),
      seatCapacity: 4,
    }),
  );
  const pickupRoute = unwrap(
    Route.create({
      distanceMeters: 5_000,
      durationSeconds: 600,
      distanceText: '3.1 mi',
      durationText: '10 mins',
      encodedPolyline: '_p~iF',
      startLocation: unwrap(Coordinates.create(25.79, -80.2)),
      endLocation: unwrap(Coordinates.create(25.7617, -80.1918)),
      routeLabels: [],
      tollPrice: null,
      routeToken: 'tk-pickup',
      description: '',
    }),
  );
  const dropoffRoute = unwrap(
    Route.create({
      distanceMeters: 30_000,
      durationSeconds: 1_800,
      distanceText: '18.6 mi',
      durationText: '30 mins',
      encodedPolyline: '_q~iF',
      startLocation: unwrap(Coordinates.create(25.7617, -80.1918)),
      endLocation: unwrap(Coordinates.create(26.1224, -80.1373)),
      routeLabels: [],
      tollPrice: null,
      routeToken: 'tk-rider',
      description: '',
    }),
  );
  const driverSnap = unwrap(
    DriverSnapshot.create({
      id: unwrap(UserId.create('driverxxxxxxxxxxxxxxxxxxxxxx')),
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
  const dropoffEndpoint = unwrap(
    Endpoint.create({
      location: unwrap(Coordinates.create(26.1224, -80.1373)),
      address: '200 Oak St',
      placeName: null,
      directions: null,
    }),
  ).withDirections(dropoffRoute);
  const base = unwrap(
    Ride.create({
      id: unwrap(RideId.create('rideStartedSmoke1234')),
      passenger,
      rideService: economy,
      pickup: unwrap(
        Endpoint.create({
          location: unwrap(Coordinates.create(25.7617, -80.1918)),
          address: '100 Main St',
          placeName: null,
          directions: null,
        }),
      ),
      dropoff: dropoffEndpoint,
      createdAt: new Date(),
    }),
  );
  return unwrap(
    unwrap(
      base.dispatch({
        driver: driverSnap,
        pickupDirections: pickupRoute,
        at: new Date(),
      }),
    ).start({ odometerMeters: 1_000, at: new Date() }),
  );
}

describe('StartedView', () => {
  it('Open Navigation CTA fires onLaunchNavigation', () => {
    const onLaunchNavigation = jest.fn();
    const { getByTestId } = render(
      <StartedView
        ride={makeStartedRide()}
        onPressCancel={jest.fn()}
        onRequestPayment={jest.fn()}
        onLaunchNavigation={onLaunchNavigation}
      />,
    );
    fireEvent.press(getByTestId('started-launch-navigation'));
    expect(onLaunchNavigation).toHaveBeenCalledTimes(1);
  });
});
