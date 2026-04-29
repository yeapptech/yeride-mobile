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

import { useVehicleListViewModel } from '../useVehicleListViewModel';

/* ─── Test mocks ──────────────────────────────────────────────────── */

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

/* ─── Helpers ─────────────────────────────────────────────────────── */

function unwrap<T>(
  r: { ok: true; value: T } | { ok: false; error: unknown },
): T {
  if (!r.ok) throw r.error;
  return r.value;
}

const VIN_HONDA = '1HGBH41JXMN109186'; // valid check digit
const VIN_BMW = '5UXKR0C58JL074657'; // valid check digit

const FIXED_NOW = new Date('2026-04-28T12:00:00Z');
const EARLIER = new Date('2026-04-01T12:00:00Z');

function vin(value: string) {
  return unwrap(Vin.create(value));
}

function rsid(slug: string) {
  return unwrap(RideServiceId.create(slug));
}

interface MakeApprovedVehicleArgs {
  readonly vin: string;
  readonly make?: string;
  readonly model?: string;
  readonly year?: number;
  readonly vehicleClass?: VehicleClass;
  readonly createdAt?: Date;
}

function makeApprovedVehicle(args: MakeApprovedVehicleArgs): Vehicle {
  const created = unwrap(
    Vehicle.create({
      vin: vin(args.vin),
      make: args.make ?? 'Honda',
      model: args.model ?? 'Accord',
      year: args.year ?? 2020,
      vehicleClass: args.vehicleClass ?? 'comfort',
      eligibleServices: [rsid('economy'), rsid('comfort'), rsid('deliver')],
      dataSource: 'vin_decoded',
      createdAt: args.createdAt ?? FIXED_NOW,
    }),
  );
  return unwrap(created.approve(args.createdAt ?? FIXED_NOW));
}

interface SeededState {
  readonly authRepo: InMemoryAuthRepository;
  readonly usersRepo: InMemoryUserRepository;
  readonly vehiclesRepo: InMemoryVehicleRepository;
  readonly uid: UserId;
  /** Re-seed the driver doc with a different `activeVehicleId`. */
  reseedDriver: (overrides: {
    readonly activeVehicleId: string | null;
    readonly vehicleIds: readonly string[];
  }) => void;
}

async function setupDriver(opts?: {
  readonly activeVehicleId?: string | null;
  readonly seedVehicles?: readonly Vehicle[];
}): Promise<SeededState> {
  const authRepo = new InMemoryAuthRepository();
  authRepo.seedAccount({ email: 'driver@yeapp.tech', password: 'hunter22' });
  await authRepo.signIn({
    email: unwrap(Email.create('driver@yeapp.tech')),
    password: 'hunter22',
  });
  const uid = (await authRepo.currentUserId()) as UserId;

  const usersRepo = new InMemoryUserRepository();

  const seedDriverDoc = (
    activeVehicleId: string | null,
    vehicleIds: readonly string[],
  ) => {
    const driver = makeDriver({
      id: uid,
      email: unwrap(Email.create('driver@yeapp.tech')),
      name: unwrap(PersonName.create({ first: 'Grace', last: 'Hopper' })),
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
      activeVehicleId,
      vehicleIds,
    });
    usersRepo.seed(driver);
  };

  seedDriverDoc(
    opts?.activeVehicleId ?? null,
    opts?.seedVehicles?.map((v) => String(v.vin)) ?? [],
  );

  const vehiclesRepo = new InMemoryVehicleRepository();
  for (const v of opts?.seedVehicles ?? []) {
    vehiclesRepo.seed(v, uid);
  }
  if (opts?.activeVehicleId !== undefined && opts.activeVehicleId !== null) {
    vehiclesRepo.setActiveDirect(uid, vin(opts.activeVehicleId));
  }

  // Session store carries the userId that useCurrentUserQuery's `enabled`
  // gate consults. Without this, the user query would never fire.
  useSessionStore.getState().setSignedIn(uid);

  return {
    authRepo,
    usersRepo,
    vehiclesRepo,
    uid,
    reseedDriver: ({ activeVehicleId, vehicleIds }) =>
      seedDriverDoc(activeVehicleId, vehicleIds),
  };
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

describe('useVehicleListViewModel', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    useSessionStore.setState({ status: 'initializing', userId: null });
  });

  it('starts in loading and resolves to empty for a driver with no vehicles', async () => {
    const setup = await setupDriver();
    const { result } = renderHook(() => useVehicleListViewModel(), {
      wrapper: withTestContainer(setup),
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe('empty');
    });
  });

  it('emits ready with the list and the active VIN when the driver has vehicles', async () => {
    const honda = makeApprovedVehicle({ vin: VIN_HONDA, createdAt: EARLIER });
    const bmw = makeApprovedVehicle({ vin: VIN_BMW, createdAt: FIXED_NOW });
    const setup = await setupDriver({
      seedVehicles: [honda, bmw],
      activeVehicleId: VIN_HONDA,
    });

    const { result } = renderHook(() => useVehicleListViewModel(), {
      wrapper: withTestContainer(setup),
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe('ready');
    });
    if (result.current.state.kind !== 'ready') throw new Error('not ready');
    // Repo emits createdAt-desc; BMW is newer, so it lands first.
    expect(result.current.state.vehicles.map((v) => String(v.vin))).toEqual([
      VIN_BMW,
      VIN_HONDA,
    ]);
    expect(result.current.state.activeVin).toBe(VIN_HONDA);
  });

  it('onActivate flips the active vehicle and the active highlight repaints', async () => {
    const honda = makeApprovedVehicle({ vin: VIN_HONDA });
    const bmw = makeApprovedVehicle({ vin: VIN_BMW });
    const setup = await setupDriver({
      seedVehicles: [honda, bmw],
      activeVehicleId: VIN_HONDA,
    });

    const { result } = renderHook(() => useVehicleListViewModel(), {
      wrapper: withTestContainer(setup),
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe('ready');
    });

    // Drive the user-doc forward so the next user-current refetch sees the
    // updated activeVehicleId. The mutation's `onSuccess` invalidates the
    // user.current query, but the InMemoryUserRepository's user doc has
    // to already be at the post-state for the refetch to see it. In
    // production, the user doc gets the matching write via Firestore's
    // batched setActive payload — the in-memory fake doesn't replicate
    // that linkage, so the test simulates it by re-seeding.
    act(() => {
      result.current.onActivate(vin(VIN_BMW));
    });
    setup.reseedDriver({
      activeVehicleId: VIN_BMW,
      vehicleIds: [VIN_HONDA, VIN_BMW],
    });

    await waitFor(() => {
      if (result.current.state.kind !== 'ready') throw new Error('not ready');
      expect(result.current.state.activeVin).toBe(VIN_BMW);
    });
    expect(setup.vehiclesRepo.spies.setActive).toBe(1);
    expect(setup.vehiclesRepo.spies.lastSetActive).toEqual({
      driverId: setup.uid,
      vin: vin(VIN_BMW),
    });
  });

  it('onActivate is a no-op when the VIN is already active', async () => {
    const honda = makeApprovedVehicle({ vin: VIN_HONDA });
    const setup = await setupDriver({
      seedVehicles: [honda],
      activeVehicleId: VIN_HONDA,
    });

    const { result } = renderHook(() => useVehicleListViewModel(), {
      wrapper: withTestContainer(setup),
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe('ready');
    });

    act(() => {
      result.current.onActivate(vin(VIN_HONDA));
    });

    expect(setup.vehiclesRepo.spies.setActive).toBe(0);
  });

  it('onDelete pops Alert; tapping Delete fires the soft-delete mutation', async () => {
    const honda = makeApprovedVehicle({ vin: VIN_HONDA });
    const setup = await setupDriver({
      seedVehicles: [honda],
      activeVehicleId: VIN_HONDA,
    });

    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {
      // no-op
    });

    const { result } = renderHook(() => useVehicleListViewModel(), {
      wrapper: withTestContainer(setup),
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe('ready');
    });

    act(() => {
      result.current.onDelete(vin(VIN_HONDA), '2020 Honda Accord');
    });

    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [, , buttons] = alertSpy.mock.calls[0] ?? [];
    expect(Array.isArray(buttons)).toBe(true);

    // Tap "Delete" → mutation fires.
    const deleteButton = (
      buttons as { text: string; onPress?: () => void }[]
    ).find((b) => b.text === 'Delete');
    expect(deleteButton).toBeDefined();
    await act(async () => {
      deleteButton?.onPress?.();
      // Yield so the mutation's mutationFn runs.
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(setup.vehiclesRepo.spies.softDelete).toBe(1);
    });

    alertSpy.mockRestore();
  });

  it('onAddVehicle navigates to the registration screen', async () => {
    const setup = await setupDriver();
    const { result } = renderHook(() => useVehicleListViewModel(), {
      wrapper: withTestContainer(setup),
    });

    act(() => {
      result.current.onAddVehicle();
    });

    expect(mockNavigate).toHaveBeenCalledWith('VehicleRegistration');
  });
});
