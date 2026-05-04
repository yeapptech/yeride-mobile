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

import { EnRouteToPickupView } from '../EnRouteToPickupView';

/**
 * Phase 8 turn 2 — smoke render verifying the new "Open Navigation"
 * CTA fires `onLaunchNavigation`. The view is otherwise covered by the
 * status-router integration in DriverMonitorScreen tests.
 */

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

function makeRide(): Ride {
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
  const base = unwrap(
    Ride.create({
      id: unwrap(RideId.create('rideEnRouteSmoke1234')),
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
      dropoff: unwrap(
        Endpoint.create({
          location: unwrap(Coordinates.create(26.1224, -80.1373)),
          address: '200 Oak St',
          placeName: null,
          directions: null,
        }),
      ),
      createdAt: new Date(),
    }),
  );
  return unwrap(
    base.dispatch({
      driver: driverSnap,
      pickupDirections: pickupRoute,
      at: new Date(),
    }),
  );
}

describe('EnRouteToPickupView', () => {
  it('Open Navigation CTA fires onLaunchNavigation', () => {
    const onLaunchNavigation = jest.fn();
    const { getByTestId } = render(
      <EnRouteToPickupView
        ride={makeRide()}
        onArrived={jest.fn()}
        onPressCancel={jest.fn()}
        onLaunchNavigation={onLaunchNavigation}
      />,
    );
    fireEvent.press(getByTestId('en-route-launch-navigation'));
    expect(onLaunchNavigation).toHaveBeenCalledTimes(1);
  });
});
