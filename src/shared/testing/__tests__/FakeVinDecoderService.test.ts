import { RideServiceId } from '@domain/entities/RideServiceId';
import { Vin } from '@domain/entities/Vin';
import { NetworkError } from '@domain/errors';
import type { VinDecodeResult } from '@domain/services';

import { FakeVinDecoderService } from '../FakeVinDecoderService';

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

const VALID_VIN_HONDA = '1HGBH41JXMN109186';
const VALID_VIN_BMW = '5UXKR0C58JL074657';

function makeDecodeResult(vinStr: string): VinDecodeResult {
  return {
    vin: unwrap(Vin.create(vinStr)),
    make: 'Honda',
    model: 'Accord',
    year: 2020,
    trim: 'EX-L',
    bodyClass: 'Sedan/Saloon',
    vehicleClass: 'comfort',
    seats: 5,
    doors: 4,
    eligibleServices: [
      unwrap(RideServiceId.create('economy')),
      unwrap(RideServiceId.create('comfort')),
    ],
    stockPhoto: null,
    specs: {},
    isEligible: true,
  };
}

describe('FakeVinDecoderService', () => {
  it('returns Result.ok(null) for an unseeded VIN', async () => {
    const decoder = new FakeVinDecoderService();
    const vin = unwrap(Vin.create(VALID_VIN_HONDA));
    const r = await decoder.decode(vin);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeNull();
  });

  it('returns the seeded result when whenVin().respondWith was called', async () => {
    const decoder = new FakeVinDecoderService();
    const vin = unwrap(Vin.create(VALID_VIN_HONDA));
    const seeded = makeDecodeResult(VALID_VIN_HONDA);
    decoder.whenVin(vin).respondWith(seeded);
    const r = await decoder.decode(vin);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(seeded);
  });

  it('returns null when whenVin().respondWithNoMatch was called', async () => {
    const decoder = new FakeVinDecoderService();
    const vin = unwrap(Vin.create(VALID_VIN_HONDA));
    decoder.whenVin(vin).respondWithNoMatch();
    const r = await decoder.decode(vin);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeNull();
  });

  it('returns Result.err(NetworkError) when whenVin().respondWithNetworkError was called', async () => {
    const decoder = new FakeVinDecoderService();
    const vin = unwrap(Vin.create(VALID_VIN_HONDA));
    const err = new NetworkError({
      code: 'nhtsa_request_failed',
      message: 'NHTSA timed out',
    });
    decoder.whenVin(vin).respondWithNetworkError(err);
    const r = await decoder.decode(vin);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(err);
  });

  it('only matches the specific VIN registered (other VINs still no-match)', async () => {
    const decoder = new FakeVinDecoderService();
    const honda = unwrap(Vin.create(VALID_VIN_HONDA));
    const vw = unwrap(Vin.create(VALID_VIN_BMW));
    decoder.whenVin(honda).respondWith(makeDecodeResult(VALID_VIN_HONDA));

    const rHonda = await decoder.decode(honda);
    expect(rHonda.ok).toBe(true);
    if (rHonda.ok) expect(rHonda.value).not.toBeNull();

    const rVw = await decoder.decode(vw);
    expect(rVw.ok).toBe(true);
    if (rVw.ok) expect(rVw.value).toBeNull();
  });

  it('counts decode calls for fetch-once assertions', async () => {
    const decoder = new FakeVinDecoderService();
    const vin = unwrap(Vin.create(VALID_VIN_HONDA));
    expect(decoder.callCount).toBe(0);
    await decoder.decode(vin);
    await decoder.decode(vin);
    expect(decoder.callCount).toBe(2);
  });
});
