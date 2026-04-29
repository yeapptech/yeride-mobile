import {
  InMemoryAuthRepository,
  InMemoryUserRepository,
  InMemoryVehicleRepository,
} from '@shared/testing';

import { RegisterVehicle } from '../RegisterVehicle';

import {
  FIXED_NOW,
  VIN_BMW,
  VIN_HONDA,
  rsid,
  setupSignedInDriver,
  setupSignedInRider,
  vin,
} from './fixtures';

function baseArgs() {
  return {
    vin: vin(VIN_HONDA),
    make: 'Honda',
    model: 'Accord',
    year: 2020,
    vehicleClass: 'comfort' as const,
    eligibleServices: [rsid('economy'), rsid('comfort'), rsid('deliver')],
    dataSource: 'vin_decoded' as const,
  };
}

describe('RegisterVehicle', () => {
  it('registers a new vehicle, auto-approves, and auto-sets active when none exists', async () => {
    const { auth, users, vehicles, uid } = await setupSignedInDriver();
    const sut = new RegisterVehicle(auth, users, vehicles, () => FIXED_NOW);

    const r = await sut.execute(baseArgs());

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe('approved');
      expect(String(r.value.vin)).toBe(VIN_HONDA);
    }
    // First vehicle → auto-active.
    expect(vehicles.getActive(uid)).toBe(VIN_HONDA);
    expect(vehicles.getServicesRide(uid)).toEqual([
      'economy',
      'comfort',
      'deliver',
    ]);
    expect(vehicles.spies.create).toBe(1);
    expect(vehicles.spies.update).toBeGreaterThanOrEqual(1);
    expect(vehicles.spies.setActive).toBe(1);
  });

  it('does NOT auto-set-active for the second registered vehicle', async () => {
    const { auth, users, vehicles, uid } = await setupSignedInDriver({
      activeVehicleId: VIN_HONDA,
      vehicleIds: [VIN_HONDA],
    });
    // Pre-existing vehicle in the store (so the user already has one active).
    // We don't really need it to exist as a doc — only `user.activeVehicleId`
    // matters for the auto-active branch.
    const sut = new RegisterVehicle(auth, users, vehicles, () => FIXED_NOW);

    const r = await sut.execute({ ...baseArgs(), vin: vin(VIN_BMW) });

    expect(r.ok).toBe(true);
    expect(vehicles.spies.setActive).toBe(0);
    expect(vehicles.getActive(uid)).toBeNull(); // fake's active is per-store
  });

  it('returns ConflictError on a duplicate VIN', async () => {
    const { auth, users, vehicles, uid } = await setupSignedInDriver();
    const sut = new RegisterVehicle(auth, users, vehicles, () => FIXED_NOW);

    // First registration goes through.
    const r1 = await sut.execute(baseArgs());
    expect(r1.ok).toBe(true);
    void uid;

    // Second with the same VIN should hit the ConflictError branch.
    const r2 = await sut.execute(baseArgs());

    expect(r2.ok).toBe(false);
    if (!r2.ok) {
      expect(r2.error.kind).toBe('conflict');
      expect(r2.error.code).toBe('vehicle_already_exists');
    }
  });

  it('returns AuthorizationError when no user is signed in', async () => {
    const auth = new InMemoryAuthRepository();
    const users = new InMemoryUserRepository();
    const vehicles = new InMemoryVehicleRepository();
    const sut = new RegisterVehicle(auth, users, vehicles, () => FIXED_NOW);

    const r = await sut.execute(baseArgs());

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('authorization');
      expect(r.error.code).toBe('auth_no_current_user');
    }
    expect(vehicles.spies.create).toBe(0);
  });

  it('returns AuthorizationError when the signed-in user is a rider', async () => {
    const { auth, users, vehicles } = await setupSignedInRider();
    const sut = new RegisterVehicle(auth, users, vehicles, () => FIXED_NOW);

    const r = await sut.execute(baseArgs());

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('authorization');
      expect(r.error.code).toBe('vehicle_register_role_not_driver');
    }
    expect(vehicles.spies.create).toBe(0);
  });

  it('returns NotFound when the user doc is missing', async () => {
    const { auth, vehicles } = await setupSignedInDriver();
    // Replace users with an empty repo so getById returns NotFound.
    const emptyUsers = new InMemoryUserRepository();
    const sut = new RegisterVehicle(
      auth,
      emptyUsers,
      vehicles,
      () => FIXED_NOW,
    );

    const r = await sut.execute(baseArgs());

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('not_found');
    expect(vehicles.spies.create).toBe(0);
  });

  it('rejects invalid input via Vehicle.create (e.g. empty make)', async () => {
    const { auth, users, vehicles } = await setupSignedInDriver();
    const sut = new RegisterVehicle(auth, users, vehicles, () => FIXED_NOW);

    const r = await sut.execute({ ...baseArgs(), make: '   ' });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('validation');
      expect(r.error.code).toBe('vehicle_invalid_make');
    }
    expect(vehicles.spies.create).toBe(0);
  });
});
