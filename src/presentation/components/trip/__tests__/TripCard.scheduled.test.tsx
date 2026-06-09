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
import { UserId } from '@domain/entities/UserId';
import { TripCard } from '@presentation/components/trip/TripCard';

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}
const usd = (m: number) => unwrap(Money.fromMajor(m, 'USD'));
const PASSENGER = unwrap(
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
const ECONOMY = unwrap(
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
function ends() {
  return {
    pickup: unwrap(
      Endpoint.create({
        location: unwrap(Coordinates.create(25.7617, -80.1918)),
        address: 'pickup',
        placeName: null,
        directions: null,
      }),
    ),
    dropoff: unwrap(
      Endpoint.create({
        location: unwrap(Coordinates.create(26.1224, -80.1373)),
        address: 'dropoff',
        placeName: null,
        directions: null,
      }),
    ),
  };
}

describe('TripCard scheduled-time line', () => {
  it('renders "Scheduled for …" for a scheduled ride', () => {
    const { pickup, dropoff } = ends();
    const ride = unwrap(
      Ride.createScheduled({
        id: unwrap(RideId.create('tripCardSched12345ab')),
        passenger: PASSENGER,
        rideService: ECONOMY,
        pickup,
        dropoff,
        createdAt: new Date('2026-06-01T12:00:00Z'),
        schedulePickupAt: new Date('2026-06-02T15:45:00Z'),
      }),
    );
    const { getByText } = render(
      <TripCard ride={ride} viewerRole="rider" onPress={() => {}} />,
    );
    expect(getByText(/^Scheduled for /)).toBeTruthy();
  });

  it('renders the created-at line (no "Scheduled for") for a normal ride', () => {
    const { pickup, dropoff } = ends();
    const ride = unwrap(
      Ride.create({
        id: unwrap(RideId.create('tripCardNormal1234ab')),
        passenger: PASSENGER,
        rideService: ECONOMY,
        pickup,
        dropoff,
        createdAt: new Date('2026-06-01T12:00:00Z'),
      }),
    );
    const { queryByText } = render(
      <TripCard ride={ride} viewerRole="rider" onPress={() => {}} />,
    );
    expect(queryByText(/^Scheduled for /)).toBeNull();
  });
});
