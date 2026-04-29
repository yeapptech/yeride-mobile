import { Email } from '@domain/entities/Email';
import { PersonName } from '@domain/entities/PersonName';
import { RideServiceId } from '@domain/entities/RideServiceId';
import {
  makeDriver,
  makeRider,
  type Driver,
  type Rider,
} from '@domain/entities/User';
import type { UserId } from '@domain/entities/UserId';
import { Vehicle, type VehiclePhotos } from '@domain/entities/Vehicle';
import type { VehicleClass } from '@domain/entities/VehicleClass';
import { Vin } from '@domain/entities/Vin';
import {
  InMemoryAuthRepository,
  InMemoryUserRepository,
  InMemoryVehiclePhotoRepository,
  InMemoryVehicleRepository,
} from '@shared/testing';

/**
 * Shared test fixtures for the Phase 5 Turn 2 vehicle use-case tests.
 *
 * All factories return real domain values via the same `Result`-returning
 * factories the production code uses; a test that constructs an invalid
 * value object will throw, which is the right signal for fixture drift.
 */

/**
 * A pair of NHTSA-valid VINs (real-world examples). Both have correct
 * check digits — see Vin.test.ts for the rationale.
 */
export const VIN_HONDA = '1HGBH41JXMN109186';
export const VIN_BMW = '5UXKR0C58JL074657';

export const FIXED_NOW = new Date('2026-04-28T12:00:00Z');

export function unwrap<T>(
  r: { ok: true; value: T } | { ok: false; error: unknown },
): T {
  if (!r.ok) throw r.error;
  return r.value;
}

export function vin(value: string = VIN_HONDA) {
  return unwrap(Vin.create(value));
}

export function rsid(slug: string) {
  return unwrap(RideServiceId.create(slug));
}

export function makeEmail(value: string): Email {
  return unwrap(Email.create(value));
}

export function makeName(): PersonName {
  return unwrap(PersonName.create({ first: 'Driver', last: 'McTest' }));
}

export function makeVehicle(
  args: {
    vin?: ReturnType<typeof vin>;
    vehicleClass?: VehicleClass;
    eligibleServices?: ReturnType<typeof rsid>[];
    photos?: VehiclePhotos;
    createdAt?: Date;
  } = {},
) {
  return unwrap(
    Vehicle.create({
      vin: args.vin ?? vin(),
      make: 'Honda',
      model: 'Accord',
      year: 2020,
      vehicleClass: args.vehicleClass ?? 'comfort',
      eligibleServices: args.eligibleServices ?? [
        rsid('economy'),
        rsid('comfort'),
      ],
      dataSource: 'vin_decoded',
      createdAt: args.createdAt ?? FIXED_NOW,
      ...(args.photos !== undefined ? { photos: args.photos } : {}),
    }),
  );
}

/**
 * Sign in a driver, return repos + the uid for tests that need to
 * exercise auth-gated use cases. The driver is also seeded into
 * `InMemoryUserRepository` so `users.getById(uid)` succeeds.
 */
export async function setupSignedInDriver(opts?: {
  activeVehicleId?: string | null;
  vehicleIds?: readonly string[];
}) {
  const auth = new InMemoryAuthRepository();
  const users = new InMemoryUserRepository();
  const vehicles = new InMemoryVehicleRepository();
  const vehiclePhotos = new InMemoryVehiclePhotoRepository();

  auth.seedAccount({
    email: 'driver@yeapp.tech',
    password: 'hunter22',
  });
  await auth.signIn({
    email: makeEmail('driver@yeapp.tech'),
    password: 'hunter22',
  });
  const uid = (await auth.currentUserId()) as UserId;

  const driver: Driver = makeDriver({
    id: uid,
    email: makeEmail('driver@yeapp.tech'),
    name: makeName(),
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    activeVehicleId: opts?.activeVehicleId ?? null,
    vehicleIds: opts?.vehicleIds ?? [],
  });
  users.seed(driver);

  return { auth, users, vehicles, vehiclePhotos, uid, driver };
}

/**
 * Same shape as `setupSignedInDriver` but the seeded user is a rider —
 * used to assert role-gated rejections.
 */
export async function setupSignedInRider() {
  const auth = new InMemoryAuthRepository();
  const users = new InMemoryUserRepository();
  const vehicles = new InMemoryVehicleRepository();
  const vehiclePhotos = new InMemoryVehiclePhotoRepository();

  auth.seedAccount({
    email: 'rider@yeapp.tech',
    password: 'hunter22',
  });
  await auth.signIn({
    email: makeEmail('rider@yeapp.tech'),
    password: 'hunter22',
  });
  const uid = (await auth.currentUserId()) as UserId;

  const rider: Rider = makeRider({
    id: uid,
    email: makeEmail('rider@yeapp.tech'),
    name: makeName(),
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  });
  users.seed(rider);

  return { auth, users, vehicles, vehiclePhotos, uid, rider };
}
