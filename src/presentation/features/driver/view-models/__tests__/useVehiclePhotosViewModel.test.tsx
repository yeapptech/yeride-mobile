import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { Email } from '@domain/entities/Email';
import { PersonName } from '@domain/entities/PersonName';
import { RideServiceId } from '@domain/entities/RideServiceId';
import { makeDriver } from '@domain/entities/User';
import type { UserId } from '@domain/entities/UserId';
import { Vehicle } from '@domain/entities/Vehicle';
import type { VehicleClass } from '@domain/entities/VehicleClass';
import { Vin } from '@domain/entities/Vin';
import { NetworkError } from '@domain/errors';
import { useSessionStore } from '@presentation/stores/useSessionStore';
import {
  InMemoryAuthRepository,
  InMemoryUserRepository,
  InMemoryVehicleRepository,
  InMemoryVehiclePhotoRepository,
  TestContainerProvider,
} from '@shared/testing';

import { useVehiclePhotosViewModel } from '../useVehiclePhotosViewModel';

/* ─── Test mocks ──────────────────────────────────────────────────── */

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

/* ─── Helpers ─────────────────────────────────────────────────────── */

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

interface MakeApprovedVehicleArgs {
  readonly vin: string;
  readonly vehicleClass?: VehicleClass;
  readonly photos?: Partial<{
    front: string | null;
    back: string | null;
    left: string | null;
    right: string | null;
    interior: string | null;
  }>;
}

function makeApprovedVehicle(args: MakeApprovedVehicleArgs): Vehicle {
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
  let approved = unwrap(created.approve(FIXED_NOW));
  // Apply seeded photos directly via attachPhoto.
  if (args.photos) {
    for (const [type, url] of Object.entries(args.photos)) {
      if (typeof url === 'string') {
        approved = unwrap(
          approved.attachPhoto({
            type: type as 'front' | 'back' | 'left' | 'right' | 'interior',
            url,
            at: FIXED_NOW,
          }),
        );
      }
    }
  }
  return approved;
}

interface SeededState {
  readonly authRepo: InMemoryAuthRepository;
  readonly usersRepo: InMemoryUserRepository;
  readonly vehiclesRepo: InMemoryVehicleRepository;
  readonly vehiclePhotosRepo: InMemoryVehiclePhotoRepository;
  readonly uid: UserId;
}

async function setupDriver(opts?: {
  readonly seedVehicle?: Vehicle;
  /**
   * If true, seed the vehicle in the photo repo (creating it server-side)
   * but DO NOT add the VIN to the driver's `vehicleIds[]`. Models the
   * "driver tries to upload to a vehicle they don't own" path.
   */
  readonly omitVehicleOwnership?: boolean;
}): Promise<SeededState> {
  const authRepo = new InMemoryAuthRepository();
  authRepo.seedAccount({ email: 'driver@yeapp.tech', password: 'hunter22' });
  await authRepo.signIn({
    email: unwrap(Email.create('driver@yeapp.tech')),
    password: 'hunter22',
  });
  const uid = (await authRepo.currentUserId()) as UserId;

  const usersRepo = new InMemoryUserRepository();
  const vehicleIds =
    opts?.seedVehicle && !opts.omitVehicleOwnership
      ? [String(opts.seedVehicle.vin)]
      : [];
  usersRepo.seed(
    makeDriver({
      id: uid,
      email: unwrap(Email.create('driver@yeapp.tech')),
      name: unwrap(PersonName.create({ first: 'Grace', last: 'Hopper' })),
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
      activeVehicleId: vehicleIds[0] ?? null,
      vehicleIds,
    }),
  );

  const vehiclesRepo = new InMemoryVehicleRepository();
  if (opts?.seedVehicle) {
    vehiclesRepo.seed(opts.seedVehicle, uid);
  }

  const vehiclePhotosRepo = new InMemoryVehiclePhotoRepository();

  useSessionStore.getState().setSignedIn(uid);

  return { authRepo, usersRepo, vehiclesRepo, vehiclePhotosRepo, uid };
}

function withTestContainer(setup: SeededState) {
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

/* ─── Tests ───────────────────────────────────────────────────────── */

describe('useVehiclePhotosViewModel', () => {
  beforeEach(() => {
    mockGoBack.mockClear();
    mockRequestPermissions.mockReset();
    mockLaunchLibrary.mockReset();
    useSessionStore.setState({ status: 'initializing', userId: null });
  });

  it('seeds tiles from the loaded vehicle photos (front attached, others idle)', async () => {
    const honda = makeApprovedVehicle({
      vin: VIN_HONDA,
      photos: { front: 'https://existing.com/front.jpg' },
    });
    const setup = await setupDriver({ seedVehicle: honda });
    const { result } = renderHook(
      () => useVehiclePhotosViewModel({ vin: VIN_HONDA }),
      { wrapper: withTestContainer(setup) },
    );

    await waitFor(() => {
      expect(result.current.state.kind).toBe('ready');
    });
    if (result.current.state.kind !== 'ready') throw new Error('not ready');
    expect(result.current.state.tiles.front).toEqual({
      kind: 'attached',
      url: 'https://existing.com/front.jpg',
    });
    expect(result.current.state.tiles.back.kind).toBe('idle');
    expect(result.current.state.tiles.interior.kind).toBe('idle');
  });

  it('happy path: pick photo → uploading → attached', async () => {
    const honda = makeApprovedVehicle({ vin: VIN_HONDA });
    const setup = await setupDriver({ seedVehicle: honda });

    mockRequestPermissions.mockResolvedValue({ granted: true });
    mockLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///tmp/picked.jpg' }],
    });

    const { result } = renderHook(
      () => useVehiclePhotosViewModel({ vin: VIN_HONDA }),
      { wrapper: withTestContainer(setup) },
    );
    await waitFor(() => {
      expect(result.current.state.kind).toBe('ready');
    });

    await act(async () => {
      result.current.onPickPhoto('front');
    });

    await waitFor(() => {
      if (result.current.state.kind !== 'ready') throw new Error('not ready');
      expect(result.current.state.tiles.front.kind).toBe('attached');
    });
    if (result.current.state.kind !== 'ready') throw new Error('not ready');
    const tile = result.current.state.tiles.front;
    if (tile.kind !== 'attached') throw new Error('not attached');
    // The InMemory photo repo emits memory://-shaped URLs.
    expect(tile.url).toMatch(/^memory:\/\/vehicles\/.*front_/);
    expect(setup.vehiclePhotosRepo.getUploads()).toHaveLength(1);
    expect(setup.vehiclePhotosRepo.getUploads()[0]?.localUri).toBe(
      'file:///tmp/picked.jpg',
    );
  });

  it('picker cancellation is silent — tile stays idle, no upload fired', async () => {
    const honda = makeApprovedVehicle({ vin: VIN_HONDA });
    const setup = await setupDriver({ seedVehicle: honda });

    mockRequestPermissions.mockResolvedValue({ granted: true });
    mockLaunchLibrary.mockResolvedValue({ canceled: true });

    const { result } = renderHook(
      () => useVehiclePhotosViewModel({ vin: VIN_HONDA }),
      { wrapper: withTestContainer(setup) },
    );
    await waitFor(() => {
      expect(result.current.state.kind).toBe('ready');
    });

    await act(async () => {
      result.current.onPickPhoto('back');
    });

    if (result.current.state.kind !== 'ready') throw new Error('not ready');
    expect(result.current.state.tiles.back.kind).toBe('idle');
    expect(setup.vehiclePhotosRepo.getUploads()).toHaveLength(0);
  });

  it('upload failure surfaces a per-tile error (other tiles unaffected)', async () => {
    const honda = makeApprovedVehicle({ vin: VIN_HONDA });
    const setup = await setupDriver({ seedVehicle: honda });

    mockRequestPermissions.mockResolvedValue({ granted: true });
    mockLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///tmp/picked.jpg' }],
    });
    setup.vehiclePhotosRepo.mockNextUploadError(
      new NetworkError({
        code: 'network_offline',
        message: 'offline',
      }),
    );

    const { result } = renderHook(
      () => useVehiclePhotosViewModel({ vin: VIN_HONDA }),
      { wrapper: withTestContainer(setup) },
    );
    await waitFor(() => {
      expect(result.current.state.kind).toBe('ready');
    });

    await act(async () => {
      result.current.onPickPhoto('left');
    });

    await waitFor(() => {
      if (result.current.state.kind !== 'ready') throw new Error('not ready');
      expect(result.current.state.tiles.left.kind).toBe('error');
    });
    if (result.current.state.kind !== 'ready') throw new Error('not ready');
    // Other tiles are still idle.
    expect(result.current.state.tiles.front.kind).toBe('idle');
    expect(result.current.state.tiles.right.kind).toBe('idle');

    // onClearError dismisses the error and re-enables the tile.
    act(() => {
      result.current.onClearError('left');
    });
    if (result.current.state.kind !== 'ready') throw new Error('not ready');
    expect(result.current.state.tiles.left.kind).toBe('idle');
  });

  it('permission denial surfaces a per-tile error rather than launching the picker', async () => {
    const honda = makeApprovedVehicle({ vin: VIN_HONDA });
    const setup = await setupDriver({ seedVehicle: honda });

    mockRequestPermissions.mockResolvedValue({ granted: false });

    const { result } = renderHook(
      () => useVehiclePhotosViewModel({ vin: VIN_HONDA }),
      { wrapper: withTestContainer(setup) },
    );
    await waitFor(() => {
      expect(result.current.state.kind).toBe('ready');
    });

    await act(async () => {
      result.current.onPickPhoto('interior');
    });

    if (result.current.state.kind !== 'ready') throw new Error('not ready');
    expect(result.current.state.tiles.interior.kind).toBe('error');
    expect(mockLaunchLibrary).not.toHaveBeenCalled();
  });

  it('ownership rejection (driver does not own VIN) → tile error', async () => {
    const honda = makeApprovedVehicle({ vin: VIN_HONDA });
    const setup = await setupDriver({
      seedVehicle: honda,
      omitVehicleOwnership: true,
    });

    mockRequestPermissions.mockResolvedValue({ granted: true });
    mockLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///tmp/picked.jpg' }],
    });

    const { result } = renderHook(
      () => useVehiclePhotosViewModel({ vin: VIN_HONDA }),
      { wrapper: withTestContainer(setup) },
    );
    await waitFor(() => {
      expect(result.current.state.kind).toBe('ready');
    });

    await act(async () => {
      result.current.onPickPhoto('right');
    });

    await waitFor(() => {
      if (result.current.state.kind !== 'ready') throw new Error('not ready');
      expect(result.current.state.tiles.right.kind).toBe('error');
    });
    // No Storage upload was made because the use case rejects before
    // the Storage write.
    expect(setup.vehiclePhotosRepo.getUploads()).toHaveLength(0);
  });

  it('onDone pops back', async () => {
    const honda = makeApprovedVehicle({ vin: VIN_HONDA });
    const setup = await setupDriver({ seedVehicle: honda });

    const { result } = renderHook(
      () => useVehiclePhotosViewModel({ vin: VIN_HONDA }),
      { wrapper: withTestContainer(setup) },
    );
    await waitFor(() => {
      expect(result.current.state.kind).toBe('ready');
    });

    act(() => {
      result.current.onDone();
    });
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('invalid VIN in route params lands the VM in error state', async () => {
    const setup = await setupDriver();
    const { result } = renderHook(
      () => useVehiclePhotosViewModel({ vin: 'NOTAVIN' }),
      { wrapper: withTestContainer(setup) },
    );

    await waitFor(() => {
      expect(result.current.state.kind).toBe('error');
    });
  });
});
