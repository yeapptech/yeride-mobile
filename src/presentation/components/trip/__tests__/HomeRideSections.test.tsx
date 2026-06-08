import { fireEvent, render } from '@testing-library/react-native';

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
import { HomeRideSections } from '@presentation/components/trip/HomeRideSections';

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
function makeRide(id: string): Ride {
  return unwrap(
    Ride.create({
      id: unwrap(RideId.create(id)),
      passenger: PASSENGER,
      rideService: ECONOMY,
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
      createdAt: new Date(),
    }),
  );
}

describe('HomeRideSections', () => {
  it('renders nothing when both lists are empty', () => {
    const { queryByTestId } = render(
      <HomeRideSections
        inProgressRides={[]}
        scheduledRides={[]}
        viewerRole="rider"
        onSelectRide={() => {}}
      />,
    );
    expect(queryByTestId('home-ride-sections')).toBeNull();
  });

  it('renders an In progress section and fires onSelectRide on tap', () => {
    const ride = makeRide('homeSecInProg12345ab');
    const onSelectRide = jest.fn();
    const { getByTestId, queryByTestId } = render(
      <HomeRideSections
        inProgressRides={[ride]}
        scheduledRides={[]}
        viewerRole="rider"
        onSelectRide={onSelectRide}
      />,
    );
    expect(getByTestId('home-in-progress-section')).toBeTruthy();
    expect(queryByTestId('home-scheduled-section')).toBeNull();
    fireEvent.press(getByTestId('trip-card-homeSecInProg12345ab'));
    expect(onSelectRide).toHaveBeenCalledWith(ride);
  });

  it('renders a Scheduled section when scheduled rides exist', () => {
    const ride = makeRide('homeSecSched123456ab');
    const { getByTestId } = render(
      <HomeRideSections
        inProgressRides={[]}
        scheduledRides={[ride]}
        viewerRole="rider"
        onSelectRide={() => {}}
      />,
    );
    expect(getByTestId('home-scheduled-section')).toBeTruthy();
  });
});
