import { Vin } from '@domain/entities/Vin';
import { NetworkError, ValidationError } from '@domain/errors';

import { InMemoryVehiclePhotoRepository } from '../InMemoryVehiclePhotoRepository';

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

const VALID_VIN = '1HGBH41JXMN109186';

describe('InMemoryVehiclePhotoRepository.uploadPhoto', () => {
  it('returns a deterministic memory:// URL', async () => {
    const repo = new InMemoryVehiclePhotoRepository();
    const vin = unwrap(Vin.create(VALID_VIN));
    const r = await repo.uploadPhoto({
      vin,
      type: 'front',
      localUri: 'file:///tmp/front.jpg',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toBe(`memory://vehicles/${VALID_VIN}/front_1.jpg`);
  });

  it('returns distinct URLs for repeated uploads of the same (vin, type)', async () => {
    const repo = new InMemoryVehiclePhotoRepository();
    const vin = unwrap(Vin.create(VALID_VIN));
    const r1 = unwrap(
      await repo.uploadPhoto({ vin, type: 'front', localUri: 'a' }),
    );
    const r2 = unwrap(
      await repo.uploadPhoto({ vin, type: 'front', localUri: 'b' }),
    );
    expect(r1).not.toBe(r2);
    expect(r1).toBe(`memory://vehicles/${VALID_VIN}/front_1.jpg`);
    expect(r2).toBe(`memory://vehicles/${VALID_VIN}/front_2.jpg`);
  });

  it('records every upload for assertion via getUploads()', async () => {
    const repo = new InMemoryVehiclePhotoRepository();
    const vin = unwrap(Vin.create(VALID_VIN));
    await repo.uploadPhoto({ vin, type: 'front', localUri: 'a' });
    await repo.uploadPhoto({ vin, type: 'back', localUri: 'b' });
    const uploads = repo.getUploads();
    expect(uploads).toHaveLength(2);
    expect(uploads[0]?.type).toBe('front');
    expect(uploads[1]?.type).toBe('back');
  });

  it('rejects empty localUri with ValidationError', async () => {
    const repo = new InMemoryVehiclePhotoRepository();
    const vin = unwrap(Vin.create(VALID_VIN));
    const r = await repo.uploadPhoto({
      vin,
      type: 'front',
      localUri: '   ',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBeInstanceOf(ValidationError);
      expect(r.error.code).toBe('vehicle_photo_invalid_local_uri');
    }
  });

  it('returns the seeded NetworkError for the next call only', async () => {
    const repo = new InMemoryVehiclePhotoRepository();
    const vin = unwrap(Vin.create(VALID_VIN));
    repo.mockNextUploadError(
      new NetworkError({
        code: 'storage_upload_failed',
        message: 'Storage offline',
      }),
    );
    const r1 = await repo.uploadPhoto({
      vin,
      type: 'front',
      localUri: 'a',
    });
    expect(r1.ok).toBe(false);
    if (!r1.ok) {
      expect(r1.error).toBeInstanceOf(NetworkError);
    }
    // Subsequent call works.
    const r2 = await repo.uploadPhoto({
      vin,
      type: 'front',
      localUri: 'a',
    });
    expect(r2.ok).toBe(true);
  });
});
