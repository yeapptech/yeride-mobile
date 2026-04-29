import { Vin } from '@domain/entities/Vin';

import { NhtsaVinDecoderService } from '../NhtsaVinDecoderService';

const VALID_VIN = '1HGBH41JXMN109186';

function vin() {
  const r = Vin.create(VALID_VIN);
  if (!r.ok) throw r.error;
  return r.value;
}

/**
 * Build a fake `fetch` that pattern-matches on URL substrings and
 * returns a queued response. Each entry is `(urlSubstring, response)`.
 *
 * The mock matches in order. If no match, the test fails loudly so we
 * don't accidentally pass with stale mocks.
 */
function mockFetch(
  responses: Array<{
    match: string;
    response: Response | (() => Promise<never>);
  }>,
) {
  const queue = [...responses];
  const fn = jest.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const idx = queue.findIndex((q) => url.includes(q.match));
    if (idx === -1) {
      throw new Error(`mockFetch: no match for ${url}`);
    }
    const [entry] = queue.splice(idx, 1);
    if (entry === undefined) throw new Error('mockFetch: empty entry');
    if (typeof entry.response === 'function') {
      return entry.response();
    }
    return entry.response;
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

function jsonResponse(body: unknown, init?: { status?: number }): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const MINIMAL_HONDA_RESULT = {
  Make: 'HONDA',
  Model: 'Accord',
  ModelYear: '2020',
  Trim: 'EX',
  BodyClass: 'Sedan',
  VehicleType: 'Passenger Car',
  Doors: '4',
  Seats: '5',
  WheelBase: '111',
  GVWR: 'Class 1A: 4,500 lb or less',
  ErrorCode: '0',
};

afterEach(() => {
  jest.restoreAllMocks();
  // @ts-expect-error reset global override
  delete global.fetch;
});

describe('NhtsaVinDecoderService.decode', () => {
  it('returns ok(decoded) on a happy path with stock photo', async () => {
    mockFetch([
      {
        match: 'DecodeVinValues',
        response: jsonResponse({ Results: [MINIMAL_HONDA_RESULT] }),
      },
      {
        match: 'SafetyRatings/modelyear',
        response: jsonResponse({
          Count: 1,
          Results: [{ VehicleId: 12345 }],
        }),
      },
      {
        match: 'SafetyRatings/VehicleId',
        response: jsonResponse({
          Results: [{ VehiclePicture: 'https://example.com/honda.jpg' }],
        }),
      },
    ]);
    const sut = new NhtsaVinDecoderService();

    const r = await sut.decode(vin());

    expect(r.ok).toBe(true);
    if (r.ok && r.value !== null) {
      expect(r.value.make).toBe('HONDA');
      expect(r.value.model).toBe('Accord');
      expect(r.value.year).toBe(2020);
      expect(r.value.vehicleClass).toBe('comfort'); // mid-size sedan via wheelbase >= 110
      expect(r.value.isEligible).toBe(true);
      expect(r.value.stockPhoto).toBe('https://example.com/honda.jpg');
      expect(r.value.eligibleServices.map(String)).toContain('economy');
      expect(r.value.eligibleServices.map(String)).toContain('comfort');
      expect(r.value.eligibleServices.map(String)).toContain('deliver');
    }
  });

  it('still returns ok(decoded) when the stock-photo fetch fails', async () => {
    mockFetch([
      {
        match: 'DecodeVinValues',
        response: jsonResponse({ Results: [MINIMAL_HONDA_RESULT] }),
      },
      {
        match: 'SafetyRatings/modelyear',
        response: jsonResponse({}, { status: 500 }),
      },
    ]);
    const sut = new NhtsaVinDecoderService();

    const r = await sut.decode(vin());

    expect(r.ok).toBe(true);
    if (r.ok && r.value !== null) {
      expect(r.value.make).toBe('HONDA');
      expect(r.value.stockPhoto).toBeNull();
    }
  });

  it('returns ok(null) when ErrorCode is non-zero', async () => {
    mockFetch([
      {
        match: 'DecodeVinValues',
        response: jsonResponse({
          Results: [
            {
              ErrorCode: '6',
              ErrorText: '6 - Incomplete VIN',
            },
          ],
        }),
      },
    ]);
    const sut = new NhtsaVinDecoderService();

    const r = await sut.decode(vin());

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeNull();
  });

  it('returns ok(null) when required fields are missing after parse', async () => {
    mockFetch([
      {
        match: 'DecodeVinValues',
        response: jsonResponse({
          Results: [
            {
              ErrorCode: '0',
              // Make + Model + ModelYear all missing.
            },
          ],
        }),
      },
    ]);
    const sut = new NhtsaVinDecoderService();

    const r = await sut.decode(vin());

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeNull();
  });

  it('returns NetworkError on HTTP 500', async () => {
    mockFetch([
      {
        match: 'DecodeVinValues',
        response: jsonResponse({}, { status: 500 }),
      },
    ]);
    const sut = new NhtsaVinDecoderService();

    const r = await sut.decode(vin());

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('network');
      expect(r.error.code).toBe('nhtsa_request_failed');
    }
  });

  it('returns NetworkError when fetch throws', async () => {
    mockFetch([
      {
        match: 'DecodeVinValues',
        response: () => {
          throw new TypeError('Network request failed');
        },
      },
    ]);
    const sut = new NhtsaVinDecoderService();

    const r = await sut.decode(vin());

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('network');
      expect(r.error.code).toBe('nhtsa_request_failed');
    }
  });

  it('returns NetworkError when the response is not JSON', async () => {
    const fn = jest.fn(async () => {
      return new Response('not-json', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    global.fetch = fn as unknown as typeof fetch;
    const sut = new NhtsaVinDecoderService();

    const r = await sut.decode(vin());

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('network');
      expect(r.error.code).toBe('nhtsa_response_invalid_json');
    }
  });

  it('returns ok(null) when the response has no Results array', async () => {
    mockFetch([
      {
        match: 'DecodeVinValues',
        response: jsonResponse({}),
      },
    ]);
    const sut = new NhtsaVinDecoderService();

    const r = await sut.decode(vin());

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeNull();
  });
});
