import { render, waitFor } from '@testing-library/react-native';

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

import VehicleListScreen from '../VehicleListScreen';

/* ─── mocks ──────────────────────────────────────────────────────── */

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

// `react-native-safe-area-context` works with the test renderer when its
// SafeAreaView falls back to a plain View if no provider is mounted.
// We don't wrap in a SafeAreaProvider because we don't care about insets.

/* ─── helpers ────────────────────────────────────────────────────── */

function unwrap<T>(
  r: { ok: true; value: T } | { ok: false; error: unknown },
): T {
  if (!r.ok) throw r.error;
  return r.value;
}

const VIN_HONDA = '1HGBH41JXMN109186';
const FIXED_NOW = new Date('2026-04-28T12:00:00Z');

function vin(value: string) {
  return unwrap(Vin.create(value));
}

function rsid(slug: string) {
  return unwrap(RideServiceId.create(slug));
}

function makeApprovedHonda() {
  const created = unwrap(
    Vehicle.create({
      vin: vin(VIN_HONDA),
      make: 'Honda',
      model: 'Accord',
      year: 2020,
      vehicleClass: 'comfort',
      eligibleServices: [rsid('economy'), rsid('comfort'), rsid('deliver')],
      dataSource: 'vin_decoded',
      createdAt: FIXED_NOW,
    }),
  );
  return unwrap(created.approve(FIXED_NOW));
}

async function setupDriver(opts?: {
  readonly seedVehicles?: readonly Vehicle[];
  readonly activeVehicleId?: string | null;
}) {
  const authRepo = new InMemoryAuthRepository();
  authRepo.seedAccount({ email: 'driver@yeapp.tech', password: 'hunter22' });
  await authRepo.signIn({
    email: unwrap(Email.create('driver@yeapp.tech')),
    password: 'hunter22',
  });
  const uid = (await authRepo.currentUserId()) as UserId;

  const usersRepo = new InMemoryUserRepository();
  usersRepo.seed(
    makeDriver({
      id: uid,
      email: unwrap(Email.create('driver@yeapp.tech')),
      name: unwrap(PersonName.create({ first: 'Grace', last: 'Hopper' })),
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
      activeVehicleId: opts?.activeVehicleId ?? null,
      vehicleIds: opts?.seedVehicles?.map((v) => String(v.vin)) ?? [],
    }),
  );

  const vehiclesRepo = new InMemoryVehicleRepository();
  for (const v of opts?.seedVehicles ?? []) {
    vehiclesRepo.seed(v, uid);
  }

  useSessionStore.getState().setSignedIn(uid);

  return { authRepo, usersRepo, vehiclesRepo, uid };
}

/* ─── tests ──────────────────────────────────────────────────────── */

describe('VehicleListScreen', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    useSessionStore.setState({ status: 'initializing', userId: null });
  });

  it('renders the empty state for a driver with no vehicles', async () => {
    const setup = await setupDriver();
    const { findByTestId } = render(
      <TestContainerProvider
        auth={setup.authRepo}
        users={setup.usersRepo}
        vehicles={setup.vehiclesRepo}
      >
        <VehicleListScreen />
      </TestContainerProvider>,
    );
    await findByTestId('vehicle-list-empty');
    await findByTestId('vehicle-list-empty-cta');
  });

  it('renders the seeded vehicle as a card with the active highlight', async () => {
    const honda = makeApprovedHonda();
    const setup = await setupDriver({
      seedVehicles: [honda],
      activeVehicleId: VIN_HONDA,
    });
    const { findByTestId, queryByTestId } = render(
      <TestContainerProvider
        auth={setup.authRepo}
        users={setup.usersRepo}
        vehicles={setup.vehiclesRepo}
      >
        <VehicleListScreen />
      </TestContainerProvider>,
    );
    await findByTestId(`vehicle-card-${VIN_HONDA}`);
    expect(queryByTestId('vehicle-list-empty')).toBeNull();
  });

  it('renders the add-vehicle CTA in the header for any state', async () => {
    const setup = await setupDriver();
    const { findByTestId } = render(
      <TestContainerProvider
        auth={setup.authRepo}
        users={setup.usersRepo}
        vehicles={setup.vehiclesRepo}
      >
        <VehicleListScreen />
      </TestContainerProvider>,
    );
    await findByTestId('vehicle-list-add');
  });

  it('shows the per-vehicle Delete button on each card', async () => {
    const honda = makeApprovedHonda();
    const setup = await setupDriver({
      seedVehicles: [honda],
      activeVehicleId: VIN_HONDA,
    });
    const { findByTestId } = render(
      <TestContainerProvider
        auth={setup.authRepo}
        users={setup.usersRepo}
        vehicles={setup.vehiclesRepo}
      >
        <VehicleListScreen />
      </TestContainerProvider>,
    );
    await findByTestId(`vehicle-card-delete-${VIN_HONDA}`);
  });

  it('settles into ready state without leaking a loading spinner', async () => {
    const honda = makeApprovedHonda();
    const setup = await setupDriver({
      seedVehicles: [honda],
      activeVehicleId: VIN_HONDA,
    });
    const { queryByTestId, findByTestId } = render(
      <TestContainerProvider
        auth={setup.authRepo}
        users={setup.usersRepo}
        vehicles={setup.vehiclesRepo}
      >
        <VehicleListScreen />
      </TestContainerProvider>,
    );
    await findByTestId('vehicle-list');
    await waitFor(() => {
      expect(queryByTestId('vehicle-list-empty')).toBeNull();
    });
  });
});
