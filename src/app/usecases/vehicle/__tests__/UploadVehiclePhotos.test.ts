import { NetworkError } from '@domain/errors';
import {
  InMemoryAuthRepository,
  InMemoryUserRepository,
  InMemoryVehiclePhotoRepository,
  InMemoryVehicleRepository,
} from '@shared/testing';

import { UploadVehiclePhotos } from '../UploadVehiclePhotos';

import {
  FIXED_NOW,
  VIN_BMW,
  VIN_HONDA,
  makeVehicle,
  setupSignedInDriver,
  setupSignedInRider,
  vin,
} from './fixtures';

async function seedDriverWithVehicle() {
  const ctx = await setupSignedInDriver({
    activeVehicleId: null,
    vehicleIds: [VIN_HONDA],
  });
  const v = makeVehicle({ vin: vin(VIN_HONDA) });
  ctx.vehicles.seed(v, ctx.uid);
  return { ...ctx, vehicle: v };
}

describe('UploadVehiclePhotos', () => {
  it('uploads a single photo and persists the URL onto the vehicle', async () => {
    const { auth, users, vehicles, vehiclePhotos, vehicle } =
      await seedDriverWithVehicle();
    const sut = new UploadVehiclePhotos(
      auth,
      users,
      vehicles,
      vehiclePhotos,
      () => FIXED_NOW,
    );

    const r = await sut.execute({
      vin: vehicle.vin,
      photos: { front: 'file:///tmp/front.jpg' },
    });

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.photos.front).toMatch(/^memory:\/\/vehicles/);
      expect(r.value.photos.back).toBeNull();
    }
    expect(vehiclePhotos.getUploads()).toHaveLength(1);
  });

  it('uploads multiple photos in canonical order and accumulates URLs', async () => {
    const { auth, users, vehicles, vehiclePhotos, vehicle } =
      await seedDriverWithVehicle();
    const sut = new UploadVehiclePhotos(
      auth,
      users,
      vehicles,
      vehiclePhotos,
      () => FIXED_NOW,
    );

    const r = await sut.execute({
      vin: vehicle.vin,
      photos: {
        right: 'file:///tmp/right.jpg',
        front: 'file:///tmp/front.jpg',
        interior: 'file:///tmp/interior.jpg',
      },
    });

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.photos.front).not.toBeNull();
      expect(r.value.photos.right).not.toBeNull();
      expect(r.value.photos.interior).not.toBeNull();
      expect(r.value.photos.back).toBeNull();
      expect(r.value.photos.left).toBeNull();
    }
    // Canonical order is front, back, left, right, interior — but only
    // the slots we passed get uploaded. So uploads should be: front, right, interior.
    const uploads = vehiclePhotos.getUploads();
    expect(uploads.map((u) => u.type)).toEqual(['front', 'right', 'interior']);
  });

  it('aborts on the first upload failure (partial state preserved)', async () => {
    const { auth, users, vehicles, vehiclePhotos, vehicle } =
      await seedDriverWithVehicle();
    // First upload succeeds; second fails. Use mockNextUploadError after
    // the first call by counting uploads — but the helper applies to the
    // very next call. So queue up: succeed once, fail once.
    const sut = new UploadVehiclePhotos(
      auth,
      users,
      vehicles,
      vehiclePhotos,
      () => FIXED_NOW,
    );

    // We need to fail the SECOND upload, not the first. Easiest path: do
    // a single-photo upload first, then queue an error and do a 2-photo
    // call where the first succeeds and the second fails.
    await sut.execute({ vin: vehicle.vin, photos: { front: 'file://a.jpg' } });
    vehiclePhotos.mockNextUploadError(
      new NetworkError({
        code: 'vehicle_photo_upload_failed',
        message: 'Storage timeout',
      }),
    );

    const r = await sut.execute({
      vin: vehicle.vin,
      photos: { back: 'file://b.jpg', left: 'file://c.jpg' },
    });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('network');
      expect(r.error.code).toBe('vehicle_photo_upload_failed');
    }
    // The first call's `front` upload is still durable.
    const finalR = await vehicles.getByVin(vehicle.vin);
    expect(finalR.ok).toBe(true);
    if (finalR.ok) {
      expect(finalR.value.photos.front).not.toBeNull();
      expect(finalR.value.photos.back).toBeNull();
    }
  });

  it('returns AuthorizationError when no user is signed in', async () => {
    const auth = new InMemoryAuthRepository();
    const users = new InMemoryUserRepository();
    const vehicles = new InMemoryVehicleRepository();
    const vehiclePhotos = new InMemoryVehiclePhotoRepository();
    const sut = new UploadVehiclePhotos(
      auth,
      users,
      vehicles,
      vehiclePhotos,
      () => FIXED_NOW,
    );

    const r = await sut.execute({
      vin: vin(),
      photos: { front: 'file://a.jpg' },
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('auth_no_current_user');
    expect(vehiclePhotos.getUploads()).toHaveLength(0);
  });

  it('returns AuthorizationError when the signed-in user is a rider', async () => {
    const { auth, users, vehicles, vehiclePhotos } = await setupSignedInRider();
    const sut = new UploadVehiclePhotos(
      auth,
      users,
      vehicles,
      vehiclePhotos,
      () => FIXED_NOW,
    );

    const r = await sut.execute({
      vin: vin(),
      photos: { front: 'file://a.jpg' },
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('vehicle_photos_role_not_driver');
    expect(vehiclePhotos.getUploads()).toHaveLength(0);
  });

  it('returns AuthorizationError when the driver does not own the vehicle', async () => {
    const { auth, users, vehicles, vehiclePhotos } = await setupSignedInDriver({
      activeVehicleId: null,
      vehicleIds: [VIN_HONDA],
    });
    const sut = new UploadVehiclePhotos(
      auth,
      users,
      vehicles,
      vehiclePhotos,
      () => FIXED_NOW,
    );

    const r = await sut.execute({
      vin: vin(VIN_BMW),
      photos: { front: 'file://a.jpg' },
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('vehicle_photos_not_owned_by_driver');
    expect(vehiclePhotos.getUploads()).toHaveLength(0);
  });

  it('rejects an empty photos map', async () => {
    const { auth, users, vehicles, vehiclePhotos, vehicle } =
      await seedDriverWithVehicle();
    const sut = new UploadVehiclePhotos(
      auth,
      users,
      vehicles,
      vehiclePhotos,
      () => FIXED_NOW,
    );

    const r = await sut.execute({ vin: vehicle.vin, photos: {} });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('validation');
      expect(r.error.code).toBe('vehicle_photos_empty');
    }
    expect(vehiclePhotos.getUploads()).toHaveLength(0);
  });
});
