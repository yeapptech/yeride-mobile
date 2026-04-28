import { RideServiceId } from '@domain/entities/RideServiceId';
import { UserId } from '@domain/entities/UserId';
import { Vehicle } from '@domain/entities/Vehicle';
import { Vin } from '@domain/entities/Vin';

import { InMemoryVehicleRepository } from '../InMemoryVehicleRepository';

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

const VALID_VIN_HONDA = '1HGBH41JXMN109186';
const VALID_VIN_BMW = '5UXKR0C58JL074657';

const FIXED_NOW = new Date('2026-04-28T12:00:00Z');
const LATER = new Date('2026-04-28T13:00:00Z');
const EVEN_LATER = new Date('2026-04-28T14:00:00Z');

function uid(suffix = 'a'): UserId {
  return unwrap(UserId.create(suffix.repeat(28)));
}

function makeVehicle(
  vinStr: string,
  createdAt: Date = FIXED_NOW,
  vehicleClass: 'economy' | 'comfort' | 'luxury' | 'xl' = 'comfort',
  eligible: readonly string[] = ['economy', 'comfort'],
): Vehicle {
  const v = unwrap(Vin.create(vinStr));
  const services = eligible.map((s) => unwrap(RideServiceId.create(s)));
  return unwrap(
    Vehicle.create({
      vin: v,
      make: 'Honda',
      model: 'Accord',
      year: 2020,
      vehicleClass,
      eligibleServices: services,
      dataSource: 'vin_decoded',
      createdAt,
    }),
  );
}

describe('InMemoryVehicleRepository CRUD', () => {
  it('creates a vehicle and links it to the driver', async () => {
    const repo = new InMemoryVehicleRepository();
    const driver = uid('a');
    const v = makeVehicle(VALID_VIN_HONDA);
    const r = await repo.create({ driverId: driver, vehicle: v });
    expect(r.ok).toBe(true);
    const list = unwrap(await repo.listByDriver({ driverId: driver }));
    expect(list).toHaveLength(1);
    expect(String(list[0]!.vin)).toBe(VALID_VIN_HONDA);
  });

  it('rejects create with ConflictError when VIN already exists in pending/approved', async () => {
    const repo = new InMemoryVehicleRepository();
    const driver = uid('a');
    const v = makeVehicle(VALID_VIN_HONDA);
    await repo.create({ driverId: driver, vehicle: v });
    const r = await repo.create({ driverId: driver, vehicle: v });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('vehicle_already_exists');
  });

  it('allows re-creating a VIN whose previous registration was soft-deleted', async () => {
    const repo = new InMemoryVehicleRepository();
    const driver = uid('a');
    const v = makeVehicle(VALID_VIN_HONDA);
    await repo.create({ driverId: driver, vehicle: v });
    const vin = unwrap(Vin.create(VALID_VIN_HONDA));
    await repo.softDelete({ driverId: driver, vin });
    // Re-create the same VIN under the same driver — legacy `isVINRegistered`
    // filters out 'deleted', so this is allowed.
    const r = await repo.create({ driverId: driver, vehicle: v });
    expect(r.ok).toBe(true);
  });

  it('listByDriver returns vehicles sorted by createdAt desc', async () => {
    const repo = new InMemoryVehicleRepository();
    const driver = uid('a');
    repo.seed(makeVehicle(VALID_VIN_HONDA, FIXED_NOW), driver);
    repo.seed(makeVehicle(VALID_VIN_BMW, LATER), driver);
    const list = unwrap(await repo.listByDriver({ driverId: driver }));
    expect(list.map((v) => String(v.vin))).toEqual([
      VALID_VIN_BMW,
      VALID_VIN_HONDA,
    ]);
  });

  it('listByDriver does not return soft-deleted vehicles (legacy unlink semantics)', async () => {
    const repo = new InMemoryVehicleRepository();
    const driver = uid('a');
    repo.seed(makeVehicle(VALID_VIN_HONDA), driver);
    repo.seed(makeVehicle(VALID_VIN_BMW), driver);
    const bmw = unwrap(Vin.create(VALID_VIN_BMW));
    await repo.softDelete({ driverId: driver, vin: bmw });
    const list = unwrap(await repo.listByDriver({ driverId: driver }));
    expect(list).toHaveLength(1);
    expect(String(list[0]!.vin)).toBe(VALID_VIN_HONDA);
    // The deleted vehicle's doc still exists globally — it's just unlinked
    // from the driver. A direct getByVin still returns it.
    expect(unwrap(await repo.getByVin(bmw)).status).toBe('deleted');
  });
});

describe('InMemoryVehicleRepository.softDelete', () => {
  it('flips status to deleted, removes VIN from driver list, clears active', async () => {
    const repo = new InMemoryVehicleRepository();
    const driver = uid('a');
    repo.seed(makeVehicle(VALID_VIN_HONDA), driver);
    // Approve so we can set as active.
    const honda = unwrap(Vin.create(VALID_VIN_HONDA));
    const v0 = unwrap(await repo.getByVin(honda));
    const approved = unwrap(v0.approve(LATER));
    await repo.update(approved);
    await repo.setActive({ driverId: driver, vin: honda });
    expect(repo.getActive(driver)).toBe(VALID_VIN_HONDA);

    const r = await repo.softDelete({ driverId: driver, vin: honda });
    expect(r.ok).toBe(true);
    expect(repo.getActive(driver)).toBeNull();
    const list = unwrap(await repo.listByDriver({ driverId: driver }));
    expect(list).toEqual([]);
  });

  it('refuses softDelete when the driver does not own the vehicle', async () => {
    const repo = new InMemoryVehicleRepository();
    const ownerA = uid('a');
    const otherB = uid('b');
    repo.seed(makeVehicle(VALID_VIN_HONDA), ownerA);
    const vin = unwrap(Vin.create(VALID_VIN_HONDA));
    const r = await repo.softDelete({ driverId: otherB, vin });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('vehicle_not_owned_by_driver');
  });

  it('returns NotFound when the VIN does not exist', async () => {
    const repo = new InMemoryVehicleRepository();
    const driver = uid('a');
    const vin = unwrap(Vin.create(VALID_VIN_HONDA));
    const r = await repo.softDelete({ driverId: driver, vin });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('vehicle_not_found');
  });
});

describe('InMemoryVehicleRepository.setActive', () => {
  it('propagates eligibleServices to user.services.ride', async () => {
    const repo = new InMemoryVehicleRepository();
    const driver = uid('a');
    const v0 = makeVehicle(VALID_VIN_HONDA, FIXED_NOW, 'comfort', [
      'economy',
      'comfort',
    ]);
    repo.seed(v0, driver);
    const honda = unwrap(Vin.create(VALID_VIN_HONDA));
    const approved = unwrap(v0.approve(LATER));
    await repo.update(approved);

    const r = await repo.setActive({ driverId: driver, vin: honda });
    expect(r.ok).toBe(true);
    expect(repo.getActive(driver)).toBe(VALID_VIN_HONDA);
    expect(repo.getServicesRide(driver)).toEqual(['economy', 'comfort']);
  });

  it('refuses to set active when vehicle is not approved', async () => {
    const repo = new InMemoryVehicleRepository();
    const driver = uid('a');
    repo.seed(makeVehicle(VALID_VIN_HONDA), driver); // pending
    const vin = unwrap(Vin.create(VALID_VIN_HONDA));
    const r = await repo.setActive({ driverId: driver, vin });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('vehicle_not_approved');
  });

  it('refuses to set active when driver does not own the vehicle', async () => {
    const repo = new InMemoryVehicleRepository();
    const ownerA = uid('a');
    const otherB = uid('b');
    const v = makeVehicle(VALID_VIN_HONDA);
    repo.seed(v, ownerA);
    const approved = unwrap(v.approve(LATER));
    await repo.update(approved);
    const vin = unwrap(Vin.create(VALID_VIN_HONDA));
    const r = await repo.setActive({ driverId: otherB, vin });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('vehicle_not_owned_by_driver');
  });

  it('clears the active vehicle when called with vin=null', async () => {
    const repo = new InMemoryVehicleRepository();
    const driver = uid('a');
    repo.seed(makeVehicle(VALID_VIN_HONDA), driver);
    const vin = unwrap(Vin.create(VALID_VIN_HONDA));
    const v0 = unwrap(await repo.getByVin(vin));
    await repo.update(unwrap(v0.approve(LATER)));
    await repo.setActive({ driverId: driver, vin });
    const r = await repo.setActive({ driverId: driver, vin: null });
    expect(r.ok).toBe(true);
    expect(repo.getActive(driver)).toBeNull();
  });

  it('records the call on spies', async () => {
    const repo = new InMemoryVehicleRepository();
    const driver = uid('a');
    repo.seed(makeVehicle(VALID_VIN_HONDA), driver);
    const vin = unwrap(Vin.create(VALID_VIN_HONDA));
    const v0 = unwrap(await repo.getByVin(vin));
    await repo.update(unwrap(v0.approve(LATER)));
    await repo.setActive({ driverId: driver, vin });
    expect(repo.spies.setActive).toBe(1);
    expect(repo.spies.lastSetActive?.vin).toBe(vin);
  });
});

describe('InMemoryVehicleRepository.subscribeByDriver', () => {
  it('emits the current state synchronously on subscribe', () => {
    const repo = new InMemoryVehicleRepository();
    const driver = uid('a');
    repo.seed(makeVehicle(VALID_VIN_HONDA), driver);
    const calls: number[] = [];
    const unsub = repo.subscribeByDriver({
      driverId: driver,
      callback: (vs) => calls.push(vs.length),
    });
    expect(calls).toEqual([1]);
    unsub();
  });

  it('re-emits when a vehicle is added', async () => {
    const repo = new InMemoryVehicleRepository();
    const driver = uid('a');
    const calls: number[] = [];
    const unsub = repo.subscribeByDriver({
      driverId: driver,
      callback: (vs) => calls.push(vs.length),
    });
    expect(calls).toEqual([0]); // initial

    await repo.create({
      driverId: driver,
      vehicle: makeVehicle(VALID_VIN_HONDA),
    });
    expect(calls).toEqual([0, 1]);

    await repo.create({
      driverId: driver,
      vehicle: makeVehicle(VALID_VIN_BMW, EVEN_LATER),
    });
    expect(calls).toEqual([0, 1, 2]);
    unsub();
  });

  it('stops emitting after unsubscribe', async () => {
    const repo = new InMemoryVehicleRepository();
    const driver = uid('a');
    const calls: number[] = [];
    const unsub = repo.subscribeByDriver({
      driverId: driver,
      callback: (vs) => calls.push(vs.length),
    });
    unsub();
    await repo.create({
      driverId: driver,
      vehicle: makeVehicle(VALID_VIN_HONDA),
    });
    expect(calls).toEqual([0]); // unchanged after unsubscribe
  });

  it('emits the deleted vehicle out of the list when softDelete fires', async () => {
    const repo = new InMemoryVehicleRepository();
    const driver = uid('a');
    repo.seed(makeVehicle(VALID_VIN_HONDA), driver);
    let last: number | null = null;
    const unsub = repo.subscribeByDriver({
      driverId: driver,
      callback: (vs) => {
        last = vs.length;
      },
    });
    expect(last).toBe(1);
    const vin = unwrap(Vin.create(VALID_VIN_HONDA));
    await repo.softDelete({ driverId: driver, vin });
    expect(last).toBe(0);
    unsub();
  });
});

describe('InMemoryVehicleRepository.existsByVin', () => {
  it('returns true for pending vehicles', async () => {
    const repo = new InMemoryVehicleRepository();
    const driver = uid('a');
    repo.seed(makeVehicle(VALID_VIN_HONDA), driver);
    const vin = unwrap(Vin.create(VALID_VIN_HONDA));
    expect(unwrap(await repo.existsByVin(vin))).toBe(true);
  });

  it('returns false for soft-deleted vehicles', async () => {
    const repo = new InMemoryVehicleRepository();
    const driver = uid('a');
    repo.seed(makeVehicle(VALID_VIN_HONDA), driver);
    const vin = unwrap(Vin.create(VALID_VIN_HONDA));
    await repo.softDelete({ driverId: driver, vin });
    expect(unwrap(await repo.existsByVin(vin))).toBe(false);
  });

  it('returns false for a never-registered VIN', async () => {
    const repo = new InMemoryVehicleRepository();
    const vin = unwrap(Vin.create(VALID_VIN_HONDA));
    expect(unwrap(await repo.existsByVin(vin))).toBe(false);
  });
});
