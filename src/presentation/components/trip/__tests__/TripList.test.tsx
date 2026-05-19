import { fireEvent, render } from '@testing-library/react-native';
import { Text, View } from 'react-native';

import { TripList } from '../TripList';

import { makeAwaitingRide } from './_rideFixture';

describe('TripList', () => {
  it('renders one TripCard per ride', () => {
    const r1 = makeAwaitingRide({ id: 'ride1xxxxx1234567890ab' });
    const r2 = makeAwaitingRide({ id: 'ride2xxxxx1234567890ab' });
    const { getByTestId } = render(
      <TripList
        rides={[r1, r2]}
        viewerRole="rider"
        onSelectRide={() => undefined}
      />,
    );
    expect(getByTestId(`trip-card-${String(r1.id)}`)).toBeTruthy();
    expect(getByTestId(`trip-card-${String(r2.id)}`)).toBeTruthy();
  });

  it('renders the empty component when rides is empty', () => {
    const { getByTestId } = render(
      <TripList
        rides={[]}
        viewerRole="rider"
        onSelectRide={() => undefined}
        ListEmptyComponent={
          <View testID="empty-marker">
            <Text>No recent rides</Text>
          </View>
        }
      />,
    );
    expect(getByTestId('empty-marker')).toBeTruthy();
  });

  it('renders the footer slot below the list', () => {
    const r1 = makeAwaitingRide({ id: 'rideFooter12345678901a' });
    const { getByTestId } = render(
      <TripList
        rides={[r1]}
        viewerRole="rider"
        onSelectRide={() => undefined}
        ListFooterComponent={
          <View testID="footer-marker">
            <Text>load more</Text>
          </View>
        }
      />,
    );
    expect(getByTestId('footer-marker')).toBeTruthy();
  });

  it('fires onSelectRide with the tapped ride', () => {
    const r1 = makeAwaitingRide({ id: 'rideSelect12345678901a' });
    const onSelectRide = jest.fn();
    const { getByTestId } = render(
      <TripList rides={[r1]} viewerRole="rider" onSelectRide={onSelectRide} />,
    );
    fireEvent.press(getByTestId(`trip-card-${String(r1.id)}`));
    expect(onSelectRide).toHaveBeenCalledWith(r1);
  });

  it('uses ride.id as the stable key', () => {
    const r1 = makeAwaitingRide({ id: 'rideKeyA12345678901abc' });
    const r2 = makeAwaitingRide({ id: 'rideKeyB12345678901abc' });
    const { getAllByTestId, rerender } = render(
      <TripList
        rides={[r1, r2]}
        viewerRole="rider"
        onSelectRide={() => undefined}
      />,
    );
    expect(getAllByTestId(/^trip-card-/).length).toBe(2);
    rerender(
      <TripList
        rides={[r2, r1]}
        viewerRole="rider"
        onSelectRide={() => undefined}
      />,
    );
    expect(getAllByTestId(/^trip-card-/).length).toBe(2);
  });
});
