import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { Email } from '@domain/entities/Email';
import { PersonName } from '@domain/entities/PersonName';
import { RideServiceId } from '@domain/entities/RideServiceId';
import { makeDriver } from '@domain/entities/User';
import type { UserId } from '@domain/entities/UserId';
import { Vehicle } from '@domain/entities/Vehicle';
import { Vin } from '@domain/entities/Vin';
import { ConflictError, NetworkError } from '@domain/errors';
import type { VinDecodeResult } from '@domain/services';
import { useSessionStore } from '@presentation/stores/useSessionStore';
import {
  FakeVinDecoderService,
  InMemoryAuthRepository,
  InMemoryUserRepository,
  InMemoryVehicleRepository,
  TestContainerProvider,
} from '@shared/testing';

import {
  EMPTY_MANUAL_VALUES,
  useVehicleRegistrationViewModel,
} from '../useVehicleRegistrationViewModel';

/* ─── mocks ──────────────────────────────────────────────────────── */

const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack }),
}));

/* ─── helpers ────────────────────────────────────────────────────── */

function unwrap<T>(
  r: { ok: true; value: T } | { ok: false; error: unknown },
): T {
  if (!r.ok) throw r.error;
  return r.value;
}

const VIN_HONDA = '1HGBH41JXMN109186';

function vin(value: string) {
  return unwrap(Vin.create(value));
}

function rsid(slug: string) {
  return unwrap(RideServiceId.create(slug));
}

const FIXED_NOW = new Date('2026-04-28T12:00:00Z');

function mockDecodedHonda(): VinDecodeResult {
  return {
    vin: vin(VIN_HONDA),
    make: 'Honda',
    model: 'Accord',
    year: 2020,
    trim: 'EX',
    bodyClass: 'Sedan',
    vehicleClass: 'comfort',
    seats: 5,
    doors: 4,
    eligibleServices: [rsid('economy'), rsid('comfort'), rsid('deliver')],
    stockPhoto: 'https://example.com/honda.jpg',
    specs: { engine: { fuelType: 'Gasoline' } },
    isEligible: true,
  };
}

interface SeededState {
  readonly authRepo: InMemoryAuthRepository;
  readonly usersRepo: InMemoryUserRepository;
  readonly vehiclesRepo: InMemoryVehicleRepository;
  readonly vinDecoder: FakeVinDecoderService;
  readonly uid: UserId;
}

async function setupDriver(): Promise<SeededState> {
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
    }),
  );

  const vehiclesRepo = new InMemoryVehicleRepository();
  const vinDecoder = new FakeVinDecoderService();

  useSessionStore.getState().setSignedIn(uid);

  return { authRepo, usersRepo, vehiclesRepo, vinDecoder, uid };
}

function withTestContainer(setup: SeededState) {
  return ({ children }: { children: ReactNode }) => (
    <TestContainerProvider
      auth={setup.authRepo}
      users={setup.usersRepo}
      vehicles={setup.vehiclesRepo}
      vinDecoder={setup.vinDecoder}
    >
      {children}
    </TestContainerProvider>
  );
}

/* ─── tests ──────────────────────────────────────────────────────── */

describe('useVehicleRegistrationViewModel', () => {
  beforeEach(() => {
    mockGoBack.mockClear();
    useSessionStore.setState({ status: 'initializing', userId: null });
  });

  it('starts idle and remains idle for invalid VIN input', async () => {
    const setup = await setupDriver();
    const { result } = renderHook(() => useVehicleRegistrationViewModel(), {
      wrapper: withTestContainer(setup),
    });

    expect(result.current.state.kind).toBe('idle');

    act(() => {
      result.current.setVinInput('NOTAVIN');
    });
    // Wait past the debounce window.
    await new Promise((r) => setTimeout(r, 500));

    // Still idle — Vin.create rejected on length, no decode fires.
    expect(result.current.state.kind).toBe('idle');
    expect(setup.vinDecoder.callCount).toBe(0);
  });

  it('decodes a valid VIN once and lands in decoded with the NHTSA data', async () => {
    const setup = await setupDriver();
    setup.vinDecoder.whenVin(vin(VIN_HONDA)).respondWith(mockDecodedHonda());

    const { result } = renderHook(() => useVehicleRegistrationViewModel(), {
      wrapper: withTestContainer(setup),
    });

    act(() => {
      result.current.setVinInput(VIN_HONDA);
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe('decoded');
    });
    if (result.current.state.kind !== 'decoded') throw new Error('not decoded');
    expect(result.current.state.decoded.make).toBe('Honda');
    expect(result.current.state.decoded.vehicleClass).toBe('comfort');
    expect(setup.vinDecoder.callCount).toBe(1);
  });

  it('falls back to manual on no-match (Result.ok(null))', async () => {
    const setup = await setupDriver();
    setup.vinDecoder.whenVin(vin(VIN_HONDA)).respondWithNoMatch();

    const { result } = renderHook(() => useVehicleRegistrationViewModel(), {
      wrapper: withTestContainer(setup),
    });

    act(() => {
      result.current.setVinInput(VIN_HONDA);
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe('manual');
    });
    if (result.current.state.kind !== 'manual') throw new Error('not manual');
    expect(setup.vinDecoder.callCount).toBe(1);
  });

  it('falls back to manual on NetworkError', async () => {
    const setup = await setupDriver();
    setup.vinDecoder.whenVin(vin(VIN_HONDA)).respondWithNetworkError(
      new NetworkError({
        code: 'nhtsa_request_failed',
        message: 'fetch failed',
      }),
    );

    const { result } = renderHook(() => useVehicleRegistrationViewModel(), {
      wrapper: withTestContainer(setup),
    });

    act(() => {
      result.current.setVinInput(VIN_HONDA);
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe('manual');
    });
  });

  it('confirmDecoded submits and lands in submitted, then pops back', async () => {
    const setup = await setupDriver();
    setup.vinDecoder.whenVin(vin(VIN_HONDA)).respondWith(mockDecodedHonda());

    const { result } = renderHook(() => useVehicleRegistrationViewModel(), {
      wrapper: withTestContainer(setup),
    });

    act(() => {
      result.current.setVinInput(VIN_HONDA);
    });
    await waitFor(() => {
      expect(result.current.state.kind).toBe('decoded');
    });

    act(() => {
      result.current.confirmDecoded();
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe('submitted');
    });
    if (result.current.state.kind !== 'submitted') {
      throw new Error('not submitted');
    }
    expect(String(result.current.state.vehicle.vin)).toBe(VIN_HONDA);
    expect(setup.vehiclesRepo.spies.create).toBe(1);
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('manual submit runs values through VehicleClassifier and registers', async () => {
    const setup = await setupDriver();
    setup.vinDecoder.whenVin(vin(VIN_HONDA)).respondWithNoMatch();

    const { result } = renderHook(() => useVehicleRegistrationViewModel(), {
      wrapper: withTestContainer(setup),
    });

    act(() => {
      result.current.setVinInput(VIN_HONDA);
    });
    await waitFor(() => {
      expect(result.current.state.kind).toBe('manual');
    });

    act(() => {
      result.current.submitManual({
        ...EMPTY_MANUAL_VALUES,
        make: 'Toyota',
        model: 'Camry',
        year: '2022',
        bodyClass: 'sedan',
        vehicleSize: 'mid-size',
        seats: '5',
        doors: '4',
        fuelType: 'Gasoline',
      });
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe('submitted');
    });

    // Toyota Camry mid-size sedan → 'comfort' class → eligible services
    // [economy, comfort, deliver]. Verify the vehicle made it through the
    // repo with that class.
    if (result.current.state.kind !== 'submitted')
      throw new Error('not submitted');
    const vehicle = result.current.state.vehicle;
    expect(vehicle.vehicleClass).toBe('comfort');
    expect(vehicle.eligibleServices.map(String)).toEqual([
      'economy',
      'comfort',
      'deliver',
    ]);
    expect(vehicle.dataSource).toBe('manual_entry');
  });

  it('manual submit on an ineligible vehicle still registers with empty eligibleServices', async () => {
    const setup = await setupDriver();
    setup.vinDecoder.whenVin(vin(VIN_HONDA)).respondWithNoMatch();

    const { result } = renderHook(() => useVehicleRegistrationViewModel(), {
      wrapper: withTestContainer(setup),
    });

    act(() => {
      result.current.setVinInput(VIN_HONDA);
    });
    await waitFor(() => {
      expect(result.current.state.kind).toBe('manual');
    });

    // 2-door non-coupe with only 2 seats → ineligible. classify still runs
    // but `computeEligibleServices` returns []. Admin review is the final
    // gate; we don't block submit.
    act(() => {
      result.current.submitManual({
        ...EMPTY_MANUAL_VALUES,
        make: 'Mini',
        model: 'Cooper',
        year: '2024',
        bodyClass: 'sedan',
        vehicleSize: 'compact',
        seats: '2',
        doors: '2',
        fuelType: 'Gasoline',
      });
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe('submitted');
    });
    if (result.current.state.kind !== 'submitted')
      throw new Error('not submitted');
    expect(result.current.state.vehicle.eligibleServices).toEqual([]);
  });

  it('surfaces ConflictError when the VIN is already registered', async () => {
    const setup = await setupDriver();
    setup.vinDecoder.whenVin(vin(VIN_HONDA)).respondWith(mockDecodedHonda());

    // Pre-seed an approved vehicle on this driver — a second register with
    // the same VIN must hit `vehicle_already_exists`.
    const seedR = Vehicle.create({
      vin: vin(VIN_HONDA),
      make: 'Honda',
      model: 'Accord',
      year: 2020,
      vehicleClass: 'comfort',
      eligibleServices: [rsid('economy'), rsid('comfort'), rsid('deliver')],
      dataSource: 'vin_decoded',
      createdAt: FIXED_NOW,
    });
    if (!seedR.ok) throw seedR.error;
    const approved = seedR.value.approve(FIXED_NOW);
    if (!approved.ok) throw approved.error;
    setup.vehiclesRepo.seed(approved.value, setup.uid);

    const { result } = renderHook(() => useVehicleRegistrationViewModel(), {
      wrapper: withTestContainer(setup),
    });

    act(() => {
      result.current.setVinInput(VIN_HONDA);
    });
    await waitFor(() => {
      expect(result.current.state.kind).toBe('decoded');
    });

    act(() => {
      result.current.confirmDecoded();
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe('error');
    });
    if (result.current.state.kind !== 'error') throw new Error('not error');
    expect(result.current.state.error).toBeInstanceOf(ConflictError);
    expect(result.current.state.error.code).toBe('vehicle_already_exists');
    // goBack NOT called — the user stays on the form to fix it.
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it('debounces VIN input — typing the full VIN over time only decodes once', async () => {
    const setup = await setupDriver();
    setup.vinDecoder.whenVin(vin(VIN_HONDA)).respondWith(mockDecodedHonda());

    const { result } = renderHook(() => useVehicleRegistrationViewModel(), {
      wrapper: withTestContainer(setup),
    });

    // Simulate the user typing the VIN one character at a time. Each
    // keystroke restarts the debounce timer; only the final stable value
    // (after 400ms of quiet) triggers the decode.
    for (let i = 1; i <= VIN_HONDA.length; i += 1) {
      act(() => {
        result.current.setVinInput(VIN_HONDA.slice(0, i));
      });
      // Less than the debounce window — won't fire yet.
      await new Promise((r) => setTimeout(r, 50));
    }

    await waitFor(() => {
      expect(result.current.state.kind).toBe('decoded');
    });

    // Decoder ran exactly once even though we set the input 17 times.
    expect(setup.vinDecoder.callCount).toBe(1);
  });
});
