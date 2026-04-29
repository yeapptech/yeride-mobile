import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { Email } from '@domain/entities/Email';
import { PersonName } from '@domain/entities/PersonName';
import { RideServiceId } from '@domain/entities/RideServiceId';
import { makeDriver } from '@domain/entities/User';
import type { UserId } from '@domain/entities/UserId';
import { Vehicle } from '@domain/entities/Vehicle';
import { Vin } from '@domain/entities/Vin';
import { useSessionStore } from '@presentation/stores/useSessionStore';
import {
  InMemoryAuthRepository,
  InMemoryUserRepository,
  InMemoryVehicleRepository,
  InMemoryVehiclePhotoRepository,
  TestContainerProvider,
} from '@shared/testing';

import VehiclePhotosScreen from '../VehiclePhotosScreen';

/* ─── mocks ──────────────────────────────────────────────────────── */

const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack }),
}));

const mockRequestPermissions = jest.fn();
const mockLaunchLibrary = jest.fn();
jest.mock('expo-image-picker', () => ({
  __esModule: true,
  requestMediaLibraryPermissionsAsync: (...args: unknown[]) =>
    mockRequestPermissions(...args),
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunchLibrary(...args),
}));

/* ─── helpers ────────────────────────────────────────────────────── */

function unwrap<T>(
  r: { ok: true; value: T } | { ok: false; error: unknown },
): T {
  if (!r.ok) throw r.error;
  return r.value;
}

const VIN_HONDA = '1HGBH41JXMN109186';
const FIXED_NOW = new Date('2026-04-28T12:00:00Z');

function makeApprovedHonda(): Vehicle {
  const created = unwrap(
    Vehicle.create({
      vin: unwrap(Vin.create(VIN_HONDA)),
      make: 'Honda',
      model: 'Accord',
      year: 2020,
      vehicleClass: 'comfort',
      eligibleServices: [unwrap(RideServiceId.create('comfort'))],
      dataSource: 'vin_decoded',
      createdAt: FIXED_NOW,
    }),
  );
  return unwrap(created.approve(FIXED_NOW));
}

async function setupDriver() {
  const authRepo = new InMemoryAuthRepository();
  authRepo.seedAccount({ email: 'driver@yeapp.tech', password: 'hunter22' });
  await authRepo.signIn({
    email: unwrap(Email.create('driver@yeapp.tech')),
    password: 'hunter22',
  });
  const uid = (await authRepo.currentUserId()) as UserId;

  const honda = makeApprovedHonda();
  const usersRepo = new InMemoryUserRepository();
  usersRepo.seed(
    makeDriver({
      id: uid,
      email: unwrap(Email.create('driver@yeapp.tech')),
      name: unwrap(PersonName.create({ first: 'Grace', last: 'Hopper' })),
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
      activeVehicleId: VIN_HONDA,
      vehicleIds: [VIN_HONDA],
    }),
  );

  const vehiclesRepo = new InMemoryVehicleRepository();
  vehiclesRepo.seed(honda, uid);

  const vehiclePhotosRepo = new InMemoryVehiclePhotoRepository();

  useSessionStore.getState().setSignedIn(uid);

  return { authRepo, usersRepo, vehiclesRepo, vehiclePhotosRepo };
}

function withTestContainer(setup: Awaited<ReturnType<typeof setupDriver>>) {
  return ({ children }: { children: ReactNode }) => (
    <TestContainerProvider
      auth={setup.authRepo}
      users={setup.usersRepo}
      vehicles={setup.vehiclesRepo}
      vehiclePhotos={setup.vehiclePhotosRepo}
    >
      {children}
    </TestContainerProvider>
  );
}

function makeRouteProps(): React.ComponentProps<typeof VehiclePhotosScreen> {
  return {
    route: {
      key: 'VehiclePhotos-1',
      name: 'VehiclePhotos',
      params: { vin: VIN_HONDA },
    },
    // The component only reads route.params, so navigation is unused.
    navigation: {} as never,
  };
}

/* ─── tests ──────────────────────────────────────────────────────── */

describe('VehiclePhotosScreen', () => {
  beforeEach(() => {
    mockGoBack.mockClear();
    mockRequestPermissions.mockReset();
    mockLaunchLibrary.mockReset();
    useSessionStore.setState({ status: 'initializing', userId: null });
  });

  it('renders 5 tiles + the year/make/model header', async () => {
    const setup = await setupDriver();
    const Wrapper = withTestContainer(setup);
    const { getByTestId, getByText } = render(
      <Wrapper>
        <VehiclePhotosScreen {...makeRouteProps()} />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(getByTestId('vehicle-photo-tile-front')).toBeTruthy();
    });
    expect(getByTestId('vehicle-photo-tile-back')).toBeTruthy();
    expect(getByTestId('vehicle-photo-tile-left')).toBeTruthy();
    expect(getByTestId('vehicle-photo-tile-right')).toBeTruthy();
    expect(getByTestId('vehicle-photo-tile-interior')).toBeTruthy();
    expect(getByText('2020 Honda Accord')).toBeTruthy();
  });

  it('tapping a tile launches the picker', async () => {
    const setup = await setupDriver();
    mockRequestPermissions.mockResolvedValue({ granted: true });
    mockLaunchLibrary.mockResolvedValue({ canceled: true });

    const Wrapper = withTestContainer(setup);
    const { getByTestId } = render(
      <Wrapper>
        <VehiclePhotosScreen {...makeRouteProps()} />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(getByTestId('vehicle-photo-tile-front')).toBeTruthy();
    });

    fireEvent.press(getByTestId('vehicle-photo-tile-front'));

    await waitFor(() => {
      expect(mockLaunchLibrary).toHaveBeenCalled();
    });
  });

  it('Done button pops back', async () => {
    const setup = await setupDriver();
    const Wrapper = withTestContainer(setup);
    const { getByTestId } = render(
      <Wrapper>
        <VehiclePhotosScreen {...makeRouteProps()} />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(getByTestId('vehicle-photos-done')).toBeTruthy();
    });

    fireEvent.press(getByTestId('vehicle-photos-done'));
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });
});
