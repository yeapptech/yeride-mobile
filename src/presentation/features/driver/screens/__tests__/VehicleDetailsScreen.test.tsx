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
  TestContainerProvider,
} from '@shared/testing';

import VehicleDetailsScreen from '../VehicleDetailsScreen';

/* ─── mocks ──────────────────────────────────────────────────────── */

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
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

async function setupDriver(opts: { readonly activeVehicleId: string | null }) {
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
      activeVehicleId: opts.activeVehicleId,
      vehicleIds: [VIN_HONDA],
    }),
  );

  const vehiclesRepo = new InMemoryVehicleRepository();
  vehiclesRepo.seed(honda, uid);
  if (opts.activeVehicleId !== null) {
    vehiclesRepo.setActiveDirect(uid, unwrap(Vin.create(opts.activeVehicleId)));
  }

  useSessionStore.getState().setSignedIn(uid);

  return { authRepo, usersRepo, vehiclesRepo, uid };
}

function withTestContainer(setup: Awaited<ReturnType<typeof setupDriver>>) {
  return ({ children }: { children: ReactNode }) => (
    <TestContainerProvider
      auth={setup.authRepo}
      users={setup.usersRepo}
      vehicles={setup.vehiclesRepo}
    >
      {children}
    </TestContainerProvider>
  );
}

function makeRouteProps(): React.ComponentProps<typeof VehicleDetailsScreen> {
  return {
    route: {
      key: 'VehicleDetails-1',
      name: 'VehicleDetails',
      params: { vin: VIN_HONDA },
    },
    navigation: {} as never,
  };
}

/* ─── tests ──────────────────────────────────────────────────────── */

describe('VehicleDetailsScreen', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockGoBack.mockClear();
    useSessionStore.setState({ status: 'initializing', userId: null });
  });

  it('renders specs (year/make/model/VIN/class) for the seeded vehicle', async () => {
    const setup = await setupDriver({ activeVehicleId: null });
    const Wrapper = withTestContainer(setup);
    const { getByText } = render(
      <Wrapper>
        <VehicleDetailsScreen {...makeRouteProps()} />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(getByText('2020 Honda Accord')).toBeTruthy();
    });
    expect(getByText('VIN')).toBeTruthy();
    expect(getByText(VIN_HONDA)).toBeTruthy();
    // "comfort" appears in both the Class row and the eligible-services
    // chip — assert that at least one is rendered.
    expect(getByText('Class')).toBeTruthy();
    expect(getByText('Eligible services')).toBeTruthy();
  });

  it('shows ACTIVE badge when this vehicle is the active one', async () => {
    const setup = await setupDriver({ activeVehicleId: VIN_HONDA });
    const Wrapper = withTestContainer(setup);
    const { getByTestId } = render(
      <Wrapper>
        <VehicleDetailsScreen {...makeRouteProps()} />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(getByTestId('vehicle-details-active-badge')).toBeTruthy();
    });
  });

  it('Edit-photos button navigates to VehiclePhotos with the VIN', async () => {
    const setup = await setupDriver({ activeVehicleId: VIN_HONDA });
    const Wrapper = withTestContainer(setup);
    const { getByTestId } = render(
      <Wrapper>
        <VehicleDetailsScreen {...makeRouteProps()} />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(getByTestId('vehicle-details-edit-photos')).toBeTruthy();
    });

    fireEvent.press(getByTestId('vehicle-details-edit-photos'));
    expect(mockNavigate).toHaveBeenCalledWith('VehiclePhotos', {
      vin: VIN_HONDA,
    });
  });

  it('Set-as-active button is hidden when vehicle is already active', async () => {
    const setup = await setupDriver({ activeVehicleId: VIN_HONDA });
    const Wrapper = withTestContainer(setup);
    const { queryByTestId } = render(
      <Wrapper>
        <VehicleDetailsScreen {...makeRouteProps()} />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(queryByTestId('vehicle-details-edit-photos')).toBeTruthy();
    });
    expect(queryByTestId('vehicle-details-set-active')).toBeNull();
  });

  it('Set-as-active button is visible when vehicle is approved + not active', async () => {
    const setup = await setupDriver({ activeVehicleId: null });
    const Wrapper = withTestContainer(setup);
    const { getByTestId } = render(
      <Wrapper>
        <VehicleDetailsScreen {...makeRouteProps()} />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(getByTestId('vehicle-details-set-active')).toBeTruthy();
    });
  });
});
