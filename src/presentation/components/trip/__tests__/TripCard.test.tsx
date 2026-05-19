import { fireEvent, render } from '@testing-library/react-native';

import { TripCard } from '../TripCard';

import { makeAwaitingRide, makeRideAt } from './_rideFixture';

describe('TripCard', () => {
  it('rider view names the driver via "Trip with {Driver}"', () => {
    const ride = makeRideAt('completed');
    const { getByText } = render(
      <TripCard ride={ride} viewerRole="rider" onPress={() => undefined} />,
    );
    expect(getByText('Trip with Grace')).toBeTruthy();
  });

  it('driver view names the passenger via "Trip with {Passenger}"', () => {
    const ride = makeRideAt('completed');
    const { getByText } = render(
      <TripCard ride={ride} viewerRole="driver" onPress={() => undefined} />,
    );
    expect(getByText('Trip with Ada')).toBeTruthy();
  });

  it('falls back to a no-driver label when the ride is pre-dispatch on the rider side', () => {
    const ride = makeAwaitingRide({ id: 'ridePreDispatch1234ab' });
    const { getByText } = render(
      <TripCard ride={ride} viewerRole="rider" onPress={() => undefined} />,
    );
    expect(getByText('Trip (no driver yet)')).toBeTruthy();
  });

  it('renders the status pill copy for each terminal status', () => {
    const completed = makeRideAt('completed', 'rideC1234567890123ab');
    const cancelled = makeRideAt('cancelled', 'rideX1234567890123ab');
    const r1 = render(
      <TripCard
        ride={completed}
        viewerRole="rider"
        onPress={() => undefined}
      />,
    );
    expect(r1.getAllByText('Completed').length).toBeGreaterThan(0);
    r1.unmount();
    const r2 = render(
      <TripCard
        ride={cancelled}
        viewerRole="rider"
        onPress={() => undefined}
      />,
    );
    expect(r2.getAllByText('Cancelled').length).toBeGreaterThan(0);
  });

  it('renders the formatted base fare', () => {
    const ride = makeRideAt('completed');
    const { getByText } = render(
      <TripCard ride={ride} viewerRole="rider" onPress={() => undefined} />,
    );
    // baseFare in the fixture is $2.50.
    expect(getByText('$2.50')).toBeTruthy();
  });

  it('renders pickup + dropoff addresses', () => {
    const ride = makeAwaitingRide({
      id: 'rideAddrs12345678901a',
      pickup: '123 Main St',
      dropoff: '456 Elm Ave',
    });
    const { getByText } = render(
      <TripCard ride={ride} viewerRole="rider" onPress={() => undefined} />,
    );
    expect(getByText('From: 123 Main St')).toBeTruthy();
    expect(getByText('To: 456 Elm Ave')).toBeTruthy();
  });

  it('fires onPress with the ride when tapped', () => {
    const ride = makeRideAt('completed');
    const onPress = jest.fn();
    const { getByTestId } = render(
      <TripCard ride={ride} viewerRole="rider" onPress={onPress} />,
    );
    fireEvent.press(getByTestId(`trip-card-${String(ride.id)}`));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledWith(ride);
  });
});
