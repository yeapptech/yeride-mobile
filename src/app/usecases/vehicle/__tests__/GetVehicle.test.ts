import { GetVehicle } from '../GetVehicle';

import { makeVehicle, setupSignedInDriver, vin } from './fixtures';

describe('GetVehicle', () => {
  it('returns the vehicle when found', async () => {
    const { vehicles, uid } = await setupSignedInDriver();
    const v = makeVehicle();
    vehicles.seed(v, uid);
    const sut = new GetVehicle(vehicles);

    const r = await sut.execute({ vin: v.vin });

    expect(r.ok).toBe(true);
    if (r.ok) expect(String(r.value.vin)).toBe(String(v.vin));
  });

  it('returns NotFound when the vehicle does not exist', async () => {
    const { vehicles } = await setupSignedInDriver();
    const sut = new GetVehicle(vehicles);

    const r = await sut.execute({ vin: vin() });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('not_found');
      expect(r.error.code).toBe('vehicle_not_found');
    }
  });
});
