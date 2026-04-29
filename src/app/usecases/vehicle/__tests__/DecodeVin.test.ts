import { NetworkError } from '@domain/errors';
import { FakeVinDecoderService } from '@shared/testing';

import { DecodeVin } from '../DecodeVin';

import { rsid, vin } from './fixtures';

describe('DecodeVin', () => {
  it('passes a successful decode through', async () => {
    const decoder = new FakeVinDecoderService();
    const v = vin();
    decoder.whenVin(v).respondWith({
      vin: v,
      make: 'Honda',
      model: 'Accord',
      year: 2020,
      trim: 'EX',
      bodyClass: 'Sedan',
      vehicleClass: 'comfort',
      seats: 5,
      doors: 4,
      eligibleServices: [rsid('economy'), rsid('comfort'), rsid('deliver')],
      stockPhoto: null,
      specs: {},
      isEligible: true,
    });
    const sut = new DecodeVin(decoder);

    const r = await sut.execute({ vin: v });

    expect(r.ok).toBe(true);
    if (r.ok && r.value !== null) {
      expect(r.value.make).toBe('Honda');
      expect(r.value.vehicleClass).toBe('comfort');
    }
  });

  it('passes Result.ok(null) (no-match) through', async () => {
    const decoder = new FakeVinDecoderService();
    decoder.whenVin(vin()).respondWithNoMatch();
    const sut = new DecodeVin(decoder);

    const r = await sut.execute({ vin: vin() });

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeNull();
  });

  it('passes a NetworkError through', async () => {
    const decoder = new FakeVinDecoderService();
    decoder.whenVin(vin()).respondWithNetworkError(
      new NetworkError({
        code: 'nhtsa_request_failed',
        message: 'NHTSA timed out',
      }),
    );
    const sut = new DecodeVin(decoder);

    const r = await sut.execute({ vin: vin() });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('network');
      expect(r.error.code).toBe('nhtsa_request_failed');
    }
  });
});
