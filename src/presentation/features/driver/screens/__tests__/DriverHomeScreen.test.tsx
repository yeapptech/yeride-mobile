import { render } from '@testing-library/react-native';

import { Coordinates } from '@domain/entities/Coordinates';
import { markerRenders, resetMapMockState } from 'react-native-maps';

/**
 * Screen-level lock for the reported bug: the DriverHome map must render
 * the driver at the LIVE GPS coordinate (`vm.liveDriverLocation`) as a
 * rotating car image — NOT the stale one-shot foreground read. The
 * view-model's live-vs-foreground logic is covered by
 * `useDriverHomeViewModel.test.tsx`; this verifies the screen wires that
 * value (and the car image + heading) into the `<Map>` driver slot.
 *
 * The VM is mocked at the hook seam; the real `<Map>` renders through the
 * global `react-native-maps` mock (jest.setup), whose `<Marker>` captures
 * its props into `markerRenders`.
 */

const mockUseDriverHomeViewModel = jest.fn();
jest.mock('../../view-models/useDriverHomeViewModel', () => ({
  useDriverHomeViewModel: () => mockUseDriverHomeViewModel(),
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
}));

import type { UseDriverHomeViewModel } from '../../view-models/useDriverHomeViewModel';
import DriverHomeScreen from '../DriverHomeScreen';

function coords(lat: number, lng: number): Coordinates {
  const r = Coordinates.create(lat, lng);
  if (!r.ok) throw new Error('test setup: bad coords');
  return r.value;
}

function makeVm(
  overrides: Partial<UseDriverHomeViewModel>,
): UseDriverHomeViewModel {
  return {
    status: 'ready',
    user: { name: { first: 'Grace' } },
    currentLocation: {
      coordinates: null,
      error: null,
      permissionStatus: 'granted',
      refresh: jest.fn(),
    },
    activeServiceArea: null,
    mode: 'offline',
    activeVehicleId: null,
    activeVehicle: null,
    noActiveVehicle: false,
    availableRides: [],
    liveDriverLocation: null,
    liveDriverHeading: null,
    inProgressRides: [],
    scheduledRides: [],
    permissionStatus: 'granted',
    bgPermissionDenied: false,
    onToggleOnline: jest.fn(),
    onSelectRide: jest.fn(),
    onResumeInProgress: jest.fn(),
    onSelectHomeRide: jest.fn(),
    onRegisterVehicle: jest.fn(),
    refreshLocation: jest.fn(),
    onOpenSettings: jest.fn(),
    ...overrides,
  } as unknown as UseDriverHomeViewModel;
}

describe('DriverHomeScreen', () => {
  beforeEach(() => {
    resetMapMockState();
    mockUseDriverHomeViewModel.mockReset();
  });

  it('renders the driver as a rotating car image at the LIVE GPS coordinate', () => {
    mockUseDriverHomeViewModel.mockReturnValue(
      makeVm({
        liveDriverLocation: coords(26.1297, -80.2654),
        liveDriverHeading: 137,
      }),
    );

    render(<DriverHomeScreen />);

    // The driver slot is the one carrying a car `image` (vs the default pin).
    const driver = markerRenders.find((m) => m.image !== undefined);
    expect(driver).toBeTruthy();
    expect(driver?.coordinate).toEqual({
      latitude: 26.1297,
      longitude: -80.2654,
    });
    expect(driver?.rotation).toBe(137);
    expect(driver?.flat).toBe(true);
  });

  it('shows no car marker until a live location exists', () => {
    mockUseDriverHomeViewModel.mockReturnValue(
      makeVm({ liveDriverLocation: null }),
    );

    render(<DriverHomeScreen />);

    expect(markerRenders.every((m) => m.image === undefined)).toBe(true);
  });
});
