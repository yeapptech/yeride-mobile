import { parseVehicleDoc, toDoc, toDomain } from '../vehicleMapper';

const VALID_VIN = '1HGBH41JXMN109186';
const FIXED_NOW = '2026-04-28T12:00:00.000Z';
const LATER = '2026-04-28T13:00:00.000Z';

/* ───────────────────────── parseVehicleDoc ───────────────────────── */

describe('parseVehicleDoc', () => {
  it('accepts a minimal pending vehicle doc', () => {
    const r = parseVehicleDoc({
      status: 'pending',
      make: 'Honda',
      model: 'Accord',
      year: 2020,
      vehicleClass: 'comfort',
      eligibleServices: ['economy', 'comfort'],
      dataSource: 'vin_decoded',
      createdAt: FIXED_NOW,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe('pending');
      expect(r.value.eligibleServices).toEqual(['economy', 'comfort']);
    }
  });

  it('accepts a fully-populated approved doc with all optional fields', () => {
    const r = parseVehicleDoc({
      vin: VALID_VIN,
      status: 'approved',
      make: 'Tesla',
      model: 'Model 3',
      year: 2022,
      trim: 'Long Range',
      bodyClass: 'sedan',
      vehicleClass: 'luxury',
      seats: 5,
      doors: 4,
      eligibleServices: ['comfort', 'luxury'],
      photos: {
        front: 'https://photos/front.jpg',
        back: 'https://photos/back.jpg',
        left: null,
        right: null,
        interior: null,
      },
      stockPhoto: 'https://nhtsa/stock.png',
      vehicleSpecs: {
        engine: { cylinders: 0, fuelType: 'Electric' },
        dimensions: { doors: 4, seats: 5 },
      },
      dataSource: 'vin_decoded',
      verificationNotes: null,
      verifiedAt: LATER,
      deletedAt: null,
      createdAt: FIXED_NOW,
      updatedAt: LATER,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe('approved');
      expect(r.value.photos?.front).toBe('https://photos/front.jpg');
      expect(r.value.vehicleSpecs?.engine?.fuelType).toBe('Electric');
    }
  });

  it('accepts a deleted doc (legacy soft-delete shape)', () => {
    const r = parseVehicleDoc({
      status: 'deleted',
      make: 'Honda',
      model: 'Accord',
      year: 2020,
      vehicleClass: 'comfort',
      eligibleServices: [],
      dataSource: 'vin_decoded',
      createdAt: FIXED_NOW,
      deletedAt: LATER,
    });
    expect(r.ok).toBe(true);
  });

  it('accepts a doc missing the photos map (legacy older docs)', () => {
    const r = parseVehicleDoc({
      status: 'pending',
      make: 'Honda',
      model: 'Accord',
      year: 2020,
      vehicleClass: 'comfort',
      eligibleServices: [],
      dataSource: 'vin_decoded',
      createdAt: FIXED_NOW,
    });
    expect(r.ok).toBe(true);
  });

  it('defaults eligibleServices and dataSource when missing', () => {
    const r = parseVehicleDoc({
      status: 'pending',
      make: 'Honda',
      model: 'Accord',
      year: 2020,
      vehicleClass: 'comfort',
      createdAt: FIXED_NOW,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.eligibleServices).toEqual([]);
      expect(r.value.dataSource).toBe('vin_decoded');
    }
  });

  it('accepts manual_entry dataSource', () => {
    const r = parseVehicleDoc({
      status: 'pending',
      make: 'Honda',
      model: 'Accord',
      year: 2020,
      vehicleClass: 'comfort',
      eligibleServices: [],
      dataSource: 'manual_entry',
      createdAt: FIXED_NOW,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.dataSource).toBe('manual_entry');
  });

  it('rejects an unknown status', () => {
    const r = parseVehicleDoc({
      status: 'not_a_real_status',
      make: 'Honda',
      model: 'Accord',
      year: 2020,
      vehicleClass: 'comfort',
      eligibleServices: [],
      dataSource: 'vin_decoded',
      createdAt: FIXED_NOW,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('vehicle_doc_invalid_shape');
  });

  it('rejects an unknown vehicleClass', () => {
    const r = parseVehicleDoc({
      status: 'pending',
      make: 'Honda',
      model: 'Accord',
      year: 2020,
      vehicleClass: 'private_jet',
      eligibleServices: [],
      dataSource: 'vin_decoded',
      createdAt: FIXED_NOW,
    });
    expect(r.ok).toBe(false);
  });

  it('rejects out-of-range year', () => {
    const r = parseVehicleDoc({
      status: 'pending',
      make: 'Honda',
      model: 'Accord',
      year: 1800,
      vehicleClass: 'comfort',
      eligibleServices: [],
      dataSource: 'vin_decoded',
      createdAt: FIXED_NOW,
    });
    expect(r.ok).toBe(false);
  });
});

/* ───────────────────────── toDomain ───────────────────────── */

describe('toDomain', () => {
  it('hydrates a Vehicle with the doc id as its VIN', () => {
    const docR = parseVehicleDoc({
      status: 'approved',
      make: 'Honda',
      model: 'Accord',
      year: 2020,
      vehicleClass: 'comfort',
      eligibleServices: ['economy', 'comfort'],
      dataSource: 'vin_decoded',
      createdAt: FIXED_NOW,
    });
    if (!docR.ok) throw docR.error;
    const r = toDomain(VALID_VIN, docR.value);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(String(r.value.vin)).toBe(VALID_VIN);
    expect(r.value.status).toBe('approved');
    expect(r.value.eligibleServices.map(String)).toEqual([
      'economy',
      'comfort',
    ]);
  });

  it('falls back updatedAt to createdAt when missing', () => {
    const docR = parseVehicleDoc({
      status: 'pending',
      make: 'Honda',
      model: 'Accord',
      year: 2020,
      vehicleClass: 'comfort',
      eligibleServices: [],
      dataSource: 'vin_decoded',
      createdAt: FIXED_NOW,
    });
    if (!docR.ok) throw docR.error;
    const r = toDomain(VALID_VIN, docR.value);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.updatedAt).toEqual(r.value.createdAt);
  });

  it('rejects when the doc id is not a valid VIN', () => {
    const docR = parseVehicleDoc({
      status: 'pending',
      make: 'Honda',
      model: 'Accord',
      year: 2020,
      vehicleClass: 'comfort',
      eligibleServices: [],
      dataSource: 'vin_decoded',
      createdAt: FIXED_NOW,
    });
    if (!docR.ok) throw docR.error;
    const r = toDomain('NOT_A_VIN', docR.value);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // Either length or format depending on the bad id; both valid.
      expect(r.error.code).toMatch(/^vin_/);
    }
  });

  it('rejects when an eligibleServices entry is malformed', () => {
    const docR = parseVehicleDoc({
      status: 'pending',
      make: 'Honda',
      model: 'Accord',
      year: 2020,
      vehicleClass: 'comfort',
      eligibleServices: ['Economy!'], // upper-case + bang violates the slug regex
      dataSource: 'vin_decoded',
      createdAt: FIXED_NOW,
    });
    if (!docR.ok) throw docR.error;
    const r = toDomain(VALID_VIN, docR.value);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('ride_service_id_invalid_format');
  });

  it('rejects when createdAt is not a parseable ISO string', () => {
    const docR = parseVehicleDoc({
      status: 'pending',
      make: 'Honda',
      model: 'Accord',
      year: 2020,
      vehicleClass: 'comfort',
      eligibleServices: [],
      dataSource: 'vin_decoded',
      createdAt: 'not-a-date',
    });
    if (!docR.ok) throw docR.error;
    const r = toDomain(VALID_VIN, docR.value);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('vehicle_doc_invalid_date');
  });
});

/* ───────────────────────── toDoc + round trip ───────────────────────── */

describe('toDoc round trip', () => {
  it('round-trips an approved vehicle (toDomain → toDoc → parse → toDomain)', () => {
    const docR = parseVehicleDoc({
      status: 'approved',
      make: 'Tesla',
      model: 'Model 3',
      year: 2022,
      trim: 'Long Range',
      bodyClass: 'sedan',
      vehicleClass: 'luxury',
      seats: 5,
      doors: 4,
      eligibleServices: ['comfort', 'luxury'],
      photos: {
        front: 'https://photos/front.jpg',
        back: null,
        left: null,
        right: null,
        interior: null,
      },
      stockPhoto: 'https://nhtsa/stock.png',
      vehicleSpecs: {
        engine: { cylinders: 0, fuelType: 'Electric' },
      },
      dataSource: 'vin_decoded',
      verificationNotes: null,
      verifiedAt: LATER,
      deletedAt: null,
      createdAt: FIXED_NOW,
      updatedAt: LATER,
    });
    if (!docR.ok) throw docR.error;

    const v1 = toDomain(VALID_VIN, docR.value);
    if (!v1.ok) throw v1.error;

    const wire = toDoc(v1.value);
    expect(wire.status).toBe('approved');
    expect(wire.photos.front).toBe('https://photos/front.jpg');
    expect(wire.vehicleSpecs?.engine?.fuelType).toBe('Electric');

    const v2 = toDomain(VALID_VIN, wire as never);
    if (!v2.ok) throw v2.error;
    expect(v2.value.status).toBe(v1.value.status);
    expect(v2.value.make).toBe(v1.value.make);
    expect(v2.value.year).toBe(v1.value.year);
    expect(v2.value.eligibleServices.map(String)).toEqual(
      v1.value.eligibleServices.map(String),
    );
    expect(v2.value.photos).toEqual(v1.value.photos);
    expect(v2.value.verifiedAt).toEqual(v1.value.verifiedAt);
    expect(v2.value.createdAt).toEqual(v1.value.createdAt);
  });

  it('round-trips a deleted vehicle', () => {
    const docR = parseVehicleDoc({
      status: 'deleted',
      make: 'Honda',
      model: 'Accord',
      year: 2020,
      vehicleClass: 'comfort',
      eligibleServices: [],
      dataSource: 'vin_decoded',
      createdAt: FIXED_NOW,
      deletedAt: LATER,
      updatedAt: LATER,
    });
    if (!docR.ok) throw docR.error;
    const v1 = toDomain(VALID_VIN, docR.value);
    if (!v1.ok) throw v1.error;
    const wire = toDoc(v1.value);
    expect(wire.status).toBe('deleted');
    expect(wire.deletedAt).toBe(LATER);
  });

  it('produces an empty photos map for a vehicle with no photos', () => {
    const docR = parseVehicleDoc({
      status: 'pending',
      make: 'Honda',
      model: 'Accord',
      year: 2020,
      vehicleClass: 'comfort',
      eligibleServices: [],
      dataSource: 'vin_decoded',
      createdAt: FIXED_NOW,
    });
    if (!docR.ok) throw docR.error;
    const v1 = toDomain(VALID_VIN, docR.value);
    if (!v1.ok) throw v1.error;
    const wire = toDoc(v1.value);
    expect(wire.photos).toEqual({
      front: null,
      back: null,
      left: null,
      right: null,
      interior: null,
    });
  });
});
