import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { Email } from '@domain/entities/Email';
import { PersonName } from '@domain/entities/PersonName';
import { RideServiceId } from '@domain/entities/RideServiceId';
import { makeDriver } from '@domain/entities/User';
import type { UserId } from '@domain/entities/UserId';
import { Vin } from '@domain/entities/Vin';
import type { VinDecodeResult } from '@domain/services';
import { useSessionStore } from '@presentation/stores/useSessionStore';
import {
  FakeVinDecoderService,
  InMemoryAuthRepository,
  InMemoryUserRepository,
  InMemoryVehicleRepository,
  TestContainerProvider,
} from '@shared/testing';

import VehicleRegistrationScreen from '../VehicleRegistrationScreen';

/* ─── mocks ──────────────────────────────────────────────────────── */

const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack }),
}));

// `react-native-safe-area-context` falls back to a plain View if no
// provider is mounted; tests don't care about insets here.

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

function decodedHonda(): VinDecodeResult {
  return {
    vin: vin(VIN_HONDA),
    make: 'Honda',
    model: 'Accord',
    year: 2020,
    trim: null,
    bodyClass: 'Sedan',
    vehicleClass: 'comfort',
    seats: 5,
    doors: 4,
    eligibleServices: [rsid('economy'), rsid('comfort'), rsid('deliver')],
    stockPhoto: null,
    specs: {},
    isEligible: true,
  };
}

async function setupDriver() {
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

/* ─── tests ──────────────────────────────────────────────────────── */

describe('VehicleRegistrationScreen', () => {
  beforeEach(() => {
    mockGoBack.mockClear();
    useSessionStore.setState({ status: 'initializing', userId: null });
  });

  it('renders the VIN entry step and the cancel control by default', async () => {
    const setup = await setupDriver();
    const { findByTestId } = render(
      <TestContainerProvider
        auth={setup.authRepo}
        users={setup.usersRepo}
        vehicles={setup.vehiclesRepo}
        vinDecoder={setup.vinDecoder}
      >
        <VehicleRegistrationScreen />
      </TestContainerProvider>,
    );
    await findByTestId('vin-input');
    await findByTestId('registration-cancel');
  });

  it('shows the decoded preview after a successful decode', async () => {
    const setup = await setupDriver();
    setup.vinDecoder.whenVin(vin(VIN_HONDA)).respondWith(decodedHonda());
    const { findByTestId, getByTestId } = render(
      <TestContainerProvider
        auth={setup.authRepo}
        users={setup.usersRepo}
        vehicles={setup.vehiclesRepo}
        vinDecoder={setup.vinDecoder}
      >
        <VehicleRegistrationScreen />
      </TestContainerProvider>,
    );

    fireEvent.changeText(getByTestId('vin-input'), VIN_HONDA);

    // Wait past the 400ms debounce + decode + state transition.
    await findByTestId('decoded-preview-confirm');
  });

  it('routes to manual entry when decode returns no match', async () => {
    const setup = await setupDriver();
    setup.vinDecoder.whenVin(vin(VIN_HONDA)).respondWithNoMatch();

    const { findByTestId, getByTestId } = render(
      <TestContainerProvider
        auth={setup.authRepo}
        users={setup.usersRepo}
        vehicles={setup.vehiclesRepo}
        vinDecoder={setup.vinDecoder}
      >
        <VehicleRegistrationScreen />
      </TestContainerProvider>,
    );

    fireEvent.changeText(getByTestId('vin-input'), VIN_HONDA);

    // Manual form's submit button is the canary.
    await findByTestId('manual-submit');
  });

  it('confirms the decoded vehicle and registers it (goBack fires)', async () => {
    const setup = await setupDriver();
    setup.vinDecoder.whenVin(vin(VIN_HONDA)).respondWith(decodedHonda());

    const { findByTestId, getByTestId } = render(
      <TestContainerProvider
        auth={setup.authRepo}
        users={setup.usersRepo}
        vehicles={setup.vehiclesRepo}
        vinDecoder={setup.vinDecoder}
      >
        <VehicleRegistrationScreen />
      </TestContainerProvider>,
    );

    fireEvent.changeText(getByTestId('vin-input'), VIN_HONDA);
    const confirm = await findByTestId('decoded-preview-confirm');
    fireEvent.press(confirm);

    await waitFor(() => {
      expect(setup.vehiclesRepo.spies.create).toBe(1);
    });
    await waitFor(() => {
      expect(mockGoBack).toHaveBeenCalledTimes(1);
    });
  });
});
