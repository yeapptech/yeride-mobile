import { RejectVehicle } from '../RejectVehicle';

import {
  FIXED_NOW,
  makeVehicle,
  setupSignedInDriver,
  unwrap,
} from './fixtures';

describe('RejectVehicle', () => {
  it('rejects a pending vehicle with notes', async () => {
    const { vehicles, uid } = await setupSignedInDriver();
    const v = makeVehicle();
    vehicles.seed(v, uid);
    const sut = new RejectVehicle(vehicles, () => FIXED_NOW);

    const r = await sut.execute({
      vin: v.vin,
      notes: 'Photos do not match VIN',
    });

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe('rejected');
      expect(r.value.verificationNotes).toBe('Photos do not match VIN');
      expect(r.value.verifiedAt).toEqual(FIXED_NOW);
    }
  });

  it('refuses empty notes', async () => {
    const { vehicles, uid } = await setupSignedInDriver();
    const v = makeVehicle();
    vehicles.seed(v, uid);
    const sut = new RejectVehicle(vehicles, () => FIXED_NOW);

    const r = await sut.execute({ vin: v.vin, notes: '   ' });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('validation');
      expect(r.error.code).toBe('vehicle_reject_notes_required');
    }
  });

  it('refuses to reject a non-pending vehicle (e.g. already approved)', async () => {
    const { vehicles, uid } = await setupSignedInDriver();
    const v = makeVehicle();
    vehicles.seed(v, uid);
    const approved = unwrap(v.approve(FIXED_NOW));
    await vehicles.update(approved);
    const sut = new RejectVehicle(vehicles, () => FIXED_NOW);

    const r = await sut.execute({ vin: v.vin, notes: 'too late' });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('validation');
      expect(r.error.code).toBe('vehicle_illegal_transition');
    }
  });
});
