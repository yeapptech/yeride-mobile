import {
  InMemoryAuthRepository,
  InMemoryVehicleRepository,
} from '@shared/testing';

import { DeleteVehicle } from '../DeleteVehicle';

import {
  VIN_BMW,
  VIN_HONDA,
  makeVehicle,
  setupSignedInDriver,
  vin,
} from './fixtures';

describe('DeleteVehicle', () => {
  it('soft-deletes a vehicle owned by the signed-in driver', async () => {
    const { auth, vehicles, uid } = await setupSignedInDriver();
    const v = makeVehicle({ vin: vin(VIN_HONDA) });
    vehicles.seed(v, uid);
    const sut = new DeleteVehicle(auth, vehicles);

    const r = await sut.execute({ vin: v.vin });

    expect(r.ok).toBe(true);
    expect(vehicles.spies.softDelete).toBe(1);
  });

  it('returns AuthorizationError when no user is signed in', async () => {
    const auth = new InMemoryAuthRepository();
    const vehicles = new InMemoryVehicleRepository();
    const sut = new DeleteVehicle(auth, vehicles);

    const r = await sut.execute({ vin: vin() });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('authorization');
      expect(r.error.code).toBe('auth_no_current_user');
    }
    expect(vehicles.spies.softDelete).toBe(0);
  });

  it('rejects when the vehicle is not owned by the signed-in driver', async () => {
    const { auth, vehicles } = await setupSignedInDriver();
    const v = makeVehicle({ vin: vin(VIN_BMW) });
    const { uid: otherDriverUid } = await setupSignedInDriver();
    vehicles.seed(v, otherDriverUid);
    const sut = new DeleteVehicle(auth, vehicles);

    const r = await sut.execute({ vin: v.vin });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('validation');
      expect(r.error.code).toBe('vehicle_not_owned_by_driver');
    }
  });

  it('clears activeVehicleId when the deleted vehicle was active', async () => {
    const { auth, vehicles, uid } = await setupSignedInDriver();
    const v = makeVehicle({ vin: vin(VIN_HONDA) });
    vehicles.seed(v, uid);
    vehicles.setActiveDirect(uid, v.vin);
    expect(vehicles.getActive(uid)).toBe(VIN_HONDA);

    const sut = new DeleteVehicle(auth, vehicles);
    const r = await sut.execute({ vin: v.vin });

    expect(r.ok).toBe(true);
    expect(vehicles.getActive(uid)).toBeNull();
  });
});
