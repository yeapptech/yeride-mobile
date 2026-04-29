import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Alert } from 'react-native';

import { Email } from '@domain/entities/Email';
import { PersonName } from '@domain/entities/PersonName';
import { RideServiceId } from '@domain/entities/RideServiceId';
import { makeDriver } from '@domain/entities/User';
import type { UserId } from '@domain/entities/UserId';
import { Vehicle } from '@domain/entities/Vehicle';
import type { VehicleClass } from '@domain/entities/VehicleClass';
import { Vin } from '@domain/entities/Vin';
import { useSessionStore } from '@presentation/stores/useSessionStore';
import {
  InMemoryAuthRepository,
  InMemoryUserRepository,
  InMemoryVehicleRepository,
  TestContainerProvider,
} from '@shared/testing';

import { useVehicleDetailsViewModel } from '../useVehicleDetailsViewModel';

/* ─── Test mocks ──────────────────────────────────────────────────── */

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
}));

/* ─── Helpers ─────────────────────────────────────────────────────── */

function unwrap<T>(
  r: { ok: true; value: T } | { ok: false; error: unknown },
): T {
  if (!r.ok) throw r.error;
  return r.value;
}

const VIN_HONDA = '1HGBH41JXMN109186';
const VIN_BMW = '5UXKR0C58JL074657';
const FIXED_NOW = new Date('2026-04-28T12:00:00Z');

function vin(value: string) {
  return unwrap(Vin.create(value));
}

function rsid(slug: string) {
  return unwrap(RideServiceId.create(slug));
}

interface MakeVehicleArgs {
  readonly vin: string;
  readonly approved?: boolean;
  readonly vehicleClass?: VehicleClass;
}

function makeVehicle(args: MakeVehicleArgs): Vehicle {
  const created = unwrap(
    Vehicle.create({
      vin: vin(args.vin),
      make: 'Honda',
      model: 'Accord',
      year: 2020,
      vehicleClass: args.vehicleClass ?? 'comfort',
      eligibleServices: [rsid('economy'), rsid('comfort')],
      dataSource: 'vin_decoded',
      createdAt: FIXED_NOW,
    }),
  );
  if (args.approved === false) return created;
  return unwrap(created.approve(FIXED_NOW));
}

interface SeededState {
  readonly authRepo: InMemoryAuthRepository;
  readonly usersRepo: InMemoryUserRepository;
  readonly vehiclesRepo: InMemoryVehicleRepository;
  readonly uid: UserId;
}

async function setupDriver(opts: {
  readonly seedVehicle: Vehicle;
  readonly activeVehicleId: string | null;
}): Promise<SeededState> {
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
      activeVehicleId: opts.activeVehicleId,
      vehicleIds: [String(opts.seedVehicle.vin)],
    }),
  );

  const vehiclesRepo = new InMemoryVehicleRepository();
  vehiclesRepo.seed(opts.seedVehicle, uid);
  if (opts.activeVehicleId !== null) {
    vehiclesRepo.setActiveDirect(uid, vin(opts.activeVehicleId));
  }

  useSessionStore.getState().setSignedIn(uid);

  return { authRepo, usersRepo, vehiclesRepo, uid };
}

function withTestContainer(setup: SeededState) {
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

/* ─── Tests ───────────────────────────────────────────────────────── */

describe('useVehicleDetailsViewModel', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockGoBack.mockClear();
    useSessionStore.setState({ status: 'initializing', userId: null });
  });

  it('reaches ready with isActive=true and canSetActive=false for the active vehicle', async () => {
    const honda = makeVehicle({ vin: VIN_HONDA });
    const setup = await setupDriver({
      seedVehicle: honda,
      activeVehicleId: VIN_HONDA,
    });

    const { result } = renderHook(
      () => useVehicleDetailsViewModel({ vin: VIN_HONDA }),
      { wrapper: withTestContainer(setup) },
    );

    await waitFor(() => {
      expect(result.current.state.kind).toBe('ready');
    });
    if (result.current.state.kind !== 'ready') throw new Error('not ready');
    expect(result.current.state.isActive).toBe(true);
    expect(result.current.state.canSetActive).toBe(false);
    expect(String(result.current.state.vehicle.vin)).toBe(VIN_HONDA);
  });

  it('reaches ready with canSetActive=true for an approved non-active vehicle', async () => {
    const bmw = makeVehicle({ vin: VIN_BMW });
    const setup = await setupDriver({
      seedVehicle: bmw,
      activeVehicleId: null,
    });

    const { result } = renderHook(
      () => useVehicleDetailsViewModel({ vin: VIN_BMW }),
      { wrapper: withTestContainer(setup) },
    );

    await waitFor(() => {
      expect(result.current.state.kind).toBe('ready');
    });
    if (result.current.state.kind !== 'ready') throw new Error('not ready');
    expect(result.current.state.isActive).toBe(false);
    expect(result.current.state.canSetActive).toBe(true);
  });

  it('onSetActive fires the mutation; canSetActive=false is a no-op', async () => {
    const bmw = makeVehicle({ vin: VIN_BMW });
    const setup = await setupDriver({
      seedVehicle: bmw,
      activeVehicleId: null,
    });

    const { result } = renderHook(
      () => useVehicleDetailsViewModel({ vin: VIN_BMW }),
      { wrapper: withTestContainer(setup) },
    );

    await waitFor(() => {
      expect(result.current.state.kind).toBe('ready');
    });

    act(() => {
      result.current.onSetActive();
    });

    await waitFor(() => {
      expect(setup.vehiclesRepo.spies.setActive).toBe(1);
    });
    expect(setup.vehiclesRepo.spies.lastSetActive).toEqual({
      driverId: setup.uid,
      vin: vin(VIN_BMW),
    });
  });

  it('onSetActive is a no-op when vehicle is not approved', async () => {
    const honda = makeVehicle({ vin: VIN_HONDA, approved: false });
    const setup = await setupDriver({
      seedVehicle: honda,
      activeVehicleId: null,
    });

    const { result } = renderHook(
      () => useVehicleDetailsViewModel({ vin: VIN_HONDA }),
      { wrapper: withTestContainer(setup) },
    );

    await waitFor(() => {
      expect(result.current.state.kind).toBe('ready');
    });
    if (result.current.state.kind !== 'ready') throw new Error('not ready');
    expect(result.current.state.canSetActive).toBe(false);

    act(() => {
      result.current.onSetActive();
    });
    expect(setup.vehiclesRepo.spies.setActive).toBe(0);
  });

  it('onDelete pops Alert; tap Delete fires soft-delete and pops back', async () => {
    const honda = makeVehicle({ vin: VIN_HONDA });
    const setup = await setupDriver({
      seedVehicle: honda,
      activeVehicleId: VIN_HONDA,
    });

    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {
      // no-op
    });

    const { result } = renderHook(
      () => useVehicleDetailsViewModel({ vin: VIN_HONDA }),
      { wrapper: withTestContainer(setup) },
    );

    await waitFor(() => {
      expect(result.current.state.kind).toBe('ready');
    });

    act(() => {
      result.current.onDelete();
    });

    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [, , buttons] = alertSpy.mock.calls[0] ?? [];
    const deleteButton = (
      buttons as { text: string; onPress?: () => void }[]
    ).find((b) => b.text === 'Delete');
    expect(deleteButton).toBeDefined();

    await act(async () => {
      deleteButton?.onPress?.();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(setup.vehiclesRepo.spies.softDelete).toBe(1);
    });
    await waitFor(() => {
      expect(mockGoBack).toHaveBeenCalledTimes(1);
    });

    alertSpy.mockRestore();
  });

  it('onEditPhotos navigates to VehiclePhotos with the VIN', async () => {
    const honda = makeVehicle({ vin: VIN_HONDA });
    const setup = await setupDriver({
      seedVehicle: honda,
      activeVehicleId: VIN_HONDA,
    });

    const { result } = renderHook(
      () => useVehicleDetailsViewModel({ vin: VIN_HONDA }),
      { wrapper: withTestContainer(setup) },
    );
    await waitFor(() => {
      expect(result.current.state.kind).toBe('ready');
    });

    act(() => {
      result.current.onEditPhotos();
    });
    expect(mockNavigate).toHaveBeenCalledWith('VehiclePhotos', {
      vin: VIN_HONDA,
    });
  });
});
