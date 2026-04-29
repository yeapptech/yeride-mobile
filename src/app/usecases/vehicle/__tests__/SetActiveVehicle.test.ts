import {
  InMemoryAuthRepository,
  InMemoryVehicleRepository,
} from '@shared/testing';

import { SetActiveVehicle } from '../SetActiveVehicle';

import {
  VIN_BMW,
  VIN_HONDA,
  makeVehicle,
  rsid,
  setupSignedInDriver,
  vin,
} from './fixtures';

describe('SetActiveVehicle', () => {
  it('sets active and propagates eligibleServices to user.services.ride', async () => {
    const { auth, vehicles, uid } = await setupSignedInDriver();
    const v = makeVehicle({
      vin: vin(VIN_HONDA),
      eligibleServices: [rsid('economy'), rsid('comfort')],
    });
    vehicles.seed(v, uid);
    // Approve so setActive accepts it.
    const approvedR = v.approve(new Date());
    if (!approvedR.ok) throw approvedR.error;
    await vehicles.update(approvedR.value);
    const sut = new SetActiveVehicle(auth, vehicles);

    const r = await sut.execute({ vin: v.vin });

    expect(r.ok).toBe(true);
    expect(vehicles.getActive(uid)).toBe(VIN_HONDA);
    expect(vehicles.getServicesRide(uid)).toEqual(['economy', 'comfort']);
    expect(vehicles.spies.lastSetActive?.vin).toBeDefined();
    expect(String(vehicles.spies.lastSetActive?.vin)).toBe(VIN_HONDA);
  });

  it('returns AuthorizationError when no user is signed in', async () => {
    const auth = new InMemoryAuthRepository();
    const vehicles = new InMemoryVehicleRepository();
    const sut = new SetActiveVehicle(auth, vehicles);

    const r = await sut.execute({ vin: vin() });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('authorization');
      expect(r.error.code).toBe('auth_no_current_user');
    }
    expect(vehicles.spies.setActive).toBe(0);
  });

  it('rejects when the vehicle is not owned by the signed-in driver', async () => {
    const { auth, vehicles } = await setupSignedInDriver();
    // Seed the vehicle under a *different* driver so ownership-link is
    // missing for our signed-in driver.
    const v = makeVehicle({ vin: vin(VIN_BMW) });
    const { uid: otherDriverUid } = await setupSignedInDriver();
    vehicles.seed(v, otherDriverUid);
    const sut = new SetActiveVehicle(auth, vehicles);

    const r = await sut.execute({ vin: v.vin });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('validation');
      expect(r.error.code).toBe('vehicle_not_owned_by_driver');
    }
  });

  it('rejects when the vehicle exists but is not approved', async () => {
    const { auth, vehicles, uid } = await setupSignedInDriver();
    const v = makeVehicle({ vin: vin(VIN_HONDA) });
    vehicles.seed(v, uid); // status === 'pending'
    const sut = new SetActiveVehicle(auth, vehicles);

    const r = await sut.execute({ vin: v.vin });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('validation');
      expect(r.error.code).toBe('vehicle_not_approved');
    }
  });

  it('clears the active pointer when vin is null', async () => {
    const { auth, vehicles, uid } = await setupSignedInDriver();
    const v = makeVehicle({ vin: vin(VIN_HONDA) });
    vehicles.seed(v, uid);
    vehicles.setActiveDirect(uid, v.vin);
    const sut = new SetActiveVehicle(auth, vehicles);

    const r = await sut.execute({ vin: null });

    expect(r.ok).toBe(true);
    expect(vehicles.getActive(uid)).toBeNull();
  });
});
