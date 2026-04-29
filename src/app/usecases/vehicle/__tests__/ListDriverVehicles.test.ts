import { UserId } from '@domain/entities/UserId';
import { InMemoryVehicleRepository } from '@shared/testing';

import { ListDriverVehicles } from '../ListDriverVehicles';

import {
  FIXED_NOW,
  VIN_BMW,
  VIN_HONDA,
  makeVehicle,
  setupSignedInDriver,
  unwrap,
  vin,
} from './fixtures';

describe('ListDriverVehicles', () => {
  it('emits the current state synchronously on subscribe', async () => {
    const { vehicles, uid } = await setupSignedInDriver();
    vehicles.seed(makeVehicle({ vin: vin(VIN_HONDA) }), uid);
    const sut = new ListDriverVehicles(vehicles);

    const seen: number[] = [];
    const unsubscribe = sut.subscribe({
      driverId: uid,
      callback: (list) => {
        seen.push(list.length);
      },
    });

    expect(seen).toEqual([1]);
    unsubscribe();
  });

  it('emits new state on add and on softDelete', async () => {
    const { vehicles, uid } = await setupSignedInDriver();
    const sut = new ListDriverVehicles(vehicles);

    const lengths: number[] = [];
    const unsubscribe = sut.subscribe({
      driverId: uid,
      callback: (list) => {
        lengths.push(list.length);
      },
    });
    expect(lengths).toEqual([0]);

    const v1 = makeVehicle({ vin: vin(VIN_HONDA) });
    await vehicles.create({ driverId: uid, vehicle: v1 });
    expect(lengths[lengths.length - 1]).toBe(1);

    const v2 = makeVehicle({
      vin: vin(VIN_BMW),
      createdAt: new Date(FIXED_NOW.getTime() + 60_000),
    });
    await vehicles.create({ driverId: uid, vehicle: v2 });
    expect(lengths[lengths.length - 1]).toBe(2);

    await vehicles.softDelete({ driverId: uid, vin: v1.vin });
    expect(lengths[lengths.length - 1]).toBe(1);

    unsubscribe();
  });

  it('returns a synchronous unsubscribe that detaches further callbacks', async () => {
    const { vehicles, uid } = await setupSignedInDriver();
    const sut = new ListDriverVehicles(vehicles);

    let calls = 0;
    const unsubscribe = sut.subscribe({
      driverId: uid,
      callback: () => {
        calls += 1;
      },
    });
    const baseline = calls;
    expect(typeof unsubscribe).toBe('function');
    unsubscribe();

    await vehicles.create({ driverId: uid, vehicle: makeVehicle() });
    expect(calls).toBe(baseline);
  });

  it('isolates subscriptions per driver', async () => {
    const vehicles = new InMemoryVehicleRepository();
    const uid1 = unwrap(UserId.create('aaaaaaaaaaaaaaaaaaaaaaaaaaaa'));
    const uid2 = unwrap(UserId.create('bbbbbbbbbbbbbbbbbbbbbbbbbbbb'));
    const sut = new ListDriverVehicles(vehicles);

    const seen1: string[][] = [];
    const seen2: string[][] = [];
    const u1 = sut.subscribe({
      driverId: uid1,
      callback: (list) => {
        seen1.push(list.map((v) => String(v.vin)));
      },
    });
    const u2 = sut.subscribe({
      driverId: uid2,
      callback: (list) => {
        seen2.push(list.map((v) => String(v.vin)));
      },
    });

    const v = makeVehicle();
    await vehicles.create({ driverId: uid1, vehicle: v });
    expect(seen1).toContainEqual([VIN_HONDA]);
    // uid2 saw only the initial empty emission.
    expect(seen2).toEqual([[]]);

    u1();
    u2();
  });
});
