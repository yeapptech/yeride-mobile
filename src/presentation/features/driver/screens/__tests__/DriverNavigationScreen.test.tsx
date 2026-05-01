import { fireEvent, render, waitFor } from '@testing-library/react-native';

import DriverNavigationScreen from '../DriverNavigationScreen';

/**
 * Phase 8 turn 2 — smoke renders for `DriverNavigationScreen`. The
 * view-model is mocked at the hook seam so each test can drive a
 * specific state-machine arm without spinning up the whole adapter
 * surface (the VM has its own coverage in
 * `useDriverNavigationViewModel.test.tsx`).
 *
 * `useNavigationSdkConnector` is mocked here too — the screen no
 * longer mounts it (the connector lives at DriverMonitor's level), so
 * stubbing it as a no-op makes the test isolated.
 */

const mockUseDriverNavigationViewModel = jest.fn();
jest.mock('../../view-models/useDriverNavigationViewModel', () => ({
  useDriverNavigationViewModel: () => mockUseDriverNavigationViewModel(),
}));

const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack }),
}));

interface RouteParams {
  readonly leg: 'pickup' | 'dropoff';
  readonly title: string;
  readonly destination: { lat: number; lng: number };
  readonly routeToken?: string;
  readonly avoidTolls?: boolean;
}

function makeRoute(params: Partial<RouteParams> = {}): {
  readonly key: string;
  readonly name: 'DriverNavigation';
  readonly params: RouteParams;
} {
  return {
    key: 'driver-navigation-key',
    name: 'DriverNavigation',
    params: {
      leg: 'pickup',
      title: 'Pickup',
      destination: { lat: 25.7617, lng: -80.1918 },
      ...params,
    },
  };
}

describe('DriverNavigationScreen', () => {
  beforeEach(() => {
    mockUseDriverNavigationViewModel.mockReset();
    mockGoBack.mockReset();
  });

  it('renders the preparing-map overlay during uninitialized state', () => {
    mockUseDriverNavigationViewModel.mockReturnValue({
      state: { kind: 'uninitialized' },
      hasArrived: false,
      onEndNavigation: jest.fn(),
      onRetry: jest.fn(),
    });

    const { getByTestId, queryByText } = render(
      <DriverNavigationScreen route={makeRoute()} navigation={{} as never} />,
    );
    expect(getByTestId('driver-navigation-overlay-uninitialized')).toBeTruthy();
    expect(queryByText(/Preparing map/i)).not.toBeNull();
  });

  it('renders the calculating-route overlay during initializing state', () => {
    mockUseDriverNavigationViewModel.mockReturnValue({
      state: { kind: 'initializing' },
      hasArrived: false,
      onEndNavigation: jest.fn(),
      onRetry: jest.fn(),
    });

    const { getByTestId, queryByText } = render(
      <DriverNavigationScreen route={makeRoute()} navigation={{} as never} />,
    );
    expect(getByTestId('driver-navigation-overlay-initializing')).toBeTruthy();
    expect(queryByText(/Calculating route/i)).not.toBeNull();
  });

  it('hides the overlay during guiding state and shows the End Navigation CTA', () => {
    mockUseDriverNavigationViewModel.mockReturnValue({
      state: { kind: 'guiding' },
      hasArrived: false,
      onEndNavigation: jest.fn(),
      onRetry: jest.fn(),
    });

    const { queryByTestId, getByTestId } = render(
      <DriverNavigationScreen route={makeRoute()} navigation={{} as never} />,
    );
    expect(queryByTestId('driver-navigation-overlay-guiding')).toBeNull();
    expect(getByTestId('driver-navigation-end')).toBeTruthy();
  });

  it("End Navigation press fires VM's onEndNavigation", () => {
    const onEndNavigation = jest.fn();
    mockUseDriverNavigationViewModel.mockReturnValue({
      state: { kind: 'guiding' },
      hasArrived: false,
      onEndNavigation,
      onRetry: jest.fn(),
    });

    const { getByTestId } = render(
      <DriverNavigationScreen route={makeRoute()} navigation={{} as never} />,
    );
    fireEvent.press(getByTestId('driver-navigation-end'));
    expect(onEndNavigation).toHaveBeenCalledTimes(1);
  });

  it('renders the error overlay with retry CTA during error state', () => {
    const onRetry = jest.fn();
    mockUseDriverNavigationViewModel.mockReturnValue({
      state: {
        kind: 'error',
        subKind: 'route_not_found',
        message: 'Could not calculate a route.',
      },
      hasArrived: false,
      onEndNavigation: jest.fn(),
      onRetry,
    });

    const { getByTestId, queryByText } = render(
      <DriverNavigationScreen route={makeRoute()} navigation={{} as never} />,
    );
    expect(getByTestId('driver-navigation-overlay-error')).toBeTruthy();
    expect(queryByText('Could not calculate a route.')).not.toBeNull();
    fireEvent.press(getByTestId('driver-navigation-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('hides the End Navigation CTA in arrived state and auto-pops via goBack', async () => {
    jest.useFakeTimers();
    mockUseDriverNavigationViewModel.mockReturnValue({
      state: { kind: 'arrived' },
      hasArrived: true,
      onEndNavigation: jest.fn(),
      onRetry: jest.fn(),
    });

    const { queryByTestId } = render(
      <DriverNavigationScreen route={makeRoute()} navigation={{} as never} />,
    );
    expect(queryByTestId('driver-navigation-end')).toBeNull();

    // Advance the 1.2s "Arrived" overlay timer.
    jest.advanceTimersByTime(1500);
    await waitFor(() => {
      expect(mockGoBack).toHaveBeenCalledTimes(1);
    });
    jest.useRealTimers();
  });

  it('renders an inline error for invalid coordinates', () => {
    mockUseDriverNavigationViewModel.mockReturnValue({
      state: { kind: 'guiding' },
      hasArrived: false,
      onEndNavigation: jest.fn(),
      onRetry: jest.fn(),
    });

    const { queryByText } = render(
      <DriverNavigationScreen
        route={makeRoute({
          destination: { lat: 999, lng: -999 },
        })}
        navigation={{} as never}
      />,
    );
    expect(queryByText(/Invalid navigation destination/i)).not.toBeNull();
  });
});
