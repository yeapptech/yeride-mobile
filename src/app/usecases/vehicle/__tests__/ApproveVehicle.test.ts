import { ApproveVehicle } from '../ApproveVehicle';

import {
  FIXED_NOW,
  makeVehicle,
  setupSignedInDriver,
  unwrap,
  vin,
} from './fixtures';

describe('ApproveVehicle', () => {
  it('approves a pending vehicle', async () => {
    const { vehicles, uid } = await setupSignedInDriver();
    const v = makeVehicle();
    vehicles.seed(v, uid);
    const sut = new ApproveVehicle(vehicles, () => FIXED_NOW);

    const r = await sut.execute({ vin: v.vin });

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe('approved');
      expect(r.value.verifiedAt).toEqual(FIXED_NOW);
    }
  });

  it('approves a previously suspended vehicle', async () => {
    const { vehicles, uid } = await setupSignedInDriver();
    const v = makeVehicle();
    vehicles.seed(v, uid);
    // pending → approved → suspended (set up via the entity)
    const approved = unwrap(v.approve(FIXED_NOW));
    const suspended = unwrap(suspendOrThrow(approved));
    await vehicles.update(suspended);
    const sut = new ApproveVehicle(vehicles, () => FIXED_NOW);

    const r = await sut.execute({ vin: v.vin });

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.status).toBe('approved');
  });

  it('returns NotFound when the vehicle does not exist', async () => {
    const { vehicles } = await setupSignedInDriver();
    const sut = new ApproveVehicle(vehicles, () => FIXED_NOW);

    const r = await sut.execute({ vin: vin() });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('not_found');
      expect(r.error.code).toBe('vehicle_not_found');
    }
  });

  it('rejects an illegal transition (e.g. approving a deleted vehicle)', async () => {
    const { vehicles, uid } = await setupSignedInDriver();
    const v = makeVehicle();
    vehicles.seed(v, uid);
    const deleted = unwrap(v.markDeleted(FIXED_NOW));
    await vehicles.update(deleted);
    const sut = new ApproveVehicle(vehicles, () => FIXED_NOW);

    const r = await sut.execute({ vin: v.vin });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('validation');
      expect(r.error.code).toBe('vehicle_illegal_transition');
    }
  });
});

function suspendOrThrow(v: ReturnType<typeof makeVehicle>) {
  return v.suspend({ notes: 'inspection failed', at: FIXED_NOW });
}
